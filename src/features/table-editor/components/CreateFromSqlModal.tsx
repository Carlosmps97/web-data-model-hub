'use client';

/**
 * CreateFromSqlModal — crea una nueva tabla (y opcionalmente relaciones
 * FK entre sus fuentes) a partir de una consulta SQL escrita por el
 * usuario.
 *
 * Flujo:
 *   1. El usuario pega o escribe un `SELECT …` o `CREATE TABLE … AS SELECT …`.
 *   2. Al "Parse", el parser (`sqlToTable.ts`) infiere:
 *        - nombre de la tabla (si vino en un CTAS)
 *        - columnas (directas heredadas vs computadas)
 *        - joins (propuestas de relaciones FK entre tablas fuente)
 *   3. El usuario revisa el preview, puede editar cada columna
 *      (nombre/tipo/descripción) y tildar qué relaciones crear.
 *   4. "Create table" emite `{ table, relationships }` al llamador,
 *      que decide cómo persistirlas (usualmente a través del store).
 *
 * Este modal *no* habla con el backend — no sabe si existe store o
 * servicio. Sólo parsea, presenta y emite objetos `TableModel` +
 * `Relationship`. La página/feature de hosting lo integra al modelo.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { sql } from '@codemirror/lang-sql';
import { COLUMN_DATA_TYPES, type TableModel, type Relationship, type TableColumn } from '@/types/model';
import { findColumnId } from '@/lib/columnRef';
import {
  parseSqlToTable,
  type InferredColumn,
  type InferredJoin,
  type ParsedSqlResult,
} from '../utils/sqlToTable';

// ─── Props ────────────────────────────────────────────────────────

interface CreateFromSqlModalProps {
  isOpen: boolean;
  /** All tables currently in the model — used to resolve SQL aliases. */
  existingTables: TableModel[];
  /** Called when the user confirms creation. The host decides how to
   *  persist; usually `addTable(table)` and one `addRelationship(r)`
   *  per item in `relationships`. */
  onCreate: (payload: { table: TableModel; relationships: Relationship[] }) => void;
  onCancel: () => void;
}

// ─── Defaults ─────────────────────────────────────────────────────

const SQL_EXAMPLE = `-- Ejemplo: crea HD_CLIENTE_ENRIQUECIDO a partir de HD_CLIENTE
-- y HD_SEGMENTO, heredando columnas directas + columna calculada.
--
-- Puedes escribir un SELECT aislado o un CREATE TABLE ... AS SELECT.

SELECT
  c.id_cliente,
  c.nombre,
  c.fec_nacimiento,
  s.nombre        AS segmento,
  CASE
    WHEN c.saldo > 1000 THEN 'PREMIUM'
    ELSE 'BASICO'
  END            AS tier,
  CAST(c.saldo AS DECIMAL(18,2)) AS saldo_normalizado
FROM HD_CLIENTE c
LEFT JOIN HD_SEGMENTO s ON c.id_segmento = s.id
`;

// ─── Component ────────────────────────────────────────────────────

export default function CreateFromSqlModal({
  isOpen,
  existingTables,
  onCreate,
  onCancel,
}: CreateFromSqlModalProps) {
  const [sqlText, setSqlText] = useState<string>(SQL_EXAMPLE);
  const [parsed, setParsed] = useState<ParsedSqlResult | null>(null);
  // Editable overlay on top of the parse result. We never mutate the
  // `parsed` object itself — all user edits live here and are merged at
  // submit time. Keyed by column index.
  const [tableName, setTableName] = useState<string>('');
  const [columnOverrides, setColumnOverrides] = useState<Record<number, Partial<InferredColumn>>>({});
  const [joinChoices, setJoinChoices] = useState<Record<number, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state every time the modal re-opens. We use the "derive state
  // from props" pattern instead of useEffect to avoid an extra render.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setSqlText(SQL_EXAMPLE);
      setParsed(null);
      setTableName('');
      setColumnOverrides({});
      setJoinChoices({});
      setSubmitError(null);
    }
  }

  // ── CodeMirror SQL editor ────────────────────────────────────────
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  // Mirror `sqlText` into a ref so the mount effect — which must only
  // run when `isOpen` flips — can read the freshest value without
  // pulling `sqlText` into its dependency array (that would recreate
  // the whole editor on every keystroke).
  const sqlTextRef = useRef(sqlText);
  useEffect(() => {
    sqlTextRef.current = sqlText;
  });

  useEffect(() => {
    if (!isOpen) return;
    if (!editorHostRef.current) return;
    if (editorViewRef.current) return;

    const onDocChange = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      setSqlText(update.state.doc.toString());
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: sqlTextRef.current,
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
          sql(),
          new Compartment().of([]),
          onDocChange,
        ],
      }),
      parent: editorHostRef.current,
    });
    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [isOpen]);

  // ── Parse handler ────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    const result = parseSqlToTable(sqlText, existingTables);
    setParsed(result);
    setColumnOverrides({});
    setTableName(result.tableName ?? '');
    // Tick every inferred join by default — the user unticks what they
    // don't want rather than starting from scratch.
    const choices: Record<number, boolean> = {};
    result.joins.forEach((_, i) => { choices[i] = true; });
    setJoinChoices(choices);
    setSubmitError(null);
  }, [sqlText, existingTables]);

  // ── Resolve effective columns (parsed + user overrides) ──────────
  const effectiveColumns = useMemo(() => {
    if (!parsed) return [] as InferredColumn[];
    return parsed.columns.map((c, idx) => ({ ...c, ...columnOverrides[idx] }));
  }, [parsed, columnOverrides]);

  const effectiveJoins = useMemo(() => {
    if (!parsed) return [] as InferredJoin[];
    return parsed.joins.filter((_, idx) => joinChoices[idx] !== false);
  }, [parsed, joinChoices]);

  const patchColumn = useCallback((idx: number, patch: Partial<InferredColumn>) => {
    setColumnOverrides((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  }, []);

  // ── Submit ───────────────────────────────────────────────────────
  const handleCreate = useCallback(() => {
    if (!parsed) return;
    const trimmedName = tableName.trim();
    if (!trimmedName) {
      setSubmitError('El nombre de la tabla es obligatorio.');
      return;
    }
    if (/\s/.test(trimmedName)) {
      setSubmitError('El nombre de la tabla no puede contener espacios.');
      return;
    }
    const clash = existingTables.find(
      (t) => t.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (clash) {
      setSubmitError(`Ya existe una tabla con el nombre "${clash.name}".`);
      return;
    }
    if (effectiveColumns.length === 0) {
      setSubmitError('La tabla debe tener al menos una columna.');
      return;
    }
    const dupes = findDuplicateNames(effectiveColumns.map((c) => c.name));
    if (dupes.length) {
      setSubmitError(`Columnas con nombre duplicado: ${dupes.join(', ')}.`);
      return;
    }

    // Build the TableModel. Inherit domain/subdomain/tags from the
    // first direct column that had them (that's the best signal we
    // have for "what domain does this new table belong to").
    const originColumn = effectiveColumns.find((c) => c.domainId);
    const newTable: TableModel = {
      id: uuidv4(),
      name: trimmedName,
      columns: effectiveColumns.map(inferredToColumn),
      functionalDefinition: `Created from SQL on ${new Date().toISOString().slice(0, 10)}.`,
      domainId: originColumn?.domainId,
      subdomainId: originColumn?.subdomainId,
      tags: mergeTags(effectiveColumns),
    };

    // Build relationships. These run between *source* tables (what the
    // SQL JOINed together) — the new table being created here never
    // appears in the edge. The join parser emits column *names*
    // (leftColumn / rightColumn); we resolve them to the stable
    // `TableColumn.id` in `existingTables` so the canvas edges survive
    // subsequent column renames. Joins whose columns can't be resolved
    // are dropped with a console warning rather than silently pointing
    // at a non-existent handle.
    const newRelationships: Relationship[] = [];
    for (const j of effectiveJoins) {
      const srcColId = findColumnId(existingTables, j.leftTable, j.leftColumn);
      const tgtColId = findColumnId(existingTables, j.rightTable, j.rightColumn);
      if (!srcColId || !tgtColId) {
        console.warn(
          `[CreateFromSql] skipping relationship ${j.leftTable}.${j.leftColumn} → ` +
            `${j.rightTable}.${j.rightColumn}: column id not found`,
        );
        continue;
      }
      newRelationships.push({
        id: uuidv4(),
        sourceTable: j.leftTable,
        sourceColumn: srcColId,
        targetTable: j.rightTable,
        targetColumn: tgtColId,
        type: 'one-to-many',
      });
    }

    onCreate({ table: newTable, relationships: newRelationships });
  }, [parsed, tableName, effectiveColumns, effectiveJoins, existingTables, onCreate]);

  if (!isOpen) return null;

  const canParse = sqlText.trim().length > 0;
  const hasParseResult = parsed !== null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-content modal-large animate-scaleIn sql-create-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>Crear tabla desde SQL</h3>
            <p className="sql-create-subtitle">
              Escribe un <code>SELECT</code> o <code>CREATE TABLE … AS SELECT</code>;
              las columnas que referencien tablas existentes heredan tipo, descripción,
              dominio y tags.
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onCancel} type="button" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body sql-create-body">
          {/* SQL editor */}
          <section className="sql-create-section">
            <label className="sql-create-label">SQL</label>
            <div ref={editorHostRef} className="sql-create-editor" />
            <div className="sql-create-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleParse}
                disabled={!canParse}
              >
                Parsear SQL
              </button>
            </div>
          </section>

          {/* Errors + warnings */}
          {hasParseResult && parsed.errors.length > 0 && (
            <div className="sql-create-errors">
              {parsed.errors.map((e, i) => (
                <div key={i} className="sql-create-error">{e}</div>
              ))}
            </div>
          )}
          {hasParseResult && parsed.warnings.length > 0 && (
            <div className="sql-create-warnings">
              {parsed.warnings.map((w, i) => (
                <div key={i} className="sql-create-warning">{w}</div>
              ))}
            </div>
          )}

          {/* Preview */}
          {hasParseResult && parsed.success && (
            <>
              <section className="sql-create-section">
                <label className="sql-create-label" htmlFor="sql-create-name">
                  Nombre de la tabla
                </label>
                <input
                  id="sql-create-name"
                  className="input"
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="Ej: HD_CLIENTE_ENRIQUECIDO"
                />
              </section>

              <section className="sql-create-section">
                <div className="sql-create-section-header">
                  <label className="sql-create-label">
                    Columnas ({effectiveColumns.length})
                  </label>
                  <span className="sql-create-legend">
                    <span className="sql-create-kind is-direct">directa</span>
                    <span className="sql-create-kind is-wildcard">wildcard</span>
                    <span className="sql-create-kind is-expression">computada</span>
                  </span>
                </div>
                <div className="sql-create-columns">
                  {effectiveColumns.map((col, idx) => (
                    <ColumnRow
                      key={idx}
                      col={col}
                      onPatch={(patch) => patchColumn(idx, patch)}
                    />
                  ))}
                </div>
              </section>

              {parsed.joins.length > 0 && (
                <section className="sql-create-section">
                  <label className="sql-create-label">
                    Relaciones inferidas ({parsed.joins.length})
                  </label>
                  <p className="sql-create-help">
                    Se crearán como 1:N entre las tablas fuente. Destildá las que no quieras.
                  </p>
                  <div className="sql-create-joins">
                    {parsed.joins.map((j, idx) => (
                      <label key={idx} className="sql-create-join">
                        <input
                          type="checkbox"
                          checked={joinChoices[idx] !== false}
                          onChange={(e) =>
                            setJoinChoices((prev) => ({ ...prev, [idx]: e.target.checked }))
                          }
                        />
                        <span>
                          <code>{j.leftTable}.{j.leftColumn}</code>
                          <span className="sql-create-join-arrow"> → </span>
                          <code>{j.rightTable}.{j.rightColumn}</code>
                          <span className="sql-create-join-type"> ({j.joinType} JOIN)</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {submitError && <div className="sql-create-error">{submitError}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!hasParseResult || !parsed.success}
          >
            Crear tabla
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

interface ColumnRowProps {
  col: InferredColumn;
  onPatch: (patch: Partial<InferredColumn>) => void;
}

function ColumnRow({ col, onPatch }: ColumnRowProps) {
  const kindLabel: Record<InferredColumn['kind'], string> = {
    direct: 'directa',
    wildcard: 'wildcard',
    expression: 'computada',
  };
  return (
    <div className={`sql-create-column is-${col.kind}`}>
      <span className={`sql-create-kind is-${col.kind}`}>{kindLabel[col.kind]}</span>
      <input
        className="input sql-create-column-name"
        type="text"
        value={col.name}
        onChange={(e) => onPatch({ name: e.target.value })}
        placeholder="column_name"
      />
      <select
        className="input sql-create-column-type"
        value={normaliseTypeForSelect(col.dataType)}
        onChange={(e) => onPatch({ dataType: e.target.value })}
      >
        {/* Preserve the inferred type even when it's not in the canonical
            list (e.g. `DECIMAL(18,2)`), by rendering it as the first
            option. */}
        {!COLUMN_DATA_TYPES.some((t) => t.toUpperCase() === normaliseTypeForSelect(col.dataType)) && (
          <option value={normaliseTypeForSelect(col.dataType)}>
            {col.dataType}
          </option>
        )}
        {COLUMN_DATA_TYPES.map((t) => (
          <option key={t} value={t.toUpperCase()}>{t}</option>
        ))}
      </select>
      <input
        className="input sql-create-column-desc"
        type="text"
        value={col.functionalDefinition ?? ''}
        onChange={(e) => onPatch({ functionalDefinition: e.target.value })}
        placeholder="Descripción funcional (opcional)"
      />
      <span className="sql-create-column-origin" title={col.explanation}>
        {col.sourceRef ? (
          <code>{col.sourceRef.tableName}.{col.sourceRef.columnName}</code>
        ) : (
          <em>{truncate(col.rawExpression, 40)}</em>
        )}
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function inferredToColumn(c: InferredColumn): TableColumn {
  // Strip the `(length[,scale])` suffix from the type; the base type
  // lives in `dataType` and the dimensions in `length` / `scale`.
  const m = c.dataType.match(/^([A-Za-z_][\w]*)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\))?$/);
  const base = (m?.[1] ?? c.dataType).toLowerCase();
  const length = m?.[2] ? parseInt(m[2], 10) : undefined;
  const scale = m?.[3] ? parseInt(m[3], 10) : undefined;
  return {
    id: uuidv4(),
    name: c.name,
    dataType: base,
    length,
    scale,
    functionalDefinition: c.functionalDefinition,
  };
}

function mergeTags(cols: InferredColumn[]): string[] | undefined {
  const all = new Set<string>();
  for (const c of cols) {
    (c.tags ?? []).forEach((t) => all.add(t));
  }
  return all.size ? Array.from(all) : undefined;
}

function findDuplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) dupes.add(n);
    seen.add(k);
  }
  return Array.from(dupes);
}

function normaliseTypeForSelect(t: string): string {
  return t.toUpperCase().trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
