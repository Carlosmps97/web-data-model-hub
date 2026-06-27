import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

const elk = new ELK();

const opts = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.spacing.nodeNode': '80',
};

const NODE_W = 230;
const NODE_H = 150;

export async function elkLayout(nodes: Node[], edges: Edge[]): Promise<Record<string, { x: number; y: number }>> {
  const graph = {
    id: 'root',
    layoutOptions: opts,
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(graph);
  const out: Record<string, { x: number; y: number }> = {};
  (res.children ?? []).forEach((c) => {
    out[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  });
  return out;
}
