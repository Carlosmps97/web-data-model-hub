'use client';

/**
 * React Flow edge component that renders an ER relationship using
 * Crow's Foot notation + the orthogonal waypoints computed by ELK.
 *
 * Why a custom component: we need (a) markers that reflect the four
 * Crow's Foot states per end, and (b) the ability to draw ELK-provided
 * bend points verbatim instead of relying on React Flow's built-in
 * smoothstep / step paths. The waypoints arrive via `edge.data`.
 *
 * Visual language preserved from `AnimatedEREdge`:
 *   - Cross-model edges render dashed in indigo.
 *   - Hover / highlighted edges animate with a dashed "flow" overlay.
 *   - Dimmed (non-related to the selected table) edges fade.
 *
 * The component is resilient to missing waypoints: if ELK didn't
 * produce any (e.g. during the first render before a layout has
 * completed), we fall back to React Flow's step path so the edge is
 * still drawn — just without the orthogonal precision.
 */

import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';

import type { CrowsFootCardinality } from '@/types/model';

import {
  CROWS_FOOT_MARKERS,
  markerUrl,
} from '../markers/CrowsFootMarkers';

interface CrowsFootEdgeData {
  waypoints?: Array<{ x: number; y: number }>;
  cardinality?: { source: CrowsFootCardinality; target: CrowsFootCardinality };
  highlighted?: boolean;
  dimmed?: boolean;
  crossModel?: boolean;
  [key: string]: unknown;
}

/** Build an SVG path `M x y L x y …` from a list of waypoints. */
function pathFromWaypoints(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  for (const p of rest) d += ` L ${p.x} ${p.y}`;
  return d;
}

/**
 * Pick the column row's source/target handle whose side matches the
 * desired orientation. Returns the absolute canvas coordinates of that
 * handle (centred), or `null` if the lookup misses (e.g. node not yet
 * measured). Used by the smoothstep fallback to anchor the wire to the
 * right side of the column row regardless of which side React Flow's
 * `sourceX/sourceY` happens to point at this frame.
 */
/**
 * Outward offset added to the SOURCE-side smoothstep anchor so the
 * rendered path starts in the gap between tables, matching the
 * geometry ELK produces for its own waypoints.
 *
 * ELK setup (`logicalToElk.ts`):
 *   • Source ports (EAST side) live at `port.x = dims.width, width = 8`,
 *     so ELK's `section.startPoint` lands at `dims.width + 8`
 *     (8px OUTSIDE the right edge of the table).
 *   • Target ports (WEST side) live at `port.x = 0, width = 8`,
 *     so ELK's `section.endPoint` lands at `0`
 *     (AT the left edge of the table — NOT outside).
 *
 * Why this asymmetry is on purpose: the target marker uses
 * `refX = 20` against a viewBox-x=14 bar with `orient=auto`, which
 * already shifts the rendered bar 6px BACKWARD along the path
 * (i.e. AWAY from the table) — so the visual gap on the target side
 * comes "for free" from the marker geometry, with no port offset
 * needed. The source marker uses `refX = -4` against a viewBox-x=2
 * bar with `orient=auto-start-reverse`, which similarly shifts the
 * rendered bar 6px backward along the path. Combined with the 8px
 * port-side offset, the source bar ends up ~2px outside the table
 * edge.
 *
 * Without an offset on the source side, smoothstep mode anchors at
 * the handle CENTER (the table column edge) and the source bar
 * (shifted 6px backward) ends up 6px INSIDE the table block, where
 * the table's own background occludes it. Result: the source-side
 * notation visually disappears after a drag or right after a new
 * relationship is created.
 *
 * The TARGET side is intentionally NOT offset — ELK lands its target
 * endpoint at the table edge and so does smoothstep when we leave
 * the anchor at the handle center. Adding a target offset would push
 * the target marker too far into the gap and create a visible
 * asymmetry between the two render modes (initial-load ELK vs
 * post-drag smoothstep).
 *
 * Sided variant: when source is on the LEFT (inverted layout where
 * the source table has been dragged across the target), the offset
 * negates so the path is pushed LEFT (still outward).
 *
 * The dynamic side-switching logic (Issue #3 / #4) is untouched —
 * `pickHandleAnchor` still chooses left vs. right based on the live
 * node centres; the offset is just applied to the chosen handle's
 * output coordinate when (and only when) that handle plays the
 * `source` role.
 */
const SMOOTHSTEP_ANCHOR_OFFSET = 8;

function pickHandleAnchor(
  internalNode: ReturnType<typeof useInternalNode>,
  role: 'source' | 'target',
  desiredSide: 'left' | 'right',
  columnId: string | null,
): { x: number; y: number; position: Position } | null {
  if (!internalNode?.internals) return null;
  const handles = (internalNode.internals.handleBounds?.[role] ?? []) as Array<{
    id?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    position: Position;
  }>;
  if (handles.length === 0) return null;
  // Prefer the handle whose id encodes both the column and the side.
  // Falls back to any handle whose `position` matches the side so old
  // edges (legacy `<col>-source` ids) still resolve.
  const wantId = columnId ? `${columnId}-${role}-${desiredSide}` : null;
  let h = handles.find((handle) => handle.id === wantId);
  if (!h) {
    h = handles.find((handle) =>
      desiredSide === 'left' ? handle.position === Position.Left : handle.position === Position.Right,
    );
  }
  if (!h) h = handles[0];
  const ax = internalNode.internals.positionAbsolute.x + h.x + h.width / 2;
  const ay = internalNode.internals.positionAbsolute.y + h.y + h.height / 2;
  // Push the SOURCE-side anchor outward along the resolved side so
  // the marker bar lands in the gap, not behind the table block.
  // TARGET side stays at the handle center to match ELK's target-port
  // anchor (which sits AT the table edge, not 8px outside). See the
  // long-form comment on `SMOOTHSTEP_ANCHOR_OFFSET`.
  const dx =
    role !== 'source'
      ? 0
      : h.position === Position.Right
        ? SMOOTHSTEP_ANCHOR_OFFSET
        : h.position === Position.Left
          ? -SMOOTHSTEP_ANCHOR_OFFSET
          : 0;
  return { x: ax + dx, y: ay, position: h.position };
}

export default function CrowsFootEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    sourceHandleId,
    targetHandleId,
    data,
    style,
  } = props;
  const edgeData = (data as CrowsFootEdgeData | undefined) ?? {};
  const waypoints = edgeData.waypoints ?? [];
  const cardinality = edgeData.cardinality ?? {
    source: 'one-only' as CrowsFootCardinality,
    target: 'one-only' as CrowsFootCardinality,
  };
  const isHighlighted = edgeData.highlighted ?? false;
  const isDimmed = edgeData.dimmed ?? false;
  const isCross = edgeData.crossModel ?? false;

  const [isHovered, setIsHovered] = useState(false);
  const isActive = isHighlighted || isHovered;

  // Used only for the fallback path. React Flow gives us the source/target
  // positions (on the node border) plus the port side, so `getSmoothStepPath`
  // produces a sensible default when ELK didn't run yet.
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // ── Path resolution ────────────────────────────────────────────────
  // The two render modes the canvas supports:
  //   1. ELK-routed: `data.waypoints` is an ordered list of bend points
  //      computed by ELK after the most recent auto-layout. The bend
  //      points hug column rows perfectly and avoid foreign nodes.
  //   2. Live smoothstep: `data.waypoints` is empty. Set by Effect A on
  //      brand-new relationships and by `onNodeDragStart` on the edges
  //      incident to a dragged node. In this mode the side of each end
  //      is decided per-frame from the *live* node positions (so the
  //      wire flips sides when one table is dragged across the other —
  //      Issue #3) and the coords are pulled directly off the four
  //      column-row handles via `pickHandleAnchor` (so the wire stays
  //      anchored to the exact column row no matter which side React
  //      Flow's chosen `sourceHandle` happens to live on — Issue #4).
  let edgePath = pathFromWaypoints(waypoints);
  // These hold the resolved anchors / sides that get used both for the
  // path itself and for the cardinality label offsets below. We seed
  // them from React Flow's defaults and override in smoothstep mode.
  let sx = sourceX;
  let sy = sourceY;
  let tx = targetX;
  let ty = targetY;
  let sPos = sourcePosition ?? Position.Right;
  let tPos = targetPosition ?? Position.Left;
  if (!edgePath) {
    if (!sourceNode || !targetNode) return null;

    // Recover column ids from the handle id format
    // `<col>-source-<side>` / `<col>-target-<side>` (and tolerate the
    // legacy `<col>-source` / `<col>-target`).
    const srcCol = sourceHandleId ? sourceHandleId.replace(/-source(?:-(?:left|right))?$/, '') : null;
    const tgtCol = targetHandleId ? targetHandleId.replace(/-target(?:-(?:left|right))?$/, '') : null;

    // Decide the side dynamically by comparing node centres. If the
    // source is to the left of the target, the wire exits on the right
    // of source and enters on the left of target — and vice versa.
    const sCenterX =
      sourceNode.internals.positionAbsolute.x + (sourceNode.measured?.width ?? sourceNode.width ?? 0) / 2;
    const tCenterX =
      targetNode.internals.positionAbsolute.x + (targetNode.measured?.width ?? targetNode.width ?? 0) / 2;
    const sourceSide: 'left' | 'right' = sCenterX <= tCenterX ? 'right' : 'left';
    const targetSide: 'left' | 'right' = sCenterX <= tCenterX ? 'left' : 'right';

    // Resolve the chosen side's column-row handle on each end. If the
    // lookup misses (handle not yet measured), keep React Flow's
    // defaults so we still draw something rather than nothing.
    const sAnchor = pickHandleAnchor(sourceNode, 'source', sourceSide, srcCol);
    const tAnchor = pickHandleAnchor(targetNode, 'target', targetSide, tgtCol);
    if (sAnchor) {
      sx = sAnchor.x;
      sy = sAnchor.y;
      sPos = sAnchor.position;
    } else {
      sPos = sourceSide === 'right' ? Position.Right : Position.Left;
    }
    if (tAnchor) {
      tx = tAnchor.x;
      ty = tAnchor.y;
      tPos = tAnchor.position;
    } else {
      tPos = targetSide === 'right' ? Position.Right : Position.Left;
    }

    const [fallback] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sPos,
      targetX: tx,
      targetY: ty,
      targetPosition: tPos,
      borderRadius: 8,
    });
    edgePath = fallback;
  }

  // Colour language: teal for intra-model, indigo for cross-model, with
  // active / dimmed variants.
  const wireColor = isCross
    ? isActive
      ? '#4338ca'
      : isDimmed
        ? '#c7d2fe'
        : '#4f46e5'
    : isActive
      ? '#0f766e'
      : isDimmed
        ? '#e2e8f0'
        : '#14b8a6';
  const wireWidth = isActive ? 2 : isDimmed ? 1 : 1.5;
  const strokeDasharray = isCross ? '6 4' : undefined;

  const markerStart = markerUrl(CROWS_FOOT_MARKERS[cardinality.source].source);
  const markerEnd = markerUrl(CROWS_FOOT_MARKERS[cardinality.target].target);

  // ── Label anchors ─────────────────────────────────────────────────
  // After the smoothstep-anchor offset above, both render modes place
  // the path start/end ~8px outside the table edge — so the labels
  // can sit at `firstPt`/`lastPt` directly without an extra in-mode
  // adjustment. The historical "+22 in smoothstep" offset was a
  // patch for the old geometry where `sx` sat on the handle centre
  // and labels would otherwise overlap the handle dot; with the new
  // offset that compensation is no longer needed and would push the
  // labels too far from their cardinality marker.
  const isSmoothstepMode = waypoints.length === 0;
  const labelDy = isSmoothstepMode ? -10 : -14;
  const firstPt = waypoints[0] ?? { x: sx, y: sy };
  const lastPt = waypoints[waypoints.length - 1] ?? { x: tx, y: ty };
  const sLabelX = firstPt.x;
  const sLabelY = firstPt.y + labelDy;
  const tLabelX = lastPt.x;
  const tLabelY = lastPt.y + labelDy;

  return (
    <>
      {/* Invisible hit area for hover detection. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ cursor: 'pointer' }}
      />

      {/* Main orthogonal path with crow's foot markers. */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: wireColor,
          strokeWidth: wireWidth,
          strokeDasharray,
          color: wireColor, // propagates to marker `currentColor`
          transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
        }}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />

      {/* Animated flow overlay when active or cross-model. */}
      {(isActive || isCross) && (
        <path
          d={edgePath}
          fill="none"
          stroke={wireColor}
          strokeWidth={1.5}
          strokeDasharray="8 4"
          className="er-edge-flow-anim"
          style={{ opacity: 0.7, pointerEvents: 'none' }}
        />
      )}

      {/* Optional inline label for the cardinality codes (helpful in
          low-contrast prints where the marker is hard to see). */}
      <EdgeLabelRenderer>
        <div
          className="dbdiagram-edge-label"
          style={{
            transform: `translate(-50%, -50%) translate(${sLabelX}px, ${sLabelY}px)`,
            color: wireColor,
            pointerEvents: 'none',
          }}
        >
          {shortLabel(cardinality.source)}
        </div>
        <div
          className="dbdiagram-edge-label"
          style={{
            transform: `translate(-50%, -50%) translate(${tLabelX}px, ${tLabelY}px)`,
            color: wireColor,
            pointerEvents: 'none',
          }}
        >
          {shortLabel(cardinality.target)}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function shortLabel(c: CrowsFootCardinality): string {
  switch (c) {
    case 'one-only':
      return '1';
    case 'zero-or-one':
      return '0..1';
    case 'one-or-many':
      return '1..*';
    case 'zero-or-many':
      return '0..*';
  }
}
