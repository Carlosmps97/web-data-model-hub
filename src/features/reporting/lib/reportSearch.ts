/**
 * reportSearch — búsqueda del Reporting con alcance, como el buscador del
 * Model: Tables / entities · Columns / attributes · Definitions · Views.
 *
 * La búsqueda elige las tablas del reporte: por su nombre (en el navegador) o,
 * con los otros alcances, por el conjunto de tablas que devuelve el servidor
 * (`GET /api/reporting/search`: columnas, definiciones de la tabla o de sus
 * columnas, vistas). Con Columns, Definitions o Views, las hojas de columnas y
 * de vistas muestran solo las filas que coinciden, en pantalla y en el Excel.
 * Coincidencia «contiene», sin distinguir mayúsculas. Puras.
 */
import type { ReportColumnRow, ReportTableRow, ReportViewRow } from '@/services/reporting.service';
import type { SheetData, SheetKey } from './reportSheets';

export type SearchScope = 'tables' | 'columns' | 'definitions' | 'views';

export interface SearchScopeSpec {
  id: SearchScope;
  label: string;
  placeholder: string;
  /** Hoja que se muestra al elegir el alcance. */
  sheet: SheetKey;
}

export const SEARCH_SCOPES: SearchScopeSpec[] = [
  { id: 'tables', label: 'Tables / entities', placeholder: 'Search tables by name…', sheet: 'tables' },
  { id: 'columns', label: 'Columns / attributes', placeholder: 'Search columns by name…', sheet: 'columns' },
  { id: 'definitions', label: 'Definitions', placeholder: 'Search table and column definitions…', sheet: 'tables' },
  { id: 'views', label: 'Views', placeholder: 'Search views by name…', sheet: 'views' },
];

/** Caracteres desde los que se busca en el servidor (y desde los que la búsqueda
 *  carga el set completo de tablas). */
export const SEARCH_MIN_CHARS = 2;
/** Tope del texto que acepta el servidor. */
export const SEARCH_MAX_CHARS = 120;

/** Término de búsqueda efectivo, sin bordes: por nombre de tabla filtra en el
 *  navegador desde el primer carácter; en el servidor, desde `SEARCH_MIN_CHARS`. */
export function searchTerm(raw: string, scope: SearchScope): string {
  const term = raw.trim();
  return scope === 'tables' || term.length >= SEARCH_MIN_CHARS ? term : '';
}

export function scopeSheet(scope: SearchScope): SheetKey {
  return SEARCH_SCOPES.find((s) => s.id === scope)!.sheet;
}

/** Alcance que se resuelve en el servidor con este término (null = en el navegador o sin búsqueda). */
export function serverScope(scope: SearchScope, term: string): Exclude<SearchScope, 'tables'> | null {
  return term && scope !== 'tables' ? scope : null;
}

const contains = (value: string | null | undefined, term: string) =>
  (value ?? '').toLowerCase().includes(term.toLowerCase());

/** ¿La tabla entra al reporte? `serverIds`: tablas que devolvió el servidor para
 *  Columns / Definitions / Views (null = todavía no hay respuesta: ninguna). */
export function tableMatches(t: ReportTableRow, scope: SearchScope, term: string, serverIds: Set<string> | null): boolean {
  if (!term) return true;
  if (scope === 'tables') return contains(t.physicalName, term) || contains(t.logicalName, term);
  return serverIds?.has(t.id) ?? false;
}

const columnMatches = (c: ReportColumnRow, scope: SearchScope, term: string) =>
  scope === 'columns' ? contains(c.physicalName, term) || contains(c.logicalName, term)
    : scope === 'definitions' ? contains(c.description, term)
      : true;

const viewMatches = (v: ReportViewRow, scope: SearchScope, term: string) => scope !== 'views' || contains(v.name, term);

/** Qué columnas muestran las hojas con esta búsqueda: con Columns o Definitions,
 *  las que coinciden; null = todas. La plantilla lo aplica después de numerar la
 *  posición de cada columna en su tabla. */
export function columnFilter(scope: SearchScope, term: string): ((c: ReportColumnRow) => boolean) | null {
  if (!term || (scope !== 'columns' && scope !== 'definitions')) return null;
  return (c) => columnMatches(c, scope, term);
}

/** Datos de las hojas acotados por la búsqueda: columnas y vistas que coinciden
 *  (según el alcance) y solo las vistas con alguna fuente entre las tablas. */
export function narrowSheetData(data: SheetData, scope: SearchScope, term: string): SheetData {
  const ids = new Set(data.tables.map((t) => t.id));
  const keep = columnFilter(scope, term);
  return {
    ...data,
    columns: data.columns && (keep ? data.columns.filter(keep) : data.columns),
    views: data.views?.filter((v) => v.sourceTableIds.some((id) => ids.has(id)) && (!term || viewMatches(v, scope, term))),
  };
}
