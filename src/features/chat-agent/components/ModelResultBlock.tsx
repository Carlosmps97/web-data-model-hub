'use client';

// ─────────────────────────────────────────────────────────────────────────
//  Bloque renderizado dentro de un mensaje de assistant cuando el agente
//  produjo un modelo. Muestra:
//
//   - Header: turno, engine, número de tablas.
//   - Lista colapsable de tablas (nombre + count de columnas + descripción).
//   - Lista de relaciones (texto libre del agente, una por línea).
//   - Resumen de QA (score, violaciones encontradas, columnas estandarizadas).
//   - Resumen de guidelines aplicadas.
//   - Acciones: "Aplicar al canvas" (reemplaza tablas/relaciones del editor),
//               "Ver DDL" (abre un dialog con el `export_sql` completo).
//
//  No persiste nada por sí mismo; sólo dispara el callback `onApply` y
//  delega la persistencia al caller (la página del editor).
// ─────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import type { ModelingResponse } from '@/lib/agent/types';

export interface ModelResultBlockProps {
  result: ModelingResponse;
  /**
   * Callback cuando el usuario pulsa "Aplicar al canvas". El caller debe
   * convertir el response a `TableModel[]` / `Relationship[]` (vía
   * `modelingResponseToCanvas` de `lib/agent/mapping`) y reemplazar el
   * estado del editor.
   */
  onApply: (result: ModelingResponse) => void;
  /** Deshabilita el botón Aplicar (ej. mientras se aplica). */
  applyDisabled?: boolean;
}

const ModelResultBlock: React.FC<ModelResultBlockProps> = ({
  result,
  onApply,
  applyDisabled,
}) => {
  const [showTables, setShowTables] = useState(true);
  const [showRels, setShowRels] = useState(false);
  const [showQA, setShowQA] = useState(false);
  const [showDDL, setShowDDL] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Auto-cancela la confirmación si el usuario no actúa en 5s
  React.useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  const tableCount = result.tables.length;
  const relCount = result.relationships.length;
  const qaScore = result.qa_report.quality_score;
  const violations = result.qa_report.guideline_violations.length;
  const standardized = result.qa_report.standardized_columns.length;

  const copyDDL = async () => {
    try {
      await navigator.clipboard.writeText(result.export_sql);
    } catch (err) {
      console.warn('[ModelResultBlock] clipboard failed', err);
    }
  };

  return (
    <div className="chat-result-block">
      {/* Header */}
      <div className="chat-result-header">
        <span className="chat-result-pill chat-result-pill-primary">Turn {result.turn_number}</span>
        <span className="chat-result-pill">{result.engine}</span>
        <span className="chat-result-pill">{tableCount} {tableCount === 1 ? 'tabla' : 'tablas'}</span>
        <span
          className={`chat-result-pill chat-result-pill-score ${qaScoreClass(qaScore)}`}
          title="Quality score (0–100)"
        >
          QA {qaScore}
        </span>
      </div>

      {/* Sección de tablas */}
      <Section
        title={`Tablas (${tableCount})`}
        open={showTables}
        onToggle={() => setShowTables((v) => !v)}
      >
        {tableCount === 0 ? (
          <p className="chat-result-empty">El agente no devolvió tablas.</p>
        ) : (
          <ul className="chat-result-list">
            {result.tables.map((t) => (
              <li key={t.table_name} className="chat-result-table">
                <div className="chat-result-table-name">
                  <strong>{t.table_name}</strong>
                  <span className="chat-result-table-count">{t.columns.length} cols</span>
                </div>
                {t.table_description && (
                  <p className="chat-result-table-desc">{t.table_description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Relaciones */}
      <Section
        title={`Relaciones (${relCount})`}
        open={showRels}
        onToggle={() => setShowRels((v) => !v)}
      >
        {relCount === 0 ? (
          <p className="chat-result-empty">Sin relaciones declaradas.</p>
        ) : (
          <ul className="chat-result-list">
            {result.relationships.map((r, i) => (
              <li key={i} className="chat-result-rel">{r}</li>
            ))}
          </ul>
        )}
      </Section>

      {/* QA report */}
      <Section
        title={`QA · ${violations} violaciones · ${standardized} estandarizadas`}
        open={showQA}
        onToggle={() => setShowQA((v) => !v)}
      >
        {result.qa_report.summary && (
          <p className="chat-result-qa-summary">{result.qa_report.summary}</p>
        )}
        {violations > 0 && (
          <div className="chat-result-qa-block">
            <span className="chat-result-qa-title">Violaciones</span>
            <ul className="chat-result-list">
              {result.qa_report.guideline_violations.map((v, i) => (
                <li key={i}>
                  <strong>{v.table_name}.{v.column_name}</strong>: {v.violation}
                  {v.correction_applied && (
                    <em className="chat-result-qa-fix"> → {v.correction_applied}</em>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {standardized > 0 && (
          <div className="chat-result-qa-block">
            <span className="chat-result-qa-title">Estandarizadas</span>
            <ul className="chat-result-list">
              {result.qa_report.standardized_columns.map((c, i) => (
                <li key={i}>
                  <code>{c.original_name}</code> → <code>{c.standardized_name}</code>
                  {c.reason && <em> · {c.reason}</em>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.qa_report.new_catalog_entries.length > 0 && (
          <div className="chat-result-qa-block">
            <span className="chat-result-qa-title">Nuevas entradas al catálogo</span>
            <ul className="chat-result-list">
              {result.qa_report.new_catalog_entries.map((e, i) => (
                <li key={i}>
                  <code>{e.column_name}</code> ({e.data_type}) en <strong>{e.table_name}</strong>
                  {e.functional_definition && (
                    <em> · {e.functional_definition}</em>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Guidelines aplicadas */}
      {result.guidelines_applied && (
        <div className="chat-result-guidelines">
          <span className="chat-result-qa-title">Guidelines aplicadas</span>
          <p>{result.guidelines_applied}</p>
        </div>
      )}

      {/* DDL */}
      <Section
        title="DDL"
        open={showDDL}
        onToggle={() => setShowDDL((v) => !v)}
      >
        <pre className="chat-result-ddl"><code>{result.export_sql || '-- (vacío)'}</code></pre>
        <div className="chat-result-ddl-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyDDL}>
            Copiar DDL
          </button>
        </div>
      </Section>

      {/* Acciones */}
      <div className="chat-result-actions">
        {!confirming ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setConfirming(true)}
            disabled={applyDisabled || tableCount === 0}
            title={
              tableCount === 0
                ? 'No hay tablas para aplicar.'
                : 'Reemplaza las tablas y relaciones del modelo en el editor.'
            }
          >
            Aplicar al canvas
          </button>
        ) : (
          <div className="chat-result-confirm-row">
            <span className="chat-result-confirm-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Esto reemplazará el modelo actual
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-warning btn-sm"
              onClick={() => { onApply(result); setConfirming(false); }}
            >
              Confirmar y aplicar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Subcomponentes ──────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, open, onToggle, children }: SectionProps) {
  return (
    <div className="chat-result-section">
      <button
        type="button"
        className="chat-result-section-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={`chat-result-chevron ${open ? 'open' : ''}`} aria-hidden>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span>{title}</span>
      </button>
      {open && <div className="chat-result-section-body">{children}</div>}
    </div>
  );
}

function qaScoreClass(score: number): string {
  if (score >= 85) return 'chat-result-pill-score-good';
  if (score >= 60) return 'chat-result-pill-score-mid';
  return 'chat-result-pill-score-bad';
}

export default ModelResultBlock;
