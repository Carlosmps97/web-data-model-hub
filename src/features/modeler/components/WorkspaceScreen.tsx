import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { useModelerStore } from '@/store/useModelerStore';
import ModelerCanvas from './ModelerCanvas';
import Toolbar from './Toolbar';
import ModelExplorer from './ModelExplorer';
import TabBar from './TabBar';
import ColumnEditor from './ColumnEditor';
import PropertiesPanel from './PropertiesPanel';

export const pushToast = (m: string, k?: 'err') => (k === 'err' ? toast.error(m) : toast.success(m));

export default function WorkspaceScreen() {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const loadProjects = useModelerStore((s) => s.loadProjects);
  const columnTarget = useModelerStore((s) => s.columnTarget);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const addColumn = useModelerStore((s) => s.addColumn);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  useEffect(() => { loadProjects().catch(() => pushToast('No se pudieron cargar los proyectos', 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`wk${selectedTableId ? ' has-props' : ''}`}>
      <Toolbar pushToast={pushToast} />
      <ModelExplorer pushToast={pushToast} />
      <div className="wk-canvas">
        {activeSaId ? <ModelerCanvas pushToast={pushToast} /> : <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>Elegí una Subject Area en el explorer.</div>}
      </div>
      {selectedTableId && <PropertiesPanel pushToast={pushToast} />}
      <TabBar pushToast={pushToast} />
      {columnTarget && <ColumnEditor tableId={columnTarget} onClose={() => setColumnTarget(null)} onAdd={async (...a) => { await addColumn(...a).catch((e) => { pushToast('No se pudo agregar', 'err'); throw e; }); }} />}
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </div>
  );
}
