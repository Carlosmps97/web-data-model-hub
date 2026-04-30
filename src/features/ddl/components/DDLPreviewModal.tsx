'use client';

import React, { useMemo, useState } from 'react';
import type { DatabaseEngine, TableModel, Relationship } from '@/types/model';
import { ENGINES, getEngine } from '@/features/engines/engines';
import {
  generateTableDDL,
  generateTablesDDL,
  generateDomainDDL,
} from '@/features/ddl/generators';

export type DDLScope =
  | { kind: 'table'; table: TableModel }
  | { kind: 'domain'; domain: string }
  | { kind: 'all' };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Whole-model context — used to resolve cross-table FK references. */
  tables: TableModel[];
  relationships: Relationship[];
  /** Default engine for the model (user can override per export). */
  defaultEngine: DatabaseEngine | null | undefined;
  /** What to render in the preview. */
  scope: DDLScope;
}

/**
 * Preview / copy / download dialog for engine-aware DDL.
 *
 * UX goals:
 *  - Pick the target engine (defaults to the model's engine).
 *  - Toggle inclusion of CREATE SCHEMA, FK constraints, and COMMENTs.
 *  - One-click copy or download as a `.sql` file (filename reflects scope).
 */
export default function DDLPreviewModal({
  open,
  onClose,
  tables,
  relationships,
  defaultEngine,
  scope,
}: Props) {
  const [engine, setEngine] = useState<DatabaseEngine>(defaultEngine ?? 'postgresql');
  const [emitSchemas, setEmitSchemas] = useState(true);
  const [emitFKs, setEmitFKs] = useState(true);
  const [emitComments, setEmitComments] = useState(true);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // Note: state resets naturally between sessions because the modal returns
  // null when `open === false` (unmounted) and the parent rerenders it with
  // fresh defaults next time it is opened. No effect needed.

  const ddl = useMemo(() => {
    if (!open) return '';
    const opts = { emitSchemas, emitForeignKeys: emitFKs, emitComments };
    if (scope.kind === 'table') {
      return generateTableDDL(scope.table, tables, relationships, engine, opts);
    }
    if (scope.kind === 'domain') {
      return generateDomainDDL(scope.domain, tables, relationships, engine, opts);
    }
    return generateTablesDDL(tables, tables, relationships, engine, opts);
  }, [open, scope, tables, relationships, engine, emitSchemas, emitFKs, emitComments]);

  const filename = useMemo(() => {
    const eng = engine.toLowerCase();
    if (scope.kind === 'table') {
      const s = scope.table.schema?.trim() || 'schema';
      return `${s}_${scope.table.name}_${eng}.sql`;
    }
    if (scope.kind === 'domain') return `domain_${slug(scope.domain)}_${eng}.sql`;
    return `model_${eng}.sql`;
  }, [scope, engine]);

  const title = useMemo(() => {
    if (scope.kind === 'table') return `DDL — ${scope.table.schema ?? '?'}.${scope.table.name}`;
    if (scope.kind === 'domain') return `DDL — domain "${scope.domain}"`;
    return 'DDL — entire model';
  }, [scope]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ddl);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch { /* ignore */ }
  };

  const handleDownload = () => {
    const blob = new Blob([ddl], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  const engDef = getEngine(engine);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content modal-large animate-scaleIn"
        style={{ width: 'min(960px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            {title}
          </h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-5)',
            borderBottom: 'var(--border-default)',
            background: 'var(--color-bg-surface)',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <label className="input-label" style={{ marginBottom: 0 }}>Engine</label>
            <select
              className="input"
              style={{ padding: '4px 10px', fontSize: 'var(--text-xs)', minWidth: 160 }}
              value={engine}
              onChange={(e) => setEngine(e.target.value as DatabaseEngine)}
            >
              {ENGINES.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            {engDef && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: engDef.color,
                  background: engDef.bg,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontWeight: 600,
                }}
              >
                schema: {engDef.defaultSchema}
              </span>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
            <Toggle label="CREATE SCHEMA" value={emitSchemas} onChange={setEmitSchemas} />
            <Toggle label="Foreign Keys" value={emitFKs} onChange={setEmitFKs} />
            <Toggle label="Comments" value={emitComments} onChange={setEmitComments} />
          </div>
        </div>

        {/* Code preview */}
        <pre
          style={{
            flex: 1,
            margin: 0,
            padding: 'var(--space-4) var(--space-5)',
            overflow: 'auto',
            background: 'var(--color-bg-elevated)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            lineHeight: 1.55,
            color: 'var(--color-text-primary)',
            whiteSpace: 'pre',
          }}
        >
{ddl || '-- (no tables in scope)'}
        </pre>

        <div
          className="modal-footer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}
        >
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            <code>{filename}</code> · {byteSize(ddl)}
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {copyState === 'copied' ? 'Copied!' : 'Copy'}
            </button>
            <button type="button" className="btn btn-primary" onClick={handleDownload}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download .sql
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Toggle({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-accent-primary)' }}
      />
      <span>{label}</span>
    </label>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unnamed';
}

function byteSize(s: string): string {
  const bytes = new TextEncoder().encode(s).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
