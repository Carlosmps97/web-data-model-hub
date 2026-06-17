'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Udp, UdpScope } from '@/types/model';

interface Props {
  udp: Udp | null;
  onClose: () => void;
  onSave: (data: Omit<Udp, 'id'>, id?: string) => void;
}

/** Create / edit a UDP (User-Defined Property) — assignable to tables and/or
 *  columns, free-text or controlled enum. */
export default function UdpForm({ udp, onClose, onSave }: Props) {
  const isNew = !udp;
  const [name, setName] = useState(udp?.name ?? '');
  const [description, setDescription] = useState(udp?.description ?? '');
  const [appliesTo, setAppliesTo] = useState<UdpScope[]>(udp?.appliesTo ?? ['column']);
  const [valueType, setValueType] = useState<'text' | 'enum'>(udp?.valueType ?? 'text');
  const [allowed, setAllowed] = useState((udp?.allowedValues ?? []).join(', '));

  const toggleScope = (s: UdpScope) => setAppliesTo((a) => (a.includes(s) ? a.filter((x) => x !== s) : [...a, s]));
  const submit = () => {
    if (!name.trim() || appliesTo.length === 0) return;
    const allowedValues = valueType === 'enum' ? allowed.split(',').map((v) => v.trim()).filter(Boolean) : undefined;
    onSave({ name: name.trim(), description: description.trim() || undefined, appliesTo, valueType, allowedValues }, udp?.id);
  };

  return (
    <Modal
      title={isNew ? 'Nuevo UDP' : 'Editar UDP'}
      subtitle="Propiedad definida por el usuario — gobierno asignable a tablas y columnas"
      icon="bolt"
      onClose={onClose}
      footer={
        <>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!name.trim() || appliesTo.length === 0} onClick={submit}><Icon name="check" size={14} sw={2.6} />{isNew ? 'Crear' : 'Guardar'}</button>
        </>
      }
    >
      <div style={{ marginBottom: 14 }}><span className="rd-label">Nombre</span><input className="rd-input" value={name} placeholder="Ej. Sistema origen" onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div style={{ marginBottom: 14 }}><span className="rd-label">Descripción</span><input className="rd-input" value={description} placeholder="opcional" onChange={(e) => setDescription(e.target.value)} /></div>
      <div style={{ marginBottom: 14 }}>
        <span className="rd-label">Aplica a</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['column', 'table'] as UdpScope[]).map((s) => (
            <button key={s} type="button" className={`dash-eng${appliesTo.includes(s) ? ' on' : ''}`} onClick={() => toggleScope(s)}>{s === 'column' ? 'Columna' : 'Tabla'}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: valueType === 'enum' ? 14 : 0 }}>
        <span className="rd-label">Tipo de valor</span>
        <div className="rd-seg"><button className={valueType === 'text' ? 'active' : ''} onClick={() => setValueType('text')}>Texto libre</button><button className={valueType === 'enum' ? 'active' : ''} onClick={() => setValueType('enum')}>Lista (enum)</button></div>
      </div>
      {valueType === 'enum' && <div><span className="rd-label">Valores válidos</span><input className="rd-input" value={allowed} placeholder="separados por coma" onChange={(e) => setAllowed(e.target.value)} /></div>}
    </Modal>
  );
}
