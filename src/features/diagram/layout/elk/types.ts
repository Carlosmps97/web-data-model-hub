/**
 * Internal type glue between the domain model, ELK, and React Flow.
 *
 * `elkjs` ships its own types via `elkjs/lib/elk-api` but they are
 * generic and do not know about our semantic fields (column id, crow's
 * foot cardinality, namespace tint, etc.). We re-export thin wrappers
 * that add what we need so the rest of the code doesn't cast.
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';

/**
 * Layout presets exposed to the UI. Internally each one maps to a set
 * of `elk.*` options in `./config.ts`.
 *
 *   - `horizontal` · layered, RIGHT, ortho. Default for ER diagrams.
 *   - `vertical`   · layered, DOWN. Better for short hierarchies.
 *   - `tree`       · `mrtree` algorithm. Pure parent→child layouts.
 *   - `compact`    · layered with tight spacing. Dense models.
 */
export type ElkLayoutMode = 'horizontal' | 'vertical' | 'tree' | 'compact';

/** Extended ElkNode with semantic bookkeeping we care about downstream. */
export interface ElkNodeExt extends ElkNode {
  /** Discriminator so we can pull the right render component. */
  __kind: 'table' | 'view' | 'namespace';
  /**
   * Absolute position computed after the layered pass. Populated by
   * `elkToReactFlow` (ELK only stores coordinates relative to the
   * parent, and React Flow needs absolutes for non-hierarchy mode).
   */
  __absX?: number;
  __absY?: number;
}

/** Port-id convention: `<tableId>::<columnId>::<role>`. */
export type PortRole = 'source' | 'target';

export function buildPortId(
  tableId: string,
  columnId: string,
  role: PortRole,
): string {
  return `${tableId}::${columnId}::${role}`;
}

export function parsePortId(
  portId: string,
): { tableId: string; columnId: string; role: PortRole } | null {
  const parts = portId.split('::');
  if (parts.length !== 3) return null;
  const [tableId, columnId, role] = parts;
  if (role !== 'source' && role !== 'target') return null;
  return { tableId, columnId, role };
}

/**
 * Re-export: ELK's extended edge shape (with sections + bend points).
 * Everyone importing routing data should go through this alias so we
 * can swap to a custom shape later if needed.
 */
export type ElkEdgeExt = ElkExtendedEdge;
