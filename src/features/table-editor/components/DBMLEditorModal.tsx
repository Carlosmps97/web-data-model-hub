'use client';

import React, { useState, useCallback } from 'react';
import { parseDBML, generateDBML } from '@/utils/dbmlParser';
import type { TableModel, Relationship } from '@/types/model';

interface DBMLEditorModalProps {
  isOpen: boolean;
  tables: TableModel[];
  relationships: Relationship[];
  onApply: (tables: TableModel[], relationships: Relationship[]) => void;
  onClose: () => void;
}

const DBML_EXAMPLE = `Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique]
  created_at timestamp
  Note: 'User account information'
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal(10,2)
  status varchar(20) [default: 'pending']
}`;

const DBMLEditorModal: React.FC<DBMLEditorModalProps> = ({
  isOpen,
  tables,
  relationships,
  onApply,
  onClose,
}) => {
  const [code, setCode] = useState(() => {
    if (tables.length > 0) {
      return generateDBML(tables, relationships);
    }
    return DBML_EXAMPLE;
  });
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [showReference, setShowReference] = useState(false);

  if (!isOpen) return null;

  const handleApply = () => {
    const result = parseDBML(code);
    if (result.errors.length > 0) {
      setParseErrors(result.errors);
      return;
    }
    setParseErrors([]);
    onApply(result.tables, result.relationships);
    onClose();
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
    if (parseErrors.length > 0) setParseErrors([]);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content modal-large animate-scaleIn" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h3>DBML Editor</h3>
            <span className="badge badge-primary">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              Code
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              className={`btn btn-ghost btn-sm ${showReference ? 'active' : ''}`}
              onClick={() => setShowReference(!showReference)}
              style={{ fontSize: 'var(--text-xs)' }}
            >
              Syntax Reference
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ display: 'flex', gap: 'var(--space-4)', maxHeight: '60vh' }}>
          {/* Editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <textarea
              value={code}
              onChange={handleCodeChange}
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                lineHeight: 1.7,
                padding: 'var(--space-4)',
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                border: parseErrors.length > 0 ? '1px solid var(--color-error)' : 'var(--border-default)',
                borderRadius: 'var(--radius-md)',
                outline: 'none',
                resize: 'none',
                minHeight: '300px',
                tabSize: 2,
              }}
              spellCheck={false}
              placeholder="Write your DBML here..."
            />

            {parseErrors.length > 0 && (
              <div style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'rgba(224, 108, 117, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224, 108, 117, 0.2)' }}>
                {parseErrors.map((err, i) => (
                  <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                    Line {err.line}: {err.message}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Syntax Reference */}
          {showReference && (
            <div style={{
              width: '280px',
              background: 'var(--color-bg-primary)',
              border: 'var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              overflow: 'auto',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.8,
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}>
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}>
                Quick Reference
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{`Table name {
  col_name type [settings]
}

Settings:
  [pk]        - Primary Key
  [sk]        - Surrogate Key
  [partition] - Partition Key
  [not null]  - Not nullable
  [unique]    - Unique
  [increment] - Auto-increment
  [default: 'val']
  [note: 'description']
  [ref: > table.col] - FK

Standalone Ref:
  Ref: t1.col > t2.col

Symbols:
  >  one-to-many
  -  one-to-one
  <  many-to-many

Notes:
  Note: 'Table description'
  // Comment line`}</pre>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Apply DBML
          </button>
        </div>
      </div>
    </div>
  );
};

export default DBMLEditorModal;
