// Recarga del canvas por tablas. Casi toda edición termina en `reload()`; en un
// canvas gigante, volver a bajar el diagrama completo cuesta segundos. Lo que
// esta pestaña escribe en el draft dice qué tablas cambiaron (`editedTables`);
// el servidor arma el recorte de esas tablas con el mismo overlay del diagrama
// completo (`GET /diagram?tableIds=`) y aquí se funde en el diagrama abierto
// (`mergeSlice`): lo demás conserva su identidad y no se vuelve a dibujar.
import type { BulkChange } from '@/services/changeset.service';
import type { View } from '@/services/views.service';
import type { Diagram } from '../services/modeler.service';

/** Tablas que cambiaron desde la última carga; `full` si algo no se puede
 *  acotar a tablas (alta o baja de tablas o vistas, membresía del canvas,
 *  esquemas, una colección desconocida). */
export interface Edited { tables: Set<string>; full: boolean }

export const noEdits = (): Edited => ({ tables: new Set(), full: false });

/** Respuesta de un recorte: el diagrama de esas tablas. */
export type DiagramSlice = Diagram & { slice: { tableIds: string[] } };

export const isSlice = (d: Diagram): d is DiagramSlice =>
  Array.isArray((d as Partial<DiagramSlice>).slice?.tableIds);

/** Fuentes de una vista (`sourceTableIds`, o `tableId` sin lista), como el servidor. */
export function viewSources(v: Pick<View, 'sourceTableIds' | 'tableId'> | Record<string, unknown> | undefined): string[] {
  const src = (v?.sourceTableIds as string[] | undefined) ?? [];
  if (src.length) return src;
  const tid = v?.tableId as string | undefined;
  return tid ? [tid] : [];
}

const str = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Suma a `into` las tablas del canvas `d` que cambian con `changes` (lo que
 *  se va a escribir en el draft). De una entidad que ya está en el diagrama
 *  cuenta también su tabla actual: una columna mudada, una relación o una
 *  vista re-apuntadas dejan de estar donde estaban. Una baja de columna o
 *  relación no trae payload: la ubica `d`, y lo que no está en él no es de este
 *  canvas. Con `strict` (se está abriendo este canvas: su foto puede tener lo
 *  que `d` todavía no muestra), una columna, relación o vista que `d` no tiene
 *  pide el completo. */
export function editedTables(d: Diagram | null, changes: readonly BulkChange[], into: Edited, strict = false): void {
  const add = (...ids: unknown[]) => { for (const id of ids) if (str(id)) into.tables.add(id); };
  // Índices por id, armados una vez y solo si hacen falta (un lote de mil
  // cambios no recorre 50 mil columnas por cambio).
  let cols: Map<string, string> | undefined;
  let rels: Map<string, Diagram['relationships'][number]> | undefined;
  let views: Map<string, View> | undefined;
  const columnTable = (id: string) => (cols ??= new Map((d?.columns ?? []).map((c) => [c.id, c.tableId]))).get(id);
  const relationship = (id: string) => (rels ??= new Map((d?.relationships ?? []).map((r) => [r.id, r]))).get(id);
  const view = (id: string) => (views ??= new Map((d?.views ?? []).map((v) => [v.id, v]))).get(id);
  for (const ch of changes) {
    const p = (ch.payload ?? {}) as Record<string, unknown>;
    switch (ch.collection) {
      case 'canonical_tables':
        // Una baja saca la tabla de los canvases en el servidor (membresía).
        if (ch.op === 'delete') into.full = true; else add(ch.entityId);
        break;
      case 'canonical_columns': {
        const at = columnTable(ch.entityId);
        if (!at && strict) into.full = true;
        else add(p.tableId, at);
        break;
      }
      case 'relationships': {
        const r = relationship(ch.entityId);
        if (!r && strict) into.full = true;
        else add(p.parentTableId, p.childTableId, p.sourceTableId, p.targetTableId, r?.parentTableId, r?.childTableId);
        break;
      }
      case 'views': {
        // Una baja también sale de los canvases en el servidor.
        const v = view(ch.entityId);
        if (ch.op === 'delete' || (!v && strict)) into.full = true;
        else add(...viewSources(p), ...viewSources(v));
        break;
      }
      case 'subject_areas':
        // Del canvas abierto solo cuenta la membresía: la posición, los trazos
        // y los colores ya están en pantalla y el recorte trae el canvas.
        if (d && ch.entityId === d.subjectArea.id
            && (ch.op === 'delete' || !sameSet(p.tableIds, d.subjectArea.tableIds)
                || (p.viewIds != null && !sameSet(p.viewIds, d.subjectArea.viewIds)))) into.full = true;
        break;
      case 'projects':
      case 'folders':
        break;
      default:
        into.full = true;
    }
  }
}

function sameSet(a: unknown, b: unknown): boolean {
  const x = new Set(Array.isArray(a) ? a : []);
  const y = new Set(Array.isArray(b) ? b : []);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

/** ¿El canvas cambió fuera del recorte (otra pestaña o versión cambió su
 *  membresía)? Entonces hace falta el diagrama completo. */
export function membershipChanged(current: Diagram, part: Diagram): boolean {
  const a = current.subjectArea;
  const b = part.subjectArea;
  return !sameSet(a.tableIds, b.tableIds) || (b.viewIds != null && !sameSet(a.viewIds, b.viewIds));
}

/** `current` con lo de `fresh` en el lugar de cada entidad del mismo id; las
 *  que `gone` dice que eran del lote y ya no vienen se quitan; las nuevas van
 *  al final. Las demás conservan su objeto. */
function replaceById<T extends { id: string }>(current: T[], fresh: T[], gone: (x: T) => boolean): T[] {
  const byId = new Map(fresh.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const x of current) {
    const f = byId.get(x.id);
    if (f) { out.push(f); byId.delete(x.id); } else if (!gone(x)) out.push(x);
  }
  return [...out, ...byId.values()];
}

const lower = (s: string | undefined) => (s ?? '').toLowerCase();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** El diagrama abierto con el recorte fundido: sus tablas, columnas,
 *  relaciones y vistas reemplazan a las del lote (lo que ya no viene se quita)
 *  y el canvas es el del recorte (con la lista implícita de vistas tomada de
 *  las que quedan). Mismo orden que el diagrama completo: tablas por nombre
 *  físico, columnas por tabla y `ordinal`. Lo que no es del lote conserva su
 *  objeto, y el sello de producción sigue siendo el de la última carga
 *  completa. Puro. */
export function mergeSlice(current: Diagram, part: DiagramSlice): Diagram {
  const lot = new Set(part.slice.tableIds);
  const tables = replaceById(current.tables, part.tables, (t) => lot.has(t.id))
    .sort((a, b) => cmp(lower(a.physicalName), lower(b.physicalName)));
  const columns = replaceById(current.columns, part.columns, (c) => lot.has(c.tableId))
    .sort((a, b) => cmp(a.tableId ?? '', b.tableId ?? '') || (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const relationships = replaceById(current.relationships, part.relationships,
    (r) => lot.has(r.parentTableId) || lot.has(r.childTableId));
  const views = replaceById(current.views, part.views, (v) => viewSources(v).some((t) => lot.has(t)));
  return {
    ...current,
    subjectArea: { ...part.subjectArea, viewIds: part.subjectArea.viewIds ?? views.map((v) => v.id) },
    tables, columns, relationships, views,
  };
}
