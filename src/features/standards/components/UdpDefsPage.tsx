import { useEffect, useMemo, useState } from 'react';
import { Columns3, LayoutGrid, Plus, Table2, Tags, Trash2, X, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { applyStandards, type StandardsSnapshot, type UdpDataType, type UdpDefinition } from '../standards.service';
import { UDP_CLASS_SEGMENTS, udpView, type Facet, type UdpClassSegment } from '@/lib/facets';

/**
 * Data Standards → UDP (doc 71 §2). Las propiedades se organizan por OBJETO de
 * Erwin y, dentro de los dos objetos con dos caras, por FACETA:
 *
 *   Entity / Table        → Logical (Entity) · Physical (Table)
 *   Attribute / Column    → Logical (Attribute) · Physical (Column)
 *   View                  → siempre física (las vistas viven en el modelo físico, doc 63)
 *   Model                 → siempre física (UDP del canvas)
 *
 * Navegador de objetos a la izquierda (con conteos por faceta), switch de faceta
 * en la cabecera, lista + formulario a la derecha. Los homónimos lógico/físico
 * son definiciones DISTINTAS (doc 69); `UDP_CLASS_SEGMENTS` sigue siendo la
 * única fuente de (level, view, label).
 */

const TYPES: UdpDataType[] = ['string', 'number', 'boolean', 'date', 'list'];
const TYPE_LABEL: Record<UdpDataType, string> = { string: 'Text', number: 'Number', boolean: 'Boolean', date: 'Date', list: 'List' };
const NEW = '__new__';

type Form = { id?: string; name: string; dataType: UdpDataType; defaultValue: string; allowedValues: string[]; description: string };
const empty: Form = { name: '', dataType: 'string', defaultValue: '', allowedValues: [], description: '' };

/** Un objeto del navegador: sus segmentos (1 o 2 facetas). */
interface ObjectGroup {
  id: 'entity-table' | 'attribute-column' | 'view' | 'model';
  title: string;
  hint: string;
  icon: React.ReactNode;
  segments: UdpClassSegment[];       // [logical, physical] o [physical]
}

const seg = (id: UdpClassSegment['id']) => UDP_CLASS_SEGMENTS.find((s) => s.id === id)!;
const GROUPS: ObjectGroup[] = [
  { id: 'entity-table', title: 'Entity / Table', hint: 'The same object seen in the Logical (entity) and Physical (table) models.',
    icon: <Table2 size={16} />, segments: [seg('entity'), seg('table')] },
  { id: 'attribute-column', title: 'Attribute / Column', hint: 'The same object seen in the Logical (attribute) and Physical (column) models.',
    icon: <Columns3 size={16} />, segments: [seg('attribute'), seg('column')] },
  { id: 'view', title: 'View', hint: 'Views belong to the physical model only.',
    icon: <Eye size={16} />, segments: [seg('view')] },
  { id: 'model', title: 'Model', hint: 'Properties of the data model (canvas) itself.',
    icon: <LayoutGrid size={16} />, segments: [seg('model')] },
];

const FACET_INFO: Record<Facet, { title: string; where: string }> = {
  logical: { title: 'Logical facet', where: 'Shown in the canvas when the Logical/Physical switch is on Logical, and in the Reporting as “(Logical)”.' },
  physical: { title: 'Physical facet', where: 'Shown in the canvas when the switch is on Physical. DDL export rules only read this facet.' },
};

const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 11px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1A2B4A', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: '#6B7486', marginBottom: 5, display: 'block' };
const cap: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' };

export default function UdpDefsPage({ projectId, snapshot, canEdit, onApplied }: { projectId: string; snapshot: StandardsSnapshot; canEdit: boolean; onApplied: () => Promise<void> }) {
  const [groupId, setGroupId] = useState<ObjectGroup['id']>('attribute-column');
  const [facet, setFacet] = useState<Facet>('physical');
  const group = GROUPS.find((g) => g.id === groupId) ?? GROUPS[1];
  // El segmento activo = objeto × faceta (los objetos de una sola cara ignoran el switch).
  const segment = group.segments.length === 2
    ? group.segments.find((s) => s.view === facet) ?? group.segments[1]
    : group.segments[0];
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<UdpDefinition | null>(null);

  const all = useMemo(() => snapshot.udp ?? [], [snapshot.udp]);
  const countOf = (s: UdpClassSegment) => all.filter((d) => d.level === s.level && udpView(d) === s.view).length;
  const defs = useMemo(
    () => all.filter((d) => d.level === segment.level && udpView(d) === segment.view)
      .slice().sort((a, b) => a.name.localeCompare(b.name)),
    [all, segment],
  );
  const editing = selId != null;

  useEffect(() => { setSelId(null); }, [groupId, facet]);   // cambiar de objeto/faceta limpia la selección
  useEffect(() => {
    if (selId === NEW) setForm(empty);
    else if (selId) {
      const d = defs.find((x) => x.id === selId);
      if (d) setForm({ id: d.id, name: d.name, dataType: d.dataType, defaultValue: d.defaultValue ?? '', allowedValues: [...d.allowedValues], description: d.description ?? '' });
    }
  }, [selId, defs]);

  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    if (!form.name.trim()) { toast.error('The name is required'); return; }
    setBusy(true);
    try {
      const v = await applyStandards(projectId, {
        kind: 'udp', title: `UDP ${form.name.trim()}`,
        udpUpsert: [{
          id: selId === NEW ? undefined : form.id, name: form.name.trim(), level: segment.level, view: segment.view, dataType: form.dataType,
          defaultValue: form.defaultValue.trim() || undefined,
          allowedValues: form.dataType === 'list' ? form.allowedValues.map((x) => x.trim()).filter(Boolean) : [],
          description: form.description.trim() || undefined,
        }],
      });
      toast.success(`Applied · ${v.label}`);
      setSelId(null); await onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't apply"); } finally { setBusy(false); }
  };

  const doDelete = async (d: UdpDefinition) => {
    setBusy(true);
    try {
      const v = await applyStandards(projectId, { kind: 'udp', title: `Remove UDP ${d.name}`, udpDelete: [d.id] });
      toast.success(`Applied · ${v.label}`);
      setConfirmDel(null); if (selId === d.id) setSelId(null); await onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete"); } finally { setBusy(false); }
  };

  const twoFaced = group.segments.length === 2;
  const facetOf = (s: UdpClassSegment) => (s.view === 'logical' ? 'Logical' : 'Physical');

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* ── Navegador de objetos ── */}
      <aside style={{ width: 268, flex: 'none', borderRight: '1px solid #EAEDF2', background: '#FBFCFD', padding: '18px 14px', overflowY: 'auto' }}>
        <div style={{ ...cap, padding: '0 6px', marginBottom: 10 }}>Objects</div>
        {GROUPS.map((g) => {
          const on = g.id === groupId;
          const total = g.segments.reduce((n, s) => n + countOf(s), 0);
          return (
            <button key={g.id} type="button" onClick={() => setGroupId(g.id)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', textAlign: 'left', padding: '11px 12px', marginBottom: 8, border: `1px solid ${on ? '#2E5BFF' : '#E6EAF0'}`, background: on ? '#F4F7FF' : '#fff', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', boxShadow: on ? '0 0 0 3px rgba(46,91,255,0.10)' : '0 1px 2px rgba(16,27,48,0.04)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? '#2E5BFF' : '#EEF2FA', color: on ? '#fff' : '#3F5DAA' }}>{g.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1A2B4A' }}>{g.title}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#8A93A5', fontFamily: 'var(--mono, monospace)' }}>{total}</span>
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: '#6B7486', lineHeight: 1.4, marginTop: 2 }}>{g.hint}</span>
                <span style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                  {g.segments.map((s) => (
                    <span key={s.id} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: s.view === 'logical' ? '#F3EEFF' : '#E7F0FF', color: s.view === 'logical' ? '#6D3FC4' : '#1F4FD8' }}>
                      {twoFacedOf(g) ? `${facetOf(s)} · ${countOf(s)}` : `${countOf(s)} propert${countOf(s) === 1 ? 'y' : 'ies'}`}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
        <div style={{ margin: '14px 6px 0', fontSize: 11.5, color: '#8A93A5', lineHeight: 1.5 }}>
          Entity/Table and Attribute/Column are one object with two facets — pick the facet in the header. Homonyms across facets are separate properties.
        </div>
      </aside>

      {/* ── Objeto seleccionado ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px', borderBottom: '1px solid #EAEDF2', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={cap}>User Defined Properties</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1A2B4A', marginTop: 2 }}>{segment.label}</div>
          </div>
          {twoFaced && (
            <div className="rd-seg" role="tablist" aria-label="Facet">
              {group.segments.map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={s.view === facet} className={s.view === facet ? 'active' : ''} onClick={() => setFacet(s.view)}>
                  {s.view === 'logical' ? `Logical · ${s.label.split(' (')[0]}` : `Physical · ${s.label.split(' (')[0]}`} <span style={{ opacity: .6 }}>({countOf(s)})</span>
                </button>
              ))}
            </div>
          )}
          <span style={{ flex: 1 }} />
          {canEdit && <button onClick={() => setSelId(NEW)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', border: '1px solid #2E5BFF', background: '#2E5BFF', color: '#fff', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Plus size={13} />New property</button>}
        </div>
        <div style={{ flex: 'none', padding: '8px 24px', fontSize: 12, color: '#6B7486', background: segment.view === 'logical' ? '#FAF7FF' : '#F7FAFF', borderBottom: '1px solid #EAEDF2' }}>
          <b style={{ color: segment.view === 'logical' ? '#6D3FC4' : '#1F4FD8' }}>{FACET_INFO[segment.view].title}.</b> {FACET_INFO[segment.view].where}
          {!twoFaced && ' This object has a single facet.'}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* lista */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#8A93A5', fontSize: 11.5, fontWeight: 600 }}>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid #EAEDF2' }}>Name</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid #EAEDF2', width: 90 }}>Type</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid #EAEDF2' }}>Default / values</th>
                  {canEdit && <th style={{ borderBottom: '1px solid #EAEDF2', width: 36 }} />}
                </tr>
              </thead>
              <tbody>
                {defs.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '18px 8px', color: '#9AA3B2' }}>
                    No properties for <b>{segment.label}</b> yet. {canEdit && 'Create one with “New property”.'}
                  </td></tr>
                )}
                {defs.map((d) => (
                  <tr key={d.id} onClick={() => setSelId(d.id)} style={{ cursor: 'pointer', background: selId === d.id ? '#F5F8FF' : 'transparent' }}>
                    <td style={{ padding: '9px 8px', borderBottom: '1px solid #F0F2F6', color: '#1A2B4A', fontWeight: 500 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Tags size={12} color={segment.view === 'logical' ? '#7A4DD6' : '#2E5BFF'} />{d.name}</span>
                    </td>
                    <td style={{ padding: '9px 8px', borderBottom: '1px solid #F0F2F6', color: '#48526A' }}>{TYPE_LABEL[d.dataType]}</td>
                    <td style={{ padding: '9px 8px', borderBottom: '1px solid #F0F2F6', color: '#6B7486' }}>
                      {d.dataType === 'list'
                        ? <span title={d.allowedValues.join(', ')}>{d.allowedValues.slice(0, 4).join(', ')}{d.allowedValues.length > 4 ? ` +${d.allowedValues.length - 4}` : ''}{d.defaultValue ? <span style={{ color: '#9AA3B2' }}> · default {d.defaultValue}</span> : ''}</span>
                        : (d.defaultValue || '—')}
                    </td>
                    {canEdit && <td style={{ padding: '9px 4px', borderBottom: '1px solid #F0F2F6' }}>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDel(d); }} title="Delete" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={14} /></button>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* formulario */}
          {editing && (
            <div style={{ width: 400, flex: 'none', borderLeft: '1px solid #EAEDF2', overflowY: 'auto', padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1A2B4A', flex: 1 }}>{selId === NEW ? 'New property' : form.name}</h3>
                <button onClick={() => setSelId(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9AA3B2' }}><X size={18} /></button>
              </div>
              <div style={{ fontSize: 11.5, color: '#8A93A5', marginBottom: 16 }}>{segment.label}</div>
              <fieldset disabled={!canEdit || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
                <div style={{ marginBottom: 14 }}><label style={lbl}>Name</label><input style={inp} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Clasificación del Dato" /></div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Type</label>
                    <select style={inp} value={form.dataType} onChange={(e) => set({ dataType: e.target.value as UdpDataType })}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
                  </div>
                  <div style={{ flex: 1 }}><label style={lbl}>Default</label>
                    {form.dataType === 'list'
                      ? <select style={inp} value={form.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })}><option value="">—</option>{form.allowedValues.map((v) => v.trim()).filter(Boolean).map((v) => <option key={v} value={v}>{v}</option>)}</select>
                      : <input style={inp} value={form.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })} placeholder="optional" />}
                  </div>
                </div>
                {form.dataType === 'list' && (
                  <div style={{ marginBottom: 14 }}><label style={lbl}>Allowed values (one per line)</label>
                    <textarea style={{ ...inp, height: 96, padding: 9, resize: 'vertical' }} value={form.allowedValues.join('\n')} onChange={(e) => set({ allowedValues: e.target.value.split('\n') })} placeholder={'No Definido\nDAC\nNo DAC'} />
                  </div>
                )}
                <div style={{ marginBottom: 18 }}><label style={lbl}>Description</label><textarea style={{ ...inp, height: 64, padding: 9, resize: 'vertical' }} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="optional" /></div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={save} disabled={busy} style={{ height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Applying…' : 'Save & apply'}</button>
                    {selId !== NEW && form.id && <button onClick={() => setConfirmDel(defs.find((x) => x.id === form.id) ?? null)} disabled={busy} style={{ height: 38, padding: '0 14px', border: '1px solid #E5B4B4', background: '#fff', color: '#C0392B', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trash2 size={14} />Delete</button>}
                  </div>
                )}
              </fieldset>
            </div>
          )}
        </div>
      </div>

      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,45,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#1A2B4A' }}>Delete «{confirmDel.name}»</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#6B7486' }}>Recorded as a new version. Values already assigned become orphaned (they are ignored).</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDel(null)} style={{ height: 36, padding: '0 16px', border: '1px solid #DCE1EA', background: '#fff', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => doDelete(confirmDel)} disabled={busy} style={{ height: 36, padding: '0 16px', border: 'none', background: '#C0392B', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const twoFacedOf = (g: ObjectGroup) => g.segments.length === 2;
