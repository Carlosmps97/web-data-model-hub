/**
 * ExportRulesPanel — el selector de DDL Export Rules del popup Export DDL
 * (doc 30 §12), como pestaña propia de la columna de opciones.
 *
 * Las reglas NO son opciones de formato: la mitad son GENERADORES que agregan
 * objetos al `.zip` (la `_rej`, las vistas `_v`, las DAC). Por eso van en dos
 * grupos con encabezado — «Generators» (crean objetos) vs «Transformations»
 * (modifican el SQL) — y cada fila dice qué emite y qué hace, en vez de mostrar
 * solo el slug. Dentro de cada grupo se respeta el orden de ejecución del motor
 * (priority DESC, name ASC) que ya viene del backend.
 *
 * Un generador que come del artefacto de OTRO generador no seleccionado queda
 * marcado pero no emite nada: la fila lo avisa (`missingSource`).
 */
import { useMemo } from 'react';
import { Check } from 'lucide-react';

import { emitTarget, missingSource, type ExportRule } from '../rulesBridge';

export interface ExportRulesPanelProps {
  rules: ExportRule[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
}

const GROUPS = [
  { id: 'generator', title: 'Generators', sub: 'Add objects to the export' },
  { id: 'rule', title: 'Transformations', sub: 'Change the SQL of existing objects' },
] as const;

export default function ExportRulesPanel({ rules, selected, onToggle, onAll, onNone }: ExportRulesPanelProps) {
  const groups = useMemo(
    () => GROUPS
      .map((g) => ({ ...g, rules: rules.filter((r) => r.kind === g.id) }))
      .filter((g) => g.rules.length > 0),
    [rules],
  );

  return (
    <div className="exd-rules">
      <div className="exd-rules-head">
        <span className="exd-rules-count">
          <strong>{selected.size}</strong> of {rules.length} selected
        </span>
        <span className="exd-tablesx-spacer" />
        <button type="button" className="exd-tablesx-link" onClick={onAll}>All</button>
        <span className="exd-tablesx-dot">·</span>
        <button type="button" className="exd-tablesx-link is-muted" onClick={onNone}>None</button>
      </div>

      <div className="exd-rules-list">
        {groups.map((g) => (
          <section key={g.id} className="exd-rules-group">
            <header className="exd-rules-grouphead">
              <span className="exd-rules-grouptitle">{g.title}</span>
              <span className="exd-rules-groupcount">
                {g.rules.filter((r) => selected.has(r.id)).length}/{g.rules.length}
              </span>
              <span className="exd-rules-groupsub">{g.sub}</span>
            </header>
            {g.rules.map((r) => {
              const on = selected.has(r.id);
              const target = emitTarget(r);
              const missing = on ? missingSource(r, rules, selected) : null;
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
                    <span className="exd-rules-name">
                      {r.name}
                      {r.validationState === 'stale' && (
                        <span
                          className="exd-rules-stale"
                          title="A UDP list value this rule uses was removed — it still runs"
                        />
                      )}
                    </span>
                    {target && (
                      <span className="exd-rules-emit">
                        Creates one {target.type} per table · <code>{target.label}</code>
                      </span>
                    )}
                    {r.description && (
                      // Recortada a 2 líneas por CSS: el texto completo va al tooltip.
                      <span className="exd-rules-desc" title={r.description}>{r.description}</span>
                    )}
                    {missing && (
                      <span className="exd-rules-warn">
                        Emits nothing without <code>{missing}</code>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>

      <span className="exd-rules-foot">
        Applied on download/copy · manage in Data Standards → DDL Export rules.
      </span>
    </div>
  );
}
