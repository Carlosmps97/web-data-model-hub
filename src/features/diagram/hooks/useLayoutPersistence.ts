'use client';

/**
 * Persists canvas positions back to Cosmos via the dedicated
 * `PATCH /api/models/{id}/positions` endpoint.
 *
 * Two write paths:
 *   - `persistSinglePosition(tableId, pos)` — called from
 *     `onNodeDragStop`; coalesced with a 500ms debounce so a rapid
 *     drag of multiple tables (or React Flow's interim position
 *     updates) turn into one PATCH.
 *   - `persistAllPositions(map)` — called after an explicit
 *     Auto-layout. Flushes any pending debounced writes first.
 *
 * Failures are logged but swallowed so a transient network blip never
 * surfaces as an error toast — the next successful write will reconcile.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { modelsService } from '@/services';
import type { NodePosition } from '@/types/model';

export type SyncState = 'idle' | 'saving' | 'error';

export interface UseLayoutPersistenceInput {
  /**
   * Either a single `modelId` (model editor) or a resolver
   * `tableId → modelId` for multi-model canvases (global view).
   * Pass `null` to disable persistence entirely.
   */
  modelId?: string | null;
  resolveModelId?: (tableId: string) => string | null;
  debounceMs?: number;
  /** When false, all writes become no-ops (e.g. read-only mode). */
  enabled?: boolean;
}

export interface UseLayoutPersistenceAPI {
  persistSinglePosition: (tableId: string, pos: NodePosition) => void;
  persistAllPositions: (positions: Map<string, NodePosition>) => Promise<void>;
  syncState: SyncState;
}

export function useLayoutPersistence({
  modelId,
  resolveModelId,
  debounceMs = 500,
  enabled = true,
}: UseLayoutPersistenceInput): UseLayoutPersistenceAPI {
  const [syncState, setSyncState] = useState<SyncState>('idle');

  // Pending single-position writes grouped by modelId so each bucket
  // flushes to its own endpoint.
  const pendingRef = useRef<Map<string, Map<string, NodePosition>>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pickModelId = useCallback(
    (tableId: string): string | null => {
      if (resolveModelId) return resolveModelId(tableId);
      return modelId ?? null;
    },
    [modelId, resolveModelId],
  );

  const flush = useCallback(async () => {
    if (!enabled) {
      pendingRef.current.clear();
      return;
    }
    if (pendingRef.current.size === 0) return;
    const snapshot = pendingRef.current;
    pendingRef.current = new Map();

    setSyncState('saving');
    try {
      await Promise.all(
        [...snapshot.entries()].map(([mid, entries]) => {
          const payload: Record<string, NodePosition> = {};
          for (const [k, v] of entries) payload[k] = v;
          return modelsService.updatePositions(mid, { tables: payload });
        }),
      );
      setSyncState('idle');
    } catch (err) {
      console.error('[useLayoutPersistence] PATCH failed', err);
      setSyncState('error');
    }
  }, [enabled]);

  const persistSinglePosition = useCallback(
    (tableId: string, pos: NodePosition) => {
      if (!enabled) return;
      const mid = pickModelId(tableId);
      if (!mid) return;
      if (!pendingRef.current.has(mid)) pendingRef.current.set(mid, new Map());
      pendingRef.current.get(mid)!.set(tableId, pos);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, debounceMs);
    },
    [enabled, pickModelId, debounceMs, flush],
  );

  const persistAllPositions = useCallback(
    async (positions: Map<string, NodePosition>) => {
      if (!enabled) return;
      // Cancel any in-flight single-position debounce; this full write
      // supersedes it.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current.clear();

      // Group by model id.
      const byModel = new Map<string, Record<string, NodePosition>>();
      for (const [tid, pos] of positions) {
        const mid = pickModelId(tid);
        if (!mid) continue;
        if (!byModel.has(mid)) byModel.set(mid, {});
        byModel.get(mid)![tid] = pos;
      }
      if (byModel.size === 0) return;

      setSyncState('saving');
      try {
        await Promise.all(
          [...byModel.entries()].map(([mid, payload]) =>
            modelsService.updatePositions(mid, { tables: payload }),
          ),
        );
        setSyncState('idle');
      } catch (err) {
        console.error('[useLayoutPersistence] bulk PATCH failed', err);
        setSyncState('error');
      }
    },
    [enabled, pickModelId],
  );

  // Cleanup on unmount so a pending debounce doesn't try to write to a
  // deleted model.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { persistSinglePosition, persistAllPositions, syncState };
}
