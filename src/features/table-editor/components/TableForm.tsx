'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Table, ModelLevel, Domain } from '@/types/model';

interface TableFormProps {
  table: Table | null;
  layers: ModelLevel[];
  domains: Domain[];
  onClose: () => void;
  onSave: (table: Table, isNew: boolean) => void;
}

export default function TableForm({ table, layers, domains, onClose, onSave }: TableFormProps) {
  const isNew = !table;
  const [d, setD] = useState<Table>(() =>
    table
      ? structuredClone(table)
      : {
          id: uuidv4(), name: '', logicalName: '', schema: layers[0]?.id ?? '',
          layer: layers[0]?.id, domain: undefined, subdomain: '', color: '#4f46e5',
          functionalDefinition: '', columns: [], views: [],
        },
  );

  const patch = (p: Partial<Table>) => setD((s) => ({ ...s, ...p }));
  const setCol = (i: number, p: Partial<Table['columns'][number]>) =>
    setD((s) => ({ ...s, columns: s.columns.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const toggleKey = (i: number, key: 'pk' | 'fk' | 'sk') => {
    const c = d.columns[i];
    if (key === 'pk') setCol(i, { isPrimaryKey: !c.isPrimaryKey });
    else if (key === 'fk') setCol(i, { isForeignKey: !c.isForeignKey });
    else setCol(i, { isSurrogateKey: !c.isSurrogateKey });
  };
  const addCol = () => setD((s) => ({ ...s, columns: [...s.columns, { id: uuidv4(), name: '', dataType: 'varchar', isNullable: true }] }));
  const delCol = (i: number) => setD((s) => ({ ...s, columns: s.columns.filter((_, j) => j !== i) }));

  const domain = d.domain ? domains.find((x) => x.id === d.domain) : undefined;
  const submit = () => { if (!d.name.trim()) return; onSave({ ...d, name: d.name.trim() }, isNew); };

  return (
    <Modal
      title={isNew ? 'Nueva tabla' : 'Editar tabla'}
      subtitle="Define columnas, claves y tipos"
      icon="table"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="rd-small left">El toggle a la derecha de cada fila es Nullable</span>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!d.name.trim()} onClick={submit}><Icon name="check" size={14} sw={2.6} />{isNew ? 'Crear tabla' : 'Guardar tabla'}</button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><span className="rd-label">Nombre de tabla</span><input className="rd-input" value={d.name} placeholder="ej. h_saldocontable" onChange={(e) => patch({ name: e.target.value })} /></div>
        <div style={{ width: 120 }}><span className="rd-label">Schema</span><input className="rd-input" value={d.schema ?? ''} onChange={(e) => patch({ schema: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 160 }}>
          <span className="rd-label">Modelo (capa)</span>
          <div className="dmh-select">
            <select className="rd-input" value={d.layer ?? ''} onChange={(e) => patch({ layer: e.target.value || undefined })}>
              <option value="">— Ninguno</option>
              {layers.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.full}</option>)}
            </select>
            <Icon name="chevD" size={13} className="chev" />
          </div>
        </div>
        <div style={{ width: 160 }}>
          <span className="rd-label">Dominio</span>
          <div className="dmh-select">
            <select className="rd-input" value={d.domain ?? ''} onChange={(e) => { const dm = domains.find((x) => x.id === e.target.value); patch({ domain: e.target.value || undefined, color: dm?.color ?? d.color }); }}>
              <option value="">— Ninguno</option>
              {domains.map((dm) => <option key={dm.id} value={dm.id}>{dm.name}</option>)}
            </select>
            <Icon name="chevD" size={13} className="chev" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <span className="rd-label">Subdominio</span>
          {domain && domain.subdomains.length ? (
            <div className="dmh-select">
              <select className="rd-input" value={d.subdomain ?? ''} onChange={(e) => patch({ subdomain: e.target.value })}>
                <option value="">—</option>
                {domain.subdomains.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Icon name="chevD" size={13} className="chev" />
            </div>
          ) : (
            <input className="rd-input" value={d.subdomain ?? ''} placeholder="opcional" onChange={(e) => patch({ subdomain: e.target.value })} />
          )}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}><span className="rd-label">Definición</span><input className="rd-input" value={d.functionalDefinition ?? ''} placeholder="Qué representa esta tabla" onChange={(e) => patch({ functionalDefinition: e.target.value })} /></div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span className="rd-label" style={{ margin: 0 }}>Columnas · {d.columns.length}</span>
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={addCol}><Icon name="plus" size={13} sw={2.6} />Añadir columna</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {d.columns.length === 0 && <div className="rd-small" style={{ padding: '14px 0', textAlign: 'center' }}>Sin columnas — añade una para empezar.</div>}
        {d.columns.map((c, i) => (
          <div className="ce-row" key={c.id}>
            <Icon name="dots" size={14} style={{ color: 'var(--subtle)', flexShrink: 0 }} />
            <input className="rd-input" style={{ flex: 1, padding: '6px 9px' }} value={c.name} placeholder="columna" onChange={(e) => setCol(i, { name: e.target.value })} />
            <input className="rd-input rd-mono" style={{ width: 120, padding: '6px 9px', fontSize: 11.5 }} value={c.dataType} onChange={(e) => setCol(i, { dataType: e.target.value })} />
            <div className="ce-keys">
              {(['PK', 'FK', 'SK'] as const).map((kk) => {
                const on = kk === 'PK' ? c.isPrimaryKey : kk === 'FK' ? c.isForeignKey : c.isSurrogateKey;
                return <span key={kk} className={`rd-key ${kk.toLowerCase()}${on ? ' on' : ''}`} onClick={() => toggleKey(i, kk.toLowerCase() as 'pk' | 'fk' | 'sk')}>{kk}</span>;
              })}
            </div>
            <span className={`rd-toggle${c.isNullable !== false ? ' on' : ''}`} title="Nullable" style={{ transform: 'scale(.82)', flexShrink: 0 }} onClick={() => setCol(i, { isNullable: c.isNullable === false })} />
            <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ flexShrink: 0 }} onClick={() => delCol(i)}><Icon name="trash" size={13} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
