'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Domain, ModelLevel } from '@/types/model';
import { SENSITIVITY_LEVELS } from '@/types/model';

const PALETTE = ['#0d9488', '#4f46e5', '#7c3aed', '#0e7490', '#b45309', '#be123c', '#475569', '#15803d'];

interface DomainModalProps {
  domain: Domain | null;
  layers: ModelLevel[];
  onClose: () => void;
  onSave: (domain: Domain, isNew: boolean) => void;
}

/** Create / edit a Domain (data product) — vertical, spans layers. */
export default function DomainModal({ domain, layers, onClose, onSave }: DomainModalProps) {
  const isNew = !domain;
  const [d, setD] = useState<Domain>(() =>
    domain
      ? { ...domain }
      : { id: '', name: '', color: '#0d9488', owner: '', steward: '', sensitivity: 'Internal', description: '', subdomains: [], layers: [] },
  );
  const [subInput, setSubInput] = useState('');

  const patch = (p: Partial<Domain>) => setD((s) => ({ ...s, ...p }));
  const toggleLayer = (id: string) =>
    setD((s) => ({ ...s, layers: s.layers.includes(id) ? s.layers.filter((x) => x !== id) : [...s.layers, id] }));
  const addSub = () => {
    const v = subInput.trim();
    if (!v || d.subdomains.includes(v)) return;
    patch({ subdomains: [...d.subdomains, v] });
    setSubInput('');
  };
  const submit = () => {
    const name = d.name.trim();
    if (!name) return;
    const id = d.id || name.toLowerCase().replace(/\s+/g, '_');
    onSave({ ...d, id, name }, isNew);
  };

  return (
    <Modal
      title={isNew ? 'Nuevo dominio' : 'Editar dominio'}
      subtitle="Producto de datos — vertical, abarca varias capas"
      icon="folder"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="rd-btn rd-btn-primary" disabled={!d.name.trim()} onClick={submit}>
            <Icon name="check" size={14} sw={2.6} />{isNew ? 'Crear dominio' : 'Guardar'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <span className="rd-label">Nombre</span>
          <input className="rd-input" value={d.name} placeholder="Ej. Finanzas" onChange={(e) => patch({ name: e.target.value })} autoFocus />
        </div>
        <div>
          <span className="rd-label">Color</span>
          <div style={{ display: 'flex', gap: 6, paddingTop: 4 }}>
            {PALETTE.map((c) => (
              <span key={c} onClick={() => patch({ color: c })} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: d.color === c ? '2px solid var(--ink)' : '2px solid transparent' }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><span className="rd-label">Owner</span><input className="rd-input" value={d.owner ?? ''} placeholder="Responsable" onChange={(e) => patch({ owner: e.target.value })} /></div>
        <div style={{ flex: 1 }}><span className="rd-label">Steward</span><input className="rd-input" value={d.steward ?? ''} placeholder="Data steward" onChange={(e) => patch({ steward: e.target.value })} /></div>
        <div style={{ width: 150 }}>
          <span className="rd-label">Sensibilidad</span>
          <div className="dmh-select">
            <select className="rd-input" value={d.sensitivity ?? 'Internal'} onChange={(e) => patch({ sensitivity: e.target.value as Domain['sensitivity'] })}>
              {SENSITIVITY_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Icon name="chevD" size={13} className="chev" />
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <span className="rd-label">Descripción</span>
        <textarea className="rd-input" style={{ minHeight: 56 }} value={d.description ?? ''} onChange={(e) => patch({ description: e.target.value })} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <span className="rd-label">Capas donde vive</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {layers.map((l) => (
            <button key={l.id} type="button" className={`dash-eng${d.layers.includes(l.id) ? ' on' : ''}`} onClick={() => toggleLayer(l.id)}>
              <span className="dot" style={{ background: l.color }} />{l.name}
            </button>
          ))}
          {layers.length === 0 && <span className="rd-small">Crea modelos (niveles) primero.</span>}
        </div>
      </div>
      <div>
        <span className="rd-label">Subdominios</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
          {d.subdomains.map((s) => (
            <span key={s} className="rd-badge rd-badge-neutral" style={{ paddingRight: 4 }}>
              {s}
              <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ width: 18, height: 18, padding: 0 }} onClick={() => patch({ subdomains: d.subdomains.filter((x) => x !== s) })}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
          {d.subdomains.length === 0 && <span className="rd-small">Aún no hay subdominios.</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="rd-input" style={{ flex: 1 }} value={subInput} placeholder="Añadir subdominio…" onChange={(e) => setSubInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }} />
          <button type="button" className="rd-btn rd-btn-secondary" onClick={addSub}><Icon name="plus" size={14} sw={2.6} />Añadir</button>
        </div>
      </div>
    </Modal>
  );
}
