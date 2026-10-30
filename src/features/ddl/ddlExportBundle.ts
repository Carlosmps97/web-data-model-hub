/**
 * ddlExportBundle: arma la lista de archivos del `.zip` del Export DDL con
 * «Use export settings».
 *
 * Puro: no toca el DOM ni la red. Recibe el DDL ya partido por objeto
 * (`tableStatements`/`viewStatements`) y lo mapea a rutas `carpeta/archivo`:
 *   {Tabla}/TABLE-{TABLA}.sql · {Tabla}/VIEW_NEG-{VISTA}.sql
 * El prefijo depende de la categoría y el nombre va en mayúscula; todo es
 * configurable en las Output settings (`fileNames`). Si dos archivos de una
 * carpeta chocan (sin distinguir mayúsculas: Mac/Windows no las distinguen al
 * descomprimir), esos llevan su esquema. Con «Use export rules» los nombres
 * los escriben las reglas; de acá toman la misma carpeta (`exportFolders`).
 */
import type { ZipEntry } from '@/lib/zip';

export interface DdlObject {
  /** Nombre físico de la tabla a cuya carpeta pertenece el objeto ('' → _views). */
  tableName: string;
  /** Esquema de esa tabla — desambigua la carpeta ante nombres físicos iguales. */
  tableSchema?: string;
  kind: 'table' | 'view';
  /** `model` = viene del modelo (física, vistas modeladas en Erwin/canvas);
   *  `generated` = lo creó un generador del ruleset. */
  origin: 'model' | 'generated';
  /** Esquema del objeto: entra al nombre del archivo ante un choque. */
  schema?: string;
  /** Nombre del objeto — va al nombre del archivo. */
  name: string;
  sql: string;
}

/** Cómo se nombran los archivos del zip (Output settings). */
export interface DdlFileNames {
  /** Prefijo de las tablas (física y generadas). */
  table: string;
  /** Prefijo de las vistas modeladas (Erwin/canvas). */
  modeledView: string;
  /** Prefijo de las vistas que generan las reglas (técnicas, de rechazos…). */
  generatedView: string;
  /** Entre el prefijo y el nombre. */
  separator: string;
  /** Casing del nombre (y del esquema) en el archivo. */
  nameCase: 'upper' | 'lower' | 'as-is';
  /** `when-needed`: el esquema solo va si dos archivos chocan; `always`: siempre. */
  schema: 'when-needed' | 'always';
}

export const DEFAULT_FILE_NAMES: DdlFileNames = {
  table: 'TABLE', modeledView: 'VIEW_NEG', generatedView: 'VIEW_TEC',
  separator: '-', nameCase: 'upper', schema: 'when-needed',
};

const ROOT_VIEWS = '_views';

/** Sustituye los caracteres ilegales en Windows y los de control. */
function sanitizeName(s: string): string {
  // eslint-disable-next-line no-control-regex
  const out = (s ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '_').trim();
  return out || 'unnamed';
}

function folderKey(o: DdlObject): string {
  return o.tableName === '' ? '__views_root__' : JSON.stringify([o.tableSchema ?? '', o.tableName]);
}

/** Todo viene del modelo; cada vista va a la carpeta de su primera fuente exportada. */
export function plainToObjects(args: {
  tables: { id: string; physicalName: string; schema?: string; sql: string }[];
  views: { name: string; schema?: string; sourceTableIds: string[]; sql: string }[];
}): DdlObject[] {
  const byId = new Map(args.tables.map((t) => [t.id, t]));
  const objects: DdlObject[] = args.tables.map((t) => ({
    tableName: t.physicalName, tableSchema: t.schema, kind: 'table', origin: 'model',
    schema: t.schema, name: t.physicalName, sql: t.sql,
  }));
  for (const v of args.views) {
    const homeId = v.sourceTableIds.find((id) => byId.has(id));
    const home = homeId ? byId.get(homeId) : undefined;
    objects.push({
      tableName: home?.physicalName ?? '', tableSchema: home?.schema,
      kind: 'view', origin: 'model', schema: v.schema, name: v.name, sql: v.sql,
    });
  }
  return objects;
}

/** Asigna nombres de carpeta únicos; si un nombre físico se repite entre
 *  esquemas, todas esas carpetas se desambiguan con `(esquema)`. */
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

/** Carpeta de cada tabla y vista del export, con la misma asignación del zip
 *  (las reglas la reciben como `tabla.carpeta` / `vista.carpeta`). */
export function exportFolders(args: {
  tables: { id: string; physicalName: string; schema?: string }[];
  views: { sourceTableIds: string[] }[];
}): { tables: string[]; views: string[] } {
  const objects = plainToObjects({
    tables: args.tables.map((t) => ({ ...t, sql: '' })),
    views: args.views.map((v) => ({ name: '', sourceTableIds: v.sourceTableIds, sql: '' })),
  });
  const folder = allocFolders(objects);
  const all = objects.map((o) => folder.get(folderKey(o))!);
  return { tables: all.slice(0, args.tables.length), views: all.slice(args.tables.length) };
}

const caseName = (s: string, mode: DdlFileNames['nameCase']): string =>
  mode === 'upper' ? s.toUpperCase() : mode === 'lower' ? s.toLowerCase() : s;

function prefixOf(o: DdlObject, f: DdlFileNames): string {
  if (o.kind === 'table') return f.table;
  return o.origin === 'generated' ? f.generatedView : f.modeledView;
}

/** `PREFIJO<sep>NOMBRE` (o `PREFIJO<sep>ESQUEMA.NOMBRE`), saneado. */
function stemOf(o: DdlObject, f: DdlFileNames, withSchema: boolean): string {
  const name = caseName(o.name, f.nameCase);
  const schema = (o.schema ?? '').trim();
  const body = withSchema && schema ? `${caseName(schema, f.nameCase)}.${name}` : name;
  const prefix = (prefixOf(o, f) ?? '').trim();
  return sanitizeName(prefix ? `${prefix}${f.separator ?? ''}${body}` : body);
}

/** Mapea los objetos a entradas `{ path, content }` listas para `buildZip`. */
export function objectsToEntries(objects: DdlObject[], fileNames: DdlFileNames = DEFAULT_FILE_NAMES): ZipEntry[] {
  const f: DdlFileNames = { ...DEFAULT_FILE_NAMES, ...fileNames };
  const folder = allocFolders(objects);
  // Choques por carpeta sin distinguir mayúsculas (Mac/Windows al descomprimir).
  const key = (dir: string, file: string) => `${dir}/${file}`.toLowerCase();
  const simple = objects.map((o) => stemOf(o, f, f.schema === 'always'));
  const counts = new Map<string, number>();
  objects.forEach((o, i) => {
    const k = key(folder.get(folderKey(o))!, simple[i]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const used = new Set<string>();
  return objects.map((o, i) => {
    const dir = folder.get(folderKey(o))!;
    let stem = simple[i];
    if ((counts.get(key(dir, stem)) ?? 0) > 1) stem = stemOf(o, f, true);   // choque → con esquema
    let file = `${stem}.sql`;
    let n = 2;
    while (used.has(key(dir, file))) file = `${stem}-${n++}.sql`;          // último recurso (mismo esquema y nombre)
    used.add(key(dir, file));
    const content = o.sql.endsWith('\n') ? o.sql : `${o.sql}\n`;
    return { path: `${dir}/${file}`, content };
  });
}
