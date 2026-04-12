'use client';

import React, { useState, useRef, useEffect } from 'react';

export type LayoutAlgorithm = 'left-right' | 'snowflake' | 'compact';

interface AutoArrangePopoverProps {
  onSelect: (algorithm: LayoutAlgorithm) => void;
}

const algorithms: { id: LayoutAlgorithm; label: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'left-right',
    label: 'Left-right',
    description: 'Arrange tables from left to right based on their relationship direction. Ideal for diagrams with long relationship lineage like ETL pipelines.',
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
    id: 'snowflake',
    label: 'Snowflake',
    description: 'Arrange tables in a snowflake shape, with the most connected tables in the center. Ideal for densely connected diagrams like data warehouses.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="10" y="10" width="8" height="8" rx="1.5" />
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="21" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="21" width="6" height="6" rx="1" />
        <rect x="21" y="21" width="6" height="6" rx="1" />
        <line x1="10" y1="12" x2="7" y2="6" />
        <line x1="18" y1="12" x2="21" y2="6" />
        <line x1="10" y1="16" x2="7" y2="21" />
        <line x1="18" y1="16" x2="21" y2="21" />
      </svg>
    ),
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Arrange tables in a compact rectangle layout. Ideal for diagrams with few relationships and tables.',
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
