'use client';

import React from 'react';
import type { DatabaseEngine } from '@/types/model';
import { getEngine } from '../engines';

interface EngineBadgeProps {
  engine?: DatabaseEngine | null;
  /** When true, show a short label, otherwise full name. Default: false. */
  compact?: boolean;
  /** Tooltip / aria-label. Defaults to engine label. */
  title?: string;
  className?: string;
}

export default function EngineBadge({ engine, compact = false, title, className }: EngineBadgeProps) {
  const def = getEngine(engine);
  if (!def) {
    return (
      <span className={`engine-badge engine-badge-unset ${className ?? ''}`.trim()} title={title ?? 'No engine selected'}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14a9 3 0 0 0 18 0V5" />
          <path d="M3 12a9 3 0 0 0 18 0" />
        </svg>
        {compact ? '—' : 'No engine'}
      </span>
    );
  }

  return (
    <span
      className={`engine-badge ${className ?? ''}`.trim()}
      title={title ?? def.label}
      style={{
        color: def.color,
        background: def.bg,
        borderColor: `${def.color}33`,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
      {compact ? def.shortLabel : def.label}
    </span>
  );
}
