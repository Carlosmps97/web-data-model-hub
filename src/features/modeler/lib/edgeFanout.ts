/**
 * Fan-out de wires: los K edges crowfoot que salen del mismo bloque padre se
 * reparten en la "zona de llave" (cabecera + franja PK) para que las patas de
 * gallo no se encimen. El canvas asigna slot/count al armar los edges (orden
 * por posición del hijo → menos cruces, estable); CrowFootEdge calcula la Y en
 * vivo con las métricas del nodo. Puro.
 */
export const HEADER_H = 32;   // alto de cabecera del nodo (espejo de lodSize.ts)
export const ROW_H = 28;      // alto de fila de columna (espejo de lodSize.ts)
export const MIN_GAP = 9;     // espaciado mínimo entre salidas (px de canvas)

export interface FanEdge { id: string; parentId: string; targetY: number; targetX: number; }

/** Slot por edge, agrupando por bloque padre; orden estable por (Y, X, id) del destino. */
export function fanSlots(edges: FanEdge[]): Map<string, { slot: number; count: number }> {
  const byParent = new Map<string, FanEdge[]>();
  for (const e of edges) {
    const a = byParent.get(e.parentId);
    if (a) a.push(e); else byParent.set(e.parentId, [e]);
  }
  const out = new Map<string, { slot: number; count: number }>();
  for (const group of byParent.values()) {
    const sorted = [...group].sort((a, b) =>
      (a.targetY - b.targetY) || (a.targetX - b.targetX) || a.id.localeCompare(b.id));
    sorted.forEach((e, i) => out.set(e.id, { slot: i, count: sorted.length }));
  }
  return out;
}

/** Y absoluta de salida del wire `slot` de `count` sobre un padre en `nodeTop`:
 *  equiespaciado dentro de la zona de llave; bajo MIN_GAP se usa todo el bloque. */
export function fanSourceY(nodeTop: number, nodeHeight: number, pkRows: number,
                           slot: number, count: number): number {
  let zone = Math.min(HEADER_H + pkRows * ROW_H, nodeHeight);
  if (zone / (count + 1) < MIN_GAP) zone = nodeHeight;
  return nodeTop + ((slot + 1) * zone) / (count + 1);
}
