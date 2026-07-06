import { useEffect, useMemo, useState } from 'react';
import { Plus, Tags, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { applyStandards, type StandardsSnapshot, type UdpDataType, type UdpDefinition, type UdpLevel } from '../standards.service';

const TYPES: UdpDataType[] = ['string', 'number', 'boolean', 'date', 'list'];
const LEVELS: UdpLevel[] = ['table', 'column'];
const NEW = '__new__';

type Form = { id?: string; name: string; dataType: UdpDataType; defaultValue: string; allowedValues: string[]; appliesTo: UdpLevel[]; description: string };
const empty: Form = { name: '', dataType: 'string', defaultValue: '', allowedValues: [], appliesTo: ['table', 'column'], description: '' };

const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 11px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1A2B4A', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: '#6B7486', marginBottom: 5, display: 'block' };

export default function UdpDefsPage({ snapshot, canEdit, onApplied }: { snapshot: StandardsSnapshot; canEdit: boolean; onApplied: () => Promise<void> }) {
  const defs = useMemo(() => snapshot.udp ?? [], [snapshot.udp]);
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<UdpDefinition | null>(null);

  const editing = selId != null;
  useEffect(() => {
    if (selId === NEW) setForm(empty);
    else if (selId) {
      const d = defs.find((x) => x.id === selId);
      if (d) setForm({ id: d.id, name: d.name, dataType: d.dataType, defaultValue: d.defaultValue ?? '', allowedValues: [...d.allowedValues], appliesTo: [...d.appliesTo], description: d.description ?? '' });
    }
  }, [selId, defs]);

  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const toggleLevel = (lv: UdpLevel) => set({ appliesTo: form.appliesTo.includes(lv) ? form.appliesTo.filter((x) => x !== lv) : [...form.appliesTo, lv] });

  const save = async () => {
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return; }
    if (form.appliesTo.length === 0) { toast.error('Elegí al menos un nivel (tabla o columna)'); return; }
    setBusy(true);
    try {
      const v = await applyStandards({
        kind: 'udp', title: `UDP ${form.name.trim()}`,
        udpUpsert: [{
          id: selId === NEW ? undefined : form.id, name: form.name.trim(), dataType: form.dataType,
          defaultValue: form.defaultValue.trim() || undefined,
          allowedValues: form.dataType === 'list' ? form.allowedValues.map((x) => x.trim()).filter(Boolean) : [],
          appliesTo: form.appliesTo, description: form.description.trim() || undefined,
        }],
      });
      toast.success(`Applied · ${v.label}`);
      setSelId(null); await onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo aplicar'); } finally { setBusy(false); }
  };

  const doDelete = async (d: UdpDefinition) => {
    setBusy(true);
    try {
      const v = await applyStandards({ kind: 'udp', title: `Remove UDP ${d.name}`, udpDelete: [d.id] });
      toast.success(`Applied · ${v.label}`);
      setConfirmDel(null); if (selId === d.id) setSelId(null); await onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo eliminar'); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* lista */}
      <div style={{ width: 320, flex: 'none', borderRight: '1px solid #EAEDF2', overflowY: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B4A', flex: 1 }}>User Defined Properties</div>
          {canEdit && <button onClick={() => setSelId(NEW)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px', border: '1px solid #2E5BFF', background: '#2E5BFF', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}><Plus size={13} />New</button>}
        </div>
        {defs.length === 0 && <div style={{ fontSize: 12.5, color: '#9AA3B2', padding: '8px 2px' }}>Aún no hay propiedades definidas.</div>}
        {defs.map((d) => (
          <button key={d.id} onClick={() => setSelId(d.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', textAlign: 'left', gap: 3, padding: '10px 11px', marginBottom: 6, border: `1px solid ${selId === d.id ? '#2E5BFF' : '#EAEDF2'}`, background: selId === d.id ? '#F5F8FF' : '#fff', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#1A2B4A' }}><Tags size={13} color="#7A4DD6" />{d.name}</span>
            <span style={{ fontSize: 11, color: '#8A93A5' }}>{d.dataType}{d.dataType === 'list' && d.allowedValues.length ? ` · ${d.allowedValues.length} opciones` : ''} · {d.appliesTo.join(', ')}</span>
          </button>
        ))}
      </div>

      {/* detalle / form */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 24 }}>
        {!editing ? (
          <div style={{ color: '#9AA3B2', fontSize: 13, marginTop: 40, textAlign: 'center' }}>Elegí una propiedad o creá una nueva para clasificar el dato.</div>
        ) : (
          <div style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A', flex: 1 }}>{selId === NEW ? 'Nueva propiedad' : form.name}</h2>
              <button onClick={() => setSelId(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9AA3B2' }}><X size={18} /></button>
            </div>
            <fieldset disabled={!canEdit || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div style={{ marginBottom: 14 }}><label style={lbl}>Nombre (key)</label><input style={inp} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="ej. Clasificación del Dato" /></div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}><label style={lbl}>Tipo de dato</label>
                  <select style={inp} value={form.dataType} onChange={(e) => set({ dataType: e.target.value as UdpDataType })}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                </div>
                <div style={{ flex: 1 }}><label style={lbl}>Valor por defecto</label><input style={inp} value={form.defaultValue} onChange={(e) => set({ defaultValue: e.target.value })} placeholder="opcional" /></div>
              </div>
              {form.dataType === 'list' && (
                <div style={{ marginBottom: 14 }}><label style={lbl}>Valores permitidos (uno por línea)</label>
                  <textarea style={{ ...inp, height: 96, padding: 9, resize: 'vertical' }} value={form.allowedValues.join('\n')} onChange={(e) => set({ allowedValues: e.target.value.split('\n') })} placeholder={'DAC\nNO DAC\nSensible'} />
                </div>
              )}
              <div style={{ marginBottom: 14 }}><label style={lbl}>Aplica a</label>
                <div style={{ display: 'flex', gap: 10 }}>{LEVELS.map((lv) => (
                  <label key={lv} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#1A2B4A', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.appliesTo.includes(lv)} onChange={() => toggleLevel(lv)} />{lv === 'table' ? 'Tabla' : 'Columna'}
                  </label>
                ))}</div>
              </div>
              <div style={{ marginBottom: 18 }}><label style={lbl}>Descripción</label><textarea style={{ ...inp, height: 60, padding: 9, resize: 'vertical' }} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="opcional" /></div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={save} disabled={busy} style={{ height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Aplicando…' : 'Save & apply'}</button>
                  {selId !== NEW && form.id && <button onClick={() => setConfirmDel(defs.find((x) => x.id === form.id) ?? null)} disabled={busy} style={{ height: 38, padding: '0 14px', border: '1px solid #E5B4B4', background: '#fff', color: '#C0392B', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Trash2 size={14} />Eliminar</button>}
                </div>
              )}
            </fieldset>
          </div>
        )}
      </div>

      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,28,45,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={() => setConfirmDel(null)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#1A2B4A' }}>Eliminar «{confirmDel.name}»</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#6B7486' }}>Se registra como una versión nueva. Los valores ya asignados en tablas/columnas quedan como huérfanos (se ignoran).</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDel(null)} style={{ height: 36, padding: '0 16px', border: '1px solid #DCE1EA', background: '#fff', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => doDelete(confirmDel)} disabled={busy} style={{ height: 36, padding: '0 16px', border: 'none', background: '#C0392B', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
