'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Table, View, ViewType } from '@/types/model';

interface ViewFormProps {
  table: Table;
  view: View | null;
  onClose: () => void;
  onSave: (view: View, isNew: boolean) => void;
}

export default function ViewForm({ table, view, onClose, onSave }: ViewFormProps) {
  const [name, setName] = useState(view?.name ?? '');
  const [type, setType] = useState<ViewType>(view?.type ?? 'business');
  const [role, setRole] = useState(view?.role ?? '');
  const [select, setSelect] = useState(view?.select ?? table.columns.map((c) => c.name).join('\n'));
  const [where, setWhere] = useState(view?.where ?? '');

  const full = `${table.schema}.${table.name}`;
  const cols = select.split('\n').map((s) => s.trim()).filter(Boolean);
  // WHERE is a single free-text condition used verbatim (AND / OR / parens).
  const whereClause = where.trim();
  const preview = `CREATE VIEW ${table.schema}.${name || 'view_name'} AS\nSELECT\n  ${cols.join(',\n  ') || '*'}\nFROM ${full}${whereClause ? `\nWHERE ${whereClause}` : ''};`;
  const insertCol = (n: string) => setSelect((s) => (s && !s.endsWith('\n') ? s + '\n' : s) + n);
  const submit = () => { if (!name.trim()) return; onSave({ id: view?.id ?? uuidv4(), name: name.trim(), type, role: role || '—', select, where }, !view); };

  return (
    <Modal
      title={view ? 'Editar vista' : 'Nueva vista'}
      subtitle={`Proyección SQL por rol de ${full}`}
      icon="eye"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="rd-small left">{cols.length} expresiones{whereClause ? ' · con filtro WHERE' : ''}</span>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!name.trim()} onClick={submit}><Icon name="check" size={14} sw={2.6} />{view ? 'Guardar vista' : 'Crear vista'}</button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><span className="rd-label">Nombre de la vista</span><input className="rd-input" value={name} placeholder="vw_…" onChange={(e) => setName(e.target.value)} /></div>
        <div><span className="rd-label">Tipo</span>
          <div className="rd-seg"><button className={type === 'business' ? 'active' : ''} onClick={() => setType('business')}>Business</button><button className={type === 'technical' ? 'active' : ''} onClick={() => setType('technical')}>Technical</button></div>
        </div>
        <div style={{ width: 170 }}><span className="rd-label">Rol</span><input className="rd-input" value={role} placeholder="Analista, Engineer…" onChange={(e) => setRole(e.target.value)} /></div>
      </div>

      <div style={{ marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="rd-small" style={{ fontWeight: 700, color: 'var(--muted)' }}>Insertar columna:</span>
        {table.columns.map((c) => <button key={c.id} className="ve-chip" onClick={() => insertCol(c.name)}>{c.name}</button>)}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <span className="rd-label">SELECT <span style={{ textTransform: 'none', fontWeight: 500, color: 'var(--subtle)' }}>— una expresión por línea · CONCAT(), sha256(), CASE…</span></span>
          <textarea className="code-area light" style={{ minHeight: 150, fontSize: 12 }} value={select} spellCheck={false} onChange={(e) => setSelect(e.target.value)} />
        </div>
        <div style={{ width: 250 }}>
          <span className="rd-label">WHERE <span style={{ textTransform: 'none', fontWeight: 500, color: 'var(--subtle)' }}>— condición libre · AND / OR / ( )</span></span>
          <textarea className="code-area light" style={{ minHeight: 150, fontSize: 12 }} value={where} placeholder={"status = 'paid' AND (region = 'EU' OR region = 'LATAM')"} spellCheck={false} onChange={(e) => setWhere(e.target.value)} />
        </div>
      </div>

      <span className="rd-label">Preview</span>
      <textarea className="code-area ddl" style={{ minHeight: 116, fontSize: 11.5 }} value={preview} readOnly spellCheck={false} />
    </Modal>
  );
}
