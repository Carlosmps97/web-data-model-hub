'use client';

import React, { useState, useEffect } from 'react';
import { parseDBML, generateDBML } from '@/utils/dbmlParser';
import type { TableModel, Relationship } from '@/types/model';

interface DBMLEditorPanelProps {
  tables: TableModel[];
  relationships: Relationship[];
  /** Replaces the current tables & relationships with the parsed DBML. */
  onApply: (tables: TableModel[], relationships: Relationship[]) => void;
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

export default function DBMLEditorPanel({ tables, relationships, onApply }: DBMLEditorPanelProps) {
  // Initialise code from current tables (or example if empty)
  const [code, setCode] = useState(() =>
    tables.length > 0 ? generateDBML(tables, relationships) : DBML_EXAMPLE
  );
  const [dirty, setDirty] = useState(false);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [appliedFlash, setAppliedFlash] = useState(false);

  // Re-sync code from external model only when the panel is NOT dirty
  useEffect(() => {
    if (dirty) return;
    const newCode = tables.length > 0 ? generateDBML(tables, relationships) : DBML_EXAMPLE;
    setCode(newCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, relationships]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
    setDirty(true);
    if (parseErrors.length > 0) setParseErrors([]);
  };

  const handleApply = () => {
    const result = parseDBML(code);
    if (result.errors.length > 0) {
      setParseErrors(result.errors);
      return;
    }
    setParseErrors([]);
    onApply(result.tables, result.relationships);
    setDirty(false);
    setAppliedFlash(true);
    setTimeout(() => setAppliedFlash(false), 1500);
  };

  const handleReset = () => {
    const newCode = tables.length > 0 ? generateDBML(tables, relationships) : DBML_EXAMPLE;
    setCode(newCode);
    setDirty(false);
    setParseErrors([]);
  };

  return (
    <div className="dbml-panel">
      <div className="dbml-panel-toolbar">
        <span className="dbml-panel-filename">schema.dbml</span>
        <div className="dbml-panel-toolbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            disabled={!dirty}
            title="Reset to current model"
            type="button"
          >
            Reset
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleApply}
            disabled={!dirty}
            type="button"
          >
            {appliedFlash ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Applied
              </>
            ) : 'Apply changes'}
          </button>
        </div>
      </div>

      <textarea
        className="dbml-panel-textarea"
        value={code}
        onChange={handleChange}
        spellCheck={false}
        placeholder="Write your DBML here..."
      />

      {parseErrors.length > 0 && (
        <div className="dbml-panel-errors">
          {parseErrors.map((err, i) => (
            <div key={i} className="dbml-panel-error">
              <strong>Line {err.line}:</strong> {err.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
