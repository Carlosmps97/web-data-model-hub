'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useUIStore } from '@/store/useUIStore';

const DEFAULT_COLOR = '#0d9488';

const PRESET_COLORS = [
  { label: 'Teal',    value: '#0d9488' },
  { label: 'Indigo',  value: '#4f46e5' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Amber',   value: '#d97706' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Violet',  value: '#7c3aed' },
  { label: 'Slate',   value: '#475569' },
  { label: 'Coral',   value: '#ea580c' },
];

type View = 'root' | 'color';

interface TableNodeGearMenuProps {
  currentColor: string | undefined;
  onEdit: () => void;
  onDelete?: () => void;
  onApplyColor: (color: string) => void;
  onClose: () => void;
}

export default function TableNodeGearMenu({
  currentColor,
  onEdit,
  onDelete,
  onApplyColor,
  onClose,
}: TableNodeGearMenuProps) {
  const start = currentColor ?? DEFAULT_COLOR;
  const [view, setView] = useState<View>('root');
  const [selected, setSelected] = useState(start);
  const setPreviewColor = useUIStore(s => s.setPreviewColor);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  // Clear preview on unmount
  useEffect(() => {
    return () => setPreviewColor(null);
  }, [setPreviewColor]);

  const pick = (color: string) => {
    setSelected(color);
    setPreviewColor(color);
  };

  const handleApply = () => {
    onApplyColor(selected);
    setPreviewColor(null);
    onClose();
  };

  const hasChanges = selected !== start;

  return (
    <div
      className="tn-gear-menu nodrag nowheel"
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {view === 'root' && (
        <>
          <button
            className="tn-gear-menu-item"
            type="button"
            onClick={() => { onEdit(); onClose(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit table
          </button>

          {onDelete && (
            <button
              className="tn-gear-menu-item tn-gear-menu-item--danger"
              type="button"
              onClick={() => { onDelete(); onClose(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete table
            </button>
          )}

          <button
            className="tn-gear-menu-item"
            type="button"
            onClick={() => setView('color')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" />
              <circle cx="17.5" cy="10.5" r=".5" />
              <circle cx="8.5" cy="7.5" r=".5" />
              <circle cx="6.5" cy="12.5" r=".5" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
            </svg>
            Change color
            <svg style={{ marginLeft: 'auto' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {view === 'color' && (
        <div className="tn-gear-color">
          <div className="tn-gear-color-header">
            <button
              className="tn-gear-back-btn"
              type="button"
              onClick={() => { setPreviewColor(null); setSelected(start); setView('root'); }}
              title="Back"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span>Table color</span>
          </div>

          <div className="tcp-swatches">
            {PRESET_COLORS.map(p => (
              <button
                key={p.value}
                className={`tcp-swatch${selected === p.value ? ' active' : ''}`}
                style={{ background: p.value }}
                title={p.label}
                onClick={() => pick(p.value)}
                type="button"
              />
            ))}

            <label className="tcp-swatch tcp-swatch-custom" title="Custom color">
              <input
                type="color"
                value={selected}
                onChange={(e) => pick(e.target.value)}
                style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </label>
          </div>

          <div className="tcp-preview-strip" style={{ background: selected }} />

          <button
            className="tcp-apply-btn"
            type="button"
            onClick={handleApply}
            disabled={!hasChanges}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
