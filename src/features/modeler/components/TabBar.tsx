import { useModelerStore } from '@/store/useModelerStore';

export default function TabBar({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const { subjectAreas, activeSaId, activeProjectId, selectSubjectArea, createSubjectArea, viewMode, setViewMode } = useModelerStore();

  const onNew = async () => { if (!activeProjectId) { pushToast('Elegí un Project', 'err'); return; } const n = prompt('Nombre de la Subject Area:'); if (n?.trim()) await createSubjectArea(n.trim()).catch(() => pushToast('No se pudo crear', 'err')); };

  return (
    <div className="wk-tabs">
      {subjectAreas.map((sa) => (
        <div key={sa.id} className={`wk-tab${sa.id === activeSaId ? ' active' : ''}`} onClick={() => selectSubjectArea(sa.id).catch(() => pushToast('Error', 'err'))}>{sa.name}</div>
      ))}
      {activeProjectId && <div className="wk-tab" title="Nueva Subject Area" onClick={onNew}>+</div>}
      <div className="wk-tabs-spacer" />
      <div className="rd-seg">
        <button className={viewMode === 'logical' ? 'active' : ''} onClick={() => setViewMode('logical')}>Lógico</button>
        <button className={viewMode === 'physical' ? 'active' : ''} onClick={() => setViewMode('physical')}>Físico</button>
      </div>
    </div>
  );
}
