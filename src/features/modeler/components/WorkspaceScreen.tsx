import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import OpenModelModal from '@/components/OpenModelModal';
import { getChangeset, getPublished, listUsers } from '@/services/versioning.service';
import type { SimUserDto, VersionRow } from '@/types/versioning';
import ModelerCanvas from './ModelerCanvas';
import Toolbar from './Toolbar';
import ModelExplorer from './ModelExplorer';
import ColumnEditor from './ColumnEditor';
import PropertiesPanel from './PropertiesPanel';

export const pushToast = (m: string, k?: 'err') => (k === 'err' ? toast.error(m) : toast.success(m));

export default function WorkspaceScreen() {
  const navigate = useNavigate();
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const loadProjects = useModelerStore((s) => s.loadProjects);
  const columnTarget = useModelerStore((s) => s.columnTarget);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const addColumn = useModelerStore((s) => s.addColumn);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  const reload = useModelerStore((s) => s.reload);
  const viewMode = useModelerStore((s) => s.viewMode);
  const setViewMode = useModelerStore((s) => s.setViewMode);
  const openMode = useSessionStore((s) => s.openMode);
  const activeChangesetId = useSessionStore((s) => s.activeChangesetId);
  const user = useSessionStore((s) => s.user);

  // Open-model entry (also the version chooser forced on first entry).
  const [openModelShown, setOpenModelShown] = useState(false);
  const [published, setPublished] = useState<VersionRow | null>(null);
  const [users, setUsers] = useState<SimUserDto[]>([]);

  useEffect(() => { loadProjects().catch(() => pushToast('No se pudieron cargar los proyectos', 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Data the Open-model modal needs (production label + draft owners).
  useEffect(() => {
    let cancelled = false;
    Promise.all([getPublished(), listUsers()])
      .then(([pub, us]) => {
        if (cancelled) return;
        setPublished(pub);
        setUsers(us);
      })
      .catch(() => { /* the modal still works with defaults */ });
    return () => { cancelled = true; };
  }, []);

  // Entering Model WITHOUT a chosen version forces the Open-model chooser — you
  // can't interact with a "production" canvas until you pick a version/mode.
  useEffect(() => { if (!openMode) setOpenModelShown(true); }, [openMode]);

  // Once a version / working-copy is chosen, refresh the canvas so it reflects
  // the right overlay (production for readonly, the working copy for editing).
  // Reabrir/cambiar de versión también resetea el checkpoint de cambios (dirty).
  useEffect(() => {
    if (openMode) void reload();
    useModelerStore.getState().clearDirty();
  }, [openMode, activeChangesetId, reload]);

  // Defensa en profundidad: una sesión `editing` sólo es válida sobre un draft
  // PROPIO. Si el changeset dejó de estar en draft (enviado desde otra pestaña,
  // decidido por un revisor a mitad de sesión, binding viejo) o el actor cambió
  // a uno que no es el owner, degradamos a solo lectura en vez de dejar un
  // canvas que responde 409/403 en cada edición.
  useEffect(() => {
    if (openMode !== 'editing' || !activeChangesetId) return;
    let cancelled = false;
    getChangeset(activeChangesetId)
      .then((cs) => {
        if (cancelled || (cs.status === 'draft' && cs.owner === user.id)) return;
        useSessionStore.getState().openModel({
          mode: 'readonly',
          changesetId: activeChangesetId,
          versionLabel: cs.versionLabel ?? null,
        });
        pushToast(
          cs.status !== 'draft'
            ? `La versión ${cs.versionLabel ?? ''} ya no está en borrador (${cs.status}): el canvas quedó en solo lectura`
            : 'La versión pertenece a otro usuario: el canvas quedó en solo lectura',
          'err',
        );
      })
      .catch(() => { /* sin respuesta no degradamos: el guard del backend sigue protegiendo */ });
    return () => { cancelled = true; };
  }, [openMode, activeChangesetId, user.id]);

  // Cerrar/recargar la pestaña con cambios sin guardar → aviso NATIVO del
  // browser (la plataforma no permite popups propios en beforeunload; el popup
  // custom con "Guardar y salir" cubre la navegación interna vía TopNav).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useSessionStore.getState().openMode === 'editing' && useModelerStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = ''; // requerido por Chrome para mostrar el aviso
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const closeOpenModel = () => {
    setOpenModelShown(false);
    // Dismissed without choosing a version → don't strand the user on a blocked
    // canvas; send them back Home.
    if (!useSessionStore.getState().openMode) navigate('/');
  };

  return (
    <div className={`wk${selectedTableId && openMode ? ' has-props' : ''}`}>
      <Toolbar pushToast={pushToast} onOpenModel={() => setOpenModelShown(true)} />
      <ModelExplorer pushToast={pushToast} />
      <div className="wk-canvas">
        {!openMode ? (
          <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>
            Elegí una versión para abrir el modelo.
          </div>
        ) : activeSaId ? (
          <ModelerCanvas pushToast={pushToast} />
        ) : (
          <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>
            Elegí una Subject Area en el explorer.
          </div>
        )}
      </div>
      <div className="wk-status">
        <span className="wk-status-spacer" />
        <div className="wk-seg" role="group" aria-label="Naming view">
          <button
            type="button"
            className={`wk-seg-btn${viewMode === 'logical' ? ' on' : ''}`}
            disabled={!openMode}
            onClick={() => setViewMode('logical')}
          >
            Logical
          </button>
          <button
            type="button"
            className={`wk-seg-btn${viewMode === 'physical' ? ' on' : ''}`}
            disabled={!openMode}
            onClick={() => setViewMode('physical')}
          >
            Physical
          </button>
        </div>
      </div>
      {selectedTableId && openMode && <PropertiesPanel pushToast={pushToast} />}
      {columnTarget && <ColumnEditor tableId={columnTarget} onClose={() => setColumnTarget(null)} onAdd={async (...a) => { await addColumn(...a).catch((e) => { pushToast('No se pudo agregar', 'err'); throw e; }); }} />}
      <OpenModelModal open={openModelShown} onClose={closeOpenModel} published={published} users={users} />
      {/* El <Toaster> ahora es global (App.tsx): uno solo para toda la app. */}
    </div>
  );
}
