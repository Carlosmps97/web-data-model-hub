'use client';

import React, { useState } from 'react';
import {
  BaseEdge,
  getSmoothStepPath,
  EdgeLabelRenderer,
  Position,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';

interface AnimatedEdgeData {
  highlighted?: boolean;
  dimmed?: boolean;
  sourceLabel?: string;
  targetLabel?: string;
  edgeIndex?: number;
  [key: string]: unknown;
}

const ENDPOINT_R = 4;
const DEFAULT_NODE_WIDTH = 260;
const SAME_SIDE_GAP = 30;
const EDGE_OFFSET_BASE = 20;
const EDGE_OFFSET_STEP = 16;

export default function AnimatedEREdge({
  id,
  source,
  target,
  sourceX: fallbackSrcX,
  sourceY,
  targetX: fallbackTgtX,
  targetY,
  sourcePosition: fallbackSrcPos,
  targetPosition: fallbackTgtPos,
  data,
  style,
}: EdgeProps) {
  const edgeData = data as AnimatedEdgeData | undefined;
  const isHighlighted = edgeData?.highlighted ?? false;
  const isDimmed = edgeData?.dimmed ?? false;
  const [isHovered, setIsHovered] = useState(false);
  const isActive = isHighlighted || isHovered;

  // ── Smart routing: read node positions in real-time ──
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  let dynamicSrcX = fallbackSrcX;
  let dynamicTgtX = fallbackTgtX;
  let dynamicSrcPos = fallbackSrcPos;
  let dynamicTgtPos = fallbackTgtPos;

  if (sourceNode && targetNode) {
    const srcAbsX = sourceNode.internals.positionAbsolute.x;
    const tgtAbsX = targetNode.internals.positionAbsolute.x;
    const srcW = sourceNode.measured.width ?? DEFAULT_NODE_WIDTH;
    const tgtW = targetNode.measured.width ?? DEFAULT_NODE_WIDTH;

    const srcRight = srcAbsX + srcW;
    const tgtRight = tgtAbsX + tgtW;

    // Horizontal gap between nodes (negative = overlap)
    const horizontalGap = Math.max(srcAbsX, tgtAbsX) - Math.min(srcRight, tgtRight);

    if (horizontalGap >= SAME_SIDE_GAP) {
      // ── Clear horizontal separation → opposite-side routing ──
      const isSourceLeft = srcAbsX + srcW / 2 < tgtAbsX + tgtW / 2;
      if (isSourceLeft) {
        dynamicSrcX = srcRight;
        dynamicSrcPos = Position.Right;
        dynamicTgtX = tgtAbsX;
        dynamicTgtPos = Position.Left;
      } else {
        dynamicSrcX = srcAbsX;
        dynamicSrcPos = Position.Left;
        dynamicTgtX = tgtRight;
        dynamicTgtPos = Position.Right;
      }
    } else {
      // ── Horizontal overlap → same-side routing (L-L or R-R) ──
      // Pick the side with the shortest total detour
      const leftCost = (srcAbsX) + (tgtAbsX);             // distance from x=0
      const rightCost = (srcRight) + (tgtRight);           // how far right both extend
      // leftCost small = nodes are near left edge → more room on right → go left
      // We compare: going left means detour to min(srcAbsX,tgtAbsX)-GAP
      // going right means detour to max(srcRight,tgtRight)+GAP
      const leftDetour = (srcAbsX - (Math.min(srcAbsX, tgtAbsX) - SAME_SIDE_GAP))
                       + (tgtAbsX - (Math.min(srcAbsX, tgtAbsX) - SAME_SIDE_GAP));
      const rightDetour = ((Math.max(srcRight, tgtRight) + SAME_SIDE_GAP) - srcRight)
                        + ((Math.max(srcRight, tgtRight) + SAME_SIDE_GAP) - tgtRight);

      if (leftDetour <= rightDetour) {
        dynamicSrcX = srcAbsX;
        dynamicSrcPos = Position.Left;
        dynamicTgtX = tgtAbsX;
        dynamicTgtPos = Position.Left;
      } else {
        dynamicSrcX = srcRight;
        dynamicSrcPos = Position.Right;
        dynamicTgtX = tgtRight;
        dynamicTgtPos = Position.Right;
      }
    }
  }

  // Per-edge offset so overlapping wires don't share the same line
  const edgeIndex = edgeData?.edgeIndex ?? 0;
  const pathOffset = EDGE_OFFSET_BASE + edgeIndex * EDGE_OFFSET_STEP;

  const [edgePath] = getSmoothStepPath({
    sourceX: dynamicSrcX,
    sourceY,
    sourcePosition: dynamicSrcPos,
    targetX: dynamicTgtX,
    targetY,
    targetPosition: dynamicTgtPos,
    borderRadius: 0,
    offset: pathOffset,
  });

  const wireColor = isActive ? '#3d7a82' : isDimmed ? '#d6dbd9' : '#5a8fa0';
  const wireWidth = isActive ? 2 : isDimmed ? 1 : 1.5;
  const endpointFill = isActive ? '#3d7a82' : isDimmed ? '#d6dbd9' : '#5a8fa0';
  const labelColor = isActive ? '#3d7a82' : isDimmed ? '#b0bab7' : '#5a7a83';

  const srcLabelOffX = dynamicSrcPos === Position.Right ? 14 : -14;
  const tgtLabelOffX = dynamicTgtPos === Position.Right ? 14 : -14;

  return (
    <>
      {/* Invisible wide hit-area for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ cursor: 'pointer' }}
      />

      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: wireColor,
          strokeWidth: wireWidth,
          transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
        }}
      />

      {/* Animated flow overlay — on hover or selection */}
      {isActive && (
        <path
          d={edgePath}
          fill="none"
          className="er-edge-flow-anim"
        />
      )}

      {/* Source endpoint circle */}
      <circle
        cx={dynamicSrcX}
        cy={sourceY}
        r={ENDPOINT_R}
        fill="#FFFFFF"
        stroke={endpointFill}
        strokeWidth={1.5}
      />

      {/* Target endpoint circle */}
      <circle
        cx={dynamicTgtX}
        cy={targetY}
        r={ENDPOINT_R}
        fill="#FFFFFF"
        stroke={endpointFill}
        strokeWidth={1.5}
      />

      {/* Cardinality labels */}
      <EdgeLabelRenderer>
        {edgeData?.sourceLabel && (
          <div
            className="dbdiagram-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${dynamicSrcX + srcLabelOffX}px, ${sourceY - 12}px)`,
              color: labelColor,
            }}
          >
            {edgeData.sourceLabel}
          </div>
        )}
        {edgeData?.targetLabel && (
          <div
            className="dbdiagram-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${dynamicTgtX + tgtLabelOffX}px, ${targetY - 12}px)`,
              color: labelColor,
            }}
          >
            {edgeData.targetLabel}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
