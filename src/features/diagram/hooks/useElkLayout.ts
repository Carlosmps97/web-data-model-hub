'use client';

/**
 * Orchestrates the full ELK pipeline for the canvas:
 *
 *   TableModel[] + Relationship[] + ViewModel[]
 *      │
 *      │ buildElkGraph           (logicalToElk.ts)
 *      ▼
 *   ElkNode
 *      │
 *      │ engine.layout           (engine.ts)
 *      ▼
 *   LaidOut ElkNode
 *      │
 *      │ adaptElkResultToReactFlow + buildCardinalityMap
 *      ▼
 *   React Flow Node[] + Edge[]
 *
 * Caching strategy: we hash the structural inputs (tables + rels +
 * mode + hierarchy + persistedPositions) into a fingerprint and only
 * re-run the layout when that changes. Purely positional edits (a drag
 * landing on a new spot) do NOT invalidate the cache — the canvas
 * handles those via `useLayoutPersistence` directly.
 *
 * Cancellation: if a new layout is requested while one is in flight,
 * the old one is aborted via `AbortController`. The result of the
 * aborted call is discarded so stale positions never hit the canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';

import type { Relationship, TableModel, ViewModel } from '@/types/model';

import { createElkEngine } from '../layout/elk/engine';
import { buildElkGraph } from '../layout/elk/logicalToElk';
import {
  adaptElkResultToReactFlow,
  type ElkToReactFlowResult,
} from '../layout/elk/elkToReactFlow';
import { buildCardinalityMap } from '../layout/cardinality/crowsFootMapping';
import type { ElkLayoutMode } from '../layout/elk/types';

export interface UseElkLayoutNamespace {
  id: string;
  label: string;
  engine?: string;
  tintIndex?: number;
  tableIds: string[];
}

export interface UseElkLayoutInput {
  tables: TableModel[];
  relationships: Relationship[];
  views?: ViewModel[];
  /** When present, enables ELK hierarchy mode (compound children). */
  namespaces?: UseElkLayoutNamespace[];
  /** Persisted positions from Cosmos — used as hints by ELK. */
  persistedPositions?: Map<string, { x: number; y: number }>;
  /** Layout mode. Default `horizontal`. */
  mode?: ElkLayoutMode;
  /** Automatically run on input change. Default `true`. */
  autoRun?: boolean;
}

export interface UseElkLayoutOutput {
  nodes: Node[];
  edges: Edge[];
  /** tableId → columnId → 'left' | 'right'. Feed into TableNode.data. */
  handleSideByTable: Map<string, Record<string, 'left' | 'right'>>;
  isLayouting: boolean;
  /** Non-fatal issues surfaced by the graph builder. */
  warnings: string[];
  /** Wall-clock duration of the last successful run (ms). */
  elapsedMs: number | null;
  /**
   * Monotonically increasing counter. Incremented every time the
   * engine produces a fresh layout (initial run, structural change,
   * manual `runLayout`). Consumers use this to distinguish "new
   * layout, re-apply ELK positions" from "same layout, just a hover
   * or other in-place tweak". Without it, every render that touches
   * ELK output state would replace React Flow's node identities and
   * blow away drag/measurement state (`error#015`).
   */
  runVersion: number;
  /**
   * Force a fresh layout. `ignorePersisted` means: drop the
   * persistedPositions hint so the layout reflows from scratch. This
   * is what the "Auto-layout" button uses.
   */
  runLayout: (opts?: { mode?: ElkLayoutMode; ignorePersisted?: boolean }) => Promise<void>;
  /**
   * Cancel any in-flight layout. Used by the canvas drag handler so a
   * layout that finishes mid-drag does NOT overwrite the smoothstep
   * waypoints (`[]`) the drag just installed on the incident edges.
   * Safe to call when nothing is in flight.
   */
  abort: () => void;
}

function fingerprint(input: UseElkLayoutInput): string {
  const { tables, relationships, views = [], mode = 'horizontal', namespaces = [], persistedPositions } = input;

  const t = tables
    .map((tb) => {
      const cols = tb.columns.map((c) => `${c.id}:${c.name}:${c.isNullable ? 'n' : ''}`).join(',');
      return `${tb.id}|${tb.name}|${cols}`;
    })
    .sort()
    .join('||');
  const r = relationships
    .map((rel) => `${rel.id}:${rel.sourceTable}.${rel.sourceColumn}->${rel.targetTable}.${rel.targetColumn}:${rel.type}`)
    .sort()
    .join('|');
  const v = views
    .map((vw) => `${vw.id}:${vw.sourceTableId}:${vw.columns.length}`)
    .sort()
    .join('|');
  const ns = namespaces
    .map((n) => `${n.id}:${n.tableIds.length}`)
    .sort()
    .join('|');
  const pp = persistedPositions
    ? [...persistedPositions.entries()]
        .map(([k, p]) => `${k}:${Math.round(p.x)},${Math.round(p.y)}`)
        .sort()
        .join('|')
    : '';
  return `${mode}::${t}::${r}::${v}::${ns}::${pp}`;
}

/**
 * Cross-model detection — for each relationship, true iff its endpoints
 * live in different namespaces. Returned separately so the adapter can
 * decorate edges without the hook rebuilding everything on hover.
 */
function computeCrossModelEdgeIds(
  relationships: Relationship[],
  namespaces?: UseElkLayoutNamespace[],
): Set<string> {
  const ids = new Set<string>();
  if (!namespaces || namespaces.length < 2) return ids;
  const nsByTable = new Map<string, string>();
  for (const ns of namespaces) for (const tid of ns.tableIds) nsByTable.set(tid, ns.id);
  for (const rel of relationships) {
    const s = nsByTable.get(rel.sourceTable);
    const t = nsByTable.get(rel.targetTable);
    if (s && t && s !== t) ids.add(rel.id);
  }
  return ids;
}

export function useElkLayout(input: UseElkLayoutInput): UseElkLayoutOutput {
  const {
    tables,
    relationships,
    views,
    namespaces,
    persistedPositions,
    mode = 'horizontal',
    autoRun = true,
  } = input;

  const engineRef = useRef(createElkEngine());
  const abortRef = useRef<AbortController | null>(null);

  const [result, setResult] = useState<ElkToReactFlowResult>({
    nodes: [],
    edges: [],
    handleSideByTable: new Map(),
  });
  const [isLayouting, setIsLayouting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [runVersion, setRunVersion] = useState(0);

  const cardinalityByRelId = useMemo(
    () => buildCardinalityMap(relationships, tables),
    [relationships, tables],
  );
  const crossModelEdgeIds = useMemo(
    () => computeCrossModelEdgeIds(relationships, namespaces),
    [relationships, namespaces],
  );

  // Fingerprint is still computed (cheap) and exposed via the hook
  // result for callers that want to detect "structural change" — but we
  // no longer auto-rerun the layout when it ticks. Keeping it here means
  // a future feature can opt back in to fingerprint-driven reruns
  // without rebuilding the whole memoisation pipeline.
  const fp = useMemo(
    () => fingerprint({ tables, relationships, views, namespaces, persistedPositions, mode }),
    [tables, relationships, views, namespaces, persistedPositions, mode],
  );

  const runLayout = useCallback(
    async (opts: { mode?: ElkLayoutMode; ignorePersisted?: boolean } = {}) => {
      // Cancel any in-flight layout.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const effectiveMode = opts.mode ?? mode;
      const effectivePersisted = opts.ignorePersisted ? undefined : persistedPositions;

      const namespaceByTableId = namespaces
        ? new Map<string, string>(
            namespaces.flatMap((ns) => ns.tableIds.map((tid) => [tid, ns.id] as const)),
          )
        : undefined;
      const useHierarchy = !!(namespaces && namespaces.length > 0);

      const { graph, warnings: ws } = buildElkGraph({
        tables,
        relationships,
        views,
        hierarchy: useHierarchy,
        namespaceByTableId,
        namespaces,
        mode: effectiveMode,
        persistedPositions: effectivePersisted,
      });

      setIsLayouting(true);
      setWarnings(ws);

      try {
        const { laidOut, elapsedMs: ms } = await engineRef.current.layout(graph, effectiveMode, {
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        const adapted = adaptElkResultToReactFlow({
          laidOut,
          tables,
          relationships,
          views,
          namespaces,
          cardinalityByRelId,
          crossModelEdgeIds,
        });
        setResult(adapted);
        setElapsedMs(ms);
        // Bump version so consumers know to re-apply ELK positions.
        // We bump on every successful run — even if the adapted nodes
        // shape is structurally identical — because the user may have
        // explicitly hit "Auto-layout" and expects a re-flow.
        setRunVersion((v) => v + 1);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // Surface the failure but keep previous layout visible.
        console.error('[useElkLayout] layout failed', err);
      } finally {
        if (!ctrl.signal.aborted) setIsLayouting(false);
      }
    },
    [
      mode,
      namespaces,
      persistedPositions,
      relationships,
      tables,
      views,
      cardinalityByRelId,
      crossModelEdgeIds,
    ],
  );

  // First-mount layout. Runs ONCE per consumer-component lifetime when
  // the table set transitions from empty → non-empty. Subsequent
  // structural changes (new table, new relationship, edited columns)
  // do NOT trigger an automatic re-layout — the canvas adds the new
  // entity at a sensible default position and lets the user fine-tune
  // it, only re-flowing when they explicitly hit "Auto arrange". This
  // mirrors dbdiagram.io's behaviour and avoids the disorienting
  // "all my tables jumped" effect every time a relationship is drawn.
  //
  // `autoRun=false` opts out entirely (used by preview canvases).
  const hasAutoRunRef = useRef(false);
  const hasTables = tables.length > 0;
  useEffect(() => {
    if (!autoRun) return;
    if (!hasTables) {
      // Empty model — clear any leftover result and stay primed for the
      // next non-empty render to count as a fresh first-mount.
      setResult({ nodes: [], edges: [], handleSideByTable: new Map() });
      hasAutoRunRef.current = false;
      return;
    }
    if (hasAutoRunRef.current) return;
    hasAutoRunRef.current = true;
    runLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, hasTables]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    nodes: result.nodes,
    edges: result.edges,
    handleSideByTable: result.handleSideByTable,
    isLayouting,
    warnings,
    elapsedMs,
    runVersion,
    runLayout,
    abort,
  };
}
