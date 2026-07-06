import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { promptDialog } from '@/components/ui/dialogs';
import { useChangesetStore } from '@/store/useChangesetStore';
import { getChangeset, type Changeset } from '../services/changeset.service';

const COLS: Record<string, string> = {
  parent_domains: 'Dominios', abbreviation_dict: 'UDP',
  canonical_tables: 'Tablas', canonical_columns: 'Columnas',
};

export default function ApprovalInbox({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const { changesets, load, approve, reject } = useChangesetStore();
  const [detail, setDetail] = useState<Changeset | null>(null);

  useEffect(() => { load().catch(() => pushToast('No se pudieron cargar los changesets', 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitted = changesets.filter((c) => c.status === 'submitted');

  const openDetail = async (id: string) => {
    try { setDetail(await getChangeset(id)); } catch { pushToast('No se pudo cargar el detalle', 'err'); }
  };
  const onApprove = async (id: string) => {
    try { await approve(id); setDetail(null); pushToast('Aprobado y publicado'); } catch { pushToast('No se pudo aprobar', 'err'); }
  };
  const onReject = async (id: string) => {
    try {
      const value = await promptDialog({
        title: 'Rechazar changeset',
        label: 'Motivo del rechazo (opcional)',
        confirmLabel: 'Rechazar', cancelLabel: 'Cancelar',
        action: (v) => reject(id, v.trim() || undefined),
      });
      if (value === null) return; // canceló — no rechazar
      setDetail(null); pushToast('Rechazado');
    } catch { pushToast('No se pudo rechazar', 'err'); }
  };

  return (
    <div className="rd-card mc-panel">
      <div className="mc-cardhead">
        <span className="mc-cardlbl"><Icon name="layers" size={13} />Aprobaciones</span>
        <span className="mc-pill">{submitted.length}</span>
      </div>
      <div className="meta-list">
        {submitted.map((c) => (
          <div className="meta-item" key={c.id}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="meta-name">{c.title}</div>
              <div className="meta-sub">por {c.owner}</div>
            </div>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => openDetail(c.id)}>Ver diff</button>
            <button className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => onApprove(c.id)}>Aprobar</button>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => onReject(c.id)} style={{ color: 'var(--error)' }}>Rechazar</button>
          </div>
        ))}
        {submitted.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>No hay changesets pendientes de aprobación.</div>}
      </div>

      {detail && (
        <div className="rd-card" style={{ padding: 10, marginTop: 8 }}>
          <div className="meta-name" style={{ marginBottom: 6 }}>Diff de "{detail.title}"</div>
          {Object.entries(detail.diff ?? {}).map(([col, d]) => (
            <div key={col} className="rd-small" style={{ marginBottom: 4 }}>
              <b>{COLS[col] ?? col}:</b>{' '}
              <span style={{ color: 'var(--success)' }}>+{d.added.length}</span>{' · '}
              <span style={{ color: 'var(--warning)' }}>~{d.modified.length}</span>{' · '}
              <span style={{ color: 'var(--error)' }}>-{d.removed.length}</span>
            </div>
          ))}
          {Object.keys(detail.diff ?? {}).length === 0 && <div className="rd-small">Sin cambios.</div>}
          <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginTop: 6 }} onClick={() => setDetail(null)}>Cerrar</button>
        </div>
      )}
    </div>
  );
}
