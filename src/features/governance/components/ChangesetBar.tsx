import { useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { useChangesetStore } from '@/store/useChangesetStore';

const DEV_USERS = ['ana', 'beto', 'qa'];

export default function ChangesetBar({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const { devUser, activeId, changesets, setDev, setActive, load, create, submit } = useChangesetStore();

  useEffect(() => { setDev(devUser); load().catch(() => pushToast('No se pudieron cargar los changesets', 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const myDrafts = changesets.filter((c) => c.owner === devUser && c.status === 'draft');
  const active = changesets.find((c) => c.id === activeId) || null;

  const onCreate = async () => {
    const title = prompt('Título del changeset (ej. "alta dominio tasa"):');
    if (!title?.trim()) return;
    try { await create(title.trim()); pushToast('Changeset creado — estás en modo draft'); }
    catch { pushToast('No se pudo crear el changeset', 'err'); }
  };
  const onPublish = async () => {
    if (!activeId) return;
    if (!confirm('¿Publicar este changeset para revisión?')) return;
    try { await submit(activeId); pushToast('Publicado — pendiente de aprobación'); }
    catch { pushToast('No se pudo publicar', 'err'); }
  };

  return (
    <div className="rd-card" style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="rd-small" style={{ color: 'var(--muted)' }}><Icon name="bolt" size={12} /> Usuario (dev)</span>
      <select className="rd-input" style={{ width: 110 }} value={devUser} onChange={(e) => { setDev(e.target.value); setActive(null); load(); }}>
        {DEV_USERS.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>

      <span style={{ width: 1, height: 22, background: 'var(--border)' }} />

      <span className="rd-small" style={{ color: 'var(--muted)' }}>Changeset</span>
      <select className="rd-input" style={{ minWidth: 200 }} value={activeId ?? ''} onChange={(e) => setActive(e.target.value || null)}>
        <option value="">— Publicado (read-only) —</option>
        {myDrafts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onCreate}><Icon name="plus" size={12} sw={2.6} />Nuevo</button>

      {active && (
        <>
          <span className="rd-badge rd-badge-flow" style={{ marginLeft: 'auto' }}>modo draft</span>
          <button className="rd-btn rd-btn-primary rd-btn-sm" onClick={onPublish}>Publicar</button>
        </>
      )}
    </div>
  );
}
