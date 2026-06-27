import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import ChangesetBar from '@/features/governance/components/ChangesetBar';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import ModelerCanvas from './ModelerCanvas';
import NewTableModal from './NewTableModal';
import AddTablesModal from './AddTablesModal';
import ColumnEditor from './ColumnEditor';

const pushToast = (m: string, k?: 'err') => (k === 'err' ? toast.error(m) : toast.success(m));

export default function ModelerScreen() {
  const { projects, subjectAreas, activeProjectId, activeSaId, loadProjects, selectProject, selectSubjectArea, createTable, addColumn, addExistingTables, createProject, createSubjectArea } = useModelerStore();
  const activeChangeset = useChangesetStore((s) => s.activeId);
  const columnTarget = useModelerStore((s) => s.columnTarget);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const diagram = useModelerStore((s) => s.diagram);
  const viewMode = useModelerStore((s) => s.viewMode);
  const setViewMode = useModelerStore((s) => s.setViewMode);
  const [modal, setModal] = useState<{ kind: 'table' } | { kind: 'addTables' } | null>(null);
  const canEdit = activeChangeset != null && activeSaId != null;

  useEffect(() => { loadProjects().catch(() => pushToast('No se pudieron cargar los proyectos', 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header crumbs={[{ label: 'Modeler' }]} />
        <div className="dmh-page" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
          <ChangesetBar pushToast={pushToast} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <select className="rd-input" value={activeProjectId ?? ''} onChange={(e) => selectProject(e.target.value).catch(() => pushToast('Error', 'err'))}>
              <option value="">— Project —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Nuevo Project" onClick={async () => { const n = prompt('Nombre del Project:'); if (n?.trim()) await createProject(n.trim()).catch(() => pushToast('No se pudo crear el Project', 'err')); }}>+</button>
            <select className="rd-input" value={activeSaId ?? ''} disabled={!activeProjectId} onChange={(e) => selectSubjectArea(e.target.value).catch(() => pushToast('Error', 'err'))}>
              <option value="">— Subject Area —</option>
              {subjectAreas.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Nueva Subject Area" disabled={!activeProjectId} onClick={async () => { const n = prompt('Nombre de la Subject Area:'); if (n?.trim()) await createSubjectArea(n.trim()).catch(() => pushToast('No se pudo crear la Subject Area', 'err')); }}>+</button>
            {!activeChangeset && <span className="rd-small" style={{ color: 'var(--muted)' }}>read-only — creá/seleccioná un changeset para editar</span>}
            {activeSaId && <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'addTables' })}>+ Tabla existente</button>}
            {canEdit && <button className="rd-btn rd-btn-primary rd-btn-sm" style={activeSaId ? undefined : { marginLeft: 'auto' }} onClick={() => setModal({ kind: 'table' })}>+ Nueva tabla</button>}
            <div className="rd-seg" style={{ marginLeft: 8 }}>
              <button className={viewMode === 'logical' ? 'active' : ''} onClick={() => setViewMode('logical')}>Lógico</button>
              <button className={viewMode === 'physical' ? 'active' : ''} onClick={() => setViewMode('physical')}>Físico</button>
            </div>
          </div>
          {activeSaId ? <ModelerCanvas pushToast={pushToast} /> : <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>Elegí un Project y una Subject Area para ver el diagrama.</div>}
        </div>
      </div>
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
      {modal?.kind === 'table' && <NewTableModal onClose={() => setModal(null)} onCreate={async (input) => { await createTable(input).catch((e) => { pushToast('No se pudo crear', 'err'); throw e; }); }} />}
      {modal?.kind === 'addTables' && <AddTablesModal excludeIds={diagram?.subjectArea.tableIds ?? []} onClose={() => setModal(null)} onAdd={async (ids) => { await addExistingTables(ids).catch((e) => { pushToast('No se pudo agregar', 'err'); throw e; }); pushToast('Tablas agregadas'); }} />}
      {columnTarget && <ColumnEditor tableId={columnTarget} onClose={() => setColumnTarget(null)} onAdd={async (...a) => { await addColumn(...a).catch((e) => { pushToast('No se pudo agregar', 'err'); throw e; }); }} />}
    </AppLayout>
  );
}
