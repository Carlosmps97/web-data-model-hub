/**
 * Report Designer → Builder: piezas PURAS del constructor visual (doc 105,
 * revisión ronda 4). Lo que el Builder no muestra — un tope total, un orden que
 * el agrupado ignora, un valor que el combo aparenta — no se manda.
 */
import type { FieldDef, Op, ReportSpec, ResultColumn } from '../query.service';

/** Página del Builder (la misma de `emptySpec`). */
export const BUILDER_PAGE = 100;

/** Spec con el que se abre el Builder (SQL validado o reporte guardado): sin el
 *  tope TOTAL `maxRows` del `LIMIT n` — el Builder no lo muestra ni lo deja
 *  quitar, y cortaba en silencio (con el placeholder, a 100 filas) — y con su
 *  página de siempre (el LIMIT también fijaba la página). */
export function toBuilderSpec(spec: ReportSpec, projectId: string): ReportSpec {
  const out: ReportSpec = { ...spec, projectId, limit: BUILDER_PAGE };
  delete out.maxRows;
  // Doc 105 (ronda 5): el orden de columnas del SELECT tampoco — con otro
  // agrupado armado en el Builder el backend respondería 422.
  delete out.resultColumns;
  return out;
}

/** GRP: agrupa o desagrupa por `key` (con el conteo mientras haya grupos) y
 *  quita el orden que la consulta nueva ignoraría: agrupada, sólo valen los
 *  campos agrupados y el conteo; sin grupos, el conteo ya no existe. */
export function regroup(spec: ReportSpec, key: string): ReportSpec {
  const groupBy = spec.groupBy.includes(key) ? spec.groupBy.filter((k) => k !== key) : [...spec.groupBy, key];
  const aggregations: ReportSpec['aggregations'] = groupBy.length ? [{ fn: 'count', as: 'count' }] : [];
  const aliases = new Set(aggregations.map((a) => a.as));
  const oldAliases = new Set(spec.aggregations.map((a) => a.as));
  const keep = (f: string) => (groupBy.length ? groupBy.includes(f) || aliases.has(f) : !oldAliases.has(f));
  return { ...spec, groupBy, aggregations, orderBy: spec.orderBy.filter((o) => keep(o.field)) };
}

/** Valor con el que nace una condición: la booleana, con el `true` que ya
 *  muestra su combo (sin valor viajaba `null` y filtraba lo vacío: 0 filas);
 *  «is set» / «is empty» y el resto de los tipos, sin valor. */
export function conditionDefaultValue(fd: FieldDef | undefined, op: Op): unknown {
  return fd?.type === 'boolean' && op !== 'exists' && op !== 'isnull' ? true : undefined;
}

/** `between` = [desde, hasta]: cambia una de las dos puntas (un valor suelto
 *  de otro operador no es un rango). */
export function betweenPart(value: unknown, index: 0 | 1, text: string): [string, string] {
  const pair: [string, string] = Array.isArray(value) ? [String(value[0] ?? ''), String(value[1] ?? '')] : ['', ''];
  pair[index] = text;
  return pair;
}

/** Texto de una celda de resultados: un booleano guardado como texto (UDP)
 *  «false» no es ✓ (antes cualquier texto no vacío lo era). */
export function cellText(v: unknown, c: Pick<ResultColumn, 'type'>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'boolean') {
    const b = typeof v === 'string' ? v.trim().toLowerCase() : v;
    if (b === true || b === 'true') return '✓';
    if (b === false || b === 'false') return '·';
  }
  return String(v);
}

/** Doc 105 (rondas 6–7): el orden por un campo sin índice da 422 en una consulta
 *  de FILAS — un reporte guardado antes de que la grilla sólo ofreciera los
 *  campos ordenables, o abierto desde el editor SQL, quedaba sin salida (el
 *  Builder no muestra el orden) y el CSV también fallaba. Se quita ese orden y
 *  se dice cuál (`removed`). `view_columns` ordena por cualquier campo y un
 *  agregado (con o sin GROUP BY) no se ordena por índice: quedan como están;
 *  tampoco se toca nada sin el catálogo de la vista. */
export function withoutUnsortableOrder(spec: ReportSpec, catalog: FieldDef[]): { spec: ReportSpec; removed: string[] } {
  if (!catalog.length || spec.from === 'view_columns' || spec.groupBy.length || spec.aggregations.length) return { spec, removed: [] };
  const ok = (field: string) => catalog.some((f) => f.key === field && f.sortable);
  const removed = spec.orderBy.filter((o) => !ok(o.field)).map((o) => o.field);
  return removed.length ? { spec: { ...spec, orderBy: spec.orderBy.filter((o) => ok(o.field)) }, removed } : { spec, removed };
}
