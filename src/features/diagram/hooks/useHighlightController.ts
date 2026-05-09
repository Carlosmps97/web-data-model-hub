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
  clearHover: () => void;
}

export function useHighlightController(
  tables: TableModel[],
  relationships: Relationship[],
  selectedTableId: string | null,
): HighlightAPI {
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const state = useMemo<HighlightState>(() => {
    const activeTableId = hoveredTableId ?? (hoveredEdgeId ? null : selectedTableId);
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
      hasActive: activeTableId !== null || activeEdgeId !== null,
    };
  }, [tables, relationships, selectedTableId, hoveredTableId, hoveredEdgeId]);

  const onNodeHover = useCallback((id: string | null) => {
    setHoveredTableId(id);
    if (id) setHoveredEdgeId(null);
  }, []);
  const onEdgeHover = useCallback((id: string | null) => {
    setHoveredEdgeId(id);
    if (id) setHoveredTableId(null);
  }, []);
  const clearHover = useCallback(() => {
    setHoveredEdgeId(null);
    setHoveredTableId(null);
  }, []);

  return { state, onNodeHover, onEdgeHover, clearHover };
}
