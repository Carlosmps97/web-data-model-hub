import { useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { confirmDialog, promptDialog } from '@/components/ui/dialogs';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';

export default function ChangesetBar({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const { devUser, activeId, changesets, setDev, setActive, load, create, submit } = useChangesetStore();

  useEffect(() => {
    // Alinea el actor legacy con el usuario REAL de la sesión (el mirror de
    // useSessionStore ya trae el username logueado). Bajo auth por token el
    // header X-Dev-User es ignorado por el backend, pero `devUser` se usa acá
    // para filtrar "mis drafts", así que debe ser el usuario real — no un switch.
    setDev(useSessionStore.getState().user.id);
    load().catch(() => pushToast('No se pudieron cargar los changesets', 'err'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const myDrafts = changesets.filter((c) => c.owner === devUser && c.status === 'draft');
  const active = changesets.find((c) => c.id === activeId) || null;

  const onCreate = async () => {
    try {
      const title = await promptDialog({
        title: 'Nuevo changeset',
        label: 'Título',
        placeholder: 'ej. "alta dominio tasa"',
        confirmLabel: 'Crear', cancelLabel: 'Cancelar',
        action: async (v) => { if (v.trim()) await create(v.trim()); },
      });
      if (title?.trim()) pushToast('Changeset creado — estás en modo draft');
    } catch { pushToast('No se pudo crear el changeset', 'err'); }
  };
  const onPublish = async () => {
    if (!activeId) return;
    try {
      const ok = await confirmDialog({
        title: 'Publicar changeset',
        message: 'Se enviará este changeset a revisión.',
        confirmLabel: 'Publicar', cancelLabel: 'Cancelar',
        action: () => submit(activeId),
      });
      if (ok) pushToast('Publicado — pendiente de aprobación');
    } catch { pushToast('No se pudo publicar', 'err'); }
  };

  return (
    <div className="rd-card" style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
