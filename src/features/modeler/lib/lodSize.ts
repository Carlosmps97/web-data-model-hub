// LOD del canvas: tamaño de la caja compacta de un nodo, replicando
// las métricas reales de `.wk-node`/`.wk-vnode` (las mismas que usa
// scripts/arrange_all.py del backend para el auto-arrange):
//   ancho  = clamp(chars·8 + 72, 240, 880)   (max-content de la fila más larga)
//   alto   = 32 (header) + filas·28
// El nodo compacto debe medir lo mismo que el detallado: de lejos, la masa de
// cada tabla y la franja PK son información visual — solo se dejan de pintar
// las filas, que bajo el umbral miden menos de 1px.
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import type { View } from '@/services/views.service';
import { collapseComplexType } from './complexTypes';
import { viewNodeRows } from './viewGraph';

/** Histéresis del umbral: entra compacto bajo ENTER, vuelve a detalle sobre
 *  EXIT (banda muerta para no parpadear en el borde). Valores calibrados sobre
 *  un canvas grande (~400 nodos): con umbrales más altos el compacto aparece
 *  cuando el modelo aún se percibe "cerca"; a 0.10 una fila de 12px mide
 *  1.2px, así que no se pierde nada legible. */
export const LOD_ENTER = 0.1;
export const LOD_EXIT = 0.2;

/** Próximo estado LOD dado el actual y el zoom (puro, para testear). */
export function nextLod(current: boolean, zoom: number): boolean {
  if (current) return zoom <= LOD_EXIT;      // sale recién al superar EXIT
  return zoom < LOD_ENTER;                   // entra recién al bajar de ENTER
}

const clampW = (chars: number) => Math.min(880, Math.max(240, Math.round(chars * 8 + 72)));

export function tableLodSize(
  table: CanonicalTable,
  columns: CanonicalColumn[],
  viewMode: 'logical' | 'physical',
): { w: number; h: number; pkRows: number } {
  const name = (c: { logicalName: string; physicalName: string }) =>
    viewMode === 'logical' ? c.logicalName : c.physicalName;
  const header = table.schema ? `${table.schema}.${name(table)}` : name(table);
  let maxcol = 12;
  for (const c of columns) {
    const len = name(c).length + collapseComplexType(c.dataType).length;
    if (len > maxcol) maxcol = len;
  }
  return {
    w: clampW(Math.max(header.length, maxcol + 3)),
    h: 32 + Math.max(1, columns.length) * 28,
    pkRows: columns.filter((c) => c.isPrimaryKey).length,
  };
}

export function viewLodSize(view: View, colTypes: Record<string, string>): { w: number; h: number } {
  const rows = viewNodeRows(view, colTypes);
  const header = view.schema ? `${view.schema}.${view.name}` : view.name;
  let maxrow = 12;
  for (const r of rows) {
    const len = r.name.length + collapseComplexType(r.type).length;
    if (len > maxrow) maxrow = len;
  }
  return {
    w: clampW(Math.max(header.length, maxrow + 6)),
    h: 32 + Math.max(1, rows.length) * 28,
  };
}
