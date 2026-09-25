/**
 * ddlExportBundle — arma la lista de archivos del `.zip` del Export DDL (doc 37 · doc 93).
 *
 * PURO: no toca el DOM ni la red. Recibe el DDL ya partido por objeto (de
 * cualquiera de los dos caminos: `tableStatements`/`viewStatements` sin reglas,
 * o `rendered.statements` con reglas) y lo mapea a rutas `carpeta/archivo`:
 *   {Tabla}/TABLE-{TABLA}.sql · {Tabla}/VIEW_NEG-{VISTA}.sql · {Tabla}/VIEW_TEC-{VISTA}.sql
 * Doc 93 D11: el prefijo depende de la CATEGORÍA (tabla · vista modelada · vista
 * generada por reglas) y el nombre va en MAYÚSCULA — todo configurable en las
 * Output settings (`fileNames`). Si dos archivos de una carpeta chocan (sin
 * distinguir mayúsculas: Mac/Windows no las distinguen al descomprimir), esos
 * llevan su esquema. D12: CREATE y sus ALTER seguidos, sin líneas en blanco.
 */
import type { ZipEntry } from '@/lib/zip';

export interface DdlObject {
  /** Nombre físico de la TABLA a cuya carpeta pertenece el objeto ('' → _views). */
  tableName: string;
  /** Esquema de esa tabla — desambigua la carpeta ante nombres físicos iguales. */
  tableSchema?: string;
  kind: 'table' | 'view';
  /** Doc 93 D11: `model` = viene del modelo (física, vistas modeladas en
   *  Erwin/canvas); `generated` = lo creó un generador del ruleset. */
  origin: 'model' | 'generated';
  /** Esquema del OBJETO — entra al nombre del archivo ante un choque. */
  schema?: string;
  /** Nombre del objeto — va al nombre del archivo. */
  name: string;
  sql: string;
}

/** Doc 93 D11 — cómo se nombran los archivos del zip (Output settings). */
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

// Artefactos del motor de reglas (doc 30) que el pipeline emite (backend).
const PHYSICAL = 'ddl.tabla_fisica';
const VIEW_BUSINESS = 'ddl.vista_negocio';
const VIEW_PASSIVE = 'ddl.vista';
/** Artefactos que vienen del MODELO; cualquier otro lo generó una regla. */
const MODELED = new Set([PHYSICAL, VIEW_BUSINESS, VIEW_PASSIVE]);
// Doc 76: anexos de CUALQUIER objeto (`<artefacto>.tags` = ALTER … SET TAGS,
// `<artefacto>.extra` = sentencias libres `after`) — se pliegan al archivo del objeto.
const ADDENDUM_RX = /^(.*)\.(tags|extra)$/;

const ROOT_VIEWS = '_views';

/** Clave estable para el mapa vista→fuentes: (schema, name). */
export function viewKey(schema: string | null | undefined, name: string): string {
  return JSON.stringify([schema ?? '', name]);
}

/** Reemplaza ilegales en Windows y control chars. */
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

/** Camino SIN reglas: todo viene del modelo; cada vista a su tabla fuente. */
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

/** Camino CON reglas: agrupa los statements del motor por tabla. */
export function statementsToObjects(args: {
  statements: { artifact: string; schema?: string | null; name?: string | null; sql: string }[];
  viewSources: Map<string, string[]>;
  tablesById: Map<string, { physicalName: string; schema?: string }>;
}): DdlObject[] {
  const { statements, viewSources, tablesById } = args;
  const objects: DdlObject[] = [];
  let currentPhysical: DdlObject | null = null;
  const byKey = new Map<string, DdlObject>();
  const keyOf = (artifact: string, s: { schema?: string | null; name?: string | null }) =>
    JSON.stringify([artifact, s.schema ?? '', s.name ?? '']);
  const originOf = (artifact: string): DdlObject['origin'] => (MODELED.has(artifact) ? 'model' : 'generated');

  const resolveHome = (s: { schema?: string | null; name?: string | null }) => {
    const src = viewSources.get(viewKey(s.schema, s.name ?? '')) ?? [];
    const homeId = src.find((id) => tablesById.has(id));
    const t = homeId ? tablesById.get(homeId) : undefined;
    return { tableName: t?.physicalName ?? '', tableSchema: t?.schema };
  };

  for (const s of statements) {
    const addendum = ADDENDUM_RX.exec(s.artifact);
    if (addendum) {
      // `.tags` / `.extra`: al archivo de su objeto (ya emitido justo antes),
      // pegados — sin línea en blanco (doc 93 D12).
      const base = addendum[1];
      const existing = byKey.get(keyOf(base, s));
      let target: DdlObject;
      if (existing) {
        target = existing;
      } else {
        const home = base === VIEW_BUSINESS || base === VIEW_PASSIVE
          ? resolveHome(s)
          : { tableName: base === PHYSICAL ? (s.name ?? '') : (currentPhysical?.tableName ?? ''),
              tableSchema: base === PHYSICAL ? (s.schema ?? undefined) : currentPhysical?.tableSchema };
        target = { ...home, kind: /vista/.test(base) ? 'view' : 'table', origin: originOf(base),
                   schema: s.schema ?? undefined, name: s.name ?? '', sql: '' };
        byKey.set(keyOf(base, s), target);
        objects.push(target);
        if (base === PHYSICAL) currentPhysical = target;
      }
      target.sql = target.sql ? `${target.sql}\n${s.sql}` : s.sql;
      continue;
    }
    let obj: DdlObject;
    if (s.artifact === PHYSICAL) {
      obj = {
        tableName: s.name ?? '', tableSchema: s.schema ?? undefined,
        kind: 'table', origin: 'model', schema: s.schema ?? undefined, name: s.name ?? '', sql: s.sql,
      };
      currentPhysical = obj;
    } else if (s.artifact === VIEW_BUSINESS || s.artifact === VIEW_PASSIVE) {
      obj = { ...resolveHome(s), kind: 'view', origin: 'model', schema: s.schema ?? undefined,
              name: s.name ?? '', sql: s.sql };
    } else {
      // Artefacto generado (p.ej. _rej, vista técnica): archivo propio en la
      // carpeta de la tabla que lo originó (la del grupo actual).
      obj = {
        tableName: currentPhysical?.tableName ?? '', tableSchema: currentPhysical?.tableSchema,
        kind: isViewSql(s.sql) ? 'view' : 'table', origin: 'generated',
        schema: s.schema ?? undefined, name: s.name ?? '', sql: s.sql,
      };
    }
    byKey.set(keyOf(s.artifact, s), obj);
    objects.push(obj);
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
  // Choques por carpeta SIN distinguir mayúsculas (Mac/Windows al descomprimir).
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
