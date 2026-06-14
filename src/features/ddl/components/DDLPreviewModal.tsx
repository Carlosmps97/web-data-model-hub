'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Table } from '@/types/model';
import { genDDL, countViews } from '../generators';

interface DDLPreviewModalProps {
  scopedTables: Table[];
  allTables: Table[];
  scopeLabel: string;
  engineLabel: string;
  modelName: string;
  onClose: () => void;
  pushToast: (msg: string, type?: 'err') => void;
}

export default function DDLPreviewModal({ scopedTables, allTables, scopeLabel, engineLabel, modelName, onClose, pushToast }: DDLPreviewModalProps) {
  const hasScope = scopedTables.length > 0 && scopedTables.length < allTables.length;
  const [onlyScope, setOnlyScope] = useState(hasScope);
  const tables = onlyScope ? scopedTables : allTables;
  const vCount = countViews(tables);
  const [withViews, setWithViews] = useState(vCount > 0);
  const ddl = genDDL(tables, { name: modelName, engineLabel, includeViews: withViews });

  return (
    <Modal
      title="Exportar DDL"
      subtitle={`${engineLabel} · ${tables.length} tablas${vCount ? ` · ${vCount} vistas` : ''}`}
      icon="download"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="rd-btn rd-btn-primary" onClick={() => { navigator.clipboard?.writeText(ddl); pushToast('DDL copiado al portapapeles'); }}><Icon name="download" size={14} />Copiar DDL</button>
        </>
      }
    >
      {hasScope && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
          <span className={`rd-toggle${onlyScope ? ' on' : ''}`} onClick={() => setOnlyScope((v) => !v)} />
          <div><div style={{ fontSize: 13, fontWeight: 700 }}>Solo el scope actual</div><div className="rd-small">{onlyScope ? `Exportando “${scopeLabel}” (${scopedTables.length} tablas)` : `Exportando todo el modelo (${allTables.length} tablas)`}</div></div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
        <span className={`rd-toggle${withViews ? ' on' : ''}`} style={{ opacity: vCount ? 1 : 0.4, pointerEvents: vCount ? 'auto' : 'none' }} onClick={() => setWithViews((v) => !v)} />
        <div><div style={{ fontSize: 13, fontWeight: 700 }}>Incluir vistas</div><div className="rd-small">Añade CREATE VIEW (negocio y técnico){vCount ? '' : ' (ninguna definida)'}</div></div>
        {vCount > 0 && <span className="rd-badge rd-badge-flow" style={{ marginLeft: 'auto' }}><Icon name="eye" size={11} />{vCount}</span>}
      </div>
      <textarea className="code-area ddl" value={ddl} readOnly spellCheck={false} />
    </Modal>
  );
}
