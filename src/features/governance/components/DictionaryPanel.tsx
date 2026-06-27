import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import * as gov from '../services/governance.service';
import type { Abbreviation } from '../services/governance.service';

export default function DictionaryPanel({ pushToast, canEdit }: { pushToast: (m: string, k?: 'err') => void; canEdit: boolean }) {
  const [items, setItems] = useState<Abbreviation[]>([]);
  const [editing, setEditing] = useState<Abbreviation | null>(null);
  const [form, setForm] = useState({ term: '', abbrev: '' });
  const [open, setOpen] = useState(false);
  const [probe, setProbe] = useState('');
  const [physical, setPhysical] = useState('');

  const load = async () => { try { setItems(await gov.listAbbrev()); } catch { pushToast('No se pudo cargar el diccionario', 'err'); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => { setEditing(null); setForm({ term: '', abbrev: '' }); setOpen(true); };
  const startEdit = (a: Abbreviation) => { setEditing(a); setForm({ term: a.term, abbrev: a.abbrev }); setOpen(true); };
  const save = async () => {
    if (!form.term.trim() || !form.abbrev.trim()) { pushToast('Término y abreviatura son obligatorios', 'err'); return; }
    const body = { term: form.term.trim(), abbrev: form.abbrev.trim() };
    try {
      if (editing) await gov.updateAbbrev(editing.id, body); else await gov.createAbbrev(body);
      setOpen(false); await load(); pushToast(editing ? 'Abreviatura actualizada' : 'Abreviatura creada');
    } catch { pushToast('No se pudo guardar', 'err'); }
  };
  const remove = async (a: Abbreviation) => {
    if (!confirm(`¿Eliminar "${a.term} → ${a.abbrev}"?`)) return;
    try { await gov.deleteAbbrev(a.id); await load(); pushToast('Abreviatura eliminada'); } catch { pushToast('No se pudo eliminar', 'err'); }
  };
  const runProbe = async () => {
    if (!probe.trim()) { setPhysical(''); return; }
    try { setPhysical((await gov.physicalize(probe.trim())).physical); } catch { pushToast('No se pudo convertir', 'err'); }
  };

  return (
    <div className="rd-card mc-panel">
      <div className="mc-cardhead">
        <span className="mc-cardlbl"><Icon name="bolt" size={13} />UDP (lógico → físico)</span>
        <span className="mc-pill">{items.length}</span>
        {canEdit && <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={startNew}><Icon name="plus" size={13} sw={2.6} />Nuevo</button>}
      </div>

      <div className="rd-card" style={{ padding: 10, margin: '8px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input className="rd-input" placeholder="Nombre lógico (ej. monto deuda dólares)" value={probe} onChange={(e) => setProbe(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runProbe(); }} style={{ flex: 1 }} />
        <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={runProbe}>Convertir</button>
        {physical && <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{physical}</span>}
      </div>

      {open && (
        <div className="rd-card" style={{ padding: 10, margin: '8px 0', display: 'grid', gap: 6 }}>
          <input className="rd-input" placeholder="Término (ej. monto)" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
          <input className="rd-input rd-mono" placeholder="Abreviatura (ej. MTO)" value={form.abbrev} onChange={(e) => setForm({ ...form, abbrev: e.target.value })} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="rd-btn rd-btn-primary rd-btn-sm" onClick={save}>Guardar</button>
          </div>
        </div>
      )}
      {!canEdit && <div className="rd-small" style={{ padding: '4px 2px', color: 'var(--muted)' }}>Vista publicada (read-only). Creá o seleccioná un changeset para editar.</div>}
      <div className="meta-list">
        {items.map((a) => (
          <div className="meta-item" key={a.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="meta-name">{a.term} <span className="rd-mono meta-dt">{a.abbrev}</span></div>
            </div>
            {canEdit && (
              <div className="meta-actions">
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => startEdit(a)}><Icon name="edit" size={13} /></button>
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => remove(a)}><Icon name="trash" size={12} style={{ color: 'var(--error)' }} /></button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>Sin abreviaturas. Crea una (ej. "monto → MTO").</div>}
      </div>
    </div>
  );
}
