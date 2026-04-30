'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
 * The popover is rendered with fixed positioning so it never gets clipped by
 * an ancestor with `overflow: hidden` (e.g. the models table wrapper).
 */
export default function EngineSelect({ value, onChange, size = 'md', disabled }: EngineSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Compute / refresh popover coordinates based on trigger rect
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const popoverWidth = 220;
      // Align right edge of popover to right edge of trigger to keep within viewport
      let left = r.left;
      if (left + popoverWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popoverWidth - 8);
      }
      setPos({ top: r.bottom + 6, left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={rootRef} className={`engine-select engine-select-${size}`}>
      <button
        ref={triggerRef}
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

      {open && pos && (
        <div
          ref={popoverRef}
          className="engine-select-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
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
