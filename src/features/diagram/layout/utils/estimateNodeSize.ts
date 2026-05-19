/**
 * Pure node-size estimator used by the ELK layout pipeline.
 *
 * ELK needs a width/height for every node *before* it computes the layout
 * — we cannot wait for the DOM to settle because the first render is
 * already driven by the positions ELK produces. Keep this function a
 * pure function of the data model so the output is deterministic and
 * matches what `TableNode.tsx` / `ViewNode.tsx` will actually render.
 *
 * If the real DOM ends up larger than the estimate (custom fonts, very
 * long names, etc.) the canvas still works — we just lose a bit of
 * whitespace. A second pass that re-measures the DOM can be added later
 * (see `nodeDimensionCache.ts`).
 */

import type { TableModel, ViewModel } from '@/types/model';

// Must stay in sync with the CSS in TableNode and ViewNode.
export const NODE_WIDTH = 260;
export const VIEW_NODE_WIDTH = 280;
export const HEADER_H = 36;
export const ROW_H = 28;
export const FOOTER_H = 28;

export interface NodeDimensions {
  width: number;
  height: number;
}

export function estimateTableSize(table: TableModel): NodeDimensions {
  return {
    width: NODE_WIDTH,
    height:
      HEADER_H +
      table.columns.length * ROW_H +
      (table.functionalDefinition ? FOOTER_H : 0),
  };
}

export function estimateViewSize(view: ViewModel): NodeDimensions {
  if (view.useCustomSql) {
    return { width: VIEW_NODE_WIDTH, height: HEADER_H + 40 + FOOTER_H };
  }
  const includedCols = view.columns.filter((c) => c.include).length;
  const hasFooter =
    view.columns.some((c) => c.include && c.expression) || !!view.whereClause;
  return {
    width: VIEW_NODE_WIDTH,
    height: HEADER_H + includedCols * ROW_H + (hasFooter ? FOOTER_H : 0),
  };
}

/** Dispatches to the right estimator based on the shape of the input. */
export function estimateNodeSize(
  node: TableModel | ViewModel,
): NodeDimensions {
  // Discriminate: TableModel has `columns: TableColumn[]` whose items
  // have a `dataType` field; ViewModel has `columns: ViewColumnTransform[]`
  // whose items have `sourceColumn` + `include`.
  if ((node as ViewModel).sourceTableId !== undefined) {
    return estimateViewSize(node as ViewModel);
  }
  return estimateTableSize(node as TableModel);
}

/**
 * Y-coordinate of the vertical center of a column's row within a table
 * node, relative to the top-left of the node. ELK uses this to anchor
 * the port at the exact vertical position of the column row in the DOM
 * so wires meet the column, not the node edge.
 */
export function columnRowCenterY(columnIndex: number): number {
  return HEADER_H + columnIndex * ROW_H + ROW_H / 2;
}
