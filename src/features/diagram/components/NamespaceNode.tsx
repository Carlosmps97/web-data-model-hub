'use client';

import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { DatabaseEngine } from '@/types/model';
import EngineBadge from '@/features/engines/components/EngineBadge';

export interface NamespaceNodeData {
  label: string;
  engine?: DatabaseEngine;
  width: number;
  height: number;
  /** Palette index (0..n) to pick a default tint when no engine color. */
  tintIndex?: number;
  [key: string]: unknown;
}

const TINTS = [
  { border: 'rgba(70, 129, 137, 0.45)', bg: 'rgba(70, 129, 137, 0.06)' },
  { border: 'rgba(108, 92, 231, 0.45)', bg: 'rgba(108, 92, 231, 0.05)' },
  { border: 'rgba(212, 130, 26, 0.45)', bg: 'rgba(212, 130, 26, 0.05)' },
  { border: 'rgba(46, 158, 90, 0.45)', bg: 'rgba(46, 158, 90, 0.05)' },
  { border: 'rgba(224, 108, 117, 0.45)', bg: 'rgba(224, 108, 117, 0.05)' },
];

function NamespaceNodeComponent({ data }: NodeProps) {
  const d = data as NamespaceNodeData;
  const tint = TINTS[(d.tintIndex ?? 0) % TINTS.length];

  return (
    <div
      className="namespace-node"
      style={{
        width: d.width,
        height: d.height,
        borderColor: tint.border,
        background: tint.bg,
      }}
    >
      <div className="namespace-node-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
        </svg>
        <span className="namespace-node-title">{d.label}</span>
        {d.engine && <EngineBadge engine={d.engine} compact />}
      </div>
    </div>
  );
}

export default React.memo(NamespaceNodeComponent);
