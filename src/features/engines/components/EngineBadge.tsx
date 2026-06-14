'use client';

import React from 'react';
import type { DatabaseEngine } from '@/types/model';
import { getEngine } from '../engines';

interface EngineBadgeProps {
  engine?: DatabaseEngine | null;
  /** When true, show the short label. Default: false (full label). */
  compact?: boolean;
  title?: string;
  className?: string;
}

/** Aurora engine chip: a colored dot + the engine name (`.rd-engine`). */
export default function EngineBadge({ engine, compact = false, title, className }: EngineBadgeProps) {
  const def = getEngine(engine);
  if (!def) {
    return (
      <span className={`rd-engine ${className ?? ''}`.trim()} title={title ?? 'Sin engine'}>
        <span className="dot" style={{ background: 'var(--subtle)' }} />
        {compact ? '—' : 'Sin engine'}
      </span>
    );
  }
  return (
    <span className={`rd-engine ${className ?? ''}`.trim()} title={title ?? def.label}>
      <span className="dot" style={{ background: def.color }} />
      {compact ? def.shortLabel : def.label}
    </span>
  );
}
