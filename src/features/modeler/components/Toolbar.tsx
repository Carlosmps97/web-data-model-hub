import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Table2, Combine, Network, Search, Save, ArrowUpToLine,
  Square, Circle, Minus, Star, Diamond, Type, RectangleHorizontal,
  FileCode2, ImageDown, FolderOpen, Spline,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { EndIcon } from './RelIcon';
import type { Cardinality } from '@/features/governance/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
import type { DrawingType } from '@/features/modeler/services/modeler.service';
import { useSessionStore } from '@/store/useSessionStore';
import NewTableModal from './NewTableModal';
import CtasModal from './CtasModal';
import PublishModal from './PublishModal';
import { ExportDdlModal } from '@/features/ddl';

// Las 4 cardinalidades crow's-foot que puede tener cada extremo de la relación.
const CARDS: { k: Cardinality; tip: string }[] = [
  { k: 'one', tip: 'Exactly one' },
  { k: 'zero-one', tip: 'Zero or one' },
  { k: 'many', tip: 'One or more' },
  { k: 'zero-many', tip: 'Zero, one or more' },
];

// Formas del grupo DRAWING (R6d). `id` = DrawingType; cada botón crea una forma.
const SHAPES: { id: DrawingType; tip: string; icon: ReactNode }[] = [
  { id: 'rect', tip: 'Rectángulo', icon: <RectangleHorizontal size={17} /> },
  { id: 'square', tip: 'Cuadrado', icon: <Square size={17} /> },
  { id: 'circle', tip: 'Círculo', icon: <Circle size={17} /> },
  { id: 'ellipse', tip: 'Elipse', icon: (
    <svg width={17} height={17} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <ellipse cx="8" cy="8" rx="7" ry="4.5" />
    </svg>
  ) },
  { id: 'line', tip: 'Línea', icon: <Minus size={17} /> },
  { id: 'star', tip: 'Estrella', icon: <Star size={17} /> },
  { id: 'diamond', tip: 'Rombo', icon: <Diamond size={17} /> },
  { id: 'text', tip: 'Texto', icon: <Type size={17} /> },
];

const VIEWER_TIP = 'Solo lectura — versión publicada';

/**
 * Inyecta los `<defs>` de los markers crow's-foot (cf-*) en el SVG exportado.
 * Esos markers viven en un `<svg>` aparte (CrowFootMarkers) que NO está dentro
 * del `.react-flow__viewport` capturado, así que sin esto el SVG referencia
 * `url(#cf-*)` sin definición y sólo se ven los wires, no la cardinalidad.
 * Además resuelve las CSS vars (var(--ink-2)/var(--surface)) a color literal,
 * porque en el SVG standalone no existen esas variables.
 */
function injectCrowFootDefs(dataUrl: string): string {
  try {
    if (!dataUrl.startsWith('data:image/svg+xml')) return dataUrl;
    const cfDefs = document.querySelector('marker[id^="cf-"]')?.closest('defs');
    if (!cfDefs) return dataUrl;
    const cs = getComputedStyle(document.documentElement);
    const ink = cs.getPropertyValue('--ink-2').trim() || '#48526A';
    const surface = cs.getPropertyValue('--surface').trim() || '#ffffff';
    const defsHtml = cfDefs.outerHTML
      .replace(/var\(--ink-2\)/g, ink)
      .replace(/var\(--surface\)/g, surface);
    const comma = dataUrl.indexOf(',');
    let svg = decodeURIComponent(dataUrl.slice(comma + 1));
    svg = svg.replace(/(<svg[^>]*>)/, `$1${defsHtml}`);
    return dataUrl.slice(0, comma + 1) + encodeURIComponent(svg);
  } catch {
    return dataUrl; // ante cualquier problema, exportar el SVG sin markers
  }
}

export default function Toolbar({ pushToast, onOpenModel }: { pushToast: (m: string, k?: 'err') => void; onOpenModel?: () => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const diagram = useModelerStore((s) => s.diagram);
  const relPreset = useModelerStore((s) => s.relPreset);
  const setRelPreset = useModelerStore((s) => s.setRelPreset);
  const autoOrganize = useModelerStore((s) => s.autoOrganize);
  const createTable = useModelerStore((s) => s.createTable);
  const focusTable = useModelerStore((s) => s.focusTable);
  const addDrawing = useModelerStore((s) => s.addDrawing);
  const saveAll = useModelerStore((s) => s.saveAll);

  const openMode = useSessionStore((s) => s.openMode);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  const readonly = openMode === 'readonly';

  const [modal, setModal] = useState<'table' | 'ctas' | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [ddlOpen, setDdlOpen] = useState(false);
  const [find, setFind] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  // Selección de cardinalidad por extremo (crow's-foot). El "lápiz" se arma con
  // el botón Draw (relPreset != null); al cambiar un extremo estando armado, se
  // refleja en vivo.
  const [relSel, setRelSel] = useState<{ source: Cardinality; target: Cardinality }>({ source: 'one', target: 'many' });
  // Acciones largas del toolbar en vuelo (feedback de "en proceso").
  const [saving, setSaving] = useState(false);
  const [arranging, setArranging] = useState(false);
  const relArmed = relPreset != null;
  const setRelEnd = (end: 'source' | 'target', c: Cardinality) => {
    const next = { ...relSel, [end]: c };
    setRelSel(next);
    if (relArmed) setRelPreset({ ...next, identifying: false });
  };
  const toggleRelDraw = () => setRelPreset(relArmed ? null : { ...relSel, identifying: false });

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

  // Coincidencias del buscador por nombre lógico/físico.
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    const tables = diagram?.tables ?? [];
    if (!q) return [];
    return tables
      .filter((t) => t.logicalName.toLowerCase().includes(q) || t.physicalName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [find, diagram]);

  const pickTable = (id: string) => { focusTable(id); setFind(''); setFindOpen(false); findRef.current?.blur(); };

  const onSave = async () => {
    setSaving(true);
    try { await saveAll(); pushToast('Saved'); }
    // Propaga el motivo real (p.ej. un 4xx del backend), no un genérico.
    catch (e) { pushToast(e instanceof Error && e.message ? e.message : 'No se pudo guardar', 'err'); }
    finally { setSaving(false); }
  };
  const onArrange = async () => {
    setArranging(true);
    try { await autoOrganize(); }
    catch { pushToast('No se pudo auto-organizar', 'err'); }
    finally { setArranging(false); }
  };

  // Export image: ajusta la vista a todo el modelo y captura el viewport a SVG.
  // SVG (vectorial) en vez de PNG: se mantiene NÍTIDO a cualquier zoom y es
  // navegable en el browser; además NO rasteriza un bitmap gigante, así que en
  // canvases grandes no congela la pestaña como el PNG con pixelRatio 2.
  const exportImage = async () => {
    const rf = useModelerStore.getState().flow;
    const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!rf || !el) { pushToast('Nada para exportar', 'err'); return; }
    // fitView devuelve promesa en React Flow 12: esperarla + doble rAF evita la
    // carrera del sleep fijo (a 100 tablas el re-layout tardaba más de 250ms y
    // la captura salía cortada). Con onlyRenderVisibleElements, el fitView además
    // monta en el DOM todos los nodos para que entren en la captura.
    await rf.fitView({ padding: 0.15, duration: 0 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const { toSvg } = await import('html-to-image');
      const dataUrl = await toSvg(el, { backgroundColor: '#FBFCFD', cacheBust: true });
      const a = document.createElement('a');
      a.download = `${diagram?.subjectArea.name ?? 'canvas'}.svg`;
      a.href = injectCrowFootDefs(dataUrl);
      a.click();
      pushToast('Imagen SVG exportada');
    } catch { pushToast('No se pudo exportar la imagen', 'err'); }
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
          {ic('Nueva tabla', <Table2 size={17} />, () => setModal('table'), { disabled: !canEdit, lockTip: true })}
          {ic('CTAS — crear desde existentes', <Combine size={17} />, () => setModal('ctas'), { disabled: !canEdit, lockTip: true })}
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
              {matches.map((t) => (
                <button key={t.id} className="wk-find-item" onMouseDown={(e) => { e.preventDefault(); pickTable(t.id); }}>
                  <span className="wk-find-lname">{t.logicalName}</span>
                  <span className="wk-find-pname rd-mono">{t.physicalName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="wk-grp-cap">Locate &amp; center</span>
      </div>
      <span className="wk-div" />

      {/* RELATIONSHIPS — cardinalidad por extremo (crow's-foot) + Draw */}
      <div className="wk-grp">
        <div className="wk-relwrap">
          <div className="wk-relbuild">
            {(['source', 'target'] as const).map((end) => (
              <div className="wk-relrow" key={end}>
                <span className="wk-rellbl">{end === 'source' ? 'Source' : 'Target'}</span>
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
          <Tooltip label={readonly ? VIEWER_TIP : relArmed ? 'Salir del modo dibujo' : 'Dibujar relación: arrastrá de una columna a otra'}>
            <button
              type="button"
              className={`wk-reldraw${relArmed ? ' on' : ''}`}
              disabled={!canEdit}
              onClick={toggleRelDraw}
            >
              <Spline size={17} />
            </button>
          </Tooltip>
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
          {ic('Autoarrange', arranging ? <span className="rd-spin" style={{ color: 'var(--primary)' }} /> : <Network size={17} />, () => void onArrange(), { disabled: !canEdit || arranging, lockTip: true })}
          {ic('Export DDL', <FileCode2 size={17} />, () => setDdlOpen(true), { disabled: !hasCanvas })}
          {ic('Export image', <ImageDown size={17} />, exportImage, { disabled: !hasCanvas })}
        </div>
        <span className="wk-grp-cap">Actions</span>
      </div>

      {/* ── Cluster derecho ── */}
      <div className="wk-right">
        {onOpenModel && (
          <Tooltip label="Abrir o cambiar de versión">
            <button className="wk-save" onClick={onOpenModel}><FolderOpen size={15} />Open model</button>
          </Tooltip>
        )}
        {openMode && (
          <span className={`wk-vpill${readonly ? ' viewer' : ''}`}>
            {readonly ? 'Viewer' : 'Editing'} · {versionLabel ?? '—'}
          </span>
        )}
        <Tooltip label={readonly ? VIEWER_TIP : 'Guardar working copy'}>
          <button className="wk-save" disabled={!canEdit || saving} onClick={onSave}>{saving ? <span className="rd-spin" /> : <Save size={15} />}{saving ? 'Saving…' : 'Save'}</button>
        </Tooltip>
        <Tooltip label={readonly ? VIEWER_TIP : 'Publicar versión'}>
          <button className="wk-publish" disabled={!canEdit} onClick={() => setPublishOpen(true)}><ArrowUpToLine size={15} />Publish</button>
        </Tooltip>
      </div>

      {modal === 'table' && <NewTableModal onClose={() => setModal(null)} onCreate={createTable} />}
      {modal === 'ctas' && <CtasModal onClose={() => setModal(null)} pushToast={pushToast} />}

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} />

      <ExportDdlModal open={ddlOpen} diagram={diagram} modelName={diagram?.subjectArea.name ?? 'model'} onClose={() => setDdlOpen(false)} />

      {relPreset && <div className="wk-relhint">Dibujá la relación: arrastrá de una columna a otra. <button className="wk-tic" style={{ width: 'auto', padding: '0 8px', color: 'var(--on-primary)' }} onClick={() => setRelPreset(null)}>salir</button></div>}
    </div>
  );
}
