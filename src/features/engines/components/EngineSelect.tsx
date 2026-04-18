'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { DatabaseEngine } from '@/types/model';
import { ENGINES } from '../engines';
import EngineBadge from './EngineBadge';

interface EngineSelectProps {
  value?: DatabaseEngine | null;
  onChange: (engine: DatabaseEngine | null) => void;
  /** Optional visual size. */
  size?: 'sm' | 'md';
  /** Disable the picker. */
  disabled?: boolean;
}

/**
 * Compact popover picker for a DatabaseEngine.
 * Shows the current engine badge; clicking opens a list of available engines.
 */
export default function EngineSelect({ value, onChange, size = 'md', disabled }: EngineSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={rootRef} className={`engine-select engine-select-${size}`}>
      <button
        type="button"
        className="engine-select-trigger"
        onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen((v) => !v); }}
        disabled={disabled}
        title="Select database engine"
      >
        <EngineBadge engine={value ?? undefined} compact />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="engine-select-popover" onClick={(e) => e.stopPropagation()}>
          <div className="engine-select-title">Database engine</div>
          <div className="engine-select-list">
            {ENGINES.map((eng) => (
              <button
                key={eng.id}
                type="button"
                className={`engine-select-option ${value === eng.id ? 'active' : ''}`}
                onClick={() => { onChange(eng.id); setOpen(false); }}
              >
                <span className="engine-select-swatch" style={{ background: eng.color }} />
                <span className="engine-select-label">{eng.label}</span>
                {value === eng.id && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          {value && (
            <button
              type="button"
              className="engine-select-clear"
              onClick={() => { onChange(null); setOpen(false); }}
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
