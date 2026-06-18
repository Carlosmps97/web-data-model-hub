'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Table, Relationship } from '@/types/model';
import { genDBML, parseDBML } from '@/features/diagram';

interface DBMLModalProps {
  tables: Table[];
  onClose: () => void;
  onApply: (parsed: { tables: Table[]; relationships: Relationship[] }) => void;
  pushToast: (msg: string, type?: 'err') => void;
}

export default function DBMLModal({ tables, onClose, onApply, pushToast }: DBMLModalProps) {
  const [text, setText] = useState(() => genDBML(tables));
  return (
    <Modal
      title="Editor DBML"
      subtitle="Escribe tablas en DBML — aplicar reemplaza el canvas"
      icon="code"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="rd-btn rd-btn-ghost left" onClick={() => { navigator.clipboard?.writeText(text); pushToast('DBML copiado'); }}><Icon name="code" size={14} />Copiar</button>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" onClick={() => { const p = parseDBML(text); if (!p.tables.length) { pushToast('No se pudo parsear ninguna tabla', 'err'); return; } onApply(p); }}><Icon name="check" size={14} sw={2.6} />Aplicar DBML</button>
        </>
      }
    >
      <textarea className="code-area" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
    </Modal>
  );
}
