import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

const elk = new ELK();

/**
 * Auto-arrange del canvas con ELK (Eclipse Layout Kernel) — algoritmo `layered`
 * (Sugiyama). NO usamos matemática de posicionamiento hecha a mano: ELK resuelve
 * asignación de capas, orden dentro de capa (minimización de cruces) y coordenadas.
 * El ruteo visual de los wires lo hace React Flow (`getSmoothStepPath`, ortogonal).
 *
 * Config afinada para diagramas ER (validada contra el canvas de estrés):
 *  · separateConnectedComponents + componentComponent → las tablas/clusters SUELTOS
 *    se empaquetan en bloques compactos en vez de una tira larga.
 *  · spacing.edge* → los wires tienen AIRE (no se pegan a los nodos ni entre sí).
 *  · BRANDES_KOEPF + favorStraightEdges → columnas balanceadas y wires más rectos.
 *  · crossingMinimization LAYER_SWEEP + thoroughness alto → menos cruces de wires.
 *  · usa el ancho/alto MEDIDO de cada nodo (ahora variable por el ancho dinámico),
 *    así el layout respeta el tamaño real de cada tabla.
 */
const opts: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',                 // flujo de dependencias izq→der (coincide con los handles src=Right/tgt=Left)
  'elk.edgeRouting': 'ORTHOGONAL',
  // Empaquetado de componentes desconectados (tablas sin relaciones / subgrafos).
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '64',
  // Separación de nodos y entre capas (holgada para nodos anchos + wires).
  'elk.layered.spacing.nodeNodeBetweenLayers': '140',
  'elk.spacing.nodeNode': '72',
  // Aire para los wires: separación wire↔nodo y wire↔wire.
  'elk.spacing.edgeNode': '28',
  'elk.spacing.edgeEdge': '16',
  'elk.layered.spacing.edgeNodeBetweenLayers': '28',
  // Calidad del layout: colocación balanceada, wires rectos y pocos cruces.
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.thoroughness': '10',
};

// Fallback SÓLO si un nodo aún no fue medido por React Flow (raro: el arrange se
// dispara con el canvas visible). Los reales llegan por `n.measured`.
const NODE_W = 240;
const NODE_H = 160;

export async function elkLayout(nodes: Node[], edges: Edge[]): Promise<Record<string, { x: number; y: number }>> {
  const graph = {
    id: 'root',
    layoutOptions: opts,
    children: nodes.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? (typeof n.width === 'number' ? n.width : NODE_W),
      height: n.measured?.height ?? (typeof n.height === 'number' ? n.height : NODE_H),
    })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(graph);
  const out: Record<string, { x: number; y: number }> = {};
  (res.children ?? []).forEach((c) => {
    out[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  });
  return out;
}
