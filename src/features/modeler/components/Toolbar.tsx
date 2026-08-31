import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Table2, Combine, Network, Search, Save, ArrowUpToLine,
  Square, Circle, Minus, Star, Diamond, Type, RectangleHorizontal,
  FileCode2, FileSpreadsheet, ImageDown, AppWindow, FileDown, FolderCog, FolderOpen, Eye, Tags, Undo2,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { EndIcon, RelLineIcon, SubcatIcon } from './RelIcon';
import type { Cardinality } from '@/features/governance/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
import { useUndoStore } from '@/store/useUndoStore';
import { UNDO_KEY_LABEL } from './ColumnContextMenu';
import type { DrawingType } from '@/features/modeler/services/modeler.service';
import { useSessionStore } from '@/store/useSessionStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { UploadModal } from '@/features/upload';
import NewTableModal from './NewTableModal';
import CtasModal from './CtasModal';
import SchemaManagerModal from './SchemaManagerModal';
import PublishModal from './PublishModal';
import { ExportDdlModal } from '@/features/ddl';
import ViewEditor from './ViewEditor';
import ModelPropertiesModal from './ModelPropertiesModal';

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


export default function Toolbar({ pushToast, onOpenModel }: { pushToast: (m: string, k?: 'err') => void; onOpenModel?: () => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const diagram = useModelerStore((s) => s.diagram);
  const relPreset = useModelerStore((s) => s.relPreset);
  const setRelPreset = useModelerStore((s) => s.setRelPreset);
  // Doc 53: la herramienta Subcategory SOLO vive en modelo lógico — en físico
  // el botón se deshabilita y el store la desarma al cambiar de modo.
  const viewMode = useModelerStore((s) => s.viewMode);
  const subcatArmed = useModelerStore((s) => s.subcatArmed);
  const setSubcatArmed = useModelerStore((s) => s.setSubcatArmed);
  const autoOrganize = useModelerStore((s) => s.autoOrganize);
  const createTable = useModelerStore((s) => s.createTable);
  const focusTable = useModelerStore((s) => s.focusTable);
  const addDrawing = useModelerStore((s) => s.addDrawing);
  const saveAll = useModelerStore((s) => s.saveAll);
  const reload = useModelerStore((s) => s.reload);

  const openMode = useSessionStore((s) => s.openMode);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  const readonly = openMode === 'readonly';
  // Doc 55: la carga masiva escribe en el draft activo — no exige canvas
  // abierto (crea proyectos/canvases), sí sesión de edición con changeset.
  const activeCsId = useChangesetStore((s) => s.activeId);
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
  const [publishOpen, setPublishOpen] = useState(false);
  const [ddlOpen, setDdlOpen] = useState(false);
  const [modelPropsOpen, setModelPropsOpen] = useState(false);
  // Doc 59: menú del botón ÚNICO de export (SVG / HTML / PDF). Portal fixed:
  // el toolbar scrollea horizontal y un menú absoluto se recortaría (doc 52).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPos, setExportPos] = useState<{ left: number; top: number } | null>(null);
  const exportBtnRef = useRef<HTMLSpanElement | null>(null);
  const [find, setFind] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  // Selección de cardinalidad por extremo (crow's-foot), en términos
  // PARENT (lado PK) / CHILD (lado FK) — doc 19. Default Erwin: one → zero-many.
  const [relSel, setRelSel] = useState<{ parent: Cardinality; child: Cardinality }>({ parent: 'one', child: 'zero-many' });
  // Acciones largas del toolbar en vuelo (feedback de "en proceso").
  const [saving, setSaving] = useState(false);
  const [arranging, setArranging] = useState(false);
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

  // ⌘K / Ctrl+K enfoca el buscador "Find a table…".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); findRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Coincidencias del buscador: tablas (nombre lógico/físico) + vistas del
  // canvas (F3 — diagram.views ya viene filtrado a las visibles). El pick usa
  // focusTable, que para nodos view centra sin abrir el PropertiesPanel.
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [];
    const tables = (diagram?.tables ?? [])
      .filter((t) => t.logicalName.toLowerCase().includes(q) || t.physicalName.toLowerCase().includes(q))
      .map((t) => ({ id: t.id, kind: 'table' as const, primary: t.logicalName, secondary: t.physicalName }));
    const views = (diagram?.views ?? [])
      .filter((v) => v.name.toLowerCase().includes(q))
      .map((v) => ({ id: v.id, kind: 'view' as const, primary: v.name, secondary: 'view' }));
    return [...tables, ...views].slice(0, 8);
  }, [find, diagram]);

  const pickTable = (id: string) => { focusTable(id); setFind(''); setFindOpen(false); findRef.current?.blur(); };

  const onSave = async () => {
    setSaving(true);
    try { await saveAll(); pushToast('Saved'); }
    // Propaga el motivo real (p.ej. un 4xx del backend), no un genérico.
    catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'); }
    finally { setSaving(false); }
  };
  const onArrange = async () => {
    setArranging(true);
    try { await autoOrganize(); }
    catch { pushToast("Couldn't auto-arrange", 'err'); }
    finally { setArranging(false); }
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
      const scene = buildDiagramScene({ diagram: st.diagram, drawings: st.drawings, viewMode: st.viewMode });
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

  // Botón-icono de sección. `disabled` ya contempla viewer-lock en cada call.
  const ic = (label: string, node: ReactNode, onClick: () => void, opts?: { on?: boolean; disabled?: boolean; lockTip?: boolean }) => (
    <Tooltip label={opts?.lockTip && readonly ? VIEWER_TIP : label}>
      <button className={`wk-tic${opts?.on ? ' on' : ''}`} disabled={opts?.disabled} onClick={onClick}>{node}</button>
    </Tooltip>
  );

  return (
    <div className="wk-toolbar">
      {/* STRUCTURE */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic('New table', <Table2 size={17} />, () => setModal('table'), { disabled: !canEdit, lockTip: true })}
          {ic('CTAS — create from existing', <Combine size={17} />, () => setModal('ctas'), { disabled: !canEdit, lockTip: true })}
          {ic('Create view', <Eye size={17} />, () => setModal('view'), { disabled: !canEdit, lockTip: true })}
          {ic('Schemas — create & manage', <FolderCog size={17} />, () => setModal('schema'), { disabled: !canEdit, lockTip: true })}
          {ic('Upload from Excel — create or update tables, columns and structure in bulk', <FileSpreadsheet size={17} />, () => setModal('upload'), { disabled: !canUpload, lockTip: true })}
        </div>
        <span className="wk-grp-cap">Structure</span>
      </div>
      <span className="wk-div" />

      {/* LOCATE & CENTER */}
      <div className="wk-grp">
        <div className="wk-grp-row wk-find-wrap">
          <Search size={14} className="wk-find-ico" />
          <input
            ref={findRef}
            className="wk-find"
            placeholder="Find a Table"
            value={find}
            disabled={!hasCanvas}
            onChange={(e) => { setFind(e.target.value); setFindOpen(true); }}
            onFocus={() => setFindOpen(true)}
            onBlur={() => setTimeout(() => setFindOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) pickTable(matches[0].id);
              if (e.key === 'Escape') { setFind(''); setFindOpen(false); findRef.current?.blur(); }
            }}
          />
          {findOpen && matches.length > 0 && (
            <div className="wk-find-menu">
              {matches.map((m) => (
                <button key={m.id} className="wk-find-item" onMouseDown={(e) => { e.preventDefault(); pickTable(m.id); }}>
                  <span className="wk-find-lname">
                    {m.kind === 'view' && <Eye size={11} style={{ marginRight: 5, verticalAlign: -1, color: 'var(--purple)' }} aria-hidden />}
                    {m.primary}
                  </span>
                  <span className="wk-find-pname rd-mono">{m.secondary}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="wk-grp-cap">Locate &amp; center</span>
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
                disabled={!canEdit || viewMode !== 'logical'}
                onClick={() => setSubcatArmed(!subcatArmed)}
              >
                <SubcatIcon />
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
              <button type="button" className="wk-drawbtn" disabled={!canEdit} onClick={() => addDrawing(s.id)}>
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
          {ic('Autoarrange', arranging ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Network size={17} />, () => void onArrange(), { disabled: !canEdit || arranging, lockTip: true })}
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
        {onOpenModel && (
          <Tooltip label="Open or switch version">
            <button className="wk-save" onClick={onOpenModel}><FolderOpen size={15} />Open model</button>
          </Tooltip>
        )}
        {openMode && (
          <span className={`wk-vpill${readonly ? ' viewer' : ''}`}>
            {readonly ? 'Viewer' : 'Editing'} · {versionLabel ?? '—'}
          </span>
        )}
        <Tooltip label={readonly ? VIEWER_TIP : 'Save working copy'}>
          <button className="wk-save" disabled={!canEdit || saving} onClick={onSave}>{saving ? <span className="rd-spin" /> : <Save size={15} />}{saving ? 'Saving…' : 'Save'}</button>
        </Tooltip>
        <Tooltip label={readonly ? VIEWER_TIP : 'Publish version'}>
          <button className="wk-publish" disabled={!canEdit} onClick={() => setPublishOpen(true)}><ArrowUpToLine size={15} />Publish</button>
        </Tooltip>
      </div>

      {modal === 'table' && <NewTableModal onClose={() => setModal(null)} onCreate={createTable} />}
      {modal === 'ctas' && <CtasModal onClose={() => setModal(null)} pushToast={pushToast} />}
      {modal === 'view' && <ViewEditor onClose={() => setModal(null)} onSaved={() => void reload()} pushToast={pushToast} />}
      {modal === 'schema' && <SchemaManagerModal onClose={() => setModal(null)} pushToast={pushToast} />}
      {modal === 'upload' && <UploadModal onClose={() => setModal(null)} pushToast={pushToast} />}

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

      {relPreset && <div className="wk-relhint">Draw the {relPreset.identifying ? 'identifying (solid)' : 'non-identifying (dashed)'} relationship: drag from the PARENT table header (blue ring) onto a child column or the child header — the parent's whole primary key is migrated. <button className="wk-tic" style={{ width: 'auto', padding: '0 8px', color: 'var(--on-primary)' }} onClick={() => setRelPreset(null)}>exit</button></div>}
      {subcatArmed && <div className="wk-relhint">Draw the subcategory: drag from the SUPERTYPE table header (blue ring) — or from an existing subcategory symbol — onto the subtype table. The supertype's key becomes the subtype's key (is-a, 1:1). <button className="wk-tic" style={{ width: 'auto', padding: '0 8px', color: 'var(--on-primary)' }} onClick={() => setSubcatArmed(false)}>exit</button></div>}
    </div>
  );
}
