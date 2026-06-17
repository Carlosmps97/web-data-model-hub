'use client';

// ─────────────────────────────────────────────────────────────────────────
//  Bloque renderizado dentro de un mensaje de assistant cuando el agente
//  produjo un modelo: header (turno/engine/#tablas/QA), secciones colapsables
//  (Tablas, Relaciones, QA, DDL) y la acción "Aplicar al canvas".
//
//  No persiste nada: "Aplicar" dispara `onApply(result)` y el caller (la
//  página del editor) abre el diálogo de placement (model level / domain /
//  subdomain) y hace el merge al canvas.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { ModelingResponse } from '../lib/types';

export interface ModelResultBlockProps {
  result: ModelingResponse;
  /** Caller abre el diálogo de placement y hace el merge al canvas. */
  onApply: (result: ModelingResponse) => void;
  /** Deshabilita Aplicar (solo lectura). */
  applyDisabled?: boolean;
}

const ModelResultBlock: React.FC<ModelResultBlockProps> = ({ result, onApply, applyDisabled }) => {
  const [showTables, setShowTables] = useState(true);
  const [showRels, setShowRels] = useState(false);
  const [showQA, setShowQA] = useState(false);
  const [showDDL, setShowDDL] = useState(false);

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
    <div className="chat-result">
      <div className="chat-result-head">
        <span className="chat-result-pill primary">Turno {result.turn_number}</span>
        <span className="chat-result-pill">{result.engine}</span>
        <span className="chat-result-pill">{tableCount} {tableCount === 1 ? 'tabla' : 'tablas'}</span>
        <span className={`chat-result-pill score ${qaScoreClass(qaScore)}`} title="Quality score (0–100)">QA {qaScore}</span>
      </div>

      <Section title={`Tablas (${tableCount})`} open={showTables} onToggle={() => setShowTables((v) => !v)}>
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
                {t.table_description && <p className="chat-result-table-desc">{t.table_description}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Relaciones (${relCount})`} open={showRels} onToggle={() => setShowRels((v) => !v)}>
        {relCount === 0 ? (
          <p className="chat-result-empty">Sin relaciones declaradas.</p>
        ) : (
          <ul className="chat-result-list">
            {result.relationships.map((r, i) => <li key={i} className="chat-result-rel">{r}</li>)}
          </ul>
        )}
      </Section>

      <Section title={`QA · ${violations} violaciones · ${standardized} estandarizadas`} open={showQA} onToggle={() => setShowQA((v) => !v)}>
        {result.qa_report.summary && <p className="chat-result-qa-summary">{result.qa_report.summary}</p>}
        {violations > 0 && (
          <div className="chat-result-qa-block">
            <span className="chat-result-qa-title">Violaciones</span>
            <ul className="chat-result-list">
              {result.qa_report.guideline_violations.map((v, i) => (
                <li key={i}>
                  <strong>{v.table_name}.{v.column_name}</strong>: {v.violation}
                  {v.correction_applied && <em className="chat-result-qa-fix"> → {v.correction_applied}</em>}
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
                <li key={i}><code>{c.original_name}</code> → <code>{c.standardized_name}</code>{c.reason && <em> · {c.reason}</em>}</li>
              ))}
            </ul>
          </div>
        )}
        {result.qa_report.new_catalog_entries.length > 0 && (
          <div className="chat-result-qa-block">
            <span className="chat-result-qa-title">Nuevas entradas al catálogo</span>
            <ul className="chat-result-list">
              {result.qa_report.new_catalog_entries.map((e, i) => (
                <li key={i}><code>{e.column_name}</code> ({e.data_type}) en <strong>{e.table_name}</strong>{e.functional_definition && <em> · {e.functional_definition}</em>}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {result.guidelines_applied && (
        <div className="chat-result-guidelines">
          <span className="chat-result-qa-title">Guidelines aplicadas</span>
          <p>{result.guidelines_applied}</p>
        </div>
      )}

      <Section title="DDL" open={showDDL} onToggle={() => setShowDDL((v) => !v)}>
        <pre className="chat-result-ddl"><code>{result.export_sql || '-- (vacío)'}</code></pre>
        <div className="chat-result-ddl-actions">
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={copyDDL}><Icon name="code" size={13} />Copiar DDL</button>
        </div>
      </Section>

      <div className="chat-result-actions">
        <button
          type="button"
          className="rd-btn rd-btn-primary rd-btn-sm"
          onClick={() => onApply(result)}
          disabled={applyDisabled || tableCount === 0}
          title={tableCount === 0 ? 'No hay tablas para aplicar.' : 'Elegí dónde ubicar las tablas y mézclalas al canvas.'}
        >
          <Icon name="merge" size={14} />Aplicar al canvas
        </button>
      </div>
    </div>
  );
};

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, open, onToggle, children }: SectionProps) {
  return (
    <div className="chat-result-sec">
      <button type="button" className="chat-result-sec-toggle" onClick={onToggle} aria-expanded={open}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        <span>{title}</span>
      </button>
      {open && <div className="chat-result-sec-body">{children}</div>}
    </div>
  );
}

function qaScoreClass(score: number): string {
  if (score >= 85) return 'good';
  if (score >= 60) return 'mid';
  return 'bad';
}

export default ModelResultBlock;
