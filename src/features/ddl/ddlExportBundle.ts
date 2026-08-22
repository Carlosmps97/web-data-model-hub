/**
 * ddlExportBundle — arma la lista de archivos del `.zip` del Export DDL (doc 37).
 *
 * PURO: no toca el DOM ni la red. Recibe el DDL ya partido por objeto (de
 * cualquiera de los dos caminos: `tableStatements`/`viewStatements` sin reglas,
 * o `rendered.statements` con reglas) y lo mapea a rutas `carpeta/archivo`:
 *   {Tabla}/[TABLE] {Tabla}.sql, {Tabla}/[VIEW] {Vista}.sql
 * Cada tabla (con sus vistas y artefactos generados) en su carpeta; varias
 * tablas = varias carpetas dentro del mismo zip.
 */
import type { ZipEntry } from '@/lib/zip';

export interface DdlObject {
  /** Nombre físico de la TABLA a cuya carpeta pertenece el objeto ('' → _views). */
  tableName: string;
  /** Esquema de esa tabla — desambigua la carpeta ante nombres físicos iguales. */
  tableSchema?: string;
  kind: 'table' | 'view';
  /** Nombre del objeto — va al nombre del archivo. */
  name: string;
  sql: string;
}

// Artefactos del motor de reglas (doc 30) que el pipeline emite (backend).
const PHYSICAL = 'ddl.tabla_fisica';
const PHYSICAL_TAGS = 'ddl.tabla_fisica.tags';
const VIEW_BUSINESS = 'ddl.vista_negocio';
const VIEW_PASSIVE = 'ddl.vista';

const ROOT_VIEWS = '_views';

/** Clave estable para el mapa vista→fuentes: (schema, name). */
export function viewKey(schema: string | null | undefined, name: string): string {
  return JSON.stringify([schema ?? '', name]);
}

/** Reemplaza ilegales en Windows y control chars; preserva `[] () ` y espacios. */
function sanitizeName(s: string): string {
  // eslint-disable-next-line no-control-regex
  const out = (s ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '_').trim();
  return out || 'unnamed';
}

function folderKey(o: DdlObject): string {
  return o.tableName === '' ? '__views_root__' : JSON.stringify([o.tableSchema ?? '', o.tableName]);
}

function isViewSql(sql: string): boolean {
  return /^\s*CREATE\s+(OR\s+REPLACE\s+)?(TEMP(ORARY)?\s+)?VIEW\b/i.test(sql);
}

/** Camino SIN reglas: una tabla = un objeto; cada vista a su tabla fuente. */
export function plainToObjects(args: {
  tables: { id: string; physicalName: string; schema?: string; sql: string }[];
  views: { name: string; schema?: string; sourceTableIds: string[]; sql: string }[];
}): DdlObject[] {
  const byId = new Map(args.tables.map((t) => [t.id, t]));
  const objects: DdlObject[] = args.tables.map((t) => ({
    tableName: t.physicalName, tableSchema: t.schema, kind: 'table', name: t.physicalName, sql: t.sql,
  }));
  for (const v of args.views) {
    const homeId = v.sourceTableIds.find((id) => byId.has(id));
    const home = homeId ? byId.get(homeId) : undefined;
    objects.push({
      tableName: home?.physicalName ?? '', tableSchema: home?.schema,
      kind: 'view', name: v.name, sql: v.sql,
    });
  }
  return objects;
}

/** Camino CON reglas: agrupa los statements del motor por tabla. */
export function statementsToObjects(args: {
  statements: { artifact: string; schema?: string | null; name?: string | null; sql: string }[];
  viewSources: Map<string, string[]>;
  tablesById: Map<string, { physicalName: string; schema?: string }>;
}): DdlObject[] {
  const { statements, viewSources, tablesById } = args;
  const objects: DdlObject[] = [];
  let currentPhysical: DdlObject | null = null;
  let currentKey = '';
  const keyOf = (s: { schema?: string | null; name?: string | null }) =>
    JSON.stringify([s.schema ?? '', s.name ?? '']);

  const resolveHome = (s: { schema?: string | null; name?: string | null }) => {
    const src = viewSources.get(viewKey(s.schema, s.name ?? '')) ?? [];
    const homeId = src.find((id) => tablesById.has(id));
    const t = homeId ? tablesById.get(homeId) : undefined;
    return { tableName: t?.physicalName ?? '', tableSchema: t?.schema };
  };

  for (const s of statements) {
    if (s.artifact === PHYSICAL) {
      currentKey = keyOf(s);
      currentPhysical = {
        tableName: s.name ?? '', tableSchema: s.schema ?? undefined,
        kind: 'table', name: s.name ?? '', sql: s.sql,
      };
      objects.push(currentPhysical);
    } else if (s.artifact === PHYSICAL_TAGS) {
      if (!currentPhysical || currentKey !== keyOf(s)) {
        currentKey = keyOf(s);
        currentPhysical = {
          tableName: s.name ?? '', tableSchema: s.schema ?? undefined,
          kind: 'table', name: s.name ?? '', sql: '',
        };
        objects.push(currentPhysical);
      }
      currentPhysical.sql = currentPhysical.sql ? `${currentPhysical.sql}\n\n${s.sql}` : s.sql;
    } else if (s.artifact === VIEW_BUSINESS || s.artifact === VIEW_PASSIVE) {
      const home = resolveHome(s);
      objects.push({ ...home, kind: 'view', name: s.name ?? '', sql: s.sql });
    } else {
      // Artefacto generado (p.ej. _rej, vista técnica): archivo propio en la
      // carpeta de la tabla que lo originó (la del grupo actual).
      objects.push({
        tableName: currentPhysical?.tableName ?? '', tableSchema: currentPhysical?.tableSchema,
        kind: isViewSql(s.sql) ? 'view' : 'table', name: s.name ?? '', sql: s.sql,
      });
    }
  }
  return objects;
}

/** Asigna nombres de carpeta únicos; si un nombre físico se repite entre
 *  esquemas, TODAS esas carpetas se desambiguan con `(esquema)`. */
function allocFolders(objects: DdlObject[]): Map<string, string> {
  const order: string[] = [];
  const meta = new Map<string, { tableName: string; schema?: string }>();
  for (const o of objects) {
    const k = folderKey(o);
    if (!meta.has(k)) { meta.set(k, { tableName: o.tableName, schema: o.tableSchema }); order.push(k); }
  }
  const base = new Map<string, string>();
  const baseCount = new Map<string, number>();
  for (const k of order) {
    const m = meta.get(k)!;
    const b = m.tableName === '' ? ROOT_VIEWS : sanitizeName(m.tableName);
    base.set(k, b);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  const used = new Set<string>();
  const display = new Map<string, string>();
  for (const k of order) {
    const m = meta.get(k)!;
    let label = base.get(k)!;
    if (m.tableName !== '' && (baseCount.get(label) ?? 0) > 1) {
      label = `${label} (${sanitizeName(m.schema ?? 'no-schema')})`;
    }
    let final = label;
    let i = 2;
    while (used.has(final)) { final = `${label}_${i++}`; }
    used.add(final);
    display.set(k, final);
  }
  return display;
}

/** Mapea los objetos a entradas `{ path, content }` listas para `buildZip`. */
export function objectsToEntries(objects: DdlObject[]): ZipEntry[] {
  const folder = allocFolders(objects);
  const usedInFolder = new Map<string, Set<string>>();
  const entries: ZipEntry[] = [];
  for (const o of objects) {
    const dir = folder.get(folderKey(o))!;
    const tag = o.kind === 'table' ? 'TABLE' : 'VIEW';
    const stem = `[${tag}] ${sanitizeName(o.name)}`;
    const set = usedInFolder.get(dir) ?? usedInFolder.set(dir, new Set()).get(dir)!;
    let file = `${stem}.sql`;
    let i = 2;
    while (set.has(file)) { file = `${stem}_${i++}.sql`; }
    set.add(file);
    const content = o.sql.endsWith('\n') ? o.sql : `${o.sql}\n`;
    entries.push({ path: `${dir}/${file}`, content });
  }
  return entries;
}
