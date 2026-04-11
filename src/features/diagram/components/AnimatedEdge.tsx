'use client';

import React from 'react';
import {
  BaseEdge,
  getSmoothStepPath,
  EdgeLabelRenderer,
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

export default function AnimatedEREdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const edgeData = data as AnimatedEdgeData | undefined;
  const isHighlighted = edgeData?.highlighted ?? false;
  const isDimmed = edgeData?.dimmed ?? false;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 0,
  });

  const wireColor = isHighlighted ? '#3d7a82' : isDimmed ? '#d6dbd9' : '#5a8fa0';
  const wireWidth = isHighlighted ? 2 : isDimmed ? 1 : 1.5;
  const endpointFill = isHighlighted ? '#3d7a82' : isDimmed ? '#d6dbd9' : '#5a8fa0';
  const labelColor = isHighlighted ? '#3d7a82' : isDimmed ? '#b0bab7' : '#5a7a83';

  const srcLabelOffX = targetX > sourceX ? 14 : -14;
  const tgtLabelOffX = sourceX > targetX ? 14 : -14;

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

      {/* Source endpoint circle */}
      <circle
        cx={sourceX}
        cy={sourceY}
        r={ENDPOINT_R}
        fill="#FFFFFF"
        stroke={endpointFill}
        strokeWidth={1.5}
      />

      {/* Target endpoint circle */}
      <circle
        cx={targetX}
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
              transform: `translate(-50%, -50%) translate(${sourceX + srcLabelOffX}px, ${sourceY - 12}px)`,
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
              transform: `translate(-50%, -50%) translate(${targetX + tgtLabelOffX}px, ${targetY - 12}px)`,
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
