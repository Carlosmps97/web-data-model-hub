import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import * as gov from '../services/governance.service';
import type { ParentDomain } from '../services/governance.service';

export default function DomainsPanel({ pushToast, canEdit }: { pushToast: (m: string, k?: 'err') => void; canEdit: boolean }) {
  const [items, setItems] = useState<ParentDomain[]>([]);
  const [editing, setEditing] = useState<ParentDomain | null>(null);
  const [form, setForm] = useState({ name: '', defaultDataType: '', description: '' });
  const [open, setOpen] = useState(false);

  const load = async () => { try { setItems(await gov.listDomains()); } catch { pushToast('No se pudieron cargar los dominios', 'err'); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => { setEditing(null); setForm({ name: '', defaultDataType: '', description: '' }); setOpen(true); };
  const startEdit = (d: ParentDomain) => { setEditing(d); setForm({ name: d.name, defaultDataType: d.defaultDataType, description: d.description ?? '' }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.defaultDataType.trim()) { pushToast('Nombre y tipo son obligatorios', 'err'); return; }
    const body = { name: form.name.trim(), defaultDataType: form.defaultDataType.trim(), description: form.description.trim() || undefined };
    try {
      if (editing) await gov.updateDomain(editing.id, body); else await gov.createDomain(body);
      setOpen(false); await load();
      pushToast(editing ? 'Dominio actualizado (cascada aplicada)' : 'Dominio creado');
    } catch { pushToast('No se pudo guardar', 'err'); }
  };
  const remove = async (d: ParentDomain) => {
    if (!confirm(`¿Eliminar el dominio "${d.name}"?`)) return;
    try { await gov.deleteDomain(d.id); await load(); pushToast('Dominio eliminado'); } catch { pushToast('No se pudo eliminar', 'err'); }
  };

  return (
    <div className="rd-card mc-panel">
      <div className="mc-cardhead">
        <span className="mc-cardlbl"><Icon name="layers" size={13} />Parent Domains</span>
        <span className="mc-pill">{items.length}</span>
        {canEdit && <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={startNew}><Icon name="plus" size={13} sw={2.6} />Nuevo</button>}
      </div>
      {open && (
        <div className="rd-card" style={{ padding: 10, margin: '8px 0', display: 'grid', gap: 6 }}>
          <input className="rd-input" placeholder="Nombre (ej. monto)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rd-input rd-mono" placeholder="Tipo por defecto (ej. decimal(24,4))" value={form.defaultDataType} onChange={(e) => setForm({ ...form, defaultDataType: e.target.value })} />
          <input className="rd-input" placeholder="Descripción (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="rd-btn rd-btn-primary rd-btn-sm" onClick={save}>Guardar</button>
          </div>
        </div>
      )}
      {!canEdit && <div className="rd-small" style={{ padding: '4px 2px', color: 'var(--muted)' }}>Vista publicada (read-only). Creá o seleccioná un changeset para editar.</div>}
      <div className="meta-list">
        {items.map((d) => (
          <div className="meta-item" key={d.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="meta-name">{d.name} <span className="rd-mono meta-dt">{d.defaultDataType}</span></div>
              <div className="meta-sub">{d.description || 'Sin descripción'}</div>
            </div>
            {canEdit && (
              <div className="meta-actions">
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => startEdit(d)}><Icon name="edit" size={13} /></button>
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => remove(d)}><Icon name="trash" size={12} style={{ color: 'var(--error)' }} /></button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>Sin dominios. Crea uno (ej. "monto" → decimal(24,4)).</div>}
      </div>
    </div>
  );
}
