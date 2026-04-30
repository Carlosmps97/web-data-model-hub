/**
 * Script de migración: JSON local → Azure Cosmos DB for MongoDB
 *
 * Lee data/projects.json y data/models/*.json y los inserta en Cosmos DB
 * con el schema definido en COSMOS_DB_SCHEMA.md.
 *
 * Uso:
 *   cd web-data-model-hub
 *   node scripts/migrate-to-cosmos.mjs
 *
 * Requiere: COSMOS_CONNECTION_STRING y COSMOS_DATABASE en .env
 */

import { MongoClient } from 'mongodb';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { createRequire } from 'module';

// ── Cargar .env manualmente (sin dependencia de dotenv) ──────────────────
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = await readFile(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING;
const DATABASE = process.env.COSMOS_DATABASE ?? 'db_modeler';
const DATA_DIR = resolve(process.cwd(), process.env.DATA_DIR ?? './data');

if (!CONNECTION_STRING) {
  console.error('❌  COSMOS_CONNECTION_STRING no está definido en .env');
  process.exit(1);
}

// ── Conexión ──────────────────────────────────────────────────────────────
console.log(`\n🔌  Conectando a Cosmos DB (${DATABASE})…`);
const client = new MongoClient(CONNECTION_STRING, { serverSelectionTimeoutMS: 15_000 });
await client.connect();
const db = client.db(DATABASE);
console.log('✅  Conectado.\n');

// Helper: insertar o actualizar (upsert)
const c = (name) => db.collection(name);

// ── Leer datos locales ────────────────────────────────────────────────────
const projectsFile = join(DATA_DIR, 'projects.json');
const modelsDir    = join(DATA_DIR, 'models');

let projects = [];
if (existsSync(projectsFile)) {
  const raw = await readFile(projectsFile, 'utf-8');
  projects = JSON.parse(raw);
  console.log(`📁  Proyectos encontrados: ${projects.length}`);
} else {
  console.log('⚠️   No se encontró projects.json — se omite la migración de proyectos.');
}

let modelFiles = [];
if (existsSync(modelsDir)) {
  const entries = await readdir(modelsDir);
  modelFiles = entries.filter((f) => f.endsWith('.json'));
  console.log(`📂  Modelos encontrados: ${modelFiles.length}\n`);
} else {
  console.log('⚠️   No se encontró la carpeta data/models — se omite la migración de modelos.\n');
}

// ── Migrar Proyectos ──────────────────────────────────────────────────────
if (projects.length > 0) {
  console.log('📋  Migrando proyectos…');
  for (const project of projects) {
    const { id, ...rest } = project;
    await c('projects').updateOne(
      { _id: id },
      { $set: { _id: id, ...rest } },
      { upsert: true },
    );
    console.log(`   ✓ ${project.name} (${id.slice(0, 8)}…)`);
  }
  console.log();
}

// ── Migrar Modelos ────────────────────────────────────────────────────────
let totalTables = 0, totalRels = 0, totalViews = 0;

for (const file of modelFiles) {
  const filePath = join(modelsDir, file);
  const raw = await readFile(filePath, 'utf-8');
  let model;
  try {
    model = JSON.parse(raw);
  } catch {
    console.warn(`   ⚠️  ${file}: JSON inválido, se omite.`);
    continue;
  }

  const {
    id,
    tables = [],
    relationships = [],
    views = [],
    domainCatalog = [],
    ...meta
  } = model;

  // Normalizar engine legacy
  if (meta.engine === 'databricks') meta.engine = 'databricks_sql';

  // 1. Metadata del modelo (upsert)
  await c('models').updateOne(
    { _id: id },
    {
      $set: {
        _id: id,
        ...meta,
        domainCatalog,
        tableCount: tables.length,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );

  // 2. Tablas — borrar existentes e insertar nuevas
  //    Sin canvasPosition: si existía en el JSON se elimina automáticamente
  //    al no incluirlo en el doc insertado.
  await c('model_tables').deleteMany({ modelId: id });
  if (tables.length > 0) {
    const tableDocs = tables.map(({ id: tid, ...trest }) => {
      // Asegurarse de que canvasPosition NO se persiste
      const { canvasPosition: _cp, ...clean } = trest;
      return { _id: tid, modelId: id, ...clean };
    });
    await c('model_tables').insertMany(tableDocs);
  }

  // 3. Relaciones
  await c('model_relationships').deleteMany({ modelId: id });
  if (relationships.length > 0) {
    const relDocs = relationships.map(({ id: rid, ...rrest }) => ({
      _id: rid, modelId: id, ...rrest,
    }));
    await c('model_relationships').insertMany(relDocs);
  }

  // 4. Vistas
  await c('model_views').deleteMany({ modelId: id });
  if (views.length > 0) {
    const viewDocs = views.map(({ id: vid, ...vrest }) => ({
      _id: vid, modelId: id, ...vrest,
    }));
    await c('model_views').insertMany(viewDocs);
  }

  totalTables += tables.length;
  totalRels   += relationships.length;
  totalViews  += views.length;

  console.log(
    `   ✓ ${meta.name ?? id.slice(0,8)} — ` +
    `${tables.length} tablas, ${relationships.length} rels, ${views.length} vistas`,
  );
}

// ── Índices ───────────────────────────────────────────────────────────────
// Cosmos DB puede lanzar NamespaceExists (code 48) si la colección
// ya fue creada al insertar datos. Se tolera ese error.
console.log('\n🔍  Creando índices…');
const tryIdx = async (col, spec) => {
  try { await col.createIndex(spec); }
  catch (e) { if (e?.code !== 48) throw e; }
};
await Promise.all([
  tryIdx(c('models'),              { projectId: 1, updatedAt: -1 }),
  tryIdx(c('model_tables'),        { modelId: 1 }),
  tryIdx(c('model_tables'),        { modelId: 1, schema: 1 }),
  tryIdx(c('model_tables'),        { modelId: 1, domain: 1 }),
  tryIdx(c('model_relationships'), { modelId: 1 }),
  tryIdx(c('model_views'),         { modelId: 1 }),
  tryIdx(c('model_views'),         { modelId: 1, sourceTableId: 1 }),
]);
console.log('✅  Índices creados.');

// ── Resumen ───────────────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════╗
║         Migración completada         ║
╠══════════════════════════════════════╣
║  Proyectos  : ${String(projects.length).padEnd(24)}║
║  Modelos    : ${String(modelFiles.length).padEnd(24)}║
║  Tablas     : ${String(totalTables).padEnd(24)}║
║  Relaciones : ${String(totalRels).padEnd(24)}║
║  Vistas     : ${String(totalViews).padEnd(24)}║
╚══════════════════════════════════════╝
`);

await client.close();
