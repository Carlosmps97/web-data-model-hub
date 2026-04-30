'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { parseDBML, generateDBML } from '../utils/dbmlParser';
import { dbmlExtensions } from '../utils/dbmlLanguage';
import type { TableModel, Relationship, DatabaseEngine } from '@/types/model';

/** A single "model" group, used in read-only multi-model (global) mode. */
export interface DBMLEditorGroup {
  name: string;
  engine?: DatabaseEngine;
  tables: TableModel[];
  relationships: Relationship[];
}

interface DBMLEditorPanelProps {
  /** Current model tables (single-model mode). Ignored when `groups` is provided. */
  tables?: TableModel[];
  /** Current model relationships (single-model mode). Ignored when `groups` is provided. */
  relationships?: Relationship[];
  /** Database engine for the current single model — emitted as a `Project` block. */
  engine?: DatabaseEngine;
  /** Display name of the current model — used as the `Project` block name. */
  modelName?: string;
  /**
   * Multi-model read-only mode. When provided, renders one DBML block per group
   * separated by `// === Model: <name> === ` banners. `tables` / `relationships`
   * / `onApply` are ignored in this mode.
   */
  groups?: DBMLEditorGroup[];
  /** Disable editing (e.g., global canvas view). */
  readOnly?: boolean;
  /**
   * Replaces current tables & relationships with the parsed DBML (single-model mode only).
   * The third argument carries any metadata extracted from a top-level `Project { ... }`
   * block (e.g. the selected database engine).
   */
  onApply?: (
    tables: TableModel[],
    relationships: Relationship[],
    meta?: { engine?: DatabaseEngine }
  ) => void;
}

const DBML_EXAMPLE = `Table users {
  id integer [pk, increment]
  username varchar(50) [not null, unique]
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

/**
 * Generate multi-model DBML with banner comments + cross-model ref hints.
 */
function generateGroupsDBML(groups: DBMLEditorGroup[]): string {
  const knownTables = new Set<string>();
  groups.forEach((g) => g.tables.forEach((t) => knownTables.add(t.name)));

  const parts: string[] = [];
  groups.forEach((g, idx) => {
    if (idx > 0) parts.push('');
    parts.push(`// ═══════════════════════════════════════════`);
    parts.push(`// Model: ${g.name}${g.engine ? `   (engine: ${g.engine})` : ''}`);
    parts.push(`// ═══════════════════════════════════════════`);
    parts.push('');
    parts.push(
      generateDBML(g.tables, g.relationships, {
        knownTables,
        project: g.engine ? { name: g.name.replace(/\s+/g, '_'), engine: g.engine } : undefined,
      })
    );
  });
  return parts.join('\n').trimEnd() + '\n';
}

export default function DBMLEditorPanel({
  tables = [],
  relationships = [],
  engine,
  modelName,
  groups,
  readOnly,
  onApply,
}: DBMLEditorPanelProps) {
  const isMultiModel = Array.isArray(groups);
  const effectivelyReadOnly = readOnly || isMultiModel || !onApply;

  // Re-generation of source code whenever upstream data changes (and the editor is clean)
  const generated = useMemo(() => {
    if (isMultiModel) return generateGroupsDBML(groups!);
    if (tables.length === 0) return DBML_EXAMPLE;
    return generateDBML(tables, relationships, {
      project: engine
        ? { name: (modelName ?? 'data_model').replace(/\s+/g, '_'), engine }
        : undefined,
    });
  }, [isMultiModel, groups, tables, relationships, engine, modelName]);

  const [code, setCode] = useState<string>(generated);
  const [dirty, setDirty] = useState(false);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [appliedFlash, setAppliedFlash] = useState(false);

  // Re-sync code from external model only when the panel is NOT dirty (or in read-only).
  // This is an intentional controlled synchronisation from props into the
  // editor state, so we accept a "setState in effect" pattern here.
  useEffect(() => {
    if (dirty && !effectivelyReadOnly) return;
    setCode(generated);
  }, [generated, dirty, effectivelyReadOnly]);

  // ── CodeMirror wiring ──────────────────────────────────────────────
  // Mount the editor once; update its doc via transactions whenever the
  // generated DBML changes upstream (and the buffer is clean). Read-only
  // state is driven by a `Compartment` so it can be flipped without
  // rebuilding the whole editor.
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment()).current;

  useEffect(() => {
    if (!editorHostRef.current) return;
    if (editorViewRef.current) return; // already mounted

    const onDocChange = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (effectivelyReadOnly) return;
      const value = update.state.doc.toString();
      setCode(value);
      setDirty(true);
      if (parseErrors.length > 0) setParseErrors([]);
    });

    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        bracketMatching(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        ...dbmlExtensions(),
        readOnlyCompartment.of([
          EditorState.readOnly.of(effectivelyReadOnly),
          EditorView.editable.of(!effectivelyReadOnly),
        ]),
        onDocChange,
      ],
    });

    const view = new EditorView({ state, parent: editorHostRef.current });
    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // We intentionally mount the editor only once — subsequent doc/readOnly
    // updates are handled via the dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync read-only state without rebuilding the editor
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(effectivelyReadOnly),
        EditorView.editable.of(!effectivelyReadOnly),
      ]),
    });
  }, [effectivelyReadOnly, readOnlyCompartment]);

  // Push `code` state back into the editor ONLY when the change comes from
  // outside (regeneration / reset) — detected by comparing with the current
  // doc. User keystrokes take the reverse path (onDocChange → setCode),
  // so this no-ops in that case.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === code) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: code },
    });
  }, [code]);

  const handleApply = () => {
    if (effectivelyReadOnly || !onApply) return;
    const result = parseDBML(code);
    if (result.errors.length > 0) {
      setParseErrors(result.errors);
      return;
    }
    setParseErrors([]);
    onApply(result.tables, result.relationships, { engine: result.project?.engine });
    setDirty(false);
    setAppliedFlash(true);
    setTimeout(() => setAppliedFlash(false), 1500);
  };

  const handleReset = () => {
    if (effectivelyReadOnly) return;
    setCode(generated);
    setDirty(false);
    setParseErrors([]);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setAppliedFlash(true);
      setTimeout(() => setAppliedFlash(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="dbml-panel">
      <div className="dbml-panel-toolbar">
        <span className="dbml-panel-filename">
          {isMultiModel ? 'global.dbml' : 'schema.dbml'}
          {effectivelyReadOnly && (
            <span className="badge badge-neutral" style={{ marginLeft: 8, fontSize: '0.6rem' }}>
              read-only
            </span>
          )}
        </span>
        <div className="dbml-panel-toolbar-actions">
          {effectivelyReadOnly ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleCopy}
              title="Copy DBML to clipboard"
              type="button"
            >
              {appliedFlash ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied
                </>
              ) : 'Copy'}
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      <div
        ref={editorHostRef}
        className="dbml-panel-editor"
        spellCheck={false}
        data-placeholder="Write your DBML here..."
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
