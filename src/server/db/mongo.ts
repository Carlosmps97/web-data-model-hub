/**
 * Azure Cosmos DB for MongoDB storage adapter.
 *
 * Única capa de persistencia del proyecto. Expone una API por entidad
 * (projects/models/tables/relationships/views) que los route handlers
 * de `@/app/api/*` consumen. Sin `canvasPosition`: las posiciones de
 * nodos son estado volátil de sesión (React Flow in-memory), nunca se
 * persisten.
 *
 * Colecciones:
 *   projects            metadata de proyectos
 *   models              metadata + domainCatalog embebido
 *   model_tables        una tabla por doc (+ modelId como campo)
 *   model_relationships una relación FK por doc (+ modelId)
 *   model_views         una vista SQL por doc (+ modelId)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient, type Db } from 'mongodb';
import type {
  Project,
  DataModel,
  TableModel,
  Relationship,
  ViewModel,
  DomainDefinition,
  DatabaseEngine,
} from '@/types/model';

// ─── Singleton de conexión ────────────────────────────────────────────────

let _client: MongoClient | null = null;
let _db: Db | null = null;

async function getDb(): Promise<Db> {
  if (_db) return _db;
  const uri = process.env.COSMOS_CONNECTION_STRING;
  const dbName = process.env.COSMOS_DATABASE ?? 'db_modeler';
  if (!uri) throw new Error('COSMOS_CONNECTION_STRING is not set');
  _client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  await _client.connect();
  _db = _client.db(dbName);
  await ensureIndexes(_db);
  return _db;
}

/** Colección sin restricciones de tipo (usamos UUIDs como _id string). */
const col = (db: Db, name: string) => db.collection(name) as any;

async function ensureIndexes(db: Db): Promise<void> {
  // Cosmos DB for MongoDB puede lanzar NamespaceExists (code 48) si la
  // colección ya fue creada implícitamente al insertar datos. Se ignora ese
  // error específico; el índice se habrá creado igualmente.
  const tryIndex = async (colName: string, spec: Record<string, unknown>) => {
    try {
      await col(db, colName).createIndex(spec);
    } catch (err: any) {
      if (err?.code !== 48) throw err; // re-lanzar errores inesperados
    }
  };
  await Promise.all([
    tryIndex('models',              { projectId: 1, updatedAt: -1 }),
    tryIndex('model_tables',        { modelId: 1 }),
    tryIndex('model_tables',        { modelId: 1, schema: 1 }),
    tryIndex('model_tables',        { modelId: 1, domain: 1 }),
    tryIndex('model_relationships', { modelId: 1 }),
    tryIndex('model_views',         { modelId: 1 }),
    tryIndex('model_views',         { modelId: 1, sourceTableId: 1 }),
  ]);
}

// ─── Helpers de conversión ────────────────────────────────────────────────

function normalizeEngine(e?: string): DatabaseEngine | undefined {
  return (e === 'databricks' ? 'databricks_sql' : e) as DatabaseEngine | undefined;
}

function toProject(doc: any): Project {
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) };
}

function toTable(doc: any): TableModel {
  const { _id, modelId: _m, ...rest } = doc;
  return { ...rest, id: String(_id) };
}

function toRelationship(doc: any): Relationship {
  const { _id, modelId: _m, ...rest } = doc;
  return { ...rest, id: String(_id) };
}

function toView(doc: any): ViewModel {
  const { _id, modelId: _m, ...rest } = doc;
  return { ...rest, id: String(_id) };
}

function toModelMeta(
  doc: any,
  tables: TableModel[] = [],
  relationships: Relationship[] = [],
  views: ViewModel[] = [],
): DataModel {
  const { _id, tableCount: _tc, ...rest } = doc;
  return {
    ...rest,
    id: String(_id),
    engine: normalizeEngine(rest.engine),
    tables,
    relationships,
    views: views ?? [],
    domainCatalog: (rest.domainCatalog as DomainDefinition[]) ?? [],
  };
}

// ─── Reemplazo masivo ─────────────────────────────────────────────────────

/**
 * Reemplaza el conjunto de entidades hijas (tablas, relaciones o vistas) de
 * un `modelId`, manteniendo soft-delete como pista de auditoría.
 *
 * Implementación: el algoritmo previo era `updateMany($flgactive=false)` +
 * `insertMany(...)` con los mismos `_id`. Eso fallaba con E11000 (duplicate
 * key) porque MongoDB exige unicidad de `_id` aunque el doc anterior esté
 * soft-deleted, dejando todo el set inactivo y las tablas "perdidas" en el
 * editor (mientras el `tableCount` desnormalizado seguía mostrando el valor
 * antiguo en el listado de modelos).
 *
 * Nuevo algoritmo:
 *   1. Soft-delete sólo los docs cuyo `_id` NO viene en el payload (borrados
 *      reales solicitados por el usuario al quitar la tabla).
 *   2. `bulkWrite` con `replaceOne(... upsert:true)` para cada entidad del
 *      payload: reemplaza el doc en sitio (sin colisión de `_id`) y lo
 *      marca `flgactive: true`. Si la entidad estaba soft-deleted, se
 *      revive automáticamente.
 */
async function replaceEntities<T extends { id: string }>(
  db: Db,
  colName: string,
  modelId: string,
  entities: T[],
): Promise<void> {
  const c = col(db, colName);
  const now = new Date().toISOString();
  const incomingIds = entities.map((e) => e.id);

  // 1) Soft-delete de las entidades que el cliente ya no manda.
  await c.updateMany(
    { modelId, _id: { $nin: incomingIds } },
    { $set: { flgactive: false, deletedAt: now } },
  );

  // 2) Upsert/replace de las que sí vienen, marcándolas activas.
  if (entities.length > 0) {
    const ops = entities.map(({ id, ...rest }) => ({
      replaceOne: {
        filter: { _id: id as unknown as string },
        replacement: {
          _id: id,
          modelId,
          flgactive: true,
          updatedAt: now,
          ...rest,
        },
        upsert: true,
      },
    }));
    await c.bulkWrite(ops as unknown as Parameters<typeof c.bulkWrite>[0]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROYECTOS
// ═══════════════════════════════════════════════════════════════════════════

export async function getProjects(): Promise<Project[]> {
  const db = await getDb();
  // Solo proyectos activos (excluir soft-deleted)
  const docs = await col(db, 'projects').find({ flgactive: { $ne: false } }).toArray();
  return docs.map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const doc = await col(db, 'projects').findOne({ _id: id, flgactive: { $ne: false } });
  return doc ? toProject(doc) : null;
}

export async function createProject(project: Project): Promise<Project> {
  const db = await getDb();
  const { id, ...rest } = project;
  await col(db, 'projects').insertOne({ _id: id, ...rest });
  return project;
}

export async function updateProject(
  id: string,
  updates: Partial<Project>,
): Promise<Project | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _ignore, ...rest } = updates;
  const result = await col(db, 'projects').findOneAndUpdate(
    { _id: id },
    { $set: { ...rest, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' },
  );
  return result ? toProject(result) : null;
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = await getDb();
  const now = new Date().toISOString();
  // Soft-delete en cascada: inactiva todos los modelos del proyecto
  const modelDocs = await col(db, 'models')
    .find({ projectId: id }, { projection: { _id: 1 } })
    .toArray();
  await Promise.all(modelDocs.map((m: any) => deleteModel(String(m._id))));
  // Soft-delete del proyecto
  const result = await col(db, 'projects').updateOne(
    { _id: id },
    { $set: { flgactive: false, deletedAt: now, updatedAt: now } },
  );
  return result.modifiedCount > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODELOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lista modelos. El listado estándar devuelve stubs de tabla (solo la
 * longitud correcta) porque la mayoría de consumidores — home, dashboard
 * y vista de proyecto — solo necesitan el conteo para sus tarjetas.
 *
 * Para vistas que sí necesitan los datos reales (Global Canvas), pasar
 * `full: true`: en ese caso se hace una única query agregada por
 * colección (`model_tables`, `model_relationships`, `model_views`) y se
 * arman los modelos completos. Esto evita N+1 round-trips al DB sin
 * perder consistencia con el editor individual.
 */
export async function getModels(
  projectId?: string,
  opts: { full?: boolean } = {},
): Promise<DataModel[]> {
  const db = await getDb();
  // Excluir registros inactivos (soft-deleted)
  const filter = projectId
    ? { projectId, flgactive: { $ne: false } }
    : { flgactive: { $ne: false } };
  const docs = await col(db, 'models').find(filter).sort({ updatedAt: -1 }).toArray();
  if (docs.length === 0) return [];

  const modelIds = docs.map((d: any) => d._id);

  if (opts.full) {
    // Tres queries en paralelo agrupadas por modelId
    const [tableDocs, relDocs, viewDocs] = await Promise.all([
      col(db, 'model_tables')
        .find({ modelId: { $in: modelIds }, flgactive: { $ne: false } })
        .toArray(),
      col(db, 'model_relationships')
        .find({ modelId: { $in: modelIds }, flgactive: { $ne: false } })
        .toArray(),
      col(db, 'model_views')
        .find({ modelId: { $in: modelIds }, flgactive: { $ne: false } })
        .toArray(),
    ]);

    const tablesByModel = new Map<string, TableModel[]>();
    const relsByModel = new Map<string, ReturnType<typeof toRelationship>[]>();
    const viewsByModel = new Map<string, ReturnType<typeof toView>[]>();
    tableDocs.forEach((d: any) => {
      const k = String(d.modelId);
      if (!tablesByModel.has(k)) tablesByModel.set(k, []);
      tablesByModel.get(k)!.push(toTable(d));
    });
    relDocs.forEach((d: any) => {
      const k = String(d.modelId);
      if (!relsByModel.has(k)) relsByModel.set(k, []);
      relsByModel.get(k)!.push(toRelationship(d));
    });
    viewDocs.forEach((d: any) => {
      const k = String(d.modelId);
      if (!viewsByModel.has(k)) viewsByModel.set(k, []);
      viewsByModel.get(k)!.push(toView(d));
    });

    return docs.map((doc: any) =>
      toModelMeta(
        doc,
        tablesByModel.get(String(doc._id)) ?? [],
        relsByModel.get(String(doc._id)) ?? [],
        viewsByModel.get(String(doc._id)) ?? [],
      ),
    );
  }

  // Modo conteo (default): stubs ligeros
  const counts = await col(db, 'model_tables')
    .aggregate([
      { $match: { modelId: { $in: modelIds }, flgactive: { $ne: false } } },
      { $group: { _id: '$modelId', count: { $sum: 1 } } },
    ])
    .toArray();
  const countByModel = new Map<string, number>(
    counts.map((c: any) => [String(c._id), c.count as number]),
  );

  return docs.map((doc: any) => {
    const count = countByModel.get(String(doc._id)) ?? 0;
    const stubs: TableModel[] = Array.from({ length: count }, (_, i) => ({
      id: `stub-${i}`, name: '', columns: [], schema: '',
    }));
    return toModelMeta(doc, stubs, [], []);
  });
}

/** Carga el modelo completo (metadata + tablas + relaciones + vistas). */
export async function getModel(id: string): Promise<DataModel | null> {
  const db = await getDb();
  const [modelDoc, tableDocs, relDocs, viewDocs] = await Promise.all([
    col(db, 'models').findOne({ _id: id, flgactive: { $ne: false } }),
    col(db, 'model_tables').find({ modelId: id, flgactive: { $ne: false } }).toArray(),
    col(db, 'model_relationships').find({ modelId: id, flgactive: { $ne: false } }).toArray(),
    col(db, 'model_views').find({ modelId: id, flgactive: { $ne: false } }).toArray(),
  ]);
  if (!modelDoc) return null;
  return toModelMeta(
    modelDoc,
    tableDocs.map(toTable),
    relDocs.map(toRelationship),
    viewDocs.map(toView),
  );
}

export async function createModel(model: DataModel): Promise<DataModel> {
  const db = await getDb();
  const { id, tables, relationships, views, domainCatalog, ...meta } = model;
  await col(db, 'models').insertOne({
    _id: id,
    ...meta,
    domainCatalog: domainCatalog ?? [],
    tableCount: tables.length,
    updatedAt: new Date().toISOString(),
  });
  await Promise.all([
    replaceEntities(db, 'model_tables', id, tables),
    replaceEntities(db, 'model_relationships', id, relationships),
    replaceEntities(db, 'model_views', id, views ?? []),
  ]);
  return model;
}

export async function updateModel(
  id: string,
  updates: Partial<DataModel>,
): Promise<DataModel | null> {
  const db = await getDb();
  const exists = await col(db, 'models').findOne(
    { _id: id },
    { projection: { _id: 1 } },
  );
  if (!exists) return null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tables, relationships, views, domainCatalog, id: _id, ...meta } = updates;

  const metaUpdate: Record<string, unknown> = {
    ...meta,
    updatedAt: new Date().toISOString(),
  };
  if (domainCatalog !== undefined) metaUpdate.domainCatalog = domainCatalog;
  if (tables !== undefined) metaUpdate.tableCount = tables.length;

  await col(db, 'models').updateOne({ _id: id }, { $set: metaUpdate });

  await Promise.all([
    tables !== undefined && replaceEntities(db, 'model_tables', id, tables),
    relationships !== undefined && replaceEntities(db, 'model_relationships', id, relationships),
    views !== undefined && replaceEntities(db, 'model_views', id, views),
  ].filter(Boolean));

  return getModel(id);
}

export async function deleteModel(id: string): Promise<boolean> {
  const db = await getDb();
  const now = new Date().toISOString();
  // Soft-delete: marcar modelo y sus entidades como inactivos
  // Las entidades (tablas, relaciones, vistas) se marcan también para trazabilidad.
  await Promise.all([
    col(db, 'model_tables').updateMany(
      { modelId: id },
      { $set: { flgactive: false, deletedAt: now } },
    ),
    col(db, 'model_relationships').updateMany(
      { modelId: id },
      { $set: { flgactive: false, deletedAt: now } },
    ),
    col(db, 'model_views').updateMany(
      { modelId: id },
      { $set: { flgactive: false, deletedAt: now } },
    ),
  ]);
  const result = await col(db, 'models').updateOne(
    { _id: id },
    { $set: { flgactive: false, deletedAt: now, updatedAt: now } },
  );
  return result.modifiedCount > 0;
}
