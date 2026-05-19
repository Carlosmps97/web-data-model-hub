/**
 * Thin wrapper around elkjs.
 *
 * The bundled build (`elkjs/lib/elk.bundled.js`) runs ELK's graal-vm-
 * compiled JS in the main thread but yields via setTimeout internally
 * so the UI stays responsive for < ~200 nodes. For larger graphs the
 * engine can be swapped for the Web-Worker variant without changing
 * any caller by replacing the `new ELK()` construction here.
 *
 * A single instance is reused across calls; elkjs documents this as
 * safe and avoids the allocation cost of bootstrapping the GWT runtime
 * on every layout.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

import type { ElkLayoutMode } from './types';

export interface ElkEngineOptions {
  /** Merge extra `elk.*` options on top of the mode preset. */
  overrides?: Record<string, string>;
  /**
   * Abort signal. Cancels nothing inside ELK (the library has no
   * cancellation hook), but the resulting promise is rejected so the
   * caller doesn't commit a stale layout.
   */
  signal?: AbortSignal;
}

export interface ElkEngineResult {
  laidOut: ElkNode;
  elapsedMs: number;
}

export interface IElkLayoutEngine {
  layout(graph: ElkNode, mode: ElkLayoutMode, opts?: ElkEngineOptions): Promise<ElkEngineResult>;
}

const _singleton: { elk: InstanceType<typeof ELK> | null } = { elk: null };

function getElk(): InstanceType<typeof ELK> {
  if (!_singleton.elk) _singleton.elk = new ELK();
  return _singleton.elk;
}

/**
 * Create an engine instance. Stateless from the caller's perspective —
 * the same underlying ELK is reused, but the options argument is
 * per-call.
 */
export function createElkEngine(): IElkLayoutEngine {
  return {
    async layout(graph, _mode, opts = {}) {
      const { signal } = opts;
      if (signal?.aborted) throw new DOMException('Layout aborted', 'AbortError');

      const t0 =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now();

      // `graph` already carries the mode-specific layoutOptions through
      // `buildElkGraph` + `resolveLayoutOptions`. We merge `overrides`
      // here so callers can tweak without rebuilding the whole graph.
      if (opts.overrides && Object.keys(opts.overrides).length > 0) {
        graph.layoutOptions = { ...graph.layoutOptions, ...opts.overrides };
      }

      const laidOut = await getElk().layout(graph);

      if (signal?.aborted) throw new DOMException('Layout aborted', 'AbortError');

      const t1 =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now();

      return { laidOut: laidOut as ElkNode, elapsedMs: Math.round(t1 - t0) };
    },
  };
}
