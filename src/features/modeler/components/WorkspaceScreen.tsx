import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
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
import DatabaseExplorer from './DatabaseExplorer';
import ColumnEditor from './ColumnEditor';
import ColumnPropertiesPanel from './ColumnPropertiesPanel';
import ViewPropertiesPanel from '@/features/modeler/components/ViewPropertiesPanel';
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
  const selectedColumnId = useModelerStore((s) => s.selectedColumnId);
  const selectedViewId = useModelerStore((s) => s.selectedViewId);
  const viewMode = useModelerStore((s) => s.viewMode);
  const setViewMode = useModelerStore((s) => s.setViewMode);
  const openMode = useSessionStore((s) => s.openMode);
  const activeChangesetId = useSessionStore((s) => s.activeChangesetId);
  const user = useSessionStore((s) => s.user);

  // Open-model entry (also the version chooser forced on first entry).
  const [openModelShown, setOpenModelShown] = useState(false);
  const [published, setPublished] = useState<VersionRow | null>(null);
  const [users, setUsers] = useState<SimUserDto[]>([]);

  // Ancho resizable del panel de propiedades (solo-vista, persiste por browser).
  // Sirve para leer nombres largos de tabla que no entran en el default.
  const [propsWidth, setPropsWidthRaw] = useState<number | null>(() => {
    try { const v = localStorage.getItem('dmh:propsWidth'); return v ? Number(v) : null; } catch { return null; }
  });
  const setPropsWidth = (w: number) => {
    const clamped = Math.round(Math.max(320, Math.min(w, window.innerWidth * 0.6)));
    setPropsWidthRaw(clamped);
    try { localStorage.setItem('dmh:propsWidth', String(clamped)); } catch { /* ignore */ }
  };

  // Ancho resizable del sidebar IZQUIERDO (explorer): mismo patrón, para árboles
  // con nombres largos. El handle vive en el borde derecho de .wk-expl-stack.
  const [explWidth, setExplWidthRaw] = useState<number | null>(() => {
    try { const v = localStorage.getItem('dmh:explWidth'); return v ? Number(v) : null; } catch { return null; }
  });
  const [explResizing, setExplResizing] = useState(false);
  const setExplWidth = (w: number) => {
    const clamped = Math.round(Math.max(220, Math.min(w, Math.min(560, window.innerWidth * 0.44))));
    setExplWidthRaw(clamped);
    try { localStorage.setItem('dmh:explWidth', String(clamped)); } catch { /* ignore */ }
  };
  const startExplResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setExplResizing(true);
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => setExplWidth(ev.clientX);   // clientX = ancho desde el borde izq.
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      setExplResizing(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  useEffect(() => { loadProjects().catch(() => pushToast("Couldn't load the projects", 'err')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Once a version / working-copy is chosen, refresh EVERYTHING for that
  // context: cambio de versión = cambio de overlay, así que se purga el cache
  // del explorer y se re-fetch (proyectos/canvases draft incluidos) + se
  // re-carga el canvas activo si sigue existiendo. Antes solo se recargaba el
  // diagrama y el árbol quedaba PEGADO a la versión anterior (doc 16).
  // Reabrir/cambiar de versión también resetea el checkpoint de cambios (dirty).
  useEffect(() => {
    if (openMode) void useModelerStore.getState().refreshExplorer().catch(() => {});
    useModelerStore.getState().clearDirty();
    // Al abrir una versión para EDITAR se muestra el modelo LÓGICO (es lo que se
    // edita) para que los cambios de naming lógico se vean de una; en solo-lectura
    // se mantiene el físico (nombres de producción). El toggle sigue disponible.
    if (openMode === 'editing') useModelerStore.getState().setViewMode('logical');
  }, [openMode, activeChangesetId]);

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
            ? `Version ${cs.versionLabel ?? ''} is no longer in draft (${cs.status}): the canvas is now read-only`
            : 'The version belongs to another user: the canvas is now read-only',
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
    <div className={`wk${(selectedTableId || selectedColumnId || selectedViewId) && openMode ? ' has-props' : ''}`}
      style={{
        ...(propsWidth ? { ['--props-w']: `${propsWidth}px` } : {}),
        ...(explWidth ? { ['--expl-w']: `${explWidth}px` } : {}),
      } as CSSProperties}>
      <Toolbar pushToast={pushToast} onOpenModel={() => setOpenModelShown(true)} />
      {/* Sidebar apilado (doc 18): Model Explorer (versión activa) arriba +
          Database Explorer (producción, solo lectura) abajo. */}
      <div className="wk-expl-stack">
        <ModelExplorer pushToast={pushToast} />
        <DatabaseExplorer />
        <div className={`wk-expl-resizer${explResizing ? ' dragging' : ''}`}
          onPointerDown={startExplResize} title="Drag to resize" />
      </div>
      <div className="wk-canvas">
        {!openMode ? (
          <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>
            Pick a version to open the model.
          </div>
        ) : activeSaId ? (
          <ModelerCanvas pushToast={pushToast} />
        ) : (
          <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>
            Pick a Subject Area in the explorer.
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
      {/* Doc 49: el área `props` del grid muestra UN panel a la vez — con una
          columna seleccionada, su Properties reemplaza al de la tabla. */}
      {selectedColumnId && openMode
        ? <ColumnPropertiesPanel pushToast={pushToast} onResize={setPropsWidth} />
        : selectedViewId && openMode
          ? <ViewPropertiesPanel pushToast={pushToast} onResize={setPropsWidth} />
          : selectedTableId && openMode && <PropertiesPanel pushToast={pushToast} onResize={setPropsWidth} />}
      {columnTarget && <ColumnEditor tableId={columnTarget} onClose={() => setColumnTarget(null)} onAdd={addColumn} />}
      <OpenModelModal open={openModelShown} onClose={closeOpenModel} published={published} users={users} />
      {/* El <Toaster> ahora es global (App.tsx): uno solo para toda la app. */}
    </div>
  );
}
