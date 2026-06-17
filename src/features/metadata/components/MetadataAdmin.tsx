'use client';

import React, { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useMetadataStore } from '@/store/useMetadataStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { SemanticType, Udp } from '@/types/model';
import SemanticTypeForm from './SemanticTypeForm';
import UdpForm from './UdpForm';

type ModalState =
  | { kind: 'st'; st: SemanticType | null }
  | { kind: 'udp'; udp: Udp | null }
  | { kind: 'confirm'; title: string; message: string; onConfirm: () => void }
  | null;

/** Model Center "Metadata" admin section — CRUD for the transversal Semantic
 *  Type and UDP catalog. Writes require a non-viewer role. */
export default function MetadataAdmin({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const {
    semanticTypes, udps, loaded, loading, load,
    createSemanticType, updateSemanticType, deleteSemanticType,
    createUdp, updateUdp, deleteUdp,
  } = useMetadataStore();
  const canEdit = useAuthStore((s) => !!s.user && s.user.role !== 'viewer');
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => { load(); }, [load]);

  const saveST = async (data: Omit<SemanticType, 'id'>, id?: string) => {
    const r = id ? await updateSemanticType(id, data) : await createSemanticType(data);
    setModal(null);
    pushToast(r ? (id ? 'Semantic Type guardado' : 'Semantic Type creado') : 'No se pudo guardar', r ? undefined : 'err');
  };
  const saveUdp = async (data: Omit<Udp, 'id'>, id?: string) => {
    const r = id ? await updateUdp(id, data) : await createUdp(data);
    setModal(null);
    pushToast(r ? (id ? 'UDP guardado' : 'UDP creado') : 'No se pudo guardar', r ? undefined : 'err');
  };

  return (
    <>
      <div className="mc-panels">
        {/* ── Semantic Types ── */}
        <div className="rd-card mc-panel">
          <div className="mc-cardhead">
            <span className="mc-cardlbl"><Icon name="sparkles" size={13} />Semantic Types</span>
            <span className="mc-pill">{semanticTypes.length}</span>
            {canEdit && <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'st', st: null })}><Icon name="plus" size={13} sw={2.6} />Nuevo</button>}
          </div>
          {loading && !loaded && <div className="rd-small" style={{ padding: 8 }}>Cargando…</div>}
          {loaded && semanticTypes.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>Sin Semantic Types. Crea uno (ej. “Monto” → decimal).</div>}
          <div className="meta-list">
            {semanticTypes.map((st) => (
              <div className="meta-item" key={st.id}>
                <span className="meta-ico" style={{ background: 'var(--k-sk-soft)', color: 'var(--accent2)' }}><Icon name="sparkles" size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="meta-name">{st.name} <span className="rd-mono meta-dt">{st.dataType}</span></div>
                  <div className="meta-sub">{st.tags.length ? st.tags.map((t) => t.key).join(' · ') : (st.description || 'Sin etiquetas')}</div>
                </div>
                {canEdit && (
                  <div className="meta-actions">
                    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setModal({ kind: 'st', st })}><Icon name="edit" size={13} /></button>
                    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setModal({ kind: 'confirm', title: `¿Eliminar “${st.name}”?`, message: 'Se quita del catálogo. Las columnas que lo usan conservan su tipo de dato actual.', onConfirm: async () => { await deleteSemanticType(st.id); pushToast('Semantic Type eliminado'); } })}><Icon name="trash" size={12} style={{ color: 'var(--error)' }} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── UDPs ── */}
        <div className="rd-card mc-panel">
          <div className="mc-cardhead">
            <span className="mc-cardlbl"><Icon name="bolt" size={13} />UDPs</span>
            <span className="mc-pill">{udps.length}</span>
            {canEdit && <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'udp', udp: null })}><Icon name="plus" size={13} sw={2.6} />Nuevo</button>}
          </div>
          {loaded && udps.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>Sin UDPs. Propiedades de gobierno asignables a tablas y columnas.</div>}
          <div className="meta-list">
            {udps.map((u) => (
              <div className="meta-item" key={u.id}>
                <span className="meta-ico" style={{ background: 'var(--flow-soft)', color: 'var(--flow-700)' }}><Icon name="bolt" size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="meta-name">{u.name}</div>
                  <div className="meta-sub">{u.appliesTo.map((s) => (s === 'column' ? 'columna' : 'tabla')).join(' · ') || '—'} · {u.valueType === 'enum' ? `lista (${(u.allowedValues ?? []).length})` : 'texto'}</div>
                </div>
                {canEdit && (
                  <div className="meta-actions">
                    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setModal({ kind: 'udp', udp: u })}><Icon name="edit" size={13} /></button>
                    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setModal({ kind: 'confirm', title: `¿Eliminar “${u.name}”?`, message: 'Se quita del catálogo de UDPs.', onConfirm: async () => { await deleteUdp(u.id); pushToast('UDP eliminado'); } })}><Icon name="trash" size={12} style={{ color: 'var(--error)' }} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!canEdit && <div className="rd-small" style={{ marginTop: 12 }}>Tu rol es de solo lectura — pide acceso de edición para administrar el catálogo.</div>}

      {modal?.kind === 'st' && <SemanticTypeForm semanticType={modal.st} onClose={() => setModal(null)} onSave={saveST} />}
      {modal?.kind === 'udp' && <UdpForm udp={modal.udp} onClose={() => setModal(null)} onSave={saveUdp} />}
      <ConfirmDialog
        open={modal?.kind === 'confirm'}
        title={modal?.kind === 'confirm' ? modal.title : ''}
        message={modal?.kind === 'confirm' ? modal.message : ''}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (modal?.kind === 'confirm') modal.onConfirm(); setModal(null); }}
        onCancel={() => setModal(null)}
      />
    </>
  );
}
