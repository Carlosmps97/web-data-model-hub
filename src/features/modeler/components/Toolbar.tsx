import { useEffect, useRef, useState, type ReactNode } from 'react';
import { facetNouns, PHYSICAL_ONLY_TOOL_TIP, toolAvailableIn } from '@/lib/facets';
import { createPortal } from 'react-dom';
import {
  Table2, Combine, Network, Search, Save, ArrowUpToLine, ChevronDown, ChevronUp,
  Square, Circle, Minus, Star, Diamond, Type, RectangleHorizontal,
  FileCode2, FileSpreadsheet, ImageDown, AppWindow, FileDown, FolderCog, FolderOpen, Eye, Tags, Undo2,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { EndIcon, RelLabelIcon, RelLineIcon, SubcatIcon } from './RelIcon';
import type { Cardinality } from '@/services/governance.service';
import { failureText, manualRouteCount, useModelerStore } from '@/store/useModelerStore';
import { useUndoStore } from '@/store/useUndoStore';
import { SEARCH_KEY_LABEL, UNDO_KEY_LABEL } from './ColumnContextMenu';
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

// Las 4 cardinalidades crow's-foot del preset por extremo (el popup de la
// relación ofrece las 6, incluyendo 'many' pelado y 'one-only').
const CARDS: { k: Cardinality; tip: string }[] = [
  { k: 'one', tip: 'Exactly one' },
  { k: 'zero-one', tip: 'Zero or one' },
  { k: 'one-many', tip: 'One or more' },
  { k: 'zero-many', tip: 'Zero or many' },
];

// Formas del grupo DRAWING (R6d). `id` = DrawingType; cada botón crea una forma.
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


/** ⌘K / Ctrl+K: abre el buscador del Model con una sesión de canvas abierta.
 *  Doc 105 (ronda 6): no con un modal o una espera en pantalla (`modalOpen`) —
 *  abría el buscador DEBAJO de «Saving working copy…» y se llevaba el foco. */
export function onSearchShortcut(e: KeyboardEvent, open: () => void): void {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) return;
  e.preventDefault();
  if (modalOpen() || !useSessionStore.getState().openMode) return;
  open();
}

export default function Toolbar({ pushToast, onOpenModel }: { pushToast: (m: string, k?: 'err') => void; onOpenModel?: () => void }) {
  // Doc 92 D7: barra de herramientas colapsable (la navegación de módulos no).
  const toolbarCollapsed = useUiStore((st) => st.toolbarCollapsed);
  const toggleToolbar = useUiStore((st) => st.toggleToolbar);
  // Doc 98: mostrar/ocultar las etiquetas de relación (por navegador).
  const relLabelsHidden = useUiStore((st) => st.relLabelsHidden);
  const toggleRelLabels = useUiStore((st) => st.toggleRelLabels);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const diagram = useModelerStore((s) => s.diagram);
  const relPreset = useModelerStore((s) => s.relPreset);
  const setRelPreset = useModelerStore((s) => s.setRelPreset);
  // Doc 53: la herramienta Subcategory SOLO vive en modelo lógico — en físico
  // el botón se deshabilita y el store la desarma al cambiar de modo.
  const viewMode = useModelerStore((s) => s.viewMode);
  const setViewMode = useModelerStore((s) => s.setViewMode);
  const n = facetNouns(viewMode);   // doc 85: Entity/Attribute vs Table/Column
  const subcatArmed = useModelerStore((s) => s.subcatArmed);
  const setSubcatArmed = useModelerStore((s) => s.setSubcatArmed);
  const autoOrganize = useModelerStore((s) => s.autoOrganize);
  const createTable = useModelerStore((s) => s.createTable);
  const addDrawing = useModelerStore((s) => s.addDrawing);
  const saveAll = useModelerStore((s) => s.saveAll);
  const reload = useModelerStore((s) => s.reload);
  // Doc 70: una vista nueva se suma a la membresía de ESTE canvas.
  const addViewsToCanvas = useModelerStore((s) => s.addViewsToCanvas);

  const openMode = useSessionStore((s) => s.openMode);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  // Doc 75 D8: el chip nombra el proyecto de la sesión.
  const projectName = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name ?? null);
  const readonly = openMode === 'readonly';
  // Doc 70: visor de un snapshot (`asof:<versionId>`) — el modelo tal como se
  // publicó en esa versión, reconstruido del ledger.
  const snapshot = isAsOfChangesetId(useSessionStore((s) => s.activeChangesetId));
  // Doc 55: la carga masiva escribe en el draft activo — no exige canvas
  // abierto (crea proyectos/canvases), sí sesión de edición con changeset.
  const activeCsId = useSessionStore((s) => s.activeChangesetId);
  const canUpload = openMode === 'editing' && !!activeCsId;

  // Undo (doc 50): el tooltip muestra QUÉ se va a deshacer; el botón se apaga
  // sin pila, con una inversa en vuelo o en solo-lectura.
  const undoCount = useUndoStore((s) => s.stack.length);
  const undoLabel = useUndoStore((s) => (s.stack.length ? s.stack[s.stack.length - 1].label : null));
  const undoBusy = useUndoStore((s) => s.busy);
  const onUndo = () => {
    void useUndoStore.getState().undoLast()
      .then((label) => { if (label) pushToast(`Undid: ${label}`); })
      .catch((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't undo", 'err'));
  };

  const [modal, setModal] = useState<'table' | 'ctas' | 'view' | 'schema' | 'upload' | null>(null);
  // Doc 71: el buscador se comparte con la cabecera del Explorer (estado en el store).
  const searchOpen = useModelerStore((s) => s.searchOpen);
  const setSearchOpen = useModelerStore((s) => s.setSearchOpen);
  const [publishOpen, setPublishOpen] = useState(false);
  const [ddlOpen, setDdlOpen] = useState(false);
  const [modelPropsOpen, setModelPropsOpen] = useState(false);
  // Doc 59: menú del botón ÚNICO de export (SVG / HTML / PDF). Portal fixed:
  // el toolbar scrollea horizontal y un menú absoluto se recortaría (doc 52).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPos, setExportPos] = useState<{ left: number; top: number } | null>(null);
  const exportBtnRef = useRef<HTMLSpanElement | null>(null);
  // Selección de cardinalidad por extremo (crow's-foot), en términos
  // PARENT (lado PK) / CHILD (lado FK) — doc 19. Default Erwin: one → zero-many.
  const [relSel, setRelSel] = useState<{ parent: Cardinality; child: Cardinality }>({ parent: 'one', child: 'zero-many' });
  // Acciones largas del toolbar en vuelo (feedback de "en proceso").
  const [saving, setSaving] = useState(false);
  const [arranging, setArranging] = useState(false);
  // Doc 99: trazos manuales de wires del canvas — el auto-arrange en edición
  // los reinicia, así que confirma antes diciendo cuántos son.
  const routeCount = useModelerStore(manualRouteCount);
  // La pregunta es sobre UN canvas: si mientras está abierta cambia el canvas
  // (buscador, Explorer), deja de valer.
  const [arrangeAsk, setArrangeAsk] = useState<string | null>(null);
  const setRelEnd = (end: 'parent' | 'child', c: Cardinality) => {
    const next = { ...relSel, [end]: c };
    setRelSel(next);
    if (relPreset) setRelPreset({ ...next, identifying: relPreset.identifying });
  };
  // Dos herramientas de dibujo estilo Erwin: Identifying (sólida) y
  // Non-identifying (punteada). Armar una desarma la otra; re-click desarma.
  const armRel = (identifying: boolean) =>
    setRelPreset(relPreset?.identifying === identifying ? null : { ...relSel, identifying });

  const hasCanvas = activeSaId != null && diagram != null;
  // Edición habilitada: hay canvas y NO es modo solo-lectura.
  const canEdit = hasCanvas && !readonly;

  // ⌘K / Ctrl+K abre el buscador del Model (doc 70 §11).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onSearchShortcut(e, () => useModelerStore.getState().setSearchOpen(true));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Doc 105 (H7): los fallos de una escritura esperan la revalidación y callan
  // si la sesión cambió (`reportWriteError`: ella ya avisó).
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

  // Doc 59: export SIN captura de DOM. html-to-image clonaba ~450k elementos
  // con getComputedStyle (minutos + RangeError en Analytics) y el data URL
  // gigante producía descargas VACÍAS (límite ~2MB de Chrome). Ahora la
  // escena se dibuja desde el MODELO (solo diagrama: columnas, relaciones,
  // pintados) y todo baja por Blob; los módulos pesados cargan lazy.
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
      // Doc 99: los trazos manuales están referidos a donde los bloques están
      // AHORA. En edición el export toma las posiciones vivas (el diagrama del
      // store guarda las de su última carga: sin esto un trazo recién hecho
      // saldría unido a la tabla en su sitio viejo) y los trazos vivos. En
      // visor exporta lo publicado, como siempre: posiciones Y trazos
      // publicados, sin los movimientos efímeros de la sesión.
      const viewer = useSessionStore.getState().openMode === 'readonly';
      const sa = st.diagram.subjectArea;
      const diagram = viewer || !st.flow
        ? st.diagram
        : { ...st.diagram, subjectArea: { ...sa, layout: liveLayout(sa.layout, st.flow.getNodes()) } };
      // Doc 98: el export respeta el botón Show/Hide relationship labels.
      const scene = buildDiagramScene({
        diagram, drawings: st.drawings, viewMode: st.viewMode,
        relLabels: !useUiStore.getState().relLabelsHidden,
        routes: st.canvasRoutes,
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

  // Doc 86: cambiar de modelo con un popup de creación abierto lo cierra — un
  // popup es de UNA faceta (entidad o tabla, atributo o columna).
  useEffect(() => { setModal(null); }, [viewMode]);
  // Doc 105 (ronda 3, R7-A): los diálogos con fondo de canvas dejan el Toolbar
  // y el TopNav clicables — al cambiar la sesión (otra versión, modo o
  // proyecto) se cierran todos: lo armado en una no se graba en la otra.
  const sessionKey = useSessionStore((s) => canvasSessionKey(s));
  useEffect(() => {
    setModal(null); setPublishOpen(false); setDdlOpen(false); setModelPropsOpen(false); setExportOpen(false); setArrangeAsk(null);
  }, [sessionKey]);

  // Doc 105 (ronda 5): nombre accesible de un botón de ÍCONO — el tooltip sólo
  // se ve con el mouse (el lector de pantalla anunciaba «button» sin más). En
  // el visor dice además por qué está deshabilitado.
  const named = (label: string, lockTip = true) => (lockTip && readonly ? `${label} — ${VIEWER_TIP}` : label);

  // Botón-icono de sección. `disabled` ya contempla viewer-lock en cada call.
  const ic = (label: string, node: ReactNode, onClick: () => void, opts?: { on?: boolean; disabled?: boolean; lockTip?: boolean }) => (
    <Tooltip label={opts?.lockTip && readonly ? VIEWER_TIP : label}>
      <button className={`wk-tic${opts?.on ? ' on' : ''}`} aria-label={named(label, !!opts?.lockTip)} disabled={opts?.disabled} onClick={onClick}>{node}</button>
    </Tooltip>
  );

  return (
    <div className={`wk-toolbar${toolbarCollapsed ? ' wk-toolbar--collapsed' : ''}`}>
      {/* Doc 92 D7: barra colapsada a una franja — sólo el botón para mostrarla
          y el contexto de la versión; los popups (abajo) siguen montados. */}
      {toolbarCollapsed && (
        <div className="wk-tb-strip">
          <button type="button" className="wk-tb-expand" onClick={toggleToolbar}
            title="Show the tools bar" aria-label="Show the tools bar" aria-expanded={false}>
            <ChevronDown size={13} /> Tools
          </button>
          {openMode && (
            <span className="wk-tb-strip-ctx">
              {projectName ? `«${projectName}» · ` : ''}{readonly ? (snapshot ? 'Snapshot' : 'Viewer') : 'Editing'} · {versionLabel ?? '—'}
            </span>
          )}
        </div>
      )}
      {!toolbarCollapsed && (<>
      {/* MODEL (doc 86): el «botón padre» lógico/físico estilo Erwin — gobierna
          explorer, tools, popups, UDPs, dominios y labels del canvas. */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          <div className="wk-seg" role="group" aria-label="Model view">
            <Tooltip label="Logical model — entities & attributes">
              <button type="button" className={`wk-seg-btn${viewMode === 'logical' ? ' on' : ''}`} aria-pressed={viewMode === 'logical'} disabled={!openMode} onClick={() => setViewMode('logical')}>Logical</button>
            </Tooltip>
            <Tooltip label="Physical model — tables, columns & views">
              <button type="button" className={`wk-seg-btn${viewMode === 'physical' ? ' on' : ''}`} aria-pressed={viewMode === 'physical'} disabled={!openMode} onClick={() => setViewMode('physical')}>Physical</button>
            </Tooltip>
          </div>
        </div>
        <span className="wk-grp-cap">Model</span>
      </div>
      <span className="wk-div" />

      {/* STRUCTURE — Views, CTAS y Schemas son conceptos físicos (doc 86 D2). */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic(`New ${n.one}`, <Table2 size={17} />, () => setModal('table'), { disabled: !canEdit, lockTip: true })}
          {ic(toolAvailableIn('ctas', viewMode) ? 'CTAS — create from existing' : PHYSICAL_ONLY_TOOL_TIP.ctas, <Combine size={17} />, () => setModal('ctas'), { disabled: !canEdit || !toolAvailableIn('ctas', viewMode), lockTip: true })}
          {ic(toolAvailableIn('view', viewMode) ? 'Create view' : PHYSICAL_ONLY_TOOL_TIP.view, <Eye size={17} />, () => setModal('view'), { disabled: !canEdit || !toolAvailableIn('view', viewMode), lockTip: true })}
          {ic(toolAvailableIn('schema', viewMode) ? 'Schemas — create & manage' : PHYSICAL_ONLY_TOOL_TIP.schema, <FolderCog size={17} />, () => setModal('schema'), { disabled: !canEdit || !toolAvailableIn('schema', viewMode), lockTip: true })}
          {ic('Upload from Excel — create or update tables, columns and structure in bulk', <FileSpreadsheet size={17} />, () => setModal('upload'), { disabled: !canUpload, lockTip: true })}
        </div>
        <span className="wk-grp-cap">Structure</span>
      </div>
      <span className="wk-div" />

      {/* SEARCH & INSPECT (docs 70 §11 · 72): UN popup busca (o navega por
          filtros) tablas, columnas y definiciones en TODA la versión; cada hit
          ofrece «Locate on canvas» (redirige/centra) e «Inspect metadata»
          (Object Inspector, sin canvas). Reemplaza el input «Find a table…». */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic(`Search the model — locate a table, column or definition on its canvas, or inspect its metadata (${SEARCH_KEY_LABEL})`, <Search size={17} />, () => setSearchOpen(true), { disabled: !openMode })}
        </div>
        <span className="wk-grp-cap">Search &amp; inspect</span>
      </div>
      <span className="wk-div" />

      {/* RELATIONSHIPS — cardinalidad por extremo (crow's-foot, Parent/Child)
          + dos herramientas de dibujo estilo Erwin (doc 19) */}
      <div className="wk-grp">
        <div className="wk-relwrap">
          <div className="wk-relbuild">
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
          {/* Subcategoría aparte: es supertipo/subtipo (doc 53), no un tercer
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
            {/* Doc 98: etiquetas de relación (frases) — preferencia de
                VISUALIZACIÓN, así que también vale en modo visor. */}
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
        <span className="wk-grp-cap">Relationships</span>
      </div>
      <span className="wk-div" />

      {/* DRAWING (R6d): 2 filas × 4; cada botón crea una forma en el centro */}
      <div className="wk-grp">
        <div className="wk-drawgrid">
          {SHAPES.map((s) => (
            <Tooltip key={s.id} label={readonly ? VIEWER_TIP : s.tip}>
              <button type="button" className="wk-drawbtn" aria-label={named(`Add ${/^[aeiou]/i.test(s.tip) ? 'an' : 'a'} ${s.tip.toLowerCase()}`)} disabled={!canEdit} onClick={() => addDrawing(s.id)}>
                {s.icon}
              </button>
            </Tooltip>
          ))}
        </div>
        <span className="wk-grp-cap">Drawing</span>
      </div>
      <span className="wk-div" />

      {/* STANDARDS (UDP / Parent Domains) se movió a su propio módulo
          "Data Standards" (2026-07-04): reglas globales, versionadas aparte,
          fuera del canvas/changeset. Ver plan-implementacion/03. */}

      {/* ACTIONS */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic(
            undoLabel ? `Undo — ${undoLabel} (${UNDO_KEY_LABEL})` : `Undo (${UNDO_KEY_LABEL}) — nothing to undo`,
            undoBusy ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Undo2 size={17} />,
            onUndo,
            { disabled: !canEdit || undoBusy || undoCount === 0, lockTip: true },
          )}
          {/* Doc 84 E: también en modo visor (sólo en esta sesión, no se guarda). */}
          {ic(readonly ? 'Auto-arrange — view only, not saved' : 'Autoarrange', arranging ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Network size={17} />, () => void onArrange(), { disabled: !hasCanvas || arranging })}
          {ic('Export DDL', <FileCode2 size={17} />, () => setDdlOpen(true), { disabled: !hasCanvas })}
          <span ref={exportBtnRef} style={{ display: 'inline-flex' }}>
            {ic('Export diagram — SVG · interactive HTML · PDF', <ImageDown size={17} />, () => {
              const r = exportBtnRef.current?.getBoundingClientRect();
              setExportPos(r ? { left: r.left, top: r.bottom + 6 } : null);
              setExportOpen((v) => !v);
            }, { disabled: !hasCanvas, on: exportOpen })}
          </span>
          {ic('Model properties — model-level UDPs', <Tags size={17} />, () => setModelPropsOpen(true), { disabled: !canEdit, lockTip: true })}
        </div>
        <span className="wk-grp-cap">Actions</span>
      </div>

      {/* ── Cluster derecho ── */}
      <div className="wk-right">
        {/* Responsive (2026-09-11): en filas envueltas el contexto va a la
            izquierda y las acciones a la derecha (space-between); la parte
            «proyecto» de la pill se oculta en pantallas angostas. */}
        <div className="wk-right-ctx">
        {onOpenModel && (
          <Tooltip label="Open or switch version">
            <button className="wk-save" onClick={onOpenModel}><FolderOpen size={15} />Open model</button>
          </Tooltip>
        )}
        {openMode && (
          <span className={`wk-vpill${readonly ? ' viewer' : ''}`}
            title={snapshot ? 'Read-only snapshot of a published version, rebuilt from the change ledger' : undefined}>
            {projectName && <span className="wk-vpill-proj">{`«${projectName}» · `}</span>}{readonly ? (snapshot ? 'Snapshot' : 'Viewer') : 'Editing'} · {versionLabel ?? '—'}
          </span>
        )}
        </div>
        <div className="wk-right-act">
        <Tooltip label={readonly ? VIEWER_TIP : 'Save working copy'}>
          <button className="wk-save" disabled={!canEdit || saving} onClick={onSave}>{saving ? <span className="rd-spin" /> : <Save size={15} />}{saving ? 'Saving…' : 'Save'}</button>
        </Tooltip>
        <Tooltip label={readonly ? VIEWER_TIP : 'Publish version'}>
          <button className="wk-publish" disabled={!canEdit} onClick={() => setPublishOpen(true)}><ArrowUpToLine size={15} />Publish</button>
        </Tooltip>
        {/* Doc 92 D7: colapsa la barra de herramientas (más espacio de canvas). */}
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
            // Doc 105 (F1): si la vista nueva no entra al canvas, se dice por qué
            // — y qué falló (O1); con la versión recién transferida, calla (H7).
            if (created && v.showOnCanvas !== false) {
              void addViewsToCanvas([v.id])
                .catch(reportWriteError((e) => pushToast(failureText("Couldn't add the view to this canvas", e), 'err')));
            } else void reload();
          }} />
      )}
      {modal === 'schema' && <SchemaManagerModal onClose={() => setModal(null)} pushToast={pushToast} />}
      {modal === 'upload' && <UploadModal onClose={() => setModal(null)} pushToast={pushToast} />}

      {/* Doc 70 §11: buscador del Model (tablas · columnas · definiciones). */}
      {searchOpen && <SearchModelPopup onClose={() => setSearchOpen(false)} pushToast={pushToast} />}

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} />

      {modelPropsOpen && diagram && (
        <ModelPropertiesModal
          subjectArea={diagram.subjectArea}
          canEdit={canEdit}
          onClose={() => setModelPropsOpen(false)}
          pushToast={pushToast}
        />
      )}

      {exportOpen && exportPos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setExportOpen(false)} />
          <div className="wk-ctxmenu" style={{ left: exportPos.left, top: exportPos.top }}>
            <button onClick={() => void exportDiagram('svg')}><ImageDown size={14} /> SVG image (.svg)</button>
            <button onClick={() => void exportDiagram('html')}><AppWindow size={14} /> Interactive HTML — deep zoom (.html)</button>
            <button onClick={() => void exportDiagram('pdf')}><FileDown size={14} /> PDF document (.pdf)</button>
          </div>
        </>, document.body)}
      <ExportDdlModal open={ddlOpen} diagram={diagram} modelName={diagram?.subjectArea.name ?? 'model'} onClose={() => setDdlOpen(false)} />

      {relPreset && <div className="wk-relhint">Draw the {relPreset.identifying ? 'identifying (solid)' : 'non-identifying (dashed)'} relationship: drag from the PARENT table header (blue ring) onto a child column or the child header — the parent's whole primary key is migrated. <button type="button" className="wk-relhint-exit" onClick={() => setRelPreset(null)}>Exit</button></div>}
      {subcatArmed && <div className="wk-relhint">Draw the subcategory: drag from the SUPERTYPE table header (blue ring) — or from an existing subcategory symbol — onto the subtype table. The supertype's key becomes the subtype's key (is-a, 1:1). <button type="button" className="wk-relhint-exit" onClick={() => setSubcatArmed(false)}>Exit</button></div>}
    </div>
  );
}
