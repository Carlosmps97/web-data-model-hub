/// <reference lib="webworker" />

/**
 * Dedicated Web Worker that owns an `elkjs` instance and processes
 * `LayoutRequest` messages off the main thread.
 *
 * Bundled build (`elkjs/lib/elk.bundled.js`) carries every algorithm
 * inline so we don't need to ship the auxiliary worker that elkjs
 * itself spawns when configured with `workerUrl`. Re-spawning ELK's
 * own worker from inside a Web Worker is brittle in Next.js because
 * the inner script URL would not be resolved by the same bundler.
 *
 * Cancellation: ELK has no abort hook, so once `elk.layout` is
 * computing we cannot stop it. The worker tracks a `cancelled` set
 * keyed by request id; when the layout resolves, if its id is in
 * that set we silently drop the result instead of posting it back.
 * The main thread's Promise was already rejected on `cancel`, so
 * dropping is safe.
 *
 * Errors: any exception inside `elk.layout` is caught and converted
 * to a `LayoutResponseErr` with the message stringified. We do NOT
 * post the Error instance directly — Firefox in particular drops
 * non-cloneable properties silently.
 *
 * NOTE: we annotate `self` with the `DedicatedWorkerGlobalScope`
 * lib above. This file is compiled by Next/Webpack via
 * `new Worker(new URL(...), { type: 'module' })`, which marks the
 * compilation target as `webworker`. TypeScript needs the lib hint
 * because the project's `tsconfig.json` defaults to `dom`.
 */

import ELK from 'elkjs/lib/elk.bundled.js';

import {
  ElkWorkerMsgType,
  type ElkWorkerInbound,
  type ElkWorkerOutbound,
} from './elkProtocol';

// `self` is `DedicatedWorkerGlobalScope` inside a worker. We type it
// here so the rest of the file can call `postMessage` / `addEventListener`
// without `as` casts every time.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

const elk = new ELK();
const cancelled = new Set<string>();

function post(msg: ElkWorkerOutbound) {
  ctx.postMessage(msg);
}

ctx.addEventListener('message', async (event: MessageEvent<ElkWorkerInbound>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === ElkWorkerMsgType.Cancel) {
    cancelled.add(msg.id);
    return;
  }

  if (msg.type === ElkWorkerMsgType.Layout) {
    const { id, graph, overrides } = msg;

    if (overrides && Object.keys(overrides).length > 0) {
      // Merge per-call overrides on top of the graph's own layout
      // options. We mutate locally — the graph object came over a
      // structured clone so we own this copy.
      graph.layoutOptions = { ...(graph.layoutOptions ?? {}), ...overrides };
    }

    const t0 = performance.now();
    try {
      const laidOut = await elk.layout(graph);
      const elapsedMs = Math.round(performance.now() - t0);

      // Drop the result if the request was cancelled while it ran.
      if (cancelled.has(id)) {
        cancelled.delete(id);
        return;
      }

      post({
        type: ElkWorkerMsgType.Response,
        id,
        ok: true,
        laidOut: laidOut as unknown as import('elkjs/lib/elk-api').ElkNode,
        elapsedMs,
      });
    } catch (err) {
      if (cancelled.has(id)) {
        cancelled.delete(id);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      post({
        type: ElkWorkerMsgType.Response,
        id,
        ok: false,
        error: message,
      });
    }
  }
});

// Announce that the worker is alive so the client can mark the
// channel as ready and stop using the in-thread fallback. We post
// this once per worker lifetime, AFTER the listener is wired up so
// any messages that arrived during boot are still processed.
post({ type: ElkWorkerMsgType.Ready });

export {}; // make this file a module so the `export {}` quiets isolatedModules.
