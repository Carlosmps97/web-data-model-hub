'use client';

import React, { useState, useRef, useEffect } from 'react';

import type { ElkLayoutMode } from '../layout/elk/types';

/**
 * Layout modes exposed to the user. Each one maps to an ELK preset in
 * `layout/elk/config.ts`. The union type here must stay in sync with
 * `ElkLayoutMode` — we re-alias it for backwards compatibility with
 * callers that imported the old name.
 */
export type LayoutAlgorithm = ElkLayoutMode;

interface AutoArrangePopoverProps {
  onSelect: (algorithm: LayoutAlgorithm) => void;
}

const algorithms: { id: LayoutAlgorithm; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'horizontal',
    label: 'Horizontal',
    description: 'Layered left-to-right with orthogonal edge routing. Ideal for ER diagrams and ETL-style lineage where data flows from sources on the left to sinks on the right.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="8" height="8" rx="1.5" />
        <rect x="18" y="4" width="8" height="8" rx="1.5" />
        <rect x="2" y="16" width="8" height="8" rx="1.5" />
        <rect x="18" y="16" width="8" height="8" rx="1.5" />
        <line x1="10" y1="8" x2="18" y2="8" />
        <line x1="10" y1="20" x2="18" y2="20" />
      </svg>
    ),
  },
  {
    id: 'vertical',
    label: 'Vertical',
    description: 'Layered top-to-bottom with orthogonal edge routing. Best for short hierarchies, read-top-to-bottom workflows, and portrait-oriented canvases.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="8" height="8" rx="1.5" />
        <rect x="16" y="2" width="8" height="8" rx="1.5" />
        <rect x="4" y="18" width="8" height="8" rx="1.5" />
        <rect x="16" y="18" width="8" height="8" rx="1.5" />
        <line x1="8" y1="10" x2="8" y2="18" />
        <line x1="20" y1="10" x2="20" y2="18" />
      </svg>
    ),
  },
  {
    id: 'tree',
    label: 'Tree',
    description: 'Pure parent→child hierarchy. Use for reference-table fan-outs where one PK feeds many FKs (e.g. catalog tables).',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="11" y="2" width="6" height="6" rx="1" />
        <rect x="2" y="18" width="6" height="6" rx="1" />
        <rect x="11" y="18" width="6" height="6" rx="1" />
        <rect x="20" y="18" width="6" height="6" rx="1" />
        <line x1="14" y1="8" x2="5" y2="18" />
        <line x1="14" y1="8" x2="14" y2="18" />
        <line x1="14" y1="8" x2="23" y2="18" />
      </svg>
    ),
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Dense layered layout with tight spacing. Ideal when screen real-estate matters more than breathing room — small models, sidebars, or print.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="7" height="7" rx="1" />
        <rect x="11" y="2" width="7" height="7" rx="1" />
        <rect x="20" y="2" width="7" height="7" rx="1" />
        <rect x="2" y="11" width="7" height="7" rx="1" />
        <rect x="11" y="11" width="7" height="7" rx="1" />
        <rect x="20" y="11" width="7" height="7" rx="1" />
        <rect x="2" y="20" width="7" height="7" rx="1" />
        <rect x="11" y="20" width="7" height="7" rx="1" />
        <rect x="20" y="20" width="7" height="7" rx="1" />
      </svg>
    ),
  },
];

export default function AutoArrangePopover({ onSelect }: AutoArrangePopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        title="Auto arrange"
        onClick={() => setOpen(!open)}
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-secondary)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="3" x2="3" y2="21" />
          <line x1="21" y1="3" x2="21" y2="21" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>

      {open && (
        <div className="auto-arrange-popover">
          <div className="auto-arrange-title">Choose auto arrange algorithm</div>
          {algorithms.map((algo, idx) => (
            <button
              key={algo.id}
              className="auto-arrange-option"
              onClick={() => {
                onSelect(algo.id);
                setOpen(false);
              }}
            >
              <div className="auto-arrange-option-icon">{algo.icon}</div>
              <div className="auto-arrange-option-body">
                <div className="auto-arrange-option-label">
                  {algo.label}
                  <span className="auto-arrange-option-badge">{idx + 1}</span>
                </div>
                <div className="auto-arrange-option-desc">{algo.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
