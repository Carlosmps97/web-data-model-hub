/**
 * sheetTemplates — plantillas de hoja Excel del Reporting: un formato fijo
 * guardado como dato (nombre de hoja + columnas encabezado → dato + filtros de
 * filas). Funciones puras: catálogo de datos, filas de la hoja (con las mismas
 * filas del export tabular, `reportRows`) y su filtrado, validación del editor y
 * nombre del archivo. El backend solo valida la forma de `source`: un dato nuevo
 * se agrega solo aquí.
 */
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import { sortColumnRows, type SheetRow } from './reportRows';

export interface SheetTemplateColumn { header: string; source: string }
/** Operadores de un filtro (espejo de `FilterOp` del backend). */
export type FilterOp = 'is' | 'isNot' | 'isOneOf' | 'contains' | 'notContains' | 'startsWith' | 'isEmpty' | 'isNotEmpty';
/** Filtro de filas: sale la fila que cumple todos. `isOneOf` lleva `values`;
 *  los «empty», nada; el resto, `value`. */
export interface SheetTemplateFilter { source: string; op: FilterOp; value?: string | null; values?: string[] | null }
export interface SheetTemplateBody {
  name: string; sheetName: string; description?: string | null; columns: SheetTemplateColumn[];
  /** Una plantilla sin filtros puede llegar sin la clave. */
  filters?: SheetTemplateFilter[];
  /** La plantilla compartida la ven todos en el proyecto; la otra, solo su dueño. */
  shared: boolean;
  /** Nombre del archivo con marcadores {yyyy} {MM} {dd} {HH} {mm} {ss} (hora
   *  local de quien exporta); vacío ⇒ `<plantilla>-<AAAA-MM-DD>.xlsx`. */
  fileName?: string | null;
}
export interface SheetTemplate extends SheetTemplateBody { id: string; projectId: string; origin: string; owner?: string | null }

/** ¿Puede editarla/borrarla? El dueño; un admin (`admin.manage`), además, las
 *  compartidas (así la QA_MODELO sembrada es editable). Espejo de `can_edit`. */
export function canEditTemplate(t: Pick<SheetTemplate, 'owner' | 'shared'>, username: string | undefined,
                                isAdmin: boolean): boolean {
  return (!!username && t.owner === username) || (isAdmin && t.shared === true);
}

/** Origen de la plantilla sembrada «QA_MODELO» (espejo de `builtin.py`). */
export const BUILTIN_ORIGIN = 'builtin:qa-modelo';

type Getter = (c: ReportColumnRow, t: ReportTableRow | undefined, position: number) => string | number;
export interface SheetSource {
  key: string; label: string; group: 'Table fields' | 'Column fields'; get: Getter;
  /** Datos con varios valores (la tabla está en varios canvases): el filtro mira cada uno. */
  items?: (t: ReportTableRow | undefined) => string[];
}

const x = (b: boolean | null | undefined) => (b ? 'X' : '');
const s = (v: string | null | undefined) => v ?? '';
const list = (xs: string[] | undefined) => (xs ?? []).join(', ');

/** Datos del modelo disponibles para una columna de la hoja (los UDP van aparte). */
export const SHEET_SOURCES: SheetSource[] = [
  // Jerarquía del modelador (plantilla Excel: SPACE › SUBJECT › DIAGRAMA).
  { key: 'table.space', label: 'Space (sub-project)', group: 'Table fields', get: (_c, t) => list(t?.spaces), items: (t) => t?.spaces ?? [] },
  { key: 'table.subject', label: 'Subject (folder)', group: 'Table fields', get: (_c, t) => list(t?.subjectAreas), items: (t) => t?.subjectAreas ?? [] },
  { key: 'table.diagram', label: 'Diagram (canvas)', group: 'Table fields', get: (_c, t) => list(t?.diagrams), items: (t) => t?.diagrams ?? [] },
  { key: 'table.schema', label: 'Schema (database)', group: 'Table fields', get: (_c, t) => s(t?.schema) },
  { key: 'table.physicalName', label: 'Table physical name', group: 'Table fields', get: (c, t) => t?.physicalName ?? c.tableId },
  { key: 'table.logicalName', label: 'Table logical name', group: 'Table fields', get: (_c, t) => s(t?.logicalName) },
  { key: 'table.description', label: 'Table definition', group: 'Table fields', get: (_c, t) => s(t?.description) },
  { key: 'column.position', label: 'Column position (1…, PK first)', group: 'Column fields', get: (_c, _t, p) => p },
  { key: 'column.ordinal', label: 'Column ordinal (raw)', group: 'Column fields', get: (c) => c.ordinal },
  { key: 'column.physicalName', label: 'Column physical name', group: 'Column fields', get: (c) => c.physicalName },
  { key: 'column.logicalName', label: 'Column logical name', group: 'Column fields', get: (c) => c.logicalName },
  { key: 'column.description', label: 'Column definition', group: 'Column fields', get: (c) => s(c.description) },
  { key: 'column.physicalDescription', label: 'Column physical comment', group: 'Column fields', get: (c) => s(c.physicalDescription) },
  { key: 'column.dataType', label: 'Physical data type', group: 'Column fields', get: (c) => c.dataType },
  { key: 'column.logicalDataType', label: 'Logical data type', group: 'Column fields', get: (c) => s(c.logicalDataType) },
  { key: 'column.parentDomain', label: 'Parent domain', group: 'Column fields', get: (c) => s(c.parentDomain) },
  { key: 'column.isPrimaryKey', label: 'PK (X)', group: 'Column fields', get: (c) => x(c.isPrimaryKey) },
  { key: 'column.isForeignKey', label: 'FK (X)', group: 'Column fields', get: (c) => x(c.isForeignKey) },
  { key: 'column.isPartition', label: 'Partition flag (X)', group: 'Column fields', get: (c) => x(c.isPartition) },
  { key: 'column.isNullable', label: 'Nullable (X)', group: 'Column fields', get: (c) => x(c.isNullable) },
];
const BY_KEY = new Map(SHEET_SOURCES.map((src) => [src.key, src]));
const UDP = /^(table|column)\.udp:(.+)$/;

/** Nombre legible de un UDP (la faceta lógica lleva «(Logical)», como el export). */
export const udpDisplayName = (d: { name: string; view?: string | null }): string =>
  (d.view === 'logical' ? `${d.name} (Logical)` : d.name);

/** Etiqueta legible de un `source` para el editor. */
export function sourceLabel(source: string): string {
  const u = UDP.exec(source);
  if (u) return `${u[1] === 'table' ? 'Table' : 'Column'} UDP · ${u[2]}`;
  return BY_KEY.get(source)?.label ?? `Unknown (${source})`;
}

export interface SourceGroup { group: string; options: { value: string; label: string }[] }

/** Opciones del selector del editor, agrupadas: campos y UDP de tabla y de columna. */
export function sourceOptions(defs: { name: string; level: string; view?: string | null }[]): SourceGroup[] {
  const udps = (level: 'table' | 'column') => defs
    .filter((d) => d.level === level)
    .map((d) => udpDisplayName(d))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ value: `${level}.udp:${n}`, label: n }));
  const fields = (group: SheetSource['group']) => SHEET_SOURCES
    .filter((o) => o.group === group).map((o) => ({ value: o.key, label: o.label }));
  return [
    { group: 'Table fields', options: fields('Table fields') },
    { group: 'Table UDPs', options: udps('table') },
    { group: 'Column fields', options: fields('Column fields') },
    { group: 'Column UDPs', options: udps('column') },
  ];
}

/** ¿El `source` existe en las opciones actuales? (un UDP borrado o renombrado, no). */
export const isKnownSource = (source: string, groups: SourceGroup[]): boolean =>
  groups.some((g) => g.options.some((o) => o.value === source));

/** Valor de una celda; un `source` desconocido queda vacío (no rompe el export). */
function cell(source: string, c: ReportColumnRow, t: ReportTableRow | undefined, position: number): string | number {
  const u = UDP.exec(source);
  if (u) return (u[1] === 'table' ? t?.udpValues : c.udpValues)?.[u[2]] ?? '';
  return BY_KEY.get(source)?.get(c, t, position) ?? '';
}

// ── Filtros de filas ─────────────────────────────────────────────────────────
const FLAG_SOURCES = new Set(['column.isPrimaryKey', 'column.isForeignKey', 'column.isPartition', 'column.isNullable']);
const ALL_OPS: { value: FilterOp; label: string }[] = [
  { value: 'is', label: 'is' }, { value: 'isNot', label: 'is not' }, { value: 'isOneOf', label: 'is one of' },
  { value: 'contains', label: 'contains' }, { value: 'notContains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' }, { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
];
const FLAG_OPS: { value: FilterOp; label: string }[] = [
  { value: 'isNotEmpty', label: 'is marked' }, { value: 'isEmpty', label: 'is not marked' },
];
export const FILTERS_MAX = 20;
const FILTER_VALUE_MAX = 200;
const FILTER_VALUES_MAX = 50;

/** Operadores que se ofrecen para un dato: una bandera (X / vacío) solo «marcada / no marcada». */
export const filterOps = (source: string): { value: FilterOp; label: string }[] =>
  (FLAG_SOURCES.has(source) ? FLAG_OPS : ALL_OPS);

/** ¿El operador lleva valor? */
export const filterNeedsValue = (op: FilterOp): boolean => op !== 'isEmpty' && op !== 'isNotEmpty';

/** «a, b ,, c» → ['a', 'b', 'c'] (valores de «is one of»). La coma dentro de
 *  () o <> es parte del valor: «DECIMAL(10,2), MAP<STRING, INT>» → 2 valores.
 *  Si un ( o < queda sin cerrar, se corta en todas las comas. */
export function splitValues(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '<') depth += 1;
    else if (ch === ')' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(current); current = ''; } else current += ch;
  }
  out.push(current);
  return (depth === 0 ? out : text.split(',')).map((v) => v.trim()).filter(Boolean);
}

/** Filtro en el editor: el valor es texto (para «is one of», separado por comas). */
export interface FilterDraft { source: string; op: FilterOp; text: string }

export function toFilterDraft(f: SheetTemplateFilter): FilterDraft {
  return { source: f.source, op: f.op, text: f.op === 'isOneOf' ? (f.values ?? []).join(', ') : f.value ?? '' };
}

/** Lo que se guarda: sin bordes y con la forma de cada operador. */
export function toFilterBody(f: FilterDraft): SheetTemplateFilter {
  if (!filterNeedsValue(f.op)) return { source: f.source, op: f.op };
  if (f.op === 'isOneOf') return { source: f.source, op: f.op, values: splitValues(f.text) };
  return { source: f.source, op: f.op, value: f.text.trim() };
}

const norm = (v: unknown): string => String(v ?? '').normalize('NFC').trim().toLowerCase();

/** Valores del dato en la fila (varios para canvases/carpetas), normalizados y sin vacíos. */
function filterItems(source: string, c: ReportColumnRow, t: ReportTableRow | undefined, position: number): string[] {
  const src = UDP.test(source) ? undefined : BY_KEY.get(source);
  const raw = src?.items ? src.items(t) : [cell(source, c, t, position)];
  return raw.map(norm).filter((v) => v !== '');
}

type RowTest = (c: ReportColumnRow, t: ReportTableRow | undefined, position: number) => boolean;

/** Los filtros preparados una vez (valores normalizados) para probar muchas
 *  filas: la fila pasa si cumple todos, sin distinguir mayúsculas ni bordes. */
export function compileFilters(filters: SheetTemplateFilter[] | undefined): RowTest {
  const tests: RowTest[] = (filters ?? []).map((f) => {
    const value = norm(f.value);
    const wanted = new Set((f.values ?? []).map(norm));
    return (c, t, position) => {
      const items = filterItems(f.source, c, t, position);
      switch (f.op) {
        case 'isEmpty': return items.length === 0;
        case 'isNotEmpty': return items.length > 0;
        case 'is': return items.includes(value);
        case 'isNot': return !items.includes(value);
        case 'isOneOf': return items.some((v) => wanted.has(v));
        case 'contains': return items.some((v) => v.includes(value));
        case 'notContains': return !items.some((v) => v.includes(value));
        case 'startsWith': return items.some((v) => v.startsWith(value));
        default: return true;
      }
    };
  });
  return (c, t, position) => tests.every((test) => test(c, t, position));
}

/** Filas de la hoja: una por columna que cumple los filtros (y, si se da,
 *  `keepColumn`: la búsqueda del Reporting), ordenadas por tabla y orden único
 *  (PK primero), con la posición 1-based real dentro de cada tabla (filtrar no
 *  renumera). */
export function templateRows(tpl: Pick<SheetTemplateBody, 'columns' | 'filters'>, tables: ReportTableRow[],
                             columns: ReportColumnRow[], keepColumn?: (c: ReportColumnRow) => boolean): SheetRow[] {
  const byId = new Map(tables.map((t) => [t.id, t] as const));
  const sorted = sortColumnRows(columns, (id) => byId.get(id)?.physicalName ?? id);
  const pos = new Map<string, number>();
  const keep = compileFilters(tpl.filters);
  return sorted.flatMap((c) => {
    const p = (pos.get(c.tableId) ?? 0) + 1;
    pos.set(c.tableId, p);
    const t = byId.get(c.tableId);
    if (!keep(c, t, p) || (keepColumn && !keepColumn(c))) return [];
    return [Object.fromEntries(tpl.columns.map((col) => [col.header, cell(col.source, c, t, p)]))];
  });
}

// Excel: nombre de hoja de 1 a 31 caracteres, sin : \ / ? * [ ], sin apóstrofo
// al inicio ni al final y distinto de «History» (nombre reservado). Espejo del backend.
const BAD_SHEET = /[:\\/?*[\]]|^'|'$|^history$/i;

/** Problemas del borrador del editor (las mismas reglas que valida el backend). */
export function templateProblems(t: Pick<SheetTemplateBody, 'name' | 'sheetName' | 'columns' | 'fileName' | 'filters'>): string[] {
  const out: string[] = [];
  if (!t.name.trim()) out.push('Give the template a name.');
  const sheet = t.sheetName.trim();
  if (!sheet || sheet.length > 31 || BAD_SHEET.test(sheet)) {
    out.push("The sheet name must be 1–31 characters, without : \\ / ? * [ ], not start or end with an apostrophe, and not be History.");
  }
  if (t.columns.length === 0) out.push('Add at least one column.');
  const seen = new Set<string>();
  t.columns.forEach((c, i) => {
    const h = c.header.trim();
    if (!h) out.push(`Column ${i + 1} needs a header.`);
    else if (seen.has(h.toLowerCase())) out.push(`The header '${h}' is repeated.`);
    seen.add(h.toLowerCase());
  });
  const file = fileNameProblem(t.fileName);
  if (file) out.push(file);
  const filters = t.filters ?? [];
  if (filters.length > FILTERS_MAX) out.push(`A template can have at most ${FILTERS_MAX} filters.`);
  filters.forEach((f, i) => {
    if (f.op === 'isOneOf' && !(f.values ?? []).some((v) => v.trim())) out.push(`Filter ${i + 1} needs at least one value.`);
    else if (f.op === 'isOneOf' && (f.values ?? []).filter((v) => v.trim()).length > FILTER_VALUES_MAX) {
      out.push(`Filter ${i + 1} can have at most ${FILTER_VALUES_MAX} values.`);
    }
    else if (f.op !== 'isOneOf' && filterNeedsValue(f.op) && !(f.value ?? '').trim()) out.push(`Filter ${i + 1} needs a value.`);
    // En code points, como `len()` del backend (un emoji = 1, no 2).
    else if ([f.value, ...(f.values ?? [])].some((v) => [...(v ?? '').trim()].length > FILTER_VALUE_MAX)) {
      out.push(`A filter value can have at most ${FILTER_VALUE_MAX} characters.`);
    }
  });
  return out;
}

/** Mueve un elemento una posición arriba (-1) o abajo (+1); fuera de rango, igual. */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Marcadores del nombre del archivo (hora local de quien exporta). */
export const FILE_NAME_TOKENS = ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss'] as const;
const FILE_NAME_MAX = 120;
// eslint-disable-next-line no-control-regex
const BAD_FILE = /[\\/:*?"<>|\u0000-\u001f]/;
const TOKEN = /\{([^{}]*)\}/g;

/** Nombre guardado: sin blancos ni `.xlsx` final; vacío ⇒ null (espejo de `clean_file_name`). */
export function cleanFileName(raw: string | null | undefined): string | null {
  let text = (raw ?? '').trim();
  if (text.toLowerCase().endsWith('.xlsx')) text = text.slice(0, -5).trimEnd();
  return text || null;
}

/** Problema del nombre de archivo (mismas reglas y textos que el backend) o null. */
export function fileNameProblem(raw: string | null | undefined): string | null {
  const text = cleanFileName(raw);
  if (!text) return null;
  // En code points, como `len()` del backend (un emoji = 1, no 2).
  if ([...text].length > FILE_NAME_MAX) return `The file name can have at most ${FILE_NAME_MAX} characters.`;
  if (BAD_FILE.test(text)) return 'The file name can\'t contain \\ / : * ? " < > |.';
  const known: readonly string[] = FILE_NAME_TOKENS;
  const unknown = [...text.matchAll(TOKEN)].map((m) => m[1]).find((k) => !known.includes(k));
  if (unknown !== undefined) return `Unknown placeholder {${unknown}} in the file name — use {yyyy} {MM} {dd} {HH} {mm} {ss}.`;
  if (/[{}]/.test(text.replace(TOKEN, ''))) return 'Unbalanced braces in the file name — placeholders look like {yyyy}.';
  return null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Archivo del export: el nombre de la plantilla con sus marcadores a la hora
 *  local (la QA_MODELO sale `QA_REPORTE_<AAAA-MM-DD> <HHmmss>.xlsx`); sin
 *  nombre propio (o con uno inválido), `<plantilla>-<AAAA-MM-DD>.xlsx`. */
export function templateFileName(tpl: Pick<SheetTemplateBody, 'name' | 'fileName'>, date: Date): string {
  const parts: Record<string, string> = {
    yyyy: pad(date.getFullYear(), 4), MM: pad(date.getMonth() + 1), dd: pad(date.getDate()),
    HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()),
  };
  const pattern = cleanFileName(tpl.fileName);
  if (pattern && !fileNameProblem(pattern)) {
    return `${pattern.replace(TOKEN, (whole: string, key: string) => parts[key] ?? whole)}.xlsx`;
  }
  const slug = tpl.name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
  return `${slug}-${parts.yyyy}-${parts.MM}-${parts.dd}.xlsx`;
}
