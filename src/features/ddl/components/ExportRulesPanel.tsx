/**
 * ExportRulesPanel: las reglas del proyecto en el popup Export DDL, con
 * «Use export rules». Van en el orden de Data Standards (arriba = más
 * prioridad), con su descripción, y se pueden desmarcar para un export puntual.
 */
import { Check } from 'lucide-react';

import type { ExportRule } from '../rulesBridge';

export interface ExportRulesPanelProps {
  rules: ExportRule[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
}

export default function ExportRulesPanel({ rules, selected, onToggle, onAll, onNone }: ExportRulesPanelProps) {
  return (
    <div className="exd-rules">
      <div className="exd-rules-head">
        <span className="exd-rules-count">
          <strong>{selected.size}</strong> of {rules.length} selected
        </span>
        <span className="exd-tablesx-spacer" />
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-xs" onClick={onAll}>All</button>
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-xs" onClick={onNone}>None</button>
      </div>

      <div className="exd-rules-list">
        {rules.map((r) => {
          const on = selected.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              className={`exd-rules-row${on ? ' is-on' : ''}`}
              onClick={() => onToggle(r.id)}
              aria-pressed={on}
            >
              <span className={`exd-cbox${on ? ' is-on' : ''}`}>
                {on && <Check size={11} strokeWidth={2.6} aria-hidden />}
              </span>
              <span className="exd-rules-txt">
                <span className="exd-rules-name">{r.name}</span>
                <span className="exd-rules-meta">For each {r.scope === 'view' ? 'view' : 'table'}</span>
                {r.description && (
                  // Recortada a 2 líneas por CSS: el texto completo va al tooltip.
                  <span className="exd-rules-desc" title={r.description}>{r.description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <span className="exd-rules-foot">
        Upper rules win when two write the same file · manage them in Data Standards → DDL export rules.
      </span>
    </div>
  );
}
