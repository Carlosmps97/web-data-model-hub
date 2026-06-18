'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import { getEngine } from '@/features/engines';
import { formatTag, tagId } from '@/lib/tags';
import type { Selection } from '../lib/catalog';

export interface CatalogInspectorProps {
  sel: NonNullable<Selection>;
  onSelect: (s: Selection) => void;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
}

/** Right-hand detail panel for the selected table or view in the Model Center. */
export default function CatalogInspector({ sel, onSelect, onClose, onOpenProject }: CatalogInspectorProps) {
  return (
    <div className="ed-inspector">
      <div className="ins-head">
        <span className="ins-ico" style={{ background: sel.kind === 'view' ? 'var(--flow-soft)' : 'var(--primary-soft)', color: sel.kind === 'view' ? 'var(--flow-700)' : 'var(--primary-700)' }}>
          <Icon name={sel.kind === 'view' ? 'eye' : 'table'} size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel.kind === 'view' ? sel.view.name : `${sel.row.schema}.${sel.row.table}`}</div>
          <div className="rd-small">{sel.row.project} · {sel.row.model}</div>
        </div>
        <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>
      <div style={{ padding: '0 14px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className="rd-engine" style={{ padding: '2px 8px 2px 6px' }}><span className="dot" style={{ background: getEngine(sel.row.engine)?.color }} />{getEngine(sel.row.engine)?.shortLabel ?? '—'}</span>
        {sel.row.domainId && <span className="rd-badge" style={{ background: sel.row.domainColor + '1a', color: sel.row.domainColor }}>{sel.row.domainName}</span>}
        {sel.kind === 'view' && <span className={`rd-badge ${sel.view.type === 'business' ? 'rd-badge-primary' : 'rd-badge-flow'}`}>{sel.view.type} · {sel.view.role}</span>}
      </div>
      <div className="ins-body">
        {sel.kind === 'table' ? (
          <>
            <div className="ins-grouplbl" style={{ marginBottom: 8 }}><Icon name="columns" size={12} />Columnas · {sel.row.columns.length}</div>
            {sel.row.columns.map((c, i) => (
              <div className="ins-col" key={i} style={{ alignItems: (c.def || c.tags.length) ? 'flex-start' : undefined }}>
                {c.key ? <span className={`rd-key ${c.key.toLowerCase()}`}>{c.key}</span> : <span className="rd-key none"><span className="d" /></span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>{c.name}</span>
                  {c.def && <div className="rd-small" style={{ lineHeight: 1.4, marginTop: 2 }}>{c.def}</div>}
                  {c.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{c.tags.map((t) => <span key={tagId(t)} className="rd-badge rd-badge-neutral" style={{ fontSize: 9.5 }}>{formatTag(t)}</span>)}</div>}
                </div>
                <span className="rd-mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.dataType}</span>
              </div>
            ))}
            {sel.row.views.length > 0 && (
              <>
                <div className="ins-grouplbl" style={{ margin: '16px 0 8px' }}><Icon name="eye" size={12} />Vistas · {sel.row.views.length}</div>
                {sel.row.views.map((v, i) => (
                  <div key={i} className="iv-card" style={{ cursor: 'pointer' }} onClick={() => onSelect({ kind: 'view', row: sel.row, view: v })}>
                    <span className="rd-mono" style={{ fontSize: 12, fontWeight: 600 }}>{v.name}</span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 7 }}><span className={`rd-badge ${v.type === 'business' ? 'rd-badge-primary' : 'rd-badge-flow'}`}>{v.type}</span><span className="rd-badge rd-badge-neutral"><Icon name="users" size={10} />{v.role}</span></div>
                  </div>
                ))}
              </>
            )}
            {sel.row.tags.length > 0 && (
              <>
                <div className="ins-grouplbl" style={{ margin: '16px 0 8px' }}><Icon name="tag" size={12} />Etiquetas · {sel.row.tags.length}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{sel.row.tags.map((t) => <span key={tagId(t)} className="rd-badge rd-badge-neutral"><Icon name="tag" size={9} />{formatTag(t)}</span>)}</div>
              </>
            )}
          </>
        ) : (
          <div className="rd-small" style={{ lineHeight: 1.6 }}>Vista {sel.view.type} para el rol <b style={{ color: 'var(--ink)' }}>{sel.view.role}</b>, proyectada desde <b style={{ color: 'var(--ink)' }}>{sel.row.schema}.{sel.row.table}</b>. Abre el proyecto para editar su SQL.</div>
        )}
        <button className="rd-btn rd-btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => onOpenProject(sel.row.projectId)}><Icon name="share" size={14} />Abrir proyecto</button>
      </div>
    </div>
  );
}
