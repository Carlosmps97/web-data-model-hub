'use client';

/**
 * SVG `<defs>` with every Crow's Foot marker the edge renderer uses.
 *
 * The four cardinalities × two variants (source-side, target-side) are
 * pre-materialised here so each edge can reference them by URL with no
 * per-edge SVG overhead. Source-side markers point "backwards" (into
 * the edge); target-side markers point "forwards".
 *
 * Colour is driven at runtime by `fill=currentColor` + `stroke=currentColor`,
 * so the parent `<path>`'s stroke colour propagates. That lets the
 * CrowsFootEdge component use one set of markers and simply toggle
 * stroke colour for active/dimmed/cross-model without needing 16
 * separate markers.
 *
 * Must be mounted exactly once per page — placed inside the canvas SVG
 * so the `url(#…)` references resolve.
 */

import React from 'react';

import type { CrowsFootCardinality } from '@/types/model';

export interface MarkerIds {
  source: string;
  target: string;
}

/** One marker pair per cardinality, reusable across edges. */
export const CROWS_FOOT_MARKERS: Record<CrowsFootCardinality, MarkerIds> = {
  'one-only': { source: 'cf-one-only-s', target: 'cf-one-only-t' },
  'zero-or-one': { source: 'cf-zero-or-one-s', target: 'cf-zero-or-one-t' },
  'one-or-many': { source: 'cf-one-or-many-s', target: 'cf-one-or-many-t' },
  'zero-or-many': { source: 'cf-zero-or-many-s', target: 'cf-zero-or-many-t' },
};

/** URL helper — saves repeating `url(#…)` everywhere. */
export function markerUrl(id: string): string {
  return `url(#${id})`;
}

// The marker shapes below use a shared viewBox of 16×16 and expect
// `markerUnits="userSpaceOnUse"` so they are rendered at a consistent
// pixel size regardless of the edge's strokeWidth.
const MARKER_WIDTH = 18;
const MARKER_HEIGHT = 18;

/** Orientation — `auto-start-reverse` on source markers makes them
 *  point opposite to the edge direction; auto on target markers keeps
 *  them aligned. */
function Marker({
  id,
  children,
  orient,
  refX,
}: {
  id: string;
  children: React.ReactNode;
  orient: 'auto' | 'auto-start-reverse';
  refX: number;
}) {
  return (
    <marker
      id={id}
      viewBox="0 0 16 16"
      markerWidth={MARKER_WIDTH}
      markerHeight={MARKER_HEIGHT}
      refX={refX}
      refY={8}
      orient={orient}
      markerUnits="userSpaceOnUse"
    >
      {children}
    </marker>
  );
}

/** Shared shapes: kept as fragments so source/target variants reuse them. */
const BAR = <line x1={2} y1={3} x2={2} y2={13} stroke="currentColor" strokeWidth={1.5} />;
const BAR_TARGET = <line x1={14} y1={3} x2={14} y2={13} stroke="currentColor" strokeWidth={1.5} />;
const CIRCLE = (
  <circle cx={7} cy={8} r={3} fill="#ffffff" stroke="currentColor" strokeWidth={1.2} />
);
const CIRCLE_TARGET = (
  <circle cx={9} cy={8} r={3} fill="#ffffff" stroke="currentColor" strokeWidth={1.2} />
);
const CROW_SRC = (
  <>
    <line x1={2} y1={8} x2={12} y2={2} stroke="currentColor" strokeWidth={1.5} />
    <line x1={2} y1={8} x2={12} y2={14} stroke="currentColor" strokeWidth={1.5} />
    <line x1={2} y1={8} x2={12} y2={8} stroke="currentColor" strokeWidth={1.5} />
  </>
);
const CROW_TGT = (
  <>
    <line x1={14} y1={8} x2={4} y2={2} stroke="currentColor" strokeWidth={1.5} />
    <line x1={14} y1={8} x2={4} y2={14} stroke="currentColor" strokeWidth={1.5} />
    <line x1={14} y1={8} x2={4} y2={8} stroke="currentColor" strokeWidth={1.5} />
  </>
);

export default function CrowsFootMarkers() {
  return (
    <svg
      width={0}
      height={0}
      style={{ position: 'absolute', overflow: 'hidden' }}
      aria-hidden
      focusable={false}
    >
      <defs>
        {/* ─── one-only (|) ───────────────────────────────────────── */}
        <Marker id="cf-one-only-s" orient="auto-start-reverse" refX={2}>
          {BAR}
        </Marker>
        <Marker id="cf-one-only-t" orient="auto" refX={14}>
          {BAR_TARGET}
        </Marker>

        {/* ─── zero-or-one (o|) ───────────────────────────────────── */}
        <Marker id="cf-zero-or-one-s" orient="auto-start-reverse" refX={2}>
          {BAR}
          {CIRCLE}
        </Marker>
        <Marker id="cf-zero-or-one-t" orient="auto" refX={14}>
          {BAR_TARGET}
          {CIRCLE_TARGET}
        </Marker>

        {/* ─── one-or-many (|<) ───────────────────────────────────── */}
        <Marker id="cf-one-or-many-s" orient="auto-start-reverse" refX={2}>
          {BAR}
          {CROW_SRC}
        </Marker>
        <Marker id="cf-one-or-many-t" orient="auto" refX={14}>
          {BAR_TARGET}
          {CROW_TGT}
        </Marker>

        {/* ─── zero-or-many (o<) ──────────────────────────────────── */}
        <Marker id="cf-zero-or-many-s" orient="auto-start-reverse" refX={2}>
          {CIRCLE}
          {CROW_SRC}
        </Marker>
        <Marker id="cf-zero-or-many-t" orient="auto" refX={14}>
          {CIRCLE_TARGET}
          {CROW_TGT}
        </Marker>
      </defs>
    </svg>
  );
}
