/**
 * SheetTemplateEditor — alta y edición de plantillas de hoja Excel (doc 95 D11):
 * nombre, nombre de hoja y columnas (encabezado → dato del modelo o UDP). Son
 * dato: se editan sin redesplegar. Permisos de los saved reports (spec D11): cada
 * uno edita las suyas y comparte las que quiera; las compartidas ajenas se ven en
 * solo lectura y se pueden duplicar; un admin gobierna las compartidas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Copy, FileSpreadsheet, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { apiErrorMessage } from '@/services/http';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import {
  BUILTIN_ORIGIN, canEditTemplate, isKnownSource, moveItem, sourceLabel, sourceOptions, templateProblems,
  type SheetTemplate, type SheetTemplateBody,
} from '../lib/sheetTemplates';
import {
  createDefaultSheetTemplate, createSheetTemplate, deleteSheetTemplate, updateSheetTemplate,
} from '../sheetTemplates.service';

type Draft = SheetTemplateBody & { id?: string };
const EMPTY: Draft = { name: '', sheetName: '', description: '', shared: false, columns: [{ header: '', source: 'column.physicalName' }] };
const toDraft = (t: SheetTemplate): Draft => ({
  id: t.id, name: t.name, sheetName: t.sheetName, description: t.description ?? '', shared: t.shared,
  columns: t.columns.map((c) => ({ ...c })),
});

export default function SheetTemplateEditor({ projectId, templates, me, isAdmin, onClose, onChanged }: {
  projectId: string; templates: SheetTemplate[]; me: string | undefined; isAdmin: boolean;
  onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [selId, setSelId] = useState<string | null>(templates[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [defs, setDefs] = useState<UdpDefinition[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const copyOf = useRef<Draft | null>(null);    // «Duplicate»: borrador que abre el alta

  useEffect(() => { getUdpDefs(projectId).then(setDefs).catch(() => setDefs([])); }, [projectId]);
  useEffect(() => {
    const t = templates.find((x) => x.id === selId);
    setDraft(t ? toDraft(t) : copyOf.current ?? EMPTY);
    copyOf.current = null;
    setConfirmDelete(false);
  }, [selId, templates]);

  const groups = useMemo(() => sourceOptions(defs), [defs]);
  const problems = useMemo(() => templateProblems(draft), [draft]);
  const hasBuiltin = templates.some((t) => t.origin === BUILTIN_ORIGIN);
  const current = templates.find((t) => t.id === draft.id) ?? null;
  const editable = !draft.id || (current !== null && canEditTemplate(current, me, isAdmin));
  // Admin sobre una compartida ajena: la edita, pero sigue compartida (el backend igual).
  const foreign = current !== null && current.owner !== me;

  const setColumn = (i: number, patch: Partial<Draft['columns'][number]>) =>
    setDraft((d) => ({ ...d, columns: d.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const save = async () => {
    if (problems.length) { toast.error(problems[0]); return; }
    setBusy(true);
    try {
      const body: SheetTemplateBody = {
        name: draft.name.trim(), sheetName: draft.sheetName.trim(), description: draft.description?.trim() || null,
        shared: foreign || draft.shared, columns: draft.columns.map((c) => ({ header: c.header.trim(), source: c.source })),
      };
      const saved = draft.id
        ? await updateSheetTemplate(projectId, draft.id, body)
        : await createSheetTemplate(projectId, body);
      toast.success(`Template ${saved.name} saved.`);
      await onChanged();
      setSelId(saved.id);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't save the template.")); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!draft.id) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    try {
      await deleteSheetTemplate(projectId, draft.id);
      toast.success(`Template ${draft.name} deleted.`);
      await onChanged();
      setSelId(null);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't delete the template.")); } finally { setBusy(false); }
  };

  const duplicate = () => {
    copyOf.current = { ...draft, id: undefined, name: `${draft.name} (copy)`, shared: false };
    setSelId(null);
  };

  const createBuiltin = async () => {
    setBusy(true);
    try {
      const t = await createDefaultSheetTemplate(projectId);
      toast.success('QA_MODELO template created.');
      await onChanged();
      setSelId(t.id);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't create the template.")); } finally { setBusy(false); }
  };

  return (
    <Dialog open title="Excel templates" icon={FileSpreadsheet} onClose={onClose} width={1040}
      subtitle="Fixed sheet formats for Reporting — each one exports a single sheet with its own name and columns."
      footer={<>
        {draft.id && editable && (
          <div className="dmh-dialog-foot-left">
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              {confirmDelete ? 'Click again to delete' : 'Delete'}
            </Button>
          </div>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
        {draft.id && <Button variant="secondary" icon={Copy} onClick={duplicate} disabled={busy}>Duplicate</Button>}
        {editable && (
          <Button variant="primary" icon={Save} onClick={save} disabled={busy}>{draft.id ? 'Save changes' : 'Create template'}</Button>
        )}
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, minHeight: 360 }}>
        <div style={{ borderRight: '1px solid #EEF1F6', paddingRight: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {templates.map((t) => (
            <button key={t.id} type="button" onClick={() => setSelId(t.id)} style={listItem(t.id === selId)}>
              <span style={{ fontWeight: 600, color: '#1A2B4A' }}>{t.name}</span>
              <span style={{ fontSize: 11, color: '#8A93A5' }}>
                sheet {t.sheetName} · {t.columns.length} columns · {ownerLabel(t, me)}
              </span>
            </button>
          ))}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setSelId(null)}>New template</Button>
          {!hasBuiltin && (
            <Button variant="secondary" size="sm" onClick={createBuiltin} disabled={busy}>Create QA_MODELO template</Button>
          )}
        </div>
        <fieldset disabled={!editable} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, border: 0, padding: 0, margin: 0 }}>
          {!editable && current && (
            <div style={note}>Shared by {current.owner ?? 'someone else'} — read-only. Duplicate it to make your own version.</div>
          )}
          {editable && foreign && current && (
            <div style={note}>Shared by {current.owner ?? 'someone else'} — you can edit it as an admin; it stays shared.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 10 }}>
            <label style={fieldLabel}>Template name
              <input className="rd-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. QA_MODELO" />
            </label>
            <label style={fieldLabel}>Sheet name
              <input className="rd-input" value={draft.sheetName} maxLength={31} onChange={(e) => setDraft({ ...draft, sheetName: e.target.value })} placeholder="e.g. QA_MODELO" />
            </label>
          </div>
          <label style={fieldLabel}>Description
            <input className="rd-input" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What this format is for" />
          </label>
          <label style={checkLabel}>
            <input type="checkbox" checked={foreign || draft.shared} disabled={foreign}
              onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
            Share with everyone in this project
          </label>
          <div style={sectionTitle}>Columns · one row per column of the model, ordered by table (PK first)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {draft.columns.map((c, i) => {
              const known = isKnownSource(c.source, groups);
              return (
                <div key={i}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr auto', gap: 8, alignItems: 'center' }}>
                    <input className="rd-input" value={c.header} onChange={(e) => setColumn(i, { header: e.target.value })}
                      placeholder="Header" aria-label={`Header ${i + 1}`} />
                    <select className="rd-input" value={c.source} onChange={(e) => setColumn(i, { source: e.target.value })}
                      aria-label={`Data ${i + 1}`}>
                      {!known && <option value={c.source}>{sourceLabel(c.source)} — not found</option>}
                      {groups.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" style={iconBtn} aria-label="Move up"
                        onClick={() => setDraft((d) => ({ ...d, columns: moveItem(d.columns, i, -1) }))}><ArrowUp size={13} /></button>
                      <button type="button" style={iconBtn} aria-label="Move down"
                        onClick={() => setDraft((d) => ({ ...d, columns: moveItem(d.columns, i, 1) }))}><ArrowDown size={13} /></button>
                      <button type="button" style={iconBtn} aria-label="Remove"
                        onClick={() => setDraft((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))}><X size={13} /></button>
                    </div>
                  </div>
                  {!known && (
                    <div style={{ fontSize: 11.5, color: '#9A6B00', marginTop: 3 }}>
                      This data doesn&apos;t exist in this project — the column will be empty.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <Button variant="secondary" size="sm" icon={Plus}
              onClick={() => setDraft((d) => ({ ...d, columns: [...d.columns, { header: '', source: 'column.physicalName' }] }))}>
              Add column
            </Button>
          </div>
          {editable && problems.length > 0 && <div style={{ fontSize: 12, color: '#C0392B' }}>{problems[0]}</div>}
        </fieldset>
      </div>
    </Dialog>
  );
}

/** «yours» / «shared by ana» / «yours · shared». */
function ownerLabel(t: SheetTemplate, me: string | undefined): string {
  if (t.owner && t.owner === me) return t.shared ? 'yours · shared' : 'yours';
  return `shared by ${t.owner ?? 'someone else'}`;
}

const note: React.CSSProperties = { fontSize: 12, color: '#7A6220', background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 9, padding: '8px 11px' };
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#56607A' };
const listItem = (active: boolean): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', padding: '8px 10px', border: `1px solid ${active ? '#2E5BFF' : '#E6EAF0'}`, background: active ? '#F4F7FF' : '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' });
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#56607A' };
const sectionTitle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginTop: 4 };
const iconBtn: React.CSSProperties = { width: 28, height: 28, border: '1px solid #E6EAF0', background: '#fff', borderRadius: 7, color: '#56607A', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
