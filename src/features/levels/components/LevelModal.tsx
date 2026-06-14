'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { ModelLevel } from '@/types/model';

const PALETTE = ['#4f46e5', '#0d9488', '#7c3aed', '#0e7490', '#b45309', '#be123c', '#0891b2', '#15803d'];

interface LevelModalProps {
  level: ModelLevel | null;
  onClose: () => void;
  onSave: (level: ModelLevel, isNew: boolean) => void;
}

/** Create / edit a "Modelo (nivel)" — an agnostic level of the project. */
export default function LevelModal({ level, onClose, onSave }: LevelModalProps) {
  const isNew = !level;
  const [name, setName] = useState(level?.name ?? '');
  const [full, setFull] = useState(level?.full ?? '');
  const [desc, setDesc] = useState(level?.desc ?? '');
  const [color, setColor] = useState(level?.color ?? '#4f46e5');

  const submit = () => {
    const code = name.trim();
    if (!code) return;
    const id = level?.id || code.toLowerCase().replace(/\s+/g, '_');
    onSave(
      { id, name: code, full: full.trim() || code, color, desc: desc.trim(), order: level?.order ?? 0, engine: level?.engine },
      isNew,
    );
  };

  return (
    <Modal
      title={isNew ? 'Nuevo modelo' : 'Editar modelo'}
      subtitle="Un nivel de la jerarquía del proyecto (capa, zona, etapa…)"
      icon="database"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="rd-btn rd-btn-primary" disabled={!name.trim()} onClick={submit}>
            <Icon name="check" size={14} sw={2.6} />{isNew ? 'Crear modelo' : 'Guardar'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 130 }}>
          <span className="rd-label">Código</span>
          <input className="rd-input" value={name} placeholder="RDV" onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div style={{ flex: 1 }}>
          <span className="rd-label">Nombre completo</span>
          <input className="rd-input" value={full} placeholder="Raw Data Vault" onChange={(e) => setFull(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <span className="rd-label">Descripción</span>
        <input className="rd-input" value={desc} placeholder="Para qué sirve este nivel" onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div>
        <span className="rd-label">Color</span>
        <div style={{ display: 'flex', gap: 7 }}>
          {PALETTE.map((c) => (
            <span
              key={c}
              onClick={() => setColor(c)}
              style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: color === c ? '2px solid var(--ink)' : '2px solid transparent' }}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
