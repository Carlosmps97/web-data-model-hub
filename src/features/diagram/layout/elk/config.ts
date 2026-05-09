/**
 * ELK layout-option presets.
 *
 * The root graph always gets the `COMMON` options below. A preset
 * dictated by `ElkLayoutMode` is spread on top. Per-node options
 * (especially `portConstraints`) are attached in `logicalToElk.ts`.
 *
 * Why these values: see the plan doc for the rationale table; the
 * short version is that `BRANDES_KOEPF` + `LAYER_SWEEP` + `NETWORK_SIMPLEX`
 * is the canonical Sugiyama implementation modern tools rely on, and
 * the spacing defaults come from the plan's recommended ranges tested
 * against real ER models.
 */

import type { ElkLayoutMode } from './types';

/** Shared options applied to every layout call. */
export const COMMON_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.cycleBreaking.strategy': 'GREEDY',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  // Respect manually-placed nodes when they carry x/y coordinates.
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  // 1–10 quality dial. 7 keeps layouts nice for < 200 nodes without
  // blowing the time budget. We dial it down to 5 on very large models.
  'elk.layered.thoroughness': '7',
  // Separate disconnected components visually — we post-process with
  // potpack for nicer island packing.
  'elk.separateConnectedComponents': 'true',
};

/** Per-mode overrides. */
export const MODE_PRESETS: Record<ElkLayoutMode, Record<string, string>> = {
  horizontal: {
    'elk.direction': 'RIGHT',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.nodeNode': '70',
    'elk.spacing.edgeNode': '30',
    'elk.spacing.edgeEdge': '20',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
  },
  vertical: {
    'elk.direction': 'DOWN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '90',
    'elk.spacing.nodeNode': '60',
    'elk.spacing.edgeNode': '25',
    'elk.spacing.edgeEdge': '18',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
  },
  tree: {
    // `mrtree` is a different algorithm; we override the common algorithm.
    'elk.algorithm': 'mrtree',
    'elk.direction': 'DOWN',
    'elk.spacing.nodeNode': '70',
  },
  compact: {
    'elk.direction': 'RIGHT',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.spacing.nodeNode': '40',
    'elk.spacing.edgeNode': '20',
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.layered.thoroughness': '10',
  },
};

/** Build the final layoutOptions map for the given mode. */
export function resolveLayoutOptions(
  mode: ElkLayoutMode,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return { ...COMMON_OPTIONS, ...MODE_PRESETS[mode], ...overrides };
}

/** Options applied to a *table* node so ELK respects column order. */
export const TABLE_NODE_OPTIONS: Record<string, string> = {
  'elk.portConstraints': 'FIXED_ORDER',
  // Allow ELK to let edges cross the node boundary through the declared
  // ports rather than trying to route around the node.
  'elk.portAlignment.default': 'CENTER',
};

/**
 * Options for namespace (model grouping) compound nodes. Kept minimal —
 * the real layering still happens at the leaves.
 */
export const NAMESPACE_NODE_OPTIONS: Record<string, string> = {
  'elk.padding': '[top=48,left=24,bottom=24,right=24]',
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
};
