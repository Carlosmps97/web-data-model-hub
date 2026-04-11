'use client';

import React from 'react';
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
  [key: string]: unknown;
}

const ENDPOINT_R = 4;
const DEFAULT_NODE_WIDTH = 260;

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

    const srcCenterX = srcAbsX + srcW / 2;
    const tgtCenterX = tgtAbsX + tgtW / 2;

    const isSourceLeft = srcCenterX < tgtCenterX;

    if (isSourceLeft) {
      dynamicSrcX = srcAbsX + srcW;
      dynamicSrcPos = Position.Right;
      dynamicTgtX = tgtAbsX;
      dynamicTgtPos = Position.Left;
    } else {
      dynamicSrcX = srcAbsX;
      dynamicSrcPos = Position.Left;
      dynamicTgtX = tgtAbsX + tgtW;
      dynamicTgtPos = Position.Right;
    }
  }

  const [edgePath] = getSmoothStepPath({
    sourceX: dynamicSrcX,
    sourceY,
    sourcePosition: dynamicSrcPos,
    targetX: dynamicTgtX,
    targetY,
    targetPosition: dynamicTgtPos,
    borderRadius: 0,
  });

  const wireColor = isHighlighted ? '#3d7a82' : isDimmed ? '#d6dbd9' : '#5a8fa0';
  const wireWidth = isHighlighted ? 2 : isDimmed ? 1 : 1.5;
  const endpointFill = isHighlighted ? '#3d7a82' : isDimmed ? '#d6dbd9' : '#5a8fa0';
  const labelColor = isHighlighted ? '#3d7a82' : isDimmed ? '#b0bab7' : '#5a7a83';

  const srcLabelOffX = dynamicSrcPos === Position.Right ? 14 : -14;
  const tgtLabelOffX = dynamicTgtPos === Position.Right ? 14 : -14;

  return (
    <>
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

      {/* Animated flow overlay for highlighted edges */}
      {isHighlighted && (
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
