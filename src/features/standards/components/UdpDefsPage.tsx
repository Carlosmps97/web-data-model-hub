import { useEffect, useMemo, useState } from 'react';
import { Plus, Tags, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { applyStandards, type StandardsSnapshot, type UdpDataType, type UdpDefinition, type UdpLevel } from '../standards.service';

const TYPES: UdpDataType[] = ['string', 'number', 'boolean', 'date', 'list'];
// Niveles (Class). Segmentado: cada UDP pertenece a UNO. 'canvas' = el Modelo
// de Datos completo (F5); extensible a más jerarquías agregando entradas acá.
const LEVELS: { id: UdpLevel; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'column', label: 'Column' },
  { id: 'canvas', label: 'Model' },
];
const LEVEL_NOUN: Record<UdpLevel, string> = { table: 'Table', column: 'Column', canvas: 'Data Model' };
const TYPE_LABEL: Record<UdpDataType, string> = { string: 'Text', number: 'Number', boolean: 'Boolean', date: 'Date', list: 'List' };
const NEW = '__new__';

type Form = { id?: string; name: string; dataType: UdpDataType; defaultValue: string; allowedValues: string[]; description: string };
const empty: Form = { name: '', dataType: 'string', defaultValue: '', allowedValues: [], description: '' };

const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 11px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1A2B4A', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: '#6B7486', marginBottom: 5, display: 'block' };

export default function UdpDefsPage({ snapshot, canEdit, onApplied }: { snapshot: StandardsSnapshot; canEdit: boolean; onApplied: () => Promise<void> }) {
  const [level, setLevel] = useState<UdpLevel>('column');
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<UdpDefinition | null>(null);

  // UDPs del nivel (Class) seleccionado.
  const defs = useMemo(() => (snapshot.udp ?? []).filter((d) => d.level === level), [snapshot.udp, level]);
  const editing = selId != null;

  useEffect(() => { setSelId(null); }, [level]);   // cambiar de Class limpia la selección
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
      const v = await applyStandards({
        kind: 'udp', title: `UDP ${form.name.trim()}`,
        udpUpsert: [{
          id: selId === NEW ? undefined : form.id, name: form.name.trim(), level, dataType: form.dataType,
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
      const v = await applyStandards({ kind: 'udp', title: `Remove UDP ${d.name}`, udpDelete: [d.id] });
      toast.success(`Applied · ${v.label}`);
      setConfirmDel(null); if (selId === d.id) setSelId(null); await onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete"); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* barra: Class (nivel) + New */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid #EAEDF2' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#6B7486' }}>Class</span>
        <div style={{ display: 'inline-flex', border: '1px solid #DCE1EA', borderRadius: 9, overflow: 'hidden' }}>
          {LEVELS.map((lv) => (
            <button key={lv.id} onClick={() => setLevel(lv.id)}
              style={{ height: 32, padding: '0 16px', border: 'none', background: level === lv.id ? '#2E5BFF' : '#fff', color: level === lv.id ? '#fff' : '#48526A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {lv.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: '#9AA3B2' }}>User Defined Properties at the <b>{LEVEL_NOUN[level]}</b> level</span>
        <span style={{ flex: 1 }} />
        {canEdit && <button onClick={() => setSelId(NEW)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', border: '1px solid #2E5BFF', background: '#2E5BFF', color: '#fff', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}><Plus size={13} />New property</button>}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* tabla Name / Type / Default */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#8A93A5', fontSize: 11.5, fontWeight: 600 }}>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #EAEDF2' }}>Name</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #EAEDF2', width: 90 }}>Type</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #EAEDF2' }}>Default</th>
                {canEdit && <th style={{ borderBottom: '1px solid #EAEDF2', width: 36 }} />}
              </tr>
            </thead>
            <tbody>
              {defs.length === 0 && <tr><td colSpan={4} style={{ padding: '16px 8px', color: '#9AA3B2' }}>No properties for this level. {canEdit && 'Create one with “New property”.'}</td></tr>}
              {defs.map((d) => (
                <tr key={d.id} onClick={() => setSelId(d.id)} style={{ cursor: 'pointer', background: selId === d.id ? '#F5F8FF' : 'transparent' }}>
                  <td style={{ padding: '9px 8px', borderBottom: '1px solid #F0F2F6', color: '#1A2B4A', fontWeight: 500 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Tags size={12} color="#7A4DD6" />{d.name}</span>
                  </td>
                  <td style={{ padding: '9px 8px', borderBottom: '1px solid #F0F2F6', color: '#48526A' }}>{TYPE_LABEL[d.dataType]}</td>
                  <td style={{ padding: '9px 8px', borderBottom: '1px solid #F0F2F6', color: '#6B7486' }}>
                    {d.dataType === 'list' ? (d.allowedValues.join(', ') || '—') : (d.defaultValue || '—')}
                  </td>
                  {canEdit && <td style={{ padding: '9px 4px', borderBottom: '1px solid #F0F2F6' }}>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDel(d); }} title="Delete" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#C0392B' }}><Trash2 size={14} /></button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Details / form */}
        {editing && (
          <div style={{ width: 400, flex: 'none', borderLeft: '1px solid #EAEDF2', overflowY: 'auto', padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1A2B4A', flex: 1 }}>{selId === NEW ? `New property · ${LEVEL_NOUN[level]}` : form.name}</h3>
              <button onClick={() => setSelId(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9AA3B2' }}><X size={18} /></button>
            </div>
            <fieldset disabled={!canEdit || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div style={{ marginBottom: 14 }}><label style={lbl}>Name</label><input style={inp} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Clasificación del Dato" /></div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}><label style={lbl}>Type</label>
                  <select style={inp} value={form.dataType} onChange={(e) => set({ dataType: e.target.value as UdpDataType })}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
                </div>
                <div style={{ flex: 1 }}><label style={lbl}>Default</label>
                  {form.dataType === 'list'
                    ? <select style={inp} value={form.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })}><option value="">—</option>{form.allowedValues.map((v) => v.trim()).filter(Boolean).map((v) => <option key={v} value={v}>{v}</option>)}</select>
                    : <input style={inp} value={form.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })} placeholder="opcional" />}
                </div>
              </div>
              {form.dataType === 'list' && (
                <div style={{ marginBottom: 14 }}><label style={lbl}>Allowed values (one per line)</label>
                  <textarea style={{ ...inp, height: 96, padding: 9, resize: 'vertical' }} value={form.allowedValues.join('\n')} onChange={(e) => set({ allowedValues: e.target.value.split('\n') })} placeholder={'No Definido\nDAC\nNo DAC'} />
                </div>
              )}
              <div style={{ marginBottom: 18 }}><label style={lbl}>Description</label><textarea style={{ ...inp, height: 64, padding: 9, resize: 'vertical' }} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="opcional" /></div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={save} disabled={busy} style={{ height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Aplicando…' : 'Save & apply'}</button>
                  {selId !== NEW && form.id && <button onClick={() => setConfirmDel(defs.find((x) => x.id === form.id) ?? null)} disabled={busy} style={{ height: 38, padding: '0 14px', border: '1px solid #E5B4B4', background: '#fff', color: '#C0392B', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trash2 size={14} />Delete</button>}
                </div>
              )}
            </fieldset>
          </div>
        )}
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
