/**
 * SheetTemplateEditor — alta y edición de plantillas de hoja Excel: nombre,
 * nombre de hoja, columnas (encabezado → dato del modelo o UDP) y filtros de
 * filas (sale la fila que cumple todos). Son dato: se editan sin redesplegar.
 * Permisos: cada uno edita las suyas y comparte las que quiera; las compartidas
 * ajenas se ven en solo lectura y se pueden duplicar; un admin gobierna las
 * compartidas y bloquea con el switch de la lista: bloqueada, nadie la edita ni
 * la borra (tampoco el admin, que antes la desbloquea), pero se usa y se duplica.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Copy, FileSpreadsheet, Lock, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { apiErrorMessage } from '@/services/http';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import {
  BUILTIN_ORIGIN, canEditTemplate, cleanFileName, filterNeedsValue, filterOps, isKnownSource, moveItem, sourceLabel,
  sourceOptions, templateFileName, templateProblems, toFilterBody, toFilterDraft, type FilterDraft, type SheetTemplate,
  type SheetTemplateBody,
} from '../lib/sheetTemplates';
import {
  createDefaultSheetTemplate, createSheetTemplate, deleteSheetTemplate, setSheetTemplateLock, updateSheetTemplate,
} from '../sheetTemplates.service';

type Draft = Omit<SheetTemplateBody, 'filters'> & { id?: string; filters: FilterDraft[] };
const EMPTY: Draft = { name: '', sheetName: '', description: '', shared: false, fileName: '', columns: [{ header: '', source: 'column.physicalName' }], filters: [] };
const toDraft = (t: SheetTemplate): Draft => ({
  id: t.id, name: t.name, sheetName: t.sheetName, description: t.description ?? '', shared: t.shared,
  fileName: t.fileName ?? '', columns: t.columns.map((c) => ({ ...c })), filters: (t.filters ?? []).map(toFilterDraft),
});

/** «Next export:» con reloj propio de 1 s: calculado en el render del editor,
 *  los segundos quedarían congelados hasta la siguiente tecla. */
export function NextExportName({ draft }: { draft: Pick<SheetTemplateBody, 'name' | 'fileName'> }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);
  return <strong>{templateFileName(draft, now)}</strong>;
}

export default function SheetTemplateEditor({ projectId, templates, me, isAdmin, onClose, onChanged, onLockChanged }: {
  projectId: string; templates: SheetTemplate[]; me: string | undefined; isAdmin: boolean;
  onClose: () => void; onChanged: () => Promise<void>;
  /** El servidor bloqueó o desbloqueó esa plantilla: la card la reemplaza en su lista. */
  onLockChanged: (t: SheetTemplate) => void;
}) {
  const [selId, setSelId] = useState<string | null>(templates[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(() => (templates[0] ? toDraft(templates[0]) : EMPTY));
  const [defs, setDefs] = useState<UdpDefinition[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const copyOf = useRef<Draft | null>(null);    // «Duplicate»: borrador que abre el alta

  useEffect(() => { getUdpDefs(projectId).then(setDefs).catch(() => setDefs([])); }, [projectId]);
  // Re-sincroniza cuando cambia la selección o la plantilla elegida: una recarga
  // de la lista o una selección programática (guardar, borrar, crear la
  // QA_MODELO), o su bloqueo. Bloquear otra reemplaza solo esa en la lista: lo
  // tecleado aquí sigue. Los clics del usuario ya reinician el borrador en el
  // mismo evento (`choose`); esto re-aplica lo mismo.
  const selected = templates.find((x) => x.id === selId);
  useEffect(() => {
    setDraft(selected ? toDraft(selected) : copyOf.current ?? EMPTY);
    copyOf.current = null;
    setConfirmDelete(false);
  }, [selId, selected]);

  /** Elegir (lista, «New template», «Duplicate») reinicia el borrador en el
   *  mismo evento: si llegara solo por el efecto, quedaría una ventana con la
   *  plantilla anterior en pantalla. La misma selección no pisa lo tecleado. */
  const choose = (id: string | null, copy: Draft | null = null) => {
    if (id === selId && !copy) return;
    const t = templates.find((x) => x.id === id);
    copyOf.current = copy;
    setSelId(id);
    setDraft(t ? toDraft(t) : copy ?? EMPTY);
    setConfirmDelete(false);
  };
  /** Cada campo actualiza sobre el último borrador encolado: con
   *  `{ ...draft, X }` una tecla tras un reinicio sin renderizar reviviría la
   *  plantilla anterior con su id (y «Save changes» la pisaría). */
  const patchDraft = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const groups = useMemo(() => sourceOptions(defs), [defs]);
  const problems = useMemo(() => templateProblems({ ...draft, filters: draft.filters.map(toFilterBody) }), [draft]);
  const hasBuiltin = templates.some((t) => t.origin === BUILTIN_ORIGIN);
  const current = templates.find((t) => t.id === draft.id) ?? null;
  const editable = !draft.id || (current !== null && !current.locked && canEditTemplate(current, me, isAdmin));
  // Admin sobre una compartida ajena: la edita, pero sigue compartida (el backend igual).
  const foreign = current !== null && current.owner !== me;

  const setColumn = (i: number, patch: Partial<Draft['columns'][number]>) =>
    setDraft((d) => ({ ...d, columns: d.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setFilter = (i: number, patch: Partial<FilterDraft>) =>
    setDraft((d) => ({ ...d, filters: d.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  /** Otro dato: si su lista de operadores no tiene el elegido, toma el primero (bandera → «is marked»). */
  const setFilterSource = (i: number, source: string) =>
    setDraft((d) => ({
      ...d,
      filters: d.filters.map((f, j) => {
        if (j !== i) return f;
        const ops = filterOps(source);
        return { ...f, source, op: ops.some((o) => o.value === f.op) ? f.op : ops[0].value };
      }),
    }));

  const save = async () => {
    if (problems.length) { toast.error(problems[0]); return; }
    setBusy(true);
    try {
      const body: SheetTemplateBody = {
        name: draft.name.trim(), sheetName: draft.sheetName.trim(), description: draft.description?.trim() || null,
        shared: foreign || draft.shared, columns: draft.columns.map((c) => ({ header: c.header.trim(), source: c.source })),
        fileName: cleanFileName(draft.fileName),
        filters: draft.filters.map(toFilterBody),
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

  const duplicate = () => choose(null, { ...draft, id: undefined, name: `${draft.name} (copy)`, shared: false });

  /** Solo un admin. Pide el estado contrario al que muestra la lista: un doble
   *  clic manda dos veces lo mismo y no se anula. */
  const toggleLock = async (t: SheetTemplate) => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const saved = await setSheetTemplateLock(projectId, t.id, !t.locked);
      toast.success(saved.locked ? `Template ${saved.name} locked — nobody can edit or delete it.` : `Template ${saved.name} unlocked.`);
      onLockChanged(saved);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't change the template lock.")); } finally { setBusy(false); }
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
            <div key={t.id} style={listItem(t.id === selId)}>
              <button type="button" onClick={() => choose(t.id)} style={listPick}>
                <span style={{ fontWeight: 600, color: '#1A2B4A' }}>{t.name}</span>
                <span style={{ fontSize: 11, color: '#8A93A5' }}>
                  sheet {t.sheetName} · {t.columns.length} columns{t.filters?.length ? ` · ${filtersLabel(t.filters.length)}` : ''} · {ownerLabel(t, me)}{t.locked ? ' · locked' : ''}
                </span>
              </button>
              {/* Lo ven todos; solo un admin lo cambia. Con una petición en curso no
                  se deshabilita: el foco del teclado sigue en él. La ayuda va en el
                  span (el mouse sobre un botón deshabilitado) y en el switch (lector). */}
              <span style={lockCell} title={lockTitle(!!t.locked, isAdmin)}>
                <Lock size={11} color={t.locked ? '#2E5BFF' : '#B6BECD'} aria-hidden />
                <button type="button" role="switch" aria-checked={!!t.locked} aria-label={`Lock ${t.name}`}
                  title={lockTitle(!!t.locked, isAdmin)} disabled={!isAdmin} aria-disabled={busy || undefined}
                  onClick={() => (busy ? undefined : toggleLock(t))} style={lockSwitch(!!t.locked, !isAdmin || busy)}>
                  <span style={lockKnob} />
                </button>
              </span>
            </div>
          ))}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => choose(null)}>New template</Button>
          {!hasBuiltin && (
            <Button variant="secondary" size="sm" onClick={createBuiltin} disabled={busy}>Create QA_MODELO template</Button>
          )}
        </div>
        <fieldset disabled={!editable} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, border: 0, padding: 0, margin: 0 }}>
          {current?.locked && (
            <div style={note}>
              {isAdmin
                ? 'Locked — read-only for everyone, admins included. Turn off its lock switch to edit or delete it.'
                : 'Locked by an admin — read-only for everyone. Duplicate it to make your own version.'}
            </div>
          )}
          {!editable && current && !current.locked && (
            <div style={note}>Shared by {current.owner ?? 'someone else'} — read-only. Duplicate it to make your own version.</div>
          )}
          {editable && foreign && current && (
            <div style={note}>Shared by {current.owner ?? 'someone else'} — you can edit it as an admin; it stays shared.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 10 }}>
            <label style={fieldLabel}>Template name
              <input className="rd-input" value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} placeholder="e.g. QA_MODELO" />
            </label>
            <label style={fieldLabel}>Sheet name
              <input className="rd-input" value={draft.sheetName} maxLength={31} onChange={(e) => patchDraft({ sheetName: e.target.value })} placeholder="e.g. QA_MODELO" />
            </label>
          </div>
          <label style={fieldLabel}>Description
            <input className="rd-input" value={draft.description ?? ''} onChange={(e) => patchDraft({ description: e.target.value })} placeholder="What this format is for" />
          </label>
          {/* Nombre del archivo del export: dato de la plantilla, sin redesplegar. */}
          <label style={fieldLabel}>File name
            <input className="rd-input" value={draft.fileName ?? ''} aria-label="File name"
              onChange={(e) => patchDraft({ fileName: e.target.value })}
              placeholder="e.g. QA_REPORTE_{yyyy}-{MM}-{dd} {HH}{mm}{ss}" />
            <span style={hint}>
              Placeholders {'{yyyy} {MM} {dd} {HH} {mm} {ss}'} use your local time; empty = template name + date.
              Next export: <NextExportName draft={draft} />
            </span>
          </label>
          <label style={checkLabel}>
            <input type="checkbox" checked={foreign || draft.shared} disabled={foreign}
              onChange={(e) => patchDraft({ shared: e.target.checked })} />
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
          <div style={sectionTitle}>Filters · a row is exported only if it meets every filter</div>
          {draft.filters.length === 0 && (
            <div style={hint}>No filters: every column of the selected tables is exported.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {draft.filters.map((f, i) => {
              const known = isKnownSource(f.source, groups);
              return (
                <div key={i}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.9fr 1fr auto', gap: 8, alignItems: 'center' }}>
                    <select className="rd-input" value={f.source} onChange={(e) => setFilterSource(i, e.target.value)}
                      aria-label={`Filter data ${i + 1}`}>
                      {!known && <option value={f.source}>{sourceLabel(f.source)} — not found</option>}
                      {groups.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <select className="rd-input" value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as FilterDraft['op'] })}
                      aria-label={`Filter operator ${i + 1}`}>
                      {opsShown(f).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {filterNeedsValue(f.op)
                      ? (
                        <input className="rd-input" value={f.text} onChange={(e) => setFilter(i, { text: e.target.value })}
                          placeholder={f.op === 'isOneOf' ? 'e.g. STRING, VARCHAR' : 'Value'} aria-label={`Filter value ${i + 1}`} />
                      )
                      : <span />}
                    <button type="button" style={iconBtn} aria-label="Remove filter"
                      onClick={() => setDraft((d) => ({ ...d, filters: d.filters.filter((_, j) => j !== i) }))}><X size={13} /></button>
                  </div>
                  {!known && (
                    <div style={{ fontSize: 11.5, color: '#9A6B00', marginTop: 3 }}>
                      This data doesn&apos;t exist in this project — the filter sees it empty.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <Button variant="secondary" size="sm" icon={Plus}
              onClick={() => setDraft((d) => ({ ...d, filters: [...d.filters, { source: 'column.physicalName', op: 'contains', text: '' }] }))}>
              Add filter
            </Button>
          </div>
          {editable && problems.length > 0 && <div style={{ fontSize: 12, color: '#C0392B' }}>{problems[0]}</div>}
        </fieldset>
      </div>
    </Dialog>
  );
}

/** Operadores del dato; uno guardado que no es de esa lista (p. ej. por API) se muestra igual. */
function opsShown(f: FilterDraft): { value: FilterDraft['op']; label: string }[] {
  const ops = filterOps(f.source);
  if (ops.some((o) => o.value === f.op)) return ops;
  return [...ops, filterOps('').find((o) => o.value === f.op) ?? { value: f.op, label: f.op }];
}

/** «1 filter» / «3 filters». */
export const filtersLabel = (n: number): string => `${n} filter${n === 1 ? '' : 's'}`;

/** Ayuda del switch de bloqueo según quién mira. */
function lockTitle(locked: boolean, isAdmin: boolean): string {
  if (isAdmin) return locked ? 'Locked: nobody can edit or delete it. Click to unlock.' : 'Lock it: nobody can edit or delete it, only use it.';
  return locked ? 'Locked by an admin: you can use it, but nobody can edit or delete it.' : 'Only an admin can lock a template.';
}

/** «yours» / «shared by ana» / «yours · shared». */
function ownerLabel(t: SheetTemplate, me: string | undefined): string {
  if (t.owner && t.owner === me) return t.shared ? 'yours · shared' : 'yours';
  return `shared by ${t.owner ?? 'someone else'}`;
}

const note: React.CSSProperties = { fontSize: 12, color: '#7A6220', background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 9, padding: '8px 11px' };
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#56607A' };
const listItem = (active: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'flex-start', border: `1px solid ${active ? '#2E5BFF' : '#E6EAF0'}`, background: active ? '#F4F7FF' : '#fff', borderRadius: 9 });
const listPick: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', padding: '8px 6px 8px 10px', border: 'none', background: 'transparent', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' };
const lockCell: React.CSSProperties = { flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '9px 10px 0 0' };
const lockSwitch = (on: boolean, off: boolean): React.CSSProperties => ({ width: 30, height: 17, borderRadius: 999, border: 'none', padding: 2, background: on ? '#2E5BFF' : '#C7CFDB', cursor: off ? 'default' : 'pointer', display: 'inline-flex', justifyContent: on ? 'flex-end' : 'flex-start', opacity: off ? 0.55 : 1, transition: 'background 0.15s' });
const lockKnob: React.CSSProperties = { width: 13, height: 13, borderRadius: '50%', background: '#fff', display: 'block' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#56607A' };
const hint: React.CSSProperties = { fontSize: 11.5, fontWeight: 400, color: '#8A93A5' };
const sectionTitle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginTop: 4 };
const iconBtn: React.CSSProperties = { width: 28, height: 28, border: '1px solid #E6EAF0', background: '#fff', borderRadius: 7, color: '#56607A', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
