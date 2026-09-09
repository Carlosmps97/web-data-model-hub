import { CircleAlert, Trash2, X } from 'lucide-react';
import SearchSelect, { type SearchOption } from '@/features/modeler/components/SearchSelect';
import { udpDisplayName, udpView } from '@/lib/facets';
import type { UdpDefinition } from '@/features/standards/standards.service';
import type { ProfileCatalog, ProfileMapping, ProfileProblem, SheetRole } from '../upload.service';
import { IDENTITY_FIELDS } from '../lib/profileDraft';
import RulesEditor from './RulesEditor';

const LEVEL_OF_ROLE: Record<SheetRole, UdpDefinition['level']> = { tables: 'table', columns: 'column' };

/**
 * Una fila de la tabla de mapeos (doc 78 §8): cabecera del Excel · destino
 * (campo, uno o varios UDP de cualquier faceta, o ignorar) · valor por
 * defecto · reglas · quitar. Los problemas del servidor/locales de ESTA
 * fila se listan debajo, en rojo.
 */
export default function MappingRow({ role, mapping, catalog, udpDefs, problems, onChange, onRemove }: {
  role: SheetRole;
  mapping: ProfileMapping;
  catalog: ProfileCatalog;
  udpDefs: UdpDefinition[];
  problems: ProfileProblem[];
  onChange: (m: ProfileMapping) => void;
  onRemove: () => void;
}) {
  const fields = catalog.fields[role];
  const defs = udpDefs.filter((d) => d.level === LEVEL_OF_ROLE[role]);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const chosen = mapping.target.kind === 'udp' ? (mapping.target.udpIds ?? []) : [];

  const options: SearchOption[] = [
    { value: 'ignore', label: 'Ignore column', detail: 'not loaded' },
    ...fields.map((f) => ({ value: `field:${f.field}`, label: f.label, detail: f.required ? 'Field · required' : 'Field' })),
    ...defs
      .filter((d) => !chosen.includes(d.id))
      .map((d) => ({ value: `udp:${d.id}`, label: udpDisplayName(d), detail: udpView(d) === 'logical' ? 'UDP · logical' : 'UDP · physical' })),
  ];

  const pick = (value: string) => {
    if (value === 'ignore') onChange({ ...mapping, target: { kind: 'ignore' } });
    else if (value.startsWith('field:')) onChange({ ...mapping, target: { kind: 'field', field: value.slice(6) } });
    else if (value.startsWith('udp:')) {
      const id = value.slice(4);
      const ids = mapping.target.kind === 'udp' ? [...(mapping.target.udpIds ?? [])] : [];
      if (!ids.includes(id)) ids.push(id);
      onChange({ ...mapping, target: { kind: 'udp', udpIds: ids } });
    }
  };
  const dropUdp = (id: string) => {
    const ids = chosen.filter((x) => x !== id);
    onChange({ ...mapping, target: ids.length ? { kind: 'udp', udpIds: ids } : { kind: 'ignore' } });
  };

  const fieldSpec = mapping.target.kind === 'field' ? fields.find((f) => f.field === mapping.target.field) : undefined;
  const valueLabel = mapping.target.kind === 'field'
    ? (fieldSpec?.label ?? String(mapping.target.field))
    : mapping.target.kind === 'udp'
      ? `${chosen.length} UDP${chosen.length === 1 ? '' : 's'}`
      : 'Ignore column';
  const identity = mapping.target.kind === 'field' && IDENTITY_FIELDS[role].includes(mapping.target.field ?? '');
  const ruleCount = mapping.rules.length;

  return (
    <>
      <tr className={`up-pf-row${problems.length ? ' has-problems' : ''}`}>
        <td>
          <input
            className="up-pf-input" value={mapping.header} placeholder="Excel header" aria-label="Excel header"
            onChange={(e) => onChange({ ...mapping, header: e.target.value })}
          />
        </td>
        <td className="up-pf-target">
          <SearchSelect
            options={options} valueLabel={valueLabel} placeholder="Pick a target…" onPick={pick}
            emptyLabel="No matching target" inputClassName="up-pf-input"
          />
          {chosen.length > 0 && (
            <div className="up-pf-chips">
              {chosen.map((id) => {
                const d = byId.get(id);
                const facet = d ? udpView(d) : 'physical';
                return (
                  <span className={`up-pf-chip up-pf-chip--${facet}${d ? '' : ' is-missing'}`} key={id} title={d ? `${d.name} · ${facet}` : 'This UDP no longer exists'}>
                    {d ? d.name : 'Missing UDP'}<small>{d ? (facet === 'logical' ? 'L' : 'P') : '?'}</small>
                    <button type="button" aria-label={`Remove ${d?.name ?? id}`} onClick={() => dropUdp(id)}><X size={11} strokeWidth={2.2} aria-hidden /></button>
                  </span>
                );
              })}
            </div>
          )}
        </td>
        <td>
          <input
            className="up-pf-input" value={mapping.defaultValue ?? ''} placeholder={identity ? 'n/a' : 'When empty (new only)'}
            aria-label="Default value" disabled={identity || mapping.target.kind === 'ignore'}
            title={identity ? "Identity columns can't have a default" : 'Used when the cell is empty and the object is new'}
            onChange={(e) => onChange({ ...mapping, defaultValue: e.target.value || null })}
          />
        </td>
        <td>
          {mapping.target.kind === 'ignore' ? (
            <span className="up-pf-muted">—</span>
          ) : (
            <details className="up-pf-rules">
              <summary>{ruleCount ? `${ruleCount} rule${ruleCount === 1 ? '' : 's'}` : 'No rules'}</summary>
              <RulesEditor role={role} mapping={mapping} catalog={catalog} onChange={onChange} />
            </details>
          )}
        </td>
        <td className="up-pf-actions">
          <button type="button" className="up-pf-iconbtn" aria-label={`Remove mapping ${mapping.header || ''}`} onClick={onRemove}>
            <Trash2 size={14} strokeWidth={1.8} aria-hidden />
          </button>
        </td>
      </tr>
      {problems.length > 0 && (
        <tr className="up-pf-problems-row">
          <td colSpan={5}>
            {problems.map((p, i) => (
              <div className="up-pf-problem" key={`${p.code}-${i}`}><CircleAlert size={13} strokeWidth={1.8} aria-hidden />{p.message}</div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
