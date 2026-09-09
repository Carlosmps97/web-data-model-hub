import { useRef, useState } from 'react';
import { CircleAlert, FileUp, Plus } from 'lucide-react';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Button from '@/components/ui/Button';
import { apiErrorMessage } from '@/services/http';
import type { UdpDefinition } from '@/features/standards/standards.service';
import type { ProfileCatalog, ProfileProblem, ProfileSheet, SheetRole, UploadProfileBody } from '../upload.service';
import { suggestMappings } from '../upload.service';
import { findSheet, headersAt, readWorkbook } from '../lib/parseWorkbook';
import { ROLES, ROLE_LABEL, emptyMapping, mergeSuggestions, problemsOfMapping } from '../lib/profileDraft';
import MappingRow from './MappingRow';

type Tab = SheetRole | 'policies';
const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Formulario de un perfil (doc 78 §8): cabecera (nombre, descripción,
 * default), una pestaña por hoja (nombre de hoja, fila de cabecera,
 * requerida, tabla de mapeos con «Read headers from a workbook…» y «Add
 * header») y la pestaña de políticas. Sin estado propio del perfil: el
 * borrador vive en el padre (`draft` / `onChange`).
 */
export default function ProfileEditor({ projectId, draft, catalog, udpDefs, problems, onChange, pushToast }: {
  projectId: string;
  draft: UploadProfileBody;
  catalog: ProfileCatalog;
  udpDefs: UdpDefinition[];
  problems: ProfileProblem[];
  onChange: (b: UploadProfileBody) => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const [tab, setTab] = useState<Tab>('tables');
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setSheet = (role: SheetRole, patch: Partial<ProfileSheet>) =>
    onChange({ ...draft, sheets: { ...draft.sheets, [role]: { ...draft.sheets[role], ...patch } } });
  const setMapping = (role: SheetRole, i: number, m: ProfileSheet['mappings'][number]) =>
    setSheet(role, { mappings: draft.sheets[role].mappings.map((x, j) => (j === i ? m : x)) });
  const removeMapping = (role: SheetRole, i: number) =>
    setSheet(role, { mappings: draft.sheets[role].mappings.filter((_, j) => j !== i) });

  const readHeaders = async (role: SheetRole, f: File) => {
    setReading(true);
    try {
      const wb = readWorkbook(await f.arrayBuffer(), f.name);
      if (!wb.sheets.length) { pushToast(`${f.name} has no sheets.`, 'err'); return; }
      const wanted = draft.sheets[role].name.trim();
      const sheet = (wanted && findSheet(wb.sheets, wanted)) || wb.sheets[0];
      const headerRow = draft.sheets[role].headerRow ?? 1;
      const headers = headersAt(sheet, headerRow);
      if (!headers.length) { pushToast(`No headers found at row ${headerRow} of '${sheet.name}' — set the header row first.`, 'err'); return; }
      const suggestions = await suggestMappings(projectId, role, headers);
      const before = draft.sheets[role].mappings.length;
      const merged = mergeSuggestions(draft.sheets[role], suggestions);
      const added = merged.mappings.length - before;
      const matched = merged.mappings.slice(before).filter((m) => m.target.kind !== 'ignore').length;
      setSheet(role, { ...merged, name: wanted || sheet.name });
      const where = wanted && sheet.name !== wanted ? ` (sheet '${wanted}' not found — read '${sheet.name}')` : '';
      pushToast(added ? `Added ${added} header${added === 1 ? '' : 's'} from '${sheet.name}', ${matched} matched by name${where}.` : `No new headers in '${sheet.name}'${where}.`);
    } catch (e) {
      pushToast(apiErrorMessage(e, "Couldn't read the workbook headers."), 'err');
    } finally {
      setReading(false);
    }
  };

  const general = (paths: string[]) => problems.filter((p) => paths.includes(p.path));

  const sheetPane = (role: SheetRole) => {
    const s = draft.sheets[role];
    const sheetProblems = general([`sheets.${role}`, `sheets.${role}.name`, `sheets.${role}.headerRow`, `sheets.${role}.mappings`]);
    return (
      <div className="up-pf-pane">
        <div className="up-pf-sheet-head">
          <label className="up-pf-field">
            <span>Sheet name</span>
            <input className="up-pf-input" value={s.name} placeholder="e.g. Cargar_Tablas" onChange={(e) => setSheet(role, { name: e.target.value })} />
          </label>
          <label className="up-pf-field up-pf-field--narrow">
            <span>Header row</span>
            <input
              className="up-pf-input" type="number" min={1} placeholder="auto" value={s.headerRow ?? ''}
              onChange={(e) => setSheet(role, { headerRow: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
          <label className="up-pf-check">
            <input type="checkbox" checked={s.required} onChange={(e) => setSheet(role, { required: e.target.checked })} />
            <span>Required sheet</span>
          </label>
          <span className="up-pf-spacer" />
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void readHeaders(role, f); e.target.value = ''; }} />
          <Button size="sm" variant="secondary" icon={FileUp} disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? 'Reading…' : 'Read headers from a workbook…'}
          </Button>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setSheet(role, { mappings: [...s.mappings, emptyMapping()] })}>Add header</Button>
        </div>
        {sheetProblems.map((p, i) => (
          <div className="up-pf-problem" key={`${p.code}-${i}`}><CircleAlert size={13} strokeWidth={1.8} aria-hidden />{p.message}</div>
        ))}
        {s.mappings.length === 0 ? (
          <div className="up-pf-empty">No columns mapped yet — read the headers from a workbook or add them by hand.</div>
        ) : (
          <div className="up-pf-table-wrap">
            <table className="up-pf-table">
              <thead>
                <tr><th>Excel header</th><th>Target</th><th>Default value</th><th>Rules</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {s.mappings.map((m, i) => (
                  <MappingRow
                    key={i} role={role} mapping={m} catalog={catalog} udpDefs={udpDefs}
                    problems={problemsOfMapping(problems, role, i)}
                    onChange={(nm) => setMapping(role, i, nm)} onRemove={() => removeMapping(role, i)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const policiesPane = (
    <div className="up-pf-pane up-pf-policies">
      <div className="up-pf-policy">
        <div><strong>Existing tables</strong><span>A row that matches a table already in the model</span></div>
        <SegmentedControl
          options={[{ value: 'update', label: 'Update it' }, { value: 'reject', label: 'Reject (error)' }]}
          value={draft.policies.onExistingTable} onChange={(v) => onChange({ ...draft, policies: { ...draft.policies, onExistingTable: v } })}
          aria-label="Existing tables policy"
        />
      </div>
      <div className="up-pf-policy">
        <div><strong>Existing columns</strong><span>A row that matches a column already in its table</span></div>
        <SegmentedControl
          options={[{ value: 'update', label: 'Update it' }, { value: 'reject', label: 'Reject (error)' }]}
          value={draft.policies.onExistingColumn} onChange={(v) => onChange({ ...draft, policies: { ...draft.policies, onExistingColumn: v } })}
          aria-label="Existing columns policy"
        />
      </div>
      <div className="up-pf-policy">
        <div><strong>Unknown headers</strong><span>Columns in the workbook that the profile doesn't map</span></div>
        <SegmentedControl
          options={[{ value: 'warn', label: 'Warn' }, { value: 'ignore', label: 'Ignore' }, { value: 'reject', label: 'Reject (error)' }]}
          value={draft.policies.unknownHeaders} onChange={(v) => onChange({ ...draft, policies: { ...draft.policies, unknownHeaders: v } })}
          aria-label="Unknown headers policy"
        />
      </div>
      {general(['policies.onExistingTable', 'policies.onExistingColumn', 'policies.unknownHeaders']).map((p, i) => (
        <div className="up-pf-problem" key={`${p.code}-${i}`}><CircleAlert size={13} strokeWidth={1.8} aria-hidden />{p.message}</div>
      ))}
    </div>
  );

  const nameProblems = general(['name']);
  const countFor = (role: SheetRole) => problems.filter((p) => p.path.startsWith(`sheets.${role}`)).length;

  return (
    <div className="up-pf-editor">
      <div className="up-pf-head">
        <label className="up-pf-field up-pf-field--grow">
          <span>Profile name</span>
          <input className="up-pf-input" value={draft.name} placeholder="e.g. Plantilla BCP" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </label>
        <label className="up-pf-field up-pf-field--grow">
          <span>Description</span>
          <input className="up-pf-input" value={draft.description ?? ''} placeholder="Optional" onChange={(e) => onChange({ ...draft, description: e.target.value })} />
        </label>
        <label className="up-pf-check">
          <input type="checkbox" checked={draft.isDefault} onChange={(e) => onChange({ ...draft, isDefault: e.target.checked })} />
          <span>Use as default</span>
        </label>
      </div>
      {nameProblems.map((p, i) => (
        <div className="up-pf-problem" key={`${p.code}-${i}`}><CircleAlert size={13} strokeWidth={1.8} aria-hidden />{p.message}</div>
      ))}
      <SegmentedControl<Tab>
        options={[
          ...ROLES.map((r) => ({ value: r as Tab, label: countFor(r) ? `${ROLE_LABEL[r]} (${countFor(r)})` : ROLE_LABEL[r] })),
          { value: 'policies', label: 'Policies' },
        ]}
        value={tab} onChange={setTab} aria-label="Profile sections"
      />
      {tab === 'policies' ? policiesPane : sheetPane(tab)}
    </div>
  );
}
