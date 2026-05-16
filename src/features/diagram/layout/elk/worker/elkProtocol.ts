/**
 * Wire protocol between the main thread (`elkClient.ts`) and the
 * dedicated Web Worker (`elk.worker.ts`).
 *
 * Design choices:
 *
 *   - Every request carries a unique `id` so the client can resolve
 *     the right Promise when the response arrives. ELK does not
 *     guarantee response order, and concurrent requests are possible
 *     while a previous one is still in flight (the queue cancels them
 *     but the worker may still emit a stale `LayoutResponse`).
 *
 *   - Cancel is fire-and-forget. ELK has no native cancellation, so
 *     the worker simply drops the result of any cancelled `id` when
 *     the layout finishes — there is no `CancelAck`. The main thread
 *     rejects its Promise immediately on `cancel`.
 *
 *   - We avoid sharing class instances or functions across the
 *     postMessage boundary. The graph is a plain object that
 *     structured-clone serialises cheaply (numbers, strings, nested
 *     plain objects, no circular refs by construction in
 *     `logicalToElk`).
 *
 *   - The response keeps `elapsedMs` measured INSIDE the worker so
 *     callers can attribute time correctly: the postMessage
 *     round-trip itself is cheap (~1-3ms even for big graphs in
 *     modern browsers) but excluding it from the benchmark gives a
 *     clean signal of the engine's own cost.
 */

import type { ElkNode } from 'elkjs/lib/elk-api';

/**
 * Tag for the discriminated union.
 *
 * IMPORTANT: this is a plain `const` object, NOT a TypeScript
 * `enum` or `const enum`. With `isolatedModules: true` (the Next.js
 * default in `tsconfig.json`), Turbopack compiles each file in
 * isolation and a `const enum` exported from one file cannot be
 * inlined into another — the imported reference resolves to
 * `undefined` at runtime, which silently breaks every message
 * comparison `msg.type === ElkWorkerMsgType.X` inside the worker.
 *
 * A `const` object emitted as plain runtime data sidesteps the
 * issue: both the main thread and the worker get the same string
 * values regardless of how the compiler splits the bundle.
 *
 * The `type` import-export of `ElkWorkerMsgTypeValue` keeps
 * exhaustiveness checks at the same level as a string-union type.
 */
export const ElkWorkerMsgType = {
  Layout: 'layout',
  Cancel: 'cancel',
  Ready: 'ready',
  Response: 'response',
} as const;
export type ElkWorkerMsgTypeValue =
  (typeof ElkWorkerMsgType)[keyof typeof ElkWorkerMsgType];

export interface LayoutRequest {
  type: typeof ElkWorkerMsgType.Layout;
  id: string;
  graph: ElkNode;
  /**
   * Per-call ELK options merged on top of the graph's own
   * `layoutOptions`. Mostly empty in practice — the graph builder
   * already bakes the mode preset in. Kept here as an escape hatch
   * for future overrides.
   */
  overrides?: Record<string, string>;
}

export interface CancelRequest {
  type: typeof ElkWorkerMsgType.Cancel;
  id: string;
}

export type ElkWorkerInbound = LayoutRequest | CancelRequest;

export interface ReadyMessage {
  type: typeof ElkWorkerMsgType.Ready;
}

export interface LayoutResponseOk {
  type: typeof ElkWorkerMsgType.Response;
  id: string;
  ok: true;
  laidOut: ElkNode;
  elapsedMs: number;
}

export interface LayoutResponseErr {
  type: typeof ElkWorkerMsgType.Response;
  id: string;
  ok: false;
  /** Human-readable error message; never an Error instance (won't
   *  cross postMessage cleanly across all browsers). */
  error: string;
}

export type ElkWorkerOutbound = ReadyMessage | LayoutResponseOk | LayoutResponseErr;
