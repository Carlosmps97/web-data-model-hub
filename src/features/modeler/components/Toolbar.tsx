import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react';
import { facetNouns, PHYSICAL_ONLY_TOOL_TIP, toolAvailableIn } from '@/lib/facets';
import { createPortal } from 'react-dom';
import {
  Table2, Combine, Network, Search, Save, ArrowUpToLine, ChevronDown, ChevronUp,
  Square, Circle, Minus, Star, Diamond, Type, RectangleHorizontal,
  FileCode2, FileSpreadsheet, ImageDown, AppWindow, FileDown, FolderCog, FolderOpen, Eye, Settings2, Undo2, Redo2,
  MoreHorizontal, Shapes,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useFloating } from '@/components/ui/useFloating';
import { placeNextTo, type RectLike } from '@/lib/floating';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { EndIcon, RelLabelIcon, RelLineIcon, SubcatIcon } from './RelIcon';
import type { Cardinality } from '@/services/governance.service';
import { failureText, manualRouteCount, useModelerStore } from '@/store/useModelerStore';
import { useUndoStore } from '@/store/useUndoStore';
import { REDO_KEY_LABEL, SEARCH_KEY_LABEL, UNDO_KEY_LABEL } from './ColumnContextMenu';
import { historyTip, runHistory } from '../lib/historyKeys';
import { modalOpen } from '@/components/ui/focusTrap';
import type { DrawingType } from '@/features/modeler/services/modeler.service';
import { useSessionStore } from '@/store/useSessionStore';
import { canvasSessionKey } from '../lib/canvasSession';
import { useUiStore } from '@/store/useUiStore';
import { runBlocking } from '@/store/useBusyStore';
import { isAsOfChangesetId } from '@/services/versioning.service';
import { reportWriteError } from '../lib/sessionGuard';
import { UploadModal } from '@/features/upload';
import NewTableModal from './NewTableModal';
import CtasModal from './CtasModal';
import SchemaManagerModal from './SchemaManagerModal';
import PublishModal from './PublishModal';
import { ExportDdlModal } from '@/features/ddl';
import ViewEditor from './ViewEditor';
import ModelPropertiesModal from './ModelPropertiesModal';
import SearchModelPopup from './SearchModelPopup';
import { liveLayout } from '../lib/viewerLayout';
import { arrangeResetWarning } from '../lib/wireRoute';
import { TOOLBAR_STEPS, stepOn, type ToolbarStep } from '../lib/toolbarFit';
import { blocksRepeat, nextIn, tabExit } from '../lib/toolbarKeys';
import { useToolbarFit } from './useToolbarFit';
import { useAuthStore } from '@/store/useAuthStore';
import { NO_EXPORT_HINT } from '@/lib/permissionHints';

// Las 4 cardinalidades crow's-foot del preset por extremo (el popup de la
// relación ofrece las 6, incluyendo 'many' pelado y 'one-only').
const CARDS: { k: Cardinality; tip: string }[] = [
  { k: 'one', tip: 'Exactly one' },
  { k: 'zero-one', tip: 'Zero or one' },
  { k: 'one-many', tip: 'One or more' },
  { k: 'zero-many', tip: 'Zero or many' },
];

// Formas del grupo DRAWING. `id` = DrawingType; cada botón crea una forma.
const SHAPES: { id: DrawingType; tip: string; icon: ReactNode }[] = [
  { id: 'rect', tip: 'Rectangle', icon: <RectangleHorizontal size={17} /> },
  { id: 'square', tip: 'Square', icon: <Square size={17} /> },
  { id: 'circle', tip: 'Circle', icon: <Circle size={17} /> },
  { id: 'ellipse', tip: 'Ellipse', icon: (
    <svg width={17} height={17} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <ellipse cx="8" cy="8" rx="7" ry="4.5" />
    </svg>
  ) },
  { id: 'line', tip: 'Line', icon: <Minus size={17} /> },
  { id: 'star', tip: 'Star', icon: <Star size={17} /> },
  { id: 'diamond', tip: 'Diamond', icon: <Diamond size={17} /> },
  { id: 'text', tip: 'Text', icon: <Type size={17} /> },
];

const VIEWER_TIP = 'Read-only — published version';
const MODEL_PROPS_TIP = 'Model properties — UDPs and colors of this canvas';


/** ⌘K / Ctrl+K: abre el buscador del Model con una sesión de canvas abierta.
 *  No con un modal o una espera en pantalla (`modalOpen`): el buscador quedaría
 *  debajo de «Saving working copy…» y se llevaría el foco. */
export function onSearchShortcut(e: KeyboardEvent, open: () => void): void {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) return;
  e.preventDefault();
  if (modalOpen() || !useSessionStore.getState().openMode) return;
  open();
}

export default function Toolbar({ pushToast, onOpenModel }: { pushToast: (m: string, k?: 'err') => void; onOpenModel?: () => void }) {
  // Barra de herramientas colapsable (la navegación de módulos no).
  const toolbarCollapsed = useUiStore((st) => st.toolbarCollapsed);
  const toggleToolbar = useUiStore((st) => st.toggleToolbar);
  // Mostrar/ocultar las etiquetas de relación (por navegador).
  const relLabelsHidden = useUiStore((st) => st.relLabelsHidden);
  const toggleRelLabels = useUiStore((st) => st.toggleRelLabels);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const diagram = useModelerStore((s) => s.diagram);
  const relPreset = useModelerStore((s) => s.relPreset);
  const setRelPreset = useModelerStore((s) => s.setRelPreset);
  // La herramienta Subcategory solo vive en modelo lógico: en físico el botón
  // se deshabilita y el store la desarma al cambiar de modo.
  const viewMode = useModelerStore((s) => s.viewMode);
  const setViewMode = useModelerStore((s) => s.setViewMode);
  const n = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  const subcatArmed = useModelerStore((s) => s.subcatArmed);
  const setSubcatArmed = useModelerStore((s) => s.setSubcatArmed);
  const autoOrganize = useModelerStore((s) => s.autoOrganize);
  const createTable = useModelerStore((s) => s.createTable);
  const addDrawing = useModelerStore((s) => s.addDrawing);
  const saveAll = useModelerStore((s) => s.saveAll);
  const reload = useModelerStore((s) => s.reload);
  // Una vista recién creada se suma a la membresía de este canvas.
  const addViewsToCanvas = useModelerStore((s) => s.addViewsToCanvas);

  const openMode = useSessionStore((s) => s.openMode);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  // El chip nombra el proyecto de la sesión.
  const projectName = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name ?? null);
  const readonly = openMode === 'readonly';
  // Visor de un snapshot (`asof:<versionId>`): el modelo tal como se
  // publicó en esa versión, reconstruido del ledger.
  const snapshot = isAsOfChangesetId(useSessionStore((s) => s.activeChangesetId));
  // La carga masiva escribe en el draft activo: no exige canvas
  // abierto (crea proyectos/canvases), sí sesión de edición con changeset.
  const activeCsId = useSessionStore((s) => s.activeChangesetId);
  const canUpload = openMode === 'editing' && !!activeCsId;

  // Undo y Redo: el tooltip muestra qué se va a deshacer o rehacer (y en qué
  // canvas, si es otro: ahí no corre y el botón lo avisa); cada botón se apaga
  // sin nada que hacer, con un paso en vuelo (spinner en el que corre) o en
  // solo lectura.
  const undoTop = useUndoStore((s) => s.stack[s.stack.length - 1] ?? null);
  const redoTop = useUndoStore((s) => s.redoStack[s.redoStack.length - 1] ?? null);
  const canvases = useModelerStore((s) => s.subjectAreas);
  const historyBusy = useUndoStore((s) => s.busy);
  const running = useUndoStore((s) => s.running);

  const [modal, setModal] = useState<'table' | 'ctas' | 'view' | 'schema' | 'upload' | null>(null);
  // El buscador se comparte con la cabecera del Explorer (estado en el store).
  const searchOpen = useModelerStore((s) => s.searchOpen);
  const setSearchOpen = useModelerStore((s) => s.setSearchOpen);
  const [publishOpen, setPublishOpen] = useState(false);
  const [ddlOpen, setDdlOpen] = useState(false);
  // La ficha del canvas (Model properties): también la abre el color
  // en Properties; el estado vive en el store.
  const modelProps = useModelerStore((s) => s.modelProps);
  const openModelProps = useModelerStore((s) => s.openModelProps);
  const closeModelProps = useModelerStore((s) => s.closeModelProps);
  // Al salir del Model (Toolbar desmontado) la ficha no queda abierta en el
  // store: si quedara, volver la montaría un instante (foco y una lectura de UDPs).
  useEffect(() => () => closeModelProps(), [closeModelProps]);
  // Menú del botón único de export (SVG / HTML / PDF). Portal fixed: el
  // toolbar scrollea horizontal y un menú absoluto se recortaría.
  const [exportOpen, setExportOpen] = useState(false);
  // Exportar (DDL, imagen, HTML, PDF) exige el permiso `export`.
  const canExport = useAuthStore((s) => s.has('export'));
  const [exportPos, setExportPos] = useState<RectLike | null>(null);
  const exportBtnRef = useRef<HTMLSpanElement | null>(null);
  // Selección de cardinalidad por extremo (crow's-foot), en términos
  // PARENT (lado PK) / CHILD (lado FK). Default Erwin: one → zero-many.
  const [relSel, setRelSel] = useState<{ parent: Cardinality; child: Cardinality }>({ parent: 'one', child: 'zero-many' });
  // Acciones largas del toolbar en vuelo (feedback de "en proceso").
  const [saving, setSaving] = useState(false);
  const [arranging, setArranging] = useState(false);
  // Trazos manuales de wires del canvas: el auto-arrange en edición los
  // reinicia, así que primero confirma indicando cuántos son.
  const routeCount = useModelerStore(manualRouteCount);
  // La pregunta es sobre un solo canvas: si mientras está abierta cambia el canvas
  // (buscador, Explorer), deja de valer.
  const [arrangeAsk, setArrangeAsk] = useState<string | null>(null);
  const setRelEnd = (end: 'parent' | 'child', c: Cardinality) => {
    const next = { ...relSel, [end]: c };
    setRelSel(next);
    if (relPreset) setRelPreset({ ...next, identifying: relPreset.identifying });
  };
  // Dos herramientas de dibujo estilo Erwin: Identifying (sólida) y
  // Non-identifying (punteada). Armar una desarma la otra; un segundo clic desarma.
  const armRel = (identifying: boolean) =>
    setRelPreset(relPreset?.identifying === identifying ? null : { ...relSel, identifying });

  const hasCanvas = activeSaId != null && diagram != null;
  // Edición habilitada: hay canvas y no es modo solo lectura.
  const canEdit = hasCanvas && !readonly;

  // La barra se compacta por pasos hasta entrar en una sola fila (sin scroll
  // horizontal ni filas desparejas); pasado el último, envuelve antes que
  // esconder botones. Lo compactado de un grupo queda en un menú en su lugar.
  const tbRef = useRef<HTMLDivElement | null>(null);
  const pillText = `${projectName ? `«${projectName}» · ` : ''}${readonly ? (snapshot ? 'Snapshot' : 'Viewer') : 'Editing'} · ${versionLabel ?? '—'}`;
  const level = useToolbarFit(tbRef, TOOLBAR_STEPS.length + 1,
    `${openMode ? pillText : ''}|${saving}|${!!onOpenModel}|${toolbarCollapsed}`, !toolbarCollapsed);
  const on = (step: ToolbarStep) => !toolbarCollapsed && stepOn(level, step);
  const tbClass = toolbarCollapsed ? ' wk-toolbar--collapsed'
    : TOOLBAR_STEPS.filter((st) => stepOn(level, st)).map((st) => ` tb-${st}`).join('') + (level > TOOLBAR_STEPS.length ? ' tb-wrap' : '');
  const cardTip = (c: Cardinality) => CARDS.find((x) => x.k === c)?.tip ?? c;
  // Un menú de grupo a la vez; si la barra cambia de nivel, los botones se
  // mueven y el menú abierto se cierra.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menus = useMemo(() => ({ open: openMenu, setOpen: setOpenMenu, level }), [openMenu, level]);

  // ⌘K / Ctrl+K abre el buscador del Model.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onSearchShortcut(e, () => useModelerStore.getState().setSearchOpen(true));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Los fallos de una escritura esperan la revalidación y callan si la sesión
  // cambia (`reportWriteError`: el aviso lo da la revalidación).
  const onSave = async () => {
    setSaving(true);
    // Propaga el motivo real (p.ej. un 4xx del backend), no un genérico.
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'));
    try { await runBlocking('Saving working copy…', saveAll); pushToast('Saved'); }
    catch (e) { await onError(e); }
    finally { setSaving(false); }
  };
  const runArrange = async () => {
    setArranging(true);
    const onError = reportWriteError((e) => pushToast(failureText("Couldn't auto-arrange", e), 'err'));
    try { await autoOrganize(); }
    catch (e) { await onError(e); }
    finally { setArranging(false); }
  };
  const onArrange = () => {
    // En visor el arrange es de la sesión (nada se guarda): no hay qué confirmar.
    if (!readonly && routeCount > 0) { setArrangeAsk(activeSaId); return; }
    void runArrange();
  };

  // Export sin captura de DOM: la escena se dibuja desde el modelo (solo
  // diagrama: columnas, relaciones, pintados) y todo baja por Blob; los módulos
  // pesados cargan lazy. Clonar el DOM de un canvas grande (cientos de miles de
  // elementos con getComputedStyle) tardaría minutos y un data URL gigante
  // superaría el límite de ~2MB de Chrome, con descargas vacías.
  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = filename;
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const exportDiagram = async (kind: 'svg' | 'html' | 'pdf') => {
    setExportOpen(false);
    try {
      const st = useModelerStore.getState();
      if (!st.diagram) { pushToast('Nothing to export', 'err'); return; }
      const name = st.diagram.subjectArea.name || 'canvas';
      const [{ buildDiagramScene }, { buildDiagramSvg }] = await Promise.all([
        import('../lib/exportScene'), import('../lib/sceneSvg'),
      ]);
      // Los trazos manuales están referidos a la posición actual de los
      // bloques. En edición el export toma las posiciones vivas (el diagrama
      // del store guarda las de su última carga: sin esto un trazo recién hecho
      // saldría unido a la tabla en su posición anterior) y los trazos vivos.
      // En visor exporta lo publicado: posiciones y trazos publicados, sin los
      // movimientos efímeros de la sesión.
      const viewer = useSessionStore.getState().openMode === 'readonly';
      const sa = st.diagram.subjectArea;
      const diagram = viewer || !st.flow
        ? st.diagram
        : { ...st.diagram, subjectArea: { ...sa, layout: liveLayout(sa.layout, st.flow.getNodes()) } };
      // El export respeta el botón Show/Hide relationship labels.
      const scene = buildDiagramScene({
        diagram, drawings: st.drawings, viewMode: st.viewMode,
        relLabels: !useUiStore.getState().relLabelsHidden,
        routes: st.canvasRoutes,
        colors: st.canvasColors, themes: st.themes,   // los vivos, como los trazos
      });
      if (kind === 'pdf') {
        const { buildDiagramPdf } = await import('../lib/scenePdf');
        download(new Blob([buildDiagramPdf(scene)], { type: 'application/pdf' }), `${name}.pdf`);
        pushToast('PDF exported');
        return;
      }
      const { EXPORT_FONT_CSS } = await import('../lib/exportFonts');
      const svg = buildDiagramSvg(scene, { fontCss: EXPORT_FONT_CSS });
      if (kind === 'svg') {
        download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
        pushToast('SVG image exported');
      } else {
        const { buildInteractiveHtml } = await import('../lib/exportHtml');
        download(new Blob([buildInteractiveHtml({ title: name, svgMarkup: svg })], { type: 'text/html' }), `${name}.html`);
        pushToast('Interactive HTML exported');
      }
    } catch {
      pushToast("Couldn't export the diagram", 'err');
    }
  };

  // Cambiar de modelo con un popup de creación abierto lo cierra: un popup es
  // de una sola faceta (entidad o tabla, atributo o columna).
  useEffect(() => { setModal(null); }, [viewMode]);
  // Los diálogos con fondo de canvas dejan el Toolbar y el TopNav clicables:
  // al cambiar la sesión (otra versión, modo o proyecto) se cierran todos, para
  // que lo armado en una no se grabe en la otra.
  const sessionKey = useSessionStore((s) => canvasSessionKey(s));
  useEffect(() => {
    setModal(null); setPublishOpen(false); setDdlOpen(false); closeModelProps(); setExportOpen(false); setArrangeAsk(null);
  }, [sessionKey, closeModelProps]);

  // Nombre accesible de un botón de ícono: el tooltip solo se ve con el mouse
  // (sin nombre, el lector de pantalla anunciaría «button» sin más). En el visor
  // dice además por qué está deshabilitado.
  const named = (label: string, lockTip = true) => (lockTip && readonly ? `${label} — ${VIEWER_TIP}` : label);

  // Botón-icono de sección. `disabled` ya contempla viewer-lock en cada call.
  // `text` = su nombre corto dentro del menú de un grupo compactado.
  const ic = (label: string, node: ReactNode, onClick: () => void, opts?: { on?: boolean; disabled?: boolean; lockTip?: boolean; text?: string; tip?: string }) => (
    <ToolBtn tip={opts?.tip ?? (opts?.lockTip && readonly ? VIEWER_TIP : label)} name={named(label, !!opts?.lockTip)} text={opts?.text}
      on={opts?.on} disabled={opts?.disabled} onClick={onClick}>{node}</ToolBtn>
  );

  return (
    <ToolMenus.Provider value={menus}>
    {/* Enter o Espacio sostenidos no encadenan herramientas (cada repetición
        activaría lo que tuviera el foco, hasta confirmar un Auto-arrange). */}
    <div ref={tbRef} className={`wk-toolbar${tbClass}`}
      onKeyDownCapture={(e) => { if (blocksRepeat({ repeat: e.repeat, key: e.key, target: e.target as HTMLElement }, tbRef.current)) e.preventDefault(); }}>
      {/* Barra colapsada a una franja: solo el botón para mostrarla y el
          contexto de la versión; los popups (abajo) siguen montados. */}
      {toolbarCollapsed && (
        <div className="wk-tb-strip">
          <button type="button" className="wk-tb-expand" onClick={toggleToolbar}
            title="Show the tools bar" aria-label="Show the tools bar" aria-expanded={false}>
            <ChevronDown size={13} /> Tools
          </button>
          {openMode && (
            <span className="wk-tb-strip-ctx">
              {projectName && <><span className="wk-ctx-proj">{`«${projectName}»`}</span><span className="wk-ctx-sep"> · </span></>}
              <span className="wk-ctx-ver">{readonly ? (snapshot ? 'Snapshot' : 'Viewer') : 'Editing'} · {versionLabel ?? '—'}</span>
            </span>
          )}
        </div>
      )}
      {!toolbarCollapsed && (<>
      {/* MODEL: el «botón padre» lógico/físico estilo Erwin; gobierna explorer,
          tools, popups, UDPs, dominios y labels del canvas. Incluye también la
          ficha del canvas abierto (Model properties: UDPs + colores). */}
      <div className="wk-grp">
        <div className="wk-modelcol">
          <div className="wk-seg" role="group" aria-label="Model view">
            <Tooltip label="Logical model — entities & attributes">
              <button type="button" className={`wk-seg-btn${viewMode === 'logical' ? ' on' : ''}`} aria-pressed={viewMode === 'logical'} disabled={!openMode} onClick={() => setViewMode('logical')}>Logical</button>
            </Tooltip>
            <Tooltip label="Physical model — tables, columns & views">
              <button type="button" className={`wk-seg-btn${viewMode === 'physical' ? ' on' : ''}`} aria-pressed={viewMode === 'physical'} disabled={!openMode} onClick={() => setViewMode('physical')}>Physical</button>
            </Tooltip>
          </div>
          <Tooltip label={readonly ? `${MODEL_PROPS_TIP} — read-only` : MODEL_PROPS_TIP}>
            {/* Alterna: la barra sigue clicable con la ficha abierta (fondo de
                canvas) y abrirla de nuevo encima no tiene sentido. */}
            <button type="button" className={`wk-mprops${modelProps ? ' on' : ''}`} aria-label={MODEL_PROPS_TIP}
              aria-expanded={!!modelProps} disabled={!hasCanvas}
              onClick={() => (modelProps ? closeModelProps() : openModelProps())}>
              <Settings2 size={13} aria-hidden /><span className="wk-mprops-txt">Model properties</span>
            </button>
          </Tooltip>
        </div>
        <span className="wk-grp-cap">Model</span>
      </div>
      <span className="wk-div" />

      {/* STRUCTURE — Views, CTAS, Schemas y la carga Excel son físicos. */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic(`New ${n.one}`, <Table2 size={17} />, () => setModal('table'), { disabled: !canEdit, lockTip: true })}
          <Collapsible when={on('structure')} menu={{ name: 'More structure tools — CTAS, views, schemas and Excel upload', icon: <MoreHorizontal size={17} />, list: true, disabled: !openMode }}>
            {ic(toolAvailableIn('ctas', viewMode) ? 'CTAS — create from existing' : PHYSICAL_ONLY_TOOL_TIP.ctas, <Combine size={17} />, () => setModal('ctas'), { disabled: !canEdit || !toolAvailableIn('ctas', viewMode), lockTip: true, text: 'CTAS' })}
            {ic(toolAvailableIn('view', viewMode) ? 'Create view' : PHYSICAL_ONLY_TOOL_TIP.view, <Eye size={17} />, () => setModal('view'), { disabled: !canEdit || !toolAvailableIn('view', viewMode), lockTip: true, text: 'Create view' })}
            {ic(toolAvailableIn('schema', viewMode) ? 'Schemas — create & manage' : PHYSICAL_ONLY_TOOL_TIP.schema, <FolderCog size={17} />, () => setModal('schema'), { disabled: !canEdit || !toolAvailableIn('schema', viewMode), lockTip: true, text: 'Schemas' })}
            {/* La carga Excel también es física (crea tablas con esquema y sus vistas). */}
            {ic(toolAvailableIn('upload', viewMode) ? 'Upload from Excel — create or update tables, columns and structure in bulk' : PHYSICAL_ONLY_TOOL_TIP.upload, <FileSpreadsheet size={17} />, () => setModal('upload'), { disabled: !canUpload || !toolAvailableIn('upload', viewMode), lockTip: true, text: 'Upload from Excel' })}
          </Collapsible>
        </div>
        <span className="wk-grp-cap">Structure</span>
      </div>
      <span className="wk-div" />

      {/* SEARCH & INSPECT: un solo popup busca (o navega por filtros) tablas,
          columnas y definiciones en toda la versión; cada hit ofrece «Locate on
          canvas» (redirige/centra) e «Inspect metadata» (Object Inspector, sin
          canvas). */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic(`Search the model — locate a table, column or definition on its canvas, or inspect its metadata (${SEARCH_KEY_LABEL})`, <Search size={17} />, () => setSearchOpen(true), { disabled: !openMode })}
        </div>
        <span className="wk-grp-cap">Search &amp; inspect</span>
      </div>
      <span className="wk-div" />

      {/* RELATIONSHIPS — cardinalidad por extremo (crow's-foot, Parent/Child)
          + dos herramientas de dibujo estilo Erwin */}
      <div className="wk-grp">
        {/* Al compactar, primero las cardinalidades (su botón muestra las
            elegidas) y al final todo el grupo, cada parte en su menú. */}
        <Collapsible when={on('rel')} menu={{ name: 'Relationships — cardinality, draw, subcategory and labels', icon: <RelLineIcon />, active: !!relPreset || subcatArmed, disabled: !openMode }}>
        <div className="wk-relwrap">
          <Collapsible when={on('ends') && !on('rel')} menu={{
            name: `Relationship ends — Parent: ${cardTip(relSel.parent)} · Child: ${cardTip(relSel.child)}`, keepOpen: true, disabled: !openMode,
            icon: <span className="wk-grpmenu-ends"><EndIcon cardinality={relSel.parent} size={14} /><EndIcon cardinality={relSel.child} size={14} /></span>,
          }}>
          <div className="wk-relbuild" data-keep-open>
            {(['parent', 'child'] as const).map((end) => (
              <div className="wk-relrow" key={end}>
                <span className="wk-rellbl">{end === 'parent' ? 'Parent' : 'Child'}</span>
                {CARDS.map((c) => (
                  <Tooltip key={c.k} label={readonly ? VIEWER_TIP : c.tip}>
                    <button
                      type="button"
                      className={`wk-relend${relSel[end] === c.k ? ' on' : ''}`}
                      aria-label={named(`${end === 'parent' ? 'Parent' : 'Child'} end: ${c.tip}`)}
                      aria-pressed={relSel[end] === c.k}
                      disabled={!canEdit}
                      onClick={() => setRelEnd(end, c.k)}
                    >
                      <EndIcon cardinality={c.k} size={15} />
                    </button>
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
          </Collapsible>
          <div className="wk-reldraw2">
            <Tooltip label={readonly ? VIEWER_TIP : relPreset?.identifying
              ? 'Exit drawing mode'
              : "Identifying (solid line): the FK joins the child's PK. Drag from the PARENT table header to the child"}>
              <button
                type="button"
                className={`wk-reldraw${relPreset?.identifying ? ' on' : ''}`}
                aria-label={named('Draw an identifying relationship (solid line)')}
                aria-pressed={!!relPreset?.identifying}
                disabled={!canEdit}
                onClick={() => armRel(true)}
              >
                <RelLineIcon />
              </button>
            </Tooltip>
            <Tooltip label={readonly ? VIEWER_TIP : relPreset && !relPreset.identifying
              ? 'Exit drawing mode'
              : 'Non-identifying (dashed line): plain FK, outside the PK. Drag from the PARENT table header to the child'}>
              <button
                type="button"
                className={`wk-reldraw${relPreset && !relPreset.identifying ? ' on' : ''}`}
                aria-label={named('Draw a non-identifying relationship (dashed line)')}
                aria-pressed={!!relPreset && !relPreset.identifying}
                disabled={!canEdit}
                onClick={() => armRel(false)}
              >
                <RelLineIcon dashed />
              </button>
            </Tooltip>
          </div>
          {/* Subcategoría aparte: es supertipo/subtipo, no un tercer
              estilo de línea identifying/non-identifying */}
          <span className="wk-relsep" />
          <div className="wk-reldraw2 wk-subcatcol">
            <Tooltip label={readonly ? VIEWER_TIP
              : viewMode !== 'logical' ? 'Subcategory — available in the Logical view only'
              : subcatArmed ? 'Exit subcategory mode'
              : "Subcategory (supertype/subtype): drag from the SUPERTYPE header onto the subtype table — the supertype's key becomes the subtype's key. Logical model only"}>
              <button
                type="button"
                className={`wk-reldraw${subcatArmed ? ' on' : ''}`}
                aria-label={named(viewMode !== 'logical' ? 'Draw a subcategory — available in the Logical view only' : 'Draw a subcategory (supertype/subtype)')}
                aria-pressed={subcatArmed}
                disabled={!canEdit || viewMode !== 'logical'}
                onClick={() => setSubcatArmed(!subcatArmed)}
              >
                <SubcatIcon />
              </button>
            </Tooltip>
            {/* Etiquetas de relación (frases): preferencia de visualización,
                así que también vale en modo visor. */}
            <Tooltip label={relLabelsHidden
              ? 'Show relationship labels (verb phrases)'
              : 'Hide relationship labels (verb phrases)'}>
              <button
                type="button"
                className={`wk-reldraw wk-rellabel${relLabelsHidden ? '' : ' on'}`}
                aria-label="Relationship labels"
                aria-pressed={!relLabelsHidden}
                disabled={!hasCanvas}
                onClick={toggleRelLabels}
              >
                <RelLabelIcon />
              </button>
            </Tooltip>
          </div>
        </div>
        </Collapsible>
        <span className="wk-grp-cap">Relationships</span>
      </div>
      <span className="wk-div" />

      {/* DRAWING: 2 filas × 4; cada botón crea una forma en el centro */}
      <div className="wk-grp">
        <Collapsible when={on('drawing')} menu={{ name: 'Drawing — add a shape', icon: <Shapes size={17} />, disabled: !openMode }}>
        <div className="wk-drawgrid">
          {SHAPES.map((s) => (
            <Tooltip key={s.id} label={readonly ? VIEWER_TIP : s.tip}>
              <button type="button" className="wk-drawbtn" aria-label={named(`Add ${/^[aeiou]/i.test(s.tip) ? 'an' : 'a'} ${s.tip.toLowerCase()}`)} disabled={!canEdit} onClick={() => addDrawing(s.id)}>
                {s.icon}
              </button>
            </Tooltip>
          ))}
        </div>
        </Collapsible>
        <span className="wk-grp-cap">Drawing</span>
      </div>
      <span className="wk-div" />

      {/* Los estándares (UDP / Parent Domains) viven en el módulo "Data
          Standards": reglas globales, versionadas aparte, fuera del
          canvas/changeset. */}

      {/* ACTIONS */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic(
            historyTip('undo', undoTop, UNDO_KEY_LABEL, activeSaId, canvases),
            running === 'undo' ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Undo2 size={17} />,
            () => runHistory('undo', pushToast),
            { disabled: !canEdit || historyBusy || !undoTop, lockTip: true },
          )}
          {ic(
            historyTip('redo', redoTop, REDO_KEY_LABEL, activeSaId, canvases),
            running === 'redo' ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Redo2 size={17} />,
            () => runHistory('redo', pushToast),
            { disabled: !canEdit || historyBusy || !redoTop, lockTip: true },
          )}
          <Collapsible when={on('actions')} menu={{
            name: 'More actions — auto-arrange and exports', list: true, active: exportOpen, disabled: !openMode,
            icon: arranging ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <MoreHorizontal size={17} />,
          }}>
          {/* También en modo visor (solo en esta sesión, no se guarda). */}
          {ic(readonly ? 'Auto-arrange — view only, not saved' : 'Autoarrange', arranging ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Network size={17} />, () => void onArrange(), { disabled: !hasCanvas || arranging, text: 'Auto-arrange' })}
          {ic('Export DDL', <FileCode2 size={17} />, () => setDdlOpen(true),
            { disabled: !hasCanvas || !canExport, text: 'Export DDL', tip: canExport ? undefined : NO_EXPORT_HINT })}
          {/* En el menú de lista, a todo el ancho como las demás. */}
          <span ref={exportBtnRef} style={{ display: 'flex', flexDirection: 'column' }}>
            {ic('Export diagram — SVG · interactive HTML · PDF', <ImageDown size={17} />, () => {
              const r = exportBtnRef.current?.getBoundingClientRect();
              setExportPos(r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null);
              setExportOpen((v) => !v);
            }, { disabled: !hasCanvas || !canExport, on: exportOpen, text: 'Export diagram', tip: canExport ? undefined : NO_EXPORT_HINT })}
          </span>
          </Collapsible>
        </div>
        <span className="wk-grp-cap">Actions</span>
      </div>

      {/* ── Cluster derecho ── */}
      <div className="wk-right">
        {/* Responsive: en filas envueltas el contexto va a la
            izquierda y las acciones a la derecha (space-between); la parte
            «proyecto» de la pill se oculta en pantallas angostas. */}
        <div className="wk-right-ctx">
        {onOpenModel && (
          <Tooltip label="Open or switch version">
            <button className="wk-save wk-open" aria-label="Open model" onClick={onOpenModel}><FolderOpen size={15} /><span className="wk-btn-txt">Open model</span></button>
          </Tooltip>
        )}
        {openMode && (
          <span className={`wk-vpill${readonly ? ' viewer' : ''}`}
            title={snapshot ? 'Read-only snapshot of a published version, rebuilt from the change ledger' : pillText}>
            {projectName && <><span className="wk-vpill-proj wk-ctx-proj">{`«${projectName}»`}</span><span className="wk-vpill-proj wk-ctx-sep"> · </span></>}
            <span className="wk-ctx-ver">{readonly ? (snapshot ? 'Snapshot' : 'Viewer') : 'Editing'} · {versionLabel ?? '—'}</span>
          </span>
        )}
        </div>
        <div className="wk-right-act">
        <Tooltip label={readonly ? VIEWER_TIP : 'Save working copy'}>
          <button className="wk-save" aria-label={saving ? 'Saving…' : 'Save'} disabled={!canEdit || saving} onClick={onSave}>{saving ? <span className="rd-spin" /> : <Save size={15} />}<span className="wk-btn-txt">{saving ? 'Saving…' : 'Save'}</span></button>
        </Tooltip>
        <Tooltip label={readonly ? VIEWER_TIP : 'Publish version'}>
          <button className="wk-publish" aria-label="Publish" disabled={!canEdit} onClick={() => setPublishOpen(true)}><ArrowUpToLine size={15} /><span className="wk-btn-txt">Publish</span></button>
        </Tooltip>
        {/* Colapsa la barra de herramientas (más espacio de canvas). */}
        <Tooltip label="Hide the tools bar — more room for the canvas">
          <button type="button" className="wk-tb-collapse" onClick={toggleToolbar} aria-label="Hide the tools bar" aria-expanded={true}>
            <ChevronUp size={15} />
          </button>
        </Tooltip>
        </div>
      </div>
      </>)}

      {/* Por portal: dentro del toolbar heredaría su `white-space: nowrap` y el
          aviso saldría cortado en una sola línea. */}
      {arrangeAsk != null && arrangeAsk === activeSaId && createPortal(
        <ConfirmDialog
          open
          title="Auto-arrange this canvas?"
          confirmLabel="Auto-arrange"
          message={arrangeResetWarning(routeCount) ?? 'Auto-arrange moves every block on this canvas.'}
          onConfirm={() => {
            const asked = arrangeAsk;
            setArrangeAsk(null);
            if (asked === useModelerStore.getState().activeSaId) void runArrange();
          }}
          onCancel={() => setArrangeAsk(null)}
        />, document.body)}
      {modal === 'table' && <NewTableModal onClose={() => setModal(null)} onCreate={createTable} />}
      {modal === 'ctas' && <CtasModal onClose={() => setModal(null)} pushToast={pushToast} />}
      {modal === 'view' && (
        <ViewEditor onClose={() => setModal(null)} pushToast={pushToast}
          onSaved={(v, created) => {
            // Si la vista recién creada no entra al canvas, se dice por qué y qué
            // falló; con la versión recién transferida, calla.
            if (created && v.showOnCanvas !== false) {
              void addViewsToCanvas([v.id])
                .catch(reportWriteError((e) => pushToast(failureText("Couldn't add the view to this canvas", e), 'err')));
            } else void reload();
          }} />
      )}
      {modal === 'schema' && <SchemaManagerModal onClose={() => setModal(null)} pushToast={pushToast} />}
      {modal === 'upload' && <UploadModal onClose={() => setModal(null)} pushToast={pushToast} />}

      {/* Buscador del Model (tablas · columnas · definiciones). */}
      {searchOpen && <SearchModelPopup onClose={() => setSearchOpen(false)} pushToast={pushToast} />}

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} />

      {modelProps && diagram && modelProps.saId === diagram.subjectArea.id && (
        <ModelPropertiesModal
          subjectArea={diagram.subjectArea}
          canEdit={canEdit}
          boxes={modelProps.boxes}
          onClose={() => closeModelProps(modelProps)}
          pushToast={pushToast}
        />
      )}

      {exportOpen && exportPos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setExportOpen(false)} />
          <MenuNextTo at={exportPos} onClose={() => setExportOpen(false)}>
            <button onClick={() => void exportDiagram('svg')}><ImageDown size={14} /> SVG image (.svg)</button>
            <button onClick={() => void exportDiagram('html')}><AppWindow size={14} /> Interactive HTML — deep zoom (.html)</button>
            <button onClick={() => void exportDiagram('pdf')}><FileDown size={14} /> PDF document (.pdf)</button>
          </MenuNextTo>
        </>, document.body)}
      <ExportDdlModal open={ddlOpen} diagram={diagram} modelName={diagram?.subjectArea.name ?? 'model'} onClose={() => setDdlOpen(false)} />

      {relPreset && <div className="wk-relhint">Draw the {relPreset.identifying ? 'identifying (solid)' : 'non-identifying (dashed)'} relationship: drag from the PARENT {n.one} header (blue ring) onto a child {n.member} or the child header — the parent's whole primary key is migrated. <button type="button" className="wk-relhint-exit" onClick={() => setRelPreset(null)}>Exit</button></div>}
      {subcatArmed && <div className="wk-relhint">Draw the subcategory: drag from the SUPERTYPE {n.one} header (blue ring) — or from an existing subcategory symbol — onto the subtype {n.one}. The supertype&apos;s key becomes the subtype&apos;s key (is-a, 1:1). <button type="button" className="wk-relhint-exit" onClick={() => setSubcatArmed(false)}>Exit</button></div>}
    </div>
    </ToolMenus.Provider>
  );
}

/** Menú de un botón del toolbar (Export diagram): debajo del
 *  botón, arriba si no entra y siempre dentro de la ventana. */
function MenuNextTo({ at, onClose, children }: { at: RectLike; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useFloating(ref, (box, bounds) => placeNextTo(at, box, bounds, { side: 'bottom', align: 'start', gap: 6 }), [at]);
  useEscape(onClose);   // Esc lo cierra (también un clic afuera)
  return <div ref={ref} className="wk-ctxmenu" style={place}>{children}</div>;
}

/** Dentro del menú de un grupo compactado, cada herramienta muestra también
 *  su nombre (en la barra, solo el ícono con su tooltip). */
const InToolMenu = createContext(false);

function ToolBtn({ tip, name, text, on, disabled, onClick, children }: {
  tip: string; name: string; text?: string; on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  const inMenu = useContext(InToolMenu) && !!text;
  return (
    <Tooltip label={tip} side={inMenu ? 'right' : undefined}>
      <button className={`wk-tic${inMenu ? ' wk-tic--menu' : ''}${on ? ' on' : ''}`} aria-label={name} disabled={disabled} onClick={onClick}>
        {children}{inMenu && <span className="wk-tic-txt">{text}</span>}
      </button>
    </Tooltip>
  );
}

/** Lo que recibe el foco con Tab dentro de la barra. */
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface MenuSpec {
  /** Nombre del grupo: el del botón (accesible y tooltip) y el del menú. */
  name: string;
  icon: ReactNode;
  /** Las herramientas en lista, con su nombre (si no, tal cual: grilla o filas). */
  list?: boolean;
  /** Elegir no cierra el menú (las cardinalidades: se eligen las dos puntas). */
  keepOpen?: boolean;
  /** Una herramienta del grupo está activa (dibujando una relación, exportando). */
  active?: boolean;
  disabled?: boolean;
}

/** Una parte de la barra que se compacta: `when` en false, tal cual;
 *  en true, un botón en su lugar que la abre en un menú flotante. */
function Collapsible({ when, menu, children }: { when: boolean; menu: MenuSpec; children: ReactNode }) {
  return when ? <GroupMenu {...menu}>{children}</GroupMenu> : <>{children}</>;
}

/** Los menús de grupo de la barra: cuál está abierto (uno a
 *  la vez) y el nivel de compactación (al cambiar, el menú abierto se cierra:
 *  su botón se movió). */
const ToolMenus = createContext<{ open: string | null; setOpen: Dispatch<SetStateAction<string | null>>; level: number }>(
  { open: null, setOpen: () => {}, level: 0 });

/** Esc (en el documento, en captura) mientras el menú está abierto: lo cierra
 *  aunque el foco no esté adentro (Tab afuera, un clic en un rótulo), salvo con
 *  el foco en un diálogo (el buscador, Open model, New table…): ese Esc es suyo;
 *  si cerrara el menú de atrás, el diálogo seguiría abierto. Con una ficha
 *  abierta (Model properties) y el menú encima, el foco está en el menú. */
function useEscape(onEscape: () => void): void {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (document.activeElement as Element | null)?.closest?.('[aria-modal="true"]')) return;
      e.stopPropagation();
      cb.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}

function GroupMenu({ name, icon, list, keepOpen, active, disabled, children }: MenuSpec & { children: ReactNode }) {
  const menus = useContext(ToolMenus);
  const [at, setAt] = useState<RectLike | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const close = useCallback((focusBack = false) => {
    setAt(null);
    menus.setOpen((cur) => (cur === id ? null : cur));
    if (focusBack) btn.current?.focus();
  }, [menus, id]);
  // Uno a la vez (con teclado podrían abrirse dos); y al cambiar el nivel, cerrado.
  useEffect(() => { if (at && menus.open !== id) setAt(null); }, [at, menus.open, id]);
  const level = useRef(menus.level);
  useEffect(() => {
    if (level.current === menus.level) return;
    level.current = menus.level;
    setAt(null);
  }, [menus.level]);
  return (
    <>
      <Tooltip label={name}>
        {/* Patrón «disclosure» (sin `aria-haspopup`: anunciaría un menú y el
            panel es un grupo de botones). */}
        <button ref={btn} type="button" className={`wk-tic wk-grpmenu${at || active ? ' on' : ''}`} aria-label={name}
          aria-expanded={!!at} aria-controls={at ? id : undefined} disabled={disabled}
          onClick={(e) => {
            if (at) { close(); return; }
            const r = e.currentTarget.getBoundingClientRect();
            setAt({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
            menus.setOpen(id);
          }}>
          {icon}<ChevronDown size={10} className="wk-grpmenu-caret" aria-hidden />
        </button>
      </Tooltip>
      {at && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => close()} />
          <ToolPopover id={id} at={at} name={name} list={list} keepOpen={keepOpen} onClose={close} button={btn}>{children}</ToolPopover>
        </>, document.body)}
    </>
  );
}

/** El menú del grupo: debajo del botón (arriba si no entra, dentro de la
 *  ventana). Al abrirse, el foco va a la primera herramienta (o al propio menú
 *  si no hay ninguna habilitada); Esc lo cierra y vuelve al botón; si el foco se
 *  va afuera, se cierra; usar una herramienta lo cierra y devuelve el foco al
 *  botón, y el modal que abra vuelve ahí al cerrarse (salvo `keepOpen` o lo
 *  marcado `data-keep-open`, como las cardinalidades). Tab en sus bordes vuelve
 *  a la barra (el menú es un portal al final de la página). */
function ToolPopover({ id, at, name, list, keepOpen, onClose, button, children }: {
  id: string; at: RectLike; name: string; list?: boolean; keepOpen?: boolean; onClose: (focusBack?: boolean) => void;
  button: { current: HTMLButtonElement | null }; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useFloating(ref, (box, bounds) => placeNextTo(at, box, bounds, { side: 'bottom', align: 'start', gap: 6 }), [at]);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    (first ?? ref.current)?.focus();
  }, []);
  useEscape(() => onClose(true));
  return (
    <div ref={ref} id={id} role="group" aria-label={name} tabIndex={-1} className={`wk-tbpop${list ? ' wk-tbpop--list' : ''}`} style={place}
      onKeyDown={(e) => {
        const panel = ref.current;
        if (!panel) return;
        const exit = tabExit(e, [...panel.querySelectorAll<HTMLElement>('button:not(:disabled)')], document.activeElement as HTMLElement | null, panel as HTMLElement);
        if (!exit) return;
        e.preventDefault();
        if (exit === 'back') { onClose(true); return; }
        // Lo que sigue al botón del grupo en la barra (o él mismo, si es el último).
        const bar = button.current?.closest('.wk-toolbar');
        const all = bar ? [...bar.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0) : [];
        const next = button.current ? nextIn(all, button.current as HTMLElement) : null;
        onClose(!next);
        next?.focus();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to ? ref.current?.contains(to) || to === button.current : !document.hasFocus()) return;
        onClose();
      }}
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && !b.disabled && !keepOpen && !b.closest('[data-keep-open]')) onClose(true);
      }}>
      <InToolMenu.Provider value={!!list}>{children}</InToolMenu.Provider>
    </div>
  );
}
