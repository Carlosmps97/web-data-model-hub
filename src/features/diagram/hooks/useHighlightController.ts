'use client';

/**
 * Centralises the hover/selection highlight logic for the canvas.
 *
 * Before: `DiagramCanvas` had three inline `useMemo`s deriving active
 * column sets, then threaded those into every node's data for each
 * render. The logic is identical across the model editor and the
 * global project view, so it belongs in one hook.
 *
 * Usage:
 *
 *   const hl = useHighlightController(tables, relationships, selectedTableId);
 *   // in ReactFlow props:
 *   onNodeMouseEnter={(_, n) => hl.onNodeHover(n.id)}
 *   onNodeMouseLeave={() => hl.onNodeHover(null)}
 *   // when painting nodes, read `hl.state.activeColumnIdsByTable` etc.
 */

import { useCallback, useMemo, useState } from 'react';

import type { Relationship, TableModel } from '@/types/model';
import { resolveColumn } from '@/lib/columnRef';

export interface HighlightState {
  /** The "logically active" table — hover wins over click selection. */
  activeTableId: string | null;
  /** Edge currently hovered (mutually exclusive with `activeTableId`). */
  activeEdgeId: string | null;
  /** Tables incident to the active one (includes the active itself). */
  highlightedTableIds: Set<string>;
  /** Per-table set of column ids whose row should be visually active. */
  activeColumnIdsByTable: Map<string, Set<string>>;
  /** Relationships incident to the active table or actively hovered. */
  highlightedEdgeIds: Set<string>;
  /** True when *anything* is active — used to decide whether to dim others. */
  hasActive: boolean;
}

export interface HighlightAPI {
  state: HighlightState;
  onNodeHover: (tableId: string | null) => void;
  onEdgeHover: (edgeId: string | null) => void;
  /**
   * Hover entered/left a specific column row. Pass `null` to clear.
   * When a column hover is active it WINS over node hover so only
   * the relationships that actually touch that column are highlighted
   * (Issue #5). Edge hover still wins over column hover so the user
   * can drill in further.
   */
  onColumnHover: (ref: { tableId: string; columnId: string } | null) => void;
  clearHover: () => void;
}

export function useHighlightController(
  tables: TableModel[],
  relationships: Relationship[],
  selectedTableId: string | null,
): HighlightAPI {
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  // Column-level hover (Issue #5). Mutually exclusive with edge hover
  // and dominant over node hover so the user can pinpoint a column's
  // relationships even when the cursor sits inside the table node.
  const [hoveredColumn, setHoveredColumn] = useState<{ tableId: string; columnId: string } | null>(null);

  const state = useMemo<HighlightState>(() => {
    // Priority: edge > column > node > selection. Each level zeros out
    // the lower ones so we never double-attribute a hover.
    const activeColumn = hoveredEdgeId ? null : hoveredColumn;
    const activeTableId =
      hoveredEdgeId || activeColumn
        ? null
        : (hoveredTableId ?? selectedTableId);
    const activeEdgeId = hoveredEdgeId;

    const highlightedTableIds = new Set<string>();
    const highlightedEdgeIds = new Set<string>();
    const activeColumnIdsByTable = new Map<string, Set<string>>();

    if (activeEdgeId) {
      const rel = relationships.find((r) => r.id === activeEdgeId);
      if (rel) {
        highlightedEdgeIds.add(rel.id);
        const srcT = tables.find(
          (t) => t.id === rel.sourceTable || t.name === rel.sourceTable,
        );
        const tgtT = tables.find(
          (t) => t.id === rel.targetTable || t.name === rel.targetTable,
        );
        if (srcT) highlightedTableIds.add(srcT.id);
        if (tgtT) highlightedTableIds.add(tgtT.id);
        const sCol = srcT ? resolveColumn(tables, srcT.id, rel.sourceColumn) : null;
        const tCol = tgtT ? resolveColumn(tables, tgtT.id, rel.targetColumn) : null;
        if (srcT && sCol) {
          if (!activeColumnIdsByTable.has(srcT.id)) activeColumnIdsByTable.set(srcT.id, new Set());
          activeColumnIdsByTable.get(srcT.id)!.add(sCol.id);
        }
        if (tgtT && tCol) {
          if (!activeColumnIdsByTable.has(tgtT.id)) activeColumnIdsByTable.set(tgtT.id, new Set());
          activeColumnIdsByTable.get(tgtT.id)!.add(tCol.id);
        }
      }
    } else if (activeColumn) {
      // Column-level hover — narrow highlights to relationships that
      // *touch* this exact column, not every relationship of the table.
      const { tableId: hoveredTid, columnId: hoveredCid } = activeColumn;
      highlightedTableIds.add(hoveredTid);
      // Mark the hovered column itself as active so its row stays lit.
      activeColumnIdsByTable.set(hoveredTid, new Set([hoveredCid]));
      for (const rel of relationships) {
        const srcT = tables.find(
          (t) => t.id === rel.sourceTable || t.name === rel.sourceTable,
        );
        const tgtT = tables.find(
          (t) => t.id === rel.targetTable || t.name === rel.targetTable,
        );
        if (!srcT || !tgtT) continue;
        // Resolve to ids so the comparison works for legacy relationships
        // that still carry column names.
        const sCol = resolveColumn(tables, srcT.id, rel.sourceColumn);
        const tCol = resolveColumn(tables, tgtT.id, rel.targetColumn);
        if (!sCol || !tCol) continue;
        const touchesColumn =
          (srcT.id === hoveredTid && sCol.id === hoveredCid) ||
          (tgtT.id === hoveredTid && tCol.id === hoveredCid);
        if (!touchesColumn) continue;
        highlightedEdgeIds.add(rel.id);
        highlightedTableIds.add(srcT.id);
        highlightedTableIds.add(tgtT.id);
        if (!activeColumnIdsByTable.has(srcT.id)) activeColumnIdsByTable.set(srcT.id, new Set());
        activeColumnIdsByTable.get(srcT.id)!.add(sCol.id);
        if (!activeColumnIdsByTable.has(tgtT.id)) activeColumnIdsByTable.set(tgtT.id, new Set());
        activeColumnIdsByTable.get(tgtT.id)!.add(tCol.id);
      }
    } else if (activeTableId) {
      highlightedTableIds.add(activeTableId);
      for (const rel of relationships) {
        const srcT = tables.find(
          (t) => t.id === rel.sourceTable || t.name === rel.sourceTable,
        );
        const tgtT = tables.find(
          (t) => t.id === rel.targetTable || t.name === rel.targetTable,
        );
        if (!srcT || !tgtT) continue;
        const touchesActive = srcT.id === activeTableId || tgtT.id === activeTableId;
        if (!touchesActive) continue;

        highlightedEdgeIds.add(rel.id);
        highlightedTableIds.add(srcT.id);
        highlightedTableIds.add(tgtT.id);

        const sCol = resolveColumn(tables, srcT.id, rel.sourceColumn);
        const tCol = resolveColumn(tables, tgtT.id, rel.targetColumn);
        if (sCol) {
          if (!activeColumnIdsByTable.has(srcT.id)) activeColumnIdsByTable.set(srcT.id, new Set());
          activeColumnIdsByTable.get(srcT.id)!.add(sCol.id);
        }
        if (tCol) {
          if (!activeColumnIdsByTable.has(tgtT.id)) activeColumnIdsByTable.set(tgtT.id, new Set());
          activeColumnIdsByTable.get(tgtT.id)!.add(tCol.id);
        }
      }
    }

    return {
      activeTableId,
      activeEdgeId,
      highlightedTableIds,
      highlightedEdgeIds,
      activeColumnIdsByTable,
      hasActive:
        activeTableId !== null || activeEdgeId !== null || activeColumn !== null,
    };
  }, [tables, relationships, selectedTableId, hoveredTableId, hoveredEdgeId, hoveredColumn]);

  const onNodeHover = useCallback((id: string | null) => {
    setHoveredTableId(id);
    if (id) setHoveredEdgeId(null);
  }, []);
  const onEdgeHover = useCallback((id: string | null) => {
    setHoveredEdgeId(id);
    if (id) {
      setHoveredTableId(null);
      setHoveredColumn(null);
    }
  }, []);
  const onColumnHover = useCallback(
    (ref: { tableId: string; columnId: string } | null) => {
      setHoveredColumn(ref);
      if (ref) setHoveredEdgeId(null);
    },
    [],
  );
  const clearHover = useCallback(() => {
    setHoveredEdgeId(null);
    setHoveredTableId(null);
    setHoveredColumn(null);
  }, []);

  return { state, onNodeHover, onEdgeHover, onColumnHover, clearHover };
}
