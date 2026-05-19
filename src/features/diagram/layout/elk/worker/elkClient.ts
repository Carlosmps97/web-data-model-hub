'use client';

/**
 * Main-thread client for the ELK Web Worker.
 *
 * Drop-in replacement for `engine.ts.createElkEngine()`: same
 * `IElkLayoutEngine.layout(graph, mode, opts)` signature so
 * `useElkLayout` only needs to swap the constructor.
 *
 * Lifecycle:
 *
 *   - The first call to `createElkClient()` lazily spins up a
 *     SINGLE Worker for the whole tab. Subsequent calls return the
 *     same singleton — re-spawning a worker per `useElkLayout`
 *     consumer would waste memory and bootstrapping time (~50ms in
 *     our measurements for the bundled elkjs).
 *
 *   - Each layout request is tagged with a uuid and tracked in a
 *     pending Map. When the worker emits a response with that id
 *     we resolve / reject the matching Promise and free the entry.
 *
 *   - AbortSignal: aborting before the response arrives sends a
 *     `cancel` message to the worker AND rejects the Promise
 *     immediately with `AbortError`. The worker drops the eventual
 *     result silently. We do NOT terminate the worker on cancel —
 *     re-bootstrapping ELK on every cancel would be a 50ms tax.
 *
 *   - Concurrency / dedup: callers may fire multiple `layout()` in
 *     quick succession (e.g. a user clicking Auto Arrange twice).
 *     Each call gets its own id and its own pending promise — the
 *     worker processes them sequentially. The CALLER is responsible
 *     for aborting stale requests before issuing new ones (which
 *     `useElkLayout.runLayout` already does via its `abortRef`).
 *
 *   - Fallback: if the Worker fails to construct (CSP, Safari with
 *     workers disabled, bundling error), we log a single warning
 *     and create an in-thread fallback that uses the existing
 *     `engine.ts.createElkEngine()`. The drop-in API holds, so the
 *     canvas keeps working.
 *
 * Bundling note (Next.js 16 / Webpack 5):
 *
 *   `new Worker(new URL('./elk.worker.ts', import.meta.url),
 *               { type: 'module' })`
 *
 *   …is the canonical Webpack 5 pattern. Webpack discovers the
 *   worker entry at build time and emits a separate chunk with the
 *   worker's transitive deps (elkjs.bundled). No `next.config.ts`
 *   change required.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ElkNode } from 'elkjs/lib/elk-api';

import type { ElkLayoutMode } from '../types';
import {
  ElkWorkerMsgType,
  type ElkWorkerInbound,
  type ElkWorkerOutbound,
} from './elkProtocol';
import type {
  IElkLayoutEngine,
  ElkEngineOptions,
  ElkEngineResult,
} from '../engine';

// `createElkEngine` is imported LAZILY only when we need the fallback
// path. This keeps `elkjs/lib/elk.bundled.js` out of the main chunk
// when the Worker is functional (the common case), so the worker
// truly is the only place that pays the elkjs bytes.
async function loadFallbackEngine(): Promise<IElkLayoutEngine> {
  const mod = await import('../engine');
  return mod.createElkEngine();
}

interface PendingEntry {
  resolve: (r: ElkEngineResult) => void;
  reject: (e: Error) => void;
  /** Cleanup function the abort handler invokes. */
  abortCleanup?: () => void;
}

/** Singleton state. Lives at module scope so multiple consumers
 *  share the same Worker. */
const state = {
  worker: null as Worker | null,
  ready: false,
  /** When the worker fails to spin up, we hot-swap to this in-thread
   *  engine so the canvas keeps working. */
  fallback: null as IElkLayoutEngine | null,
  pending: new Map<string, PendingEntry>(),
  /** Resolves once the worker posts its `Ready` message. We await
   *  this on the very first `layout()` call so we don't accidentally
   *  send a `Layout` message into a not-yet-listening worker. */
  readyPromise: null as Promise<void> | null,
  /** Set true after we logged the "falling back to main thread"
   *  warning so we don't spam the console. */
  warnedFallback: false,
};

function logFallbackOnce(reason: string) {
  if (state.warnedFallback) return;
  state.warnedFallback = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[elkClient] Web Worker unavailable (${reason}). Falling back to main-thread ELK. ` +
      `Layouts > 200 nodes may briefly freeze the UI.`,
  );
}

function ensureWorker(): { worker: Worker; readyPromise: Promise<void> } | null {
  if (typeof window === 'undefined') return null; // SSR
  if (state.worker) {
    return { worker: state.worker, readyPromise: state.readyPromise! };
  }

  let worker: Worker;
  try {
    // The `new URL(...)` form is what Next.js / Webpack 5 statically
    // analyses to emit a separate worker chunk at build time.
    worker = new Worker(new URL('./elk.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (err) {
    logFallbackOnce(`construction error: ${(err as Error).message}`);
    return null;
  }

  state.worker = worker;
  state.readyPromise = new Promise<void>((resolveReady) => {
    const onMessage = (event: MessageEvent<ElkWorkerOutbound>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === ElkWorkerMsgType.Ready) {
        state.ready = true;
        resolveReady();
        return;
      }

      if (msg.type === ElkWorkerMsgType.Response) {
        const entry = state.pending.get(msg.id);
        if (!entry) return; // already aborted, response is stale.
        state.pending.delete(msg.id);
        entry.abortCleanup?.();
        if (msg.ok) {
          entry.resolve({ laidOut: msg.laidOut as ElkNode, elapsedMs: msg.elapsedMs });
        } else {
          entry.reject(new Error(msg.error));
        }
      }
    };

    const onError = (event: ErrorEvent) => {
      // Worker crashed (e.g. elkjs threw during init). Reject all
      // pending requests with a synthetic error and tear down the
      // worker so the next call falls back to main thread.
      const err = new Error(`[elkClient] worker error: ${event.message}`);
      for (const [, entry] of state.pending) {
        entry.abortCleanup?.();
        entry.reject(err);
      }
      state.pending.clear();
      worker.terminate();
      state.worker = null;
      state.ready = false;
      state.readyPromise = null;
      logFallbackOnce(`runtime error: ${event.message}`);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });

  return { worker, readyPromise: state.readyPromise };
}

function postLayout(worker: Worker, msg: ElkWorkerInbound) {
  worker.postMessage(msg);
}

/**
 * Build a layout engine that proxies to the dedicated Worker.
 * Falls back to in-thread ELK if the Worker can't be created.
 *
 * The returned object implements `IElkLayoutEngine` so it can drop
 * straight into `useElkLayout` without touching anything else.
 */
export function createElkClient(): IElkLayoutEngine {
  return {
    async layout(
      graph: ElkNode,
      _mode: ElkLayoutMode,
      opts: ElkEngineOptions = {},
    ): Promise<ElkEngineResult> {
      const { signal, overrides } = opts;
      if (signal?.aborted) {
        throw new DOMException('Layout aborted', 'AbortError');
      }

      const handle = ensureWorker();
      if (!handle) {
        // No worker available (SSR or explicit fallback). Run the
        // legacy in-thread engine. The dynamic import below is the
        // only place `elkjs.bundled` enters the main chunk when the
        // Worker is unhealthy.
        if (!state.fallback) state.fallback = await loadFallbackEngine();
        return state.fallback.layout(graph, _mode, opts);
      }

      // Wait for the worker to announce readiness before posting.
      // After the first layout this is a resolved promise so the
      // wait is free.
      await handle.readyPromise;

      const id = uuidv4();
      return new Promise<ElkEngineResult>((resolve, reject) => {
        const onAbort = () => {
          state.pending.delete(id);
          // Fire-and-forget cancel. Worker may still emit a stale
          // response, which the message handler ignores because
          // `state.pending` no longer has the id.
          if (state.worker) {
            try {
              postLayout(state.worker, { type: ElkWorkerMsgType.Cancel, id });
            } catch {
              // Worker dead; nothing to clean up here.
            }
          }
          reject(new DOMException('Layout aborted', 'AbortError'));
        };

        const cleanup = () => {
          if (signal) signal.removeEventListener('abort', onAbort);
        };

        state.pending.set(id, { resolve, reject, abortCleanup: cleanup });

        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        try {
          postLayout(handle.worker, {
            type: ElkWorkerMsgType.Layout,
            id,
            graph,
            overrides,
          });
        } catch (err) {
          // Synchronous postMessage failure (e.g. graph contains a
          // non-cloneable property — this should never happen with
          // our pure-data graphs). Fall back to in-thread.
          state.pending.delete(id);
          cleanup();
          (async () => {
            if (!state.fallback) state.fallback = await loadFallbackEngine();
            try {
              const r = await state.fallback.layout(graph, _mode, opts);
              resolve(r);
            } catch (innerErr) {
              reject(innerErr as Error);
            }
          })();
          // eslint-disable-next-line no-console
          console.warn(
            '[elkClient] postMessage failed, used main-thread fallback once:',
            err,
          );
        }
      });
    },
  };
}

/**
 * Test/debug hook. Kills the worker and clears all pending state.
 * Next call to `createElkClient().layout()` will spin up a fresh
 * worker. Not used in production code paths — exposed for unit
 * tests and for any future "reset diagnostics" UI control.
 */
export function _resetElkClientForTests() {
  if (state.worker) state.worker.terminate();
  state.worker = null;
  state.ready = false;
  state.readyPromise = null;
  state.pending.clear();
  state.fallback = null;
  state.warnedFallback = false;
}
