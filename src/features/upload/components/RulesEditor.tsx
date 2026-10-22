import type { ProfileCatalog, ProfileMapping, ProfileRule, RuleSeverity, RuleType, SheetRole } from '../upload.service';
import { removeRule, ruleOf, upsertRule } from '../lib/profileDraft';

/**
 * Reglas de una columna del perfil: una fila por tipo del
 * catálogo — activar/desactivar, valor según `valueKind` y severidad.
 * `mustExist` solo se ofrece cuando el destino es un campo que lo admite.
 */
export default function RulesEditor({ role, mapping, catalog, onChange }: {
  role: SheetRole;
  mapping: ProfileMapping;
  catalog: ProfileCatalog;
  onChange: (m: ProfileMapping) => void;
}) {
  const field = mapping.target.kind === 'field'
    ? catalog.fields[role].find((f) => f.field === mapping.target.field)
    : undefined;

  const defaultValueFor = (kind: 'int' | 'regex' | 'list' | null): ProfileRule['value'] => {
    if (kind === 'int') return 80;
    if (kind === 'regex') return '';
    if (kind === 'list') return [];
    return null;
  };

  return (
    <div className="up-pf-rules-grid" role="group" aria-label="Column rules">
      {catalog.ruleTypes.map((rt) => {
        const rule = ruleOf(mapping, rt.type as RuleType);
        const applicable = rt.appliesTo === 'mustExist' ? !!field?.mustExist : true;
        const enabled = !!rule && applicable;
        const set = (patch: Partial<ProfileRule>) => onChange(upsertRule(mapping, { type: rt.type, severity: 'error', ...(rule ?? {}), ...patch }));
        return (
          <div className={`up-pf-rule${enabled ? ' is-on' : ''}${applicable ? '' : ' is-na'}`} key={rt.type}>
            <label className="up-pf-rule-main">
              <input
                type="checkbox" checked={enabled} disabled={!applicable}
                onChange={(e) => onChange(e.target.checked
                  ? upsertRule(mapping, { type: rt.type, value: defaultValueFor(rt.valueKind), severity: 'error' })
                  : removeRule(mapping, rt.type as RuleType))}
              />
              <span>{rt.label}</span>
              {!applicable && <small>only for schema, subject, space, diagram, parent domain</small>}
            </label>
            {enabled && rt.valueKind === 'int' && (
              <input
                type="number" min={1} className="up-pf-input up-pf-input--num" aria-label={`${rt.label} value`}
                value={typeof rule?.value === 'number' ? rule.value : ''}
                onChange={(e) => set({ value: e.target.value === '' ? null : Number(e.target.value) })}
              />
            )}
            {enabled && rt.valueKind === 'regex' && (
              <input
                type="text" className="up-pf-input up-mono" placeholder="^[A-Z_]+$" aria-label={`${rt.label} value`}
                value={typeof rule?.value === 'string' ? rule.value : ''}
                onChange={(e) => set({ value: e.target.value })}
              />
            )}
            {enabled && rt.valueKind === 'list' && (
              <textarea
                className="up-pf-input up-pf-input--list" rows={2} placeholder="One value per line" aria-label={`${rt.label} values`}
                value={Array.isArray(rule?.value) ? rule.value.join('\n') : ''}
                onChange={(e) => set({ value: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) })}
              />
            )}
            {enabled && (
              <select
                className="up-pf-input up-pf-input--sev" aria-label={`${rt.label} severity`}
                value={rule?.severity ?? 'error'}
                onChange={(e) => set({ severity: e.target.value as RuleSeverity })}
              >
                <option value="error">Error (blocks upload)</option>
                <option value="warning">Warning</option>
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
