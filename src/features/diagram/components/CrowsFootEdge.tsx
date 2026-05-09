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

  let edgePath = pathFromWaypoints(waypoints);
  if (!edgePath) {
    if (sourceNode && targetNode) {
      const [fallback] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition: sourcePosition ?? Position.Right,
        targetX,
        targetY,
        targetPosition: targetPosition ?? Position.Left,
        borderRadius: 0,
      });
      edgePath = fallback;
    } else {
      return null;
    }
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

  // Label anchors — use the first and last waypoints when available so
  // labels hug the column row, not the node centre.
  const firstPt = waypoints[0] ?? { x: sourceX, y: sourceY };
  const lastPt = waypoints[waypoints.length - 1] ?? { x: targetX, y: targetY };

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
            transform: `translate(-50%, -50%) translate(${firstPt.x}px, ${firstPt.y - 14}px)`,
            color: wireColor,
            pointerEvents: 'none',
          }}
        >
          {shortLabel(cardinality.source)}
        </div>
        <div
          className="dbdiagram-edge-label"
          style={{
            transform: `translate(-50%, -50%) translate(${lastPt.x}px, ${lastPt.y - 14}px)`,
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
