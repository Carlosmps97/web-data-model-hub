import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { MODEL_MODE_CAPTION } from '@/lib/facets';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { failureText, useModelerStore } from '@/store/useModelerStore';
import { LAST_PROJECT_KEY, useSessionStore } from '@/store/useSessionStore';
import { canvasSessionKey } from '../lib/canvasSession';
import {
  isVersionHeaderUrl, reportWriteError, sessionFate, stillAskedSession, touchesChangeset, trackRevalidation,
} from '../lib/sessionGuard';
import OpenModelModal from '@/components/OpenModelModal';
import NewProjectModal from '@/components/NewProjectModal';
import { getChangeset, getPublished, isAsOfChangesetId, listUserNames } from '@/services/versioning.service';
import { ApiError, errorReason, setOnApiError } from '@/services/http';
import { useAuthStore } from '@/store/useAuthStore';
import type { ChangesetDetail, SimUserDto } from '@/types/versioning';
import ModelerCanvas from './ModelerCanvas';
import Toolbar from './Toolbar';
import ExplorerPanel from './ExplorerPanel';
import ColumnEditor from './ColumnEditor';
import ColumnPropertiesPanel from './ColumnPropertiesPanel';
import ViewPropertiesPanel from '@/features/modeler/components/ViewPropertiesPanel';
import PropertiesPanel from './PropertiesPanel';
import ObjectInspector from './ObjectInspector';
import NavigatingOverlay from './NavigatingOverlay';
import DeletionPendingPanel from './DeletionPendingPanel';
import PublishModal from './PublishModal';
import { runBlocking } from '@/store/useBusyStore';
import { useUiStore } from '@/store/useUiStore';
import { ChevronsRight } from 'lucide-react';

export const pushToast = (m: string, k?: 'err') => (k === 'err' ? toast.error(m) : toast.success(m));

export default function WorkspaceScreen() {
  const navigate = useNavigate();
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const columnTarget = useModelerStore((s) => s.columnTarget);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const addColumn = useModelerStore((s) => s.addColumn);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  const selectedColumnId = useModelerStore((s) => s.selectedColumnId);
  const selectedViewId = useModelerStore((s) => s.selectedViewId);
  const viewMode = useModelerStore((s) => s.viewMode);
  // Doc 75 D5: la working copy borra su proyecto → el canvas cede al panel.
  const deletionPending = useModelerStore((s) => s.projectDeletionPending);
  const activeProject = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const undoProjectDeletion = useModelerStore((s) => s.undoProjectDeletion);
  const [publishFromPanel, setPublishFromPanel] = useState(false);
  const openMode = useSessionStore((s) => s.openMode);
  const activeChangesetId = useSessionStore((s) => s.activeChangesetId);
  // Clave de contexto de la sesión (proyecto + modo + changeset): cualquier
  // cambio re-sincroniza el workspace. Sin el proyecto en la clave, abrir OTRO
  // proyecto en el mismo modo dejaba el explorer/canvas en el anterior.
  const sessionKey = useSessionStore((s) => canvasSessionKey(s));
  const user = useSessionStore((s) => s.user);

  // Open-model entry (also the version chooser forced on first entry). Doc 75:
  // el modal elige PROYECTO y luego modo; «New project…» abre el alta y
  // reabre el chooser con el proyecto nuevo preseleccionado.
  const [openModelShown, setOpenModelShown] = useState(false);
  const [newProjectShown, setNewProjectShown] = useState(false);
  const [presetProjectId, setPresetProjectId] = useState<string | null>(null);
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
  // Doc 92 D7: Explorer colapsado a un riel de 30 px (más canvas).
  const explorerCollapsed = useUiStore((s) => s.explorerCollapsed);
  const toggleExplorer = useUiStore((s) => s.toggleExplorer);
  const toolbarCollapsed = useUiStore((s) => s.toolbarCollapsed);
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

  // Doc 105 (H6): los proyectos NO se cargan al montar. Con sesión los trae
  // `refreshExplorer` (efecto de abajo); sin sesión nadie los lee (el Explorer
  // muestra sólo el proyecto de la sesión y el chooser carga los suyos). La
  // carga del montaje duplicaba la del refresco y, con la red caída, sumaba
  // su propio aviso: una caída eran dos o tres avisos.

  // Data the Open-model modal needs (draft owners); production is per project
  // and the modal resolves it from the version list (doc 75). Doc 105 (U1):
  // sólo para NOMBRES — incluye a los deshabilitados (quien dejó la empresa
  // sigue siendo dueño de su versión y se ve con su nombre, no con su correo).
  useEffect(() => {
    let cancelled = false;
    listUserNames()
      .then((us) => { if (!cancelled) setUsers(us); })
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
  // La dependencia es la CLAVE de sesión (proyecto + modo + changeset): abrir
  // otro proyecto en el mismo modo también re-sincroniza (owner 2026-09-08).
  useEffect(() => {
    if (openMode) {
      // Doc 105 (F2): un fallo ya no se traga (el Explorer quedaba en «Open a
      // project…» sin aviso). Criterio de sessionGuard, con la sesión tomada AL
      // PEDIR: un error de la versión espera la revalidación; si la sesión ya
      // no es esta (la cambió la revalidación, que avisó, o el usuario abrió
      // otra), se calla. Un aviso por sesión (id): no se apilan.
      const asked = useSessionStore.getState();
      const askedKey = canvasSessionKey(asked);
      useModelerStore.getState().refreshExplorer().catch(async (e: unknown) => {
        const current = () => canvasSessionKey(useSessionStore.getState());
        if (!(await stillAskedSession(e, asked.activeChangesetId, askedKey, current))) return;
        const reason = errorReason(e, 'unknown error');
        toast.error(`Couldn't load the explorer: ${reason}. Use Refresh to try again.`, { id: `dmh-explorer-load:${askedKey}` });
      });
    }
    useModelerStore.getState().clearDirty();
    setPublishFromPanel(false);   // doc 105 (R7-A): el Publish era de la sesión anterior
    // Al abrir una versión para EDITAR se muestra el modelo LÓGICO (es lo que se
    // edita) para que los cambios de naming lógico se vean de una; en solo-lectura
    // se mantiene el físico (nombres de producción). El toggle sigue disponible.
    if (openMode === 'editing') useModelerStore.getState().setViewMode('logical');
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Defensa en profundidad: la versión abierta pudo cambiar POR FUERA — enviada
  // o decidida en otra pestaña, binding viejo, o (doc 104) transferida a otro
  // usuario o eliminada. Se revalida al entrar/cambiar de sesión y cuando una
  // respuesta 403/404/409 de ESA versión lo avisa; `sessionFate` decide: seguir,
  // solo lectura (la misma versión o producción) o volver al chooser — en vez
  // de dejar un canvas que falla en cada guardado o que muestra otra cosa.
  const usersRef = useRef<SimUserDto[]>([]);
  usersRef.current = users;
  // Revalidación en curso: una a la vez POR versión (otra sesión abierta en el
  // medio se revisa igual). Un pedido que llega mientras corre no se pierde:
  // marca `rerun`, la corrida se repite al terminar y quien pidió espera ambas
  // (la promesa de la corrida). Se registra (`trackRevalidation`) para que el
  // store y el Explorer esperen el veredicto antes de avisar un error propio.
  type Run = { csId: string; rerun: boolean; promise: Promise<void> };
  const revalidating = useRef<Run | null>(null);
  const revalidateRef = useRef<() => Promise<void>>(async () => {});

  const checkSession = useCallback(async (csId: string, start: ReturnType<typeof useSessionStore.getState>) => {
    const same = () => {
      const now = useSessionStore.getState();
      return now.activeChangesetId === csId && now.openMode === start.openMode;
    };
    let cs: ChangesetDetail | null;
    try {
      cs = await getChangeset(csId);
    } catch (e) {
      // Sin respuesta no se degrada: el guard del backend sigue protegiendo.
      // Y no se repite: si la cabecera no se puede leer (403 del proxy, red),
      // reintentar ahora daría lo mismo — el siguiente error lo vuelve a pedir.
      if (!(e instanceof ApiError && e.status === 404)) {
        if (revalidating.current?.csId === csId) revalidating.current.rerun = false;
        // Un 403 acá no viene del backend (la cabecera no exige permisos): es
        // el proxy de la plataforma. Un aviso por versión (id: no se apilan) y
        // sólo si la sesión sigue siendo esa.
        if (e instanceof ApiError && e.status === 403 && same()) {
          toast.error(`Couldn't check this version: ${e.message || 'access denied'}`, { id: `dmh-version-check:${csId}` });
        }
        return;
      }
      cs = null;
    }
    if (!same()) return;
    const now = useSessionStore.getState();
    const auth = useAuthStore.getState();
    // Nombres para el aviso: al entrar a Model la lista puede no haber
    // llegado todavía (el aviso saldría con el correo en vez del nombre).
    if (!usersRef.current.length && cs?.owner && cs.owner !== now.user.id) {
      usersRef.current = await listUserNames().catch(() => []);
      if (!same()) return;
    }
    const fate = sessionFate({
      mode: start.openMode!,
      changesetId: csId,
      versionLabel: now.activeVersionLabel ?? cs?.versionLabel ?? null,
      me: now.user.id,
      canViewAll: auth.has('versions.view_all') || auth.has('admin.manage'),
      cs,
      userName: (id) => usersRef.current.find((u) => u.id === id)?.name ?? id,
    });
    if (fate.kind === 'keep') return;
    const projectId = cs?.projectId ?? now.activeProjectId;
    if (fate.kind === 'close' || !projectId) {
      now.closeModel();
      pushToast(fate.message, 'err');
      return;
    }
    const label = fate.changesetId
      ? (cs?.versionLabel ?? null)
      : ((await getPublished(projectId).catch(() => null))?.versionLabel ?? null);
    if (!same()) return;
    useSessionStore.getState().openModel({
      projectId, mode: 'readonly', changesetId: fate.changesetId ?? undefined, versionLabel: label,
    });
    pushToast(fate.message, 'err');
  }, []);

  const revalidateSession = useCallback((): Promise<void> => {
    const start = useSessionStore.getState();
    const csId = start.activeChangesetId;
    if (!start.openMode || !csId || isAsOfChangesetId(csId)) return Promise.resolve();
    const running = revalidating.current;
    if (running?.csId === csId) { running.rerun = true; return running.promise; }
    const run: Run = { csId, rerun: false, promise: Promise.resolve() };
    revalidating.current = run;
    run.promise = (async () => {
      try {
        await checkSession(csId, start);
      } finally {
        const again = revalidating.current === run && run.rerun;
        if (revalidating.current === run) revalidating.current = null;
        if (again) await revalidateRef.current();
      }
    })();
    return run.promise;
  }, [checkSession]);
  revalidateRef.current = revalidateSession;

  useEffect(() => { trackRevalidation(revalidateSession()); }, [openMode, activeChangesetId, user.id, revalidateSession]);

  // Doc 104: una respuesta 403/404/409 de la versión abierta (guardado o
  // lectura) = pudo haberla transferido o eliminado otra sesión → revalidar.
  useEffect(() => {
    setOnApiError((status, url) => {
      if (status !== 403 && status !== 404 && status !== 409) return;
      const cs = useSessionStore.getState().activeChangesetId;
      // La lectura de cabecera ES la revalidación: su propio error no la redispara.
      if (!touchesChangeset(url, cs) || isVersionHeaderUrl(url, cs)) return;
      trackRevalidation(revalidateSession());
    });
    return () => setOnApiError(null);
  }, [revalidateSession]);

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
  const lastProjectId = (): string | null => {
    const active = useSessionStore.getState().activeProjectId;
    if (active) return active;
    try { return localStorage.getItem(LAST_PROJECT_KEY); } catch { return null; }
  };

  return (
    <div className={`wk${(selectedTableId || selectedColumnId || selectedViewId) && openMode ? ' has-props' : ''}${toolbarCollapsed ? ' tb-collapsed' : ''}`}
      style={{
        ...(propsWidth ? { ['--props-w']: `${propsWidth}px` } : {}),
        ...(explorerCollapsed ? { ['--expl-w']: '30px' } : explWidth ? { ['--expl-w']: `${explWidth}px` } : {}),
      } as CSSProperties}>
      <Toolbar pushToast={pushToast} onOpenModel={() => setOpenModelShown(true)} />
      {/* Sidebar (docs 71/72): UN Explorer — por proyecto Models · Tables ·
          Views · Schemas (el catálogo global se retiró; lo cubren ⌘K + Inspect). */}
      {explorerCollapsed ? (
        <div className="wk-expl-stack wk-expl-rail">
          <button type="button" className="wk-expl-rail-btn" onClick={toggleExplorer}
            title="Show the Explorer" aria-label="Show the Explorer" aria-expanded={false}>
            <ChevronsRight size={14} />
          </button>
          <span className="wk-expl-rail-label" aria-hidden>Explorer</span>
        </div>
      ) : (
        <div className="wk-expl-stack">
          <ExplorerPanel pushToast={pushToast} onOpenModel={() => setOpenModelShown(true)} />
          <div className={`wk-expl-resizer${explResizing ? ' dragging' : ''}`}
            onPointerDown={startExplResize} title="Drag to resize" />
        </div>
      )}
      <div className="wk-canvas">
        {!openMode ? (
          <div className="rd-small" style={{ padding: 16, color: 'var(--muted)' }}>
            Pick a version to open the model.
          </div>
        ) : deletionPending && activeProject ? (
          <DeletionPendingPanel
            project={activeProject}
            onUndo={() => { void runBlocking('Restoring project…', undoProjectDeletion).catch(reportWriteError((e) => pushToast(failureText("Couldn't restore the project", e), 'err'))); }}
            onSend={() => setPublishFromPanel(true)}
          />
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
        {/* Doc 86 D1: el selector lógico/físico vive en la barra de tools (grupo
            Model); acá queda el rótulo del modelo activo. */}
        <span className="rd-small" style={{ color: 'var(--muted)' }}>{openMode ? MODEL_MODE_CAPTION[viewMode] : ''}</span>
      </div>
      {/* Doc 49: el área `props` del grid muestra UN panel a la vez — con una
          columna seleccionada, su Properties reemplaza al de la tabla. */}
      {selectedColumnId && openMode
        ? <ColumnPropertiesPanel pushToast={pushToast} onResize={setPropsWidth} />
        : selectedViewId && openMode
          ? <ViewPropertiesPanel pushToast={pushToast} onResize={setPropsWidth} />
          : selectedTableId && openMode && <PropertiesPanel pushToast={pushToast} onResize={setPropsWidth} />}
      {columnTarget && <ColumnEditor tableId={columnTarget} onClose={() => setColumnTarget(null)} onAdd={addColumn} />}
      <PublishModal open={publishFromPanel} onClose={() => setPublishFromPanel(false)} />
      <OpenModelModal
        open={openModelShown && !newProjectShown}
        onClose={closeOpenModel}
        defaultProjectId={presetProjectId ?? lastProjectId()}
        users={users}
        onNewProject={() => setNewProjectShown(true)}
      />
      <NewProjectModal
        open={newProjectShown}
        onClose={() => setNewProjectShown(false)}
        onCreated={(p) => { setNewProjectShown(false); setPresetProjectId(p.id); setOpenModelShown(true); }}
      />
      {/* Doc 72 §3: Object Inspector — metadata de tabla/vista/columna sin canvas. */}
      <ObjectInspector />
      {/* Doc 72 r2: overlay bloqueante mientras Locate abre otro canvas y centra. */}
      <NavigatingOverlay />
      {/* El <Toaster> ahora es global (App.tsx): uno solo para toda la app. */}
    </div>
  );
}
