/**
 * sheetTemplates — plantillas de hoja Excel del Reporting (doc 95 D11): un
 * formato FIJO guardado como dato (nombre de hoja + columnas encabezado → dato).
 * Funciones PURAS: catálogo de datos, filas de la hoja (con las MISMAS filas del
 * export tabular, `reportRows`), validación del editor y nombre del archivo. El
 * backend solo valida la FORMA de `source`: sumar un dato nuevo es solo acá.
 */
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import { sortColumnRows, type SheetRow } from './reportRows';

export interface SheetTemplateColumn { header: string; source: string }
export interface SheetTemplateBody {
  name: string; sheetName: string; description?: string | null; columns: SheetTemplateColumn[];
  /** Spec D11 («dueño + compartida, como los saved reports»): la ven todos en el proyecto. */
  shared: boolean;
}
export interface SheetTemplate extends SheetTemplateBody { id: string; projectId: string; origin: string; owner?: string | null }

/** ¿Puede editarla/borrarla? El dueño; un admin (`admin.manage`), además, las
 *  compartidas (así la QA_MODELO sembrada sigue editable). Espejo de `can_edit`. */
export function canEditTemplate(t: Pick<SheetTemplate, 'owner' | 'shared'>, username: string | undefined,
                                isAdmin: boolean): boolean {
  return (!!username && t.owner === username) || (isAdmin && t.shared === true);
}

/** Origen de la plantilla sembrada «QA_MODELO» (espejo de `builtin.py`). */
export const BUILTIN_ORIGIN = 'builtin:qa-modelo';

type Getter = (c: ReportColumnRow, t: ReportTableRow | undefined, position: number) => string | number;
export interface SheetSource { key: string; label: string; group: 'Table fields' | 'Column fields'; get: Getter }

const x = (b: boolean | null | undefined) => (b ? 'X' : '');
const s = (v: string | null | undefined) => v ?? '';

/** Datos del modelo disponibles para una columna de la hoja (los UDP van aparte). */
export const SHEET_SOURCES: SheetSource[] = [
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

/** Filas de la hoja: una por columna, ordenadas por tabla y orden único (PK
 *  primero), con la posición 1-based DENTRO de cada tabla. */
export function templateRows(tpl: Pick<SheetTemplateBody, 'columns'>, tables: ReportTableRow[],
                             columns: ReportColumnRow[]): SheetRow[] {
  const byId = new Map(tables.map((t) => [t.id, t] as const));
  const sorted = sortColumnRows(columns, (id) => byId.get(id)?.physicalName ?? id);
  const pos = new Map<string, number>();
  return sorted.map((c) => {
    const p = (pos.get(c.tableId) ?? 0) + 1;
    pos.set(c.tableId, p);
    const t = byId.get(c.tableId);
    return Object.fromEntries(tpl.columns.map((col) => [col.header, cell(col.source, c, t, p)]));
  });
}

// Excel: nombre de hoja de 1 a 31 caracteres, sin : \ / ? * [ ] (espejo del backend).
const BAD_SHEET = /[:\\/?*[\]]/;

/** Problemas del borrador del editor (las mismas reglas que valida el backend). */
export function templateProblems(t: Pick<SheetTemplateBody, 'name' | 'sheetName' | 'columns'>): string[] {
  const out: string[] = [];
  if (!t.name.trim()) out.push('Give the template a name.');
  const sheet = t.sheetName.trim();
  if (!sheet || sheet.length > 31 || BAD_SHEET.test(sheet)) {
    out.push('The sheet name must be 1–31 characters, without : \\ / ? * [ ].');
  }
  if (t.columns.length === 0) out.push('Add at least one column.');
  const seen = new Set<string>();
  t.columns.forEach((c, i) => {
    const h = c.header.trim();
    if (!h) out.push(`Column ${i + 1} needs a header.`);
    else if (seen.has(h.toLowerCase())) out.push(`The header '${h}' is repeated.`);
    seen.add(h.toLowerCase());
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

/** Archivo del export: `<plantilla>-<AAAA-MM-DD>.xlsx`. */
export function templateFileName(name: string, date: Date): string {
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
  return `${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}
