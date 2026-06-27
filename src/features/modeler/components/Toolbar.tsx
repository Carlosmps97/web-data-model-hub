import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Table2, Combine, Network, BookA, Shapes, Search, Save, ArrowUpToLine,
  Square, Circle, Minus, Star, Diamond, Type, RectangleHorizontal,
  FileCode2, ImageDown,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import RelIcon, { type RelKind } from './RelIcon';
import type { Cardinality } from '@/features/governance/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
import type { DrawingType } from '@/features/modeler/services/modeler.service';
import { useSessionStore } from '@/store/useSessionStore';
import NewTableModal from './NewTableModal';
import CtasModal from './CtasModal';
import GovPopup, { type GovKind } from './GovDrawer';
import PublishModal from './PublishModal';
import { ExportDdlModal } from '@/features/ddl';

const PRESETS: { k: RelKind; s: Cardinality; t: Cardinality; id: boolean; tip: string }[] = [
  { k: '1:N', s: 'one', t: 'many', id: false, tip: 'Relación uno a muchos' },
  { k: '1:1', s: 'one', t: 'one', id: false, tip: 'Relación uno a uno' },
  { k: '0:N', s: 'zero-one', t: 'zero-many', id: false, tip: 'Relación cero a muchos' },
  { k: 'N:M', s: 'many', t: 'many', id: false, tip: 'Relación muchos a muchos' },
  { k: 'ID', s: 'one', t: 'many', id: true, tip: 'Relación identificadora (FK→PK)' },
];

// Formas del grupo DRAWING (R6d). `id` = DrawingType; cada botón crea una forma.
const SHAPES: { id: DrawingType; tip: string; icon: ReactNode }[] = [
  { id: 'rect', tip: 'Rectángulo', icon: <RectangleHorizontal size={17} /> },
  { id: 'square', tip: 'Cuadrado', icon: <Square size={17} /> },
  { id: 'circle', tip: 'Círculo', icon: <Circle size={17} /> },
  { id: 'ellipse', tip: 'Elipse', icon: <Circle size={17} style={{ transform: 'scaleY(.72)' }} /> },
  { id: 'line', tip: 'Línea', icon: <Minus size={17} /> },
  { id: 'star', tip: 'Estrella', icon: <Star size={17} /> },
  { id: 'diamond', tip: 'Rombo', icon: <Diamond size={17} /> },
  { id: 'text', tip: 'Texto', icon: <Type size={17} /> },
];

const VIEWER_TIP = 'Solo lectura — versión publicada';

export default function Toolbar({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const diagram = useModelerStore((s) => s.diagram);
  const relPreset = useModelerStore((s) => s.relPreset);
  const setRelPreset = useModelerStore((s) => s.setRelPreset);
  const autoOrganize = useModelerStore((s) => s.autoOrganize);
  const createTable = useModelerStore((s) => s.createTable);
  const focusTable = useModelerStore((s) => s.focusTable);
  const addDrawing = useModelerStore((s) => s.addDrawing);
  const saveAllLayout = useModelerStore((s) => s.saveAllLayout);

  const openMode = useSessionStore((s) => s.openMode);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  const readonly = openMode === 'readonly';

  const [modal, setModal] = useState<'table' | 'ctas' | null>(null);
  const [gov, setGov] = useState<GovKind | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [ddlOpen, setDdlOpen] = useState(false);
  const [find, setFind] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);

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
    try { await saveAllLayout(); pushToast('Saved'); }
    catch { pushToast('No se pudo guardar', 'err'); }
  };

  // Export image: ajusta la vista a todo el modelo y captura el viewport a PNG.
  const exportImage = async () => {
    const rf = useModelerStore.getState().flow;
    const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!rf || !el) { pushToast('Nada para exportar', 'err'); return; }
    rf.fitView({ padding: 0.15, duration: 0 });
    await new Promise((r) => setTimeout(r, 250));
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(el, { backgroundColor: '#FBFCFD', pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.download = `${diagram?.subjectArea.name ?? 'canvas'}.png`;
      a.href = dataUrl;
      a.click();
      pushToast('Imagen exportada');
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
            placeholder="Find a table…  ⌘K"
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

      {/* RELATIONSHIPS (presets crow's-foot) */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {PRESETS.map((p) => {
            const on = relPreset?.source === p.s && relPreset?.target === p.t && relPreset?.identifying === p.id;
            return <span key={p.k}>{ic(p.tip, <RelIcon kind={p.k} />, () => setRelPreset(on ? null : { source: p.s, target: p.t, identifying: p.id }), { on, disabled: !canEdit, lockTip: true })}</span>;
          })}
        </div>
        <span className="wk-grp-cap">Relationships</span>
      </div>
      <span className="wk-div" />

      {/* DRAWING (R6d): cada botón crea una forma en el centro del viewport) */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {SHAPES.map((s) => <span key={s.id}>{ic(s.tip, s.icon, () => addDrawing(s.id), { disabled: !canEdit, lockTip: true })}</span>)}
        </div>
        <span className="wk-grp-cap">Drawing</span>
      </div>
      <span className="wk-div" />

      {/* STANDARDS */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic('UDP (glossary)', <BookA size={17} />, () => setGov('udp'), { disabled: readonly, lockTip: true })}
          {ic('Parent Domains', <Shapes size={17} />, () => setGov('domains'), { disabled: readonly, lockTip: true })}
        </div>
        <span className="wk-grp-cap">Standards</span>
      </div>
      <span className="wk-div" />

      {/* ACTIONS */}
      <div className="wk-grp">
        <div className="wk-grp-row">
          {ic('Autoarrange', <Network size={17} />, () => autoOrganize().catch(() => pushToast('No se pudo auto-organizar', 'err')), { disabled: !canEdit, lockTip: true })}
          {ic('Export DDL', <FileCode2 size={17} />, () => setDdlOpen(true), { disabled: !hasCanvas })}
          {ic('Export image', <ImageDown size={17} />, exportImage, { disabled: !hasCanvas })}
        </div>
        <span className="wk-grp-cap">Actions</span>
      </div>

      {/* ── Cluster derecho ── */}
      <div className="wk-right">
        {openMode && (
          <span className={`wk-vpill${readonly ? ' viewer' : ''}`}>
            {readonly ? 'Viewer' : 'Editing'} · {versionLabel ?? '—'}
          </span>
        )}
        <Tooltip label={readonly ? VIEWER_TIP : 'Guardar working copy'}>
          <button className="wk-save" disabled={!canEdit} onClick={onSave}><Save size={15} />Save</button>
        </Tooltip>
        <Tooltip label={readonly ? VIEWER_TIP : 'Publicar versión'}>
          <button className="wk-publish" disabled={!canEdit} onClick={() => setPublishOpen(true)}><ArrowUpToLine size={15} />Publish</button>
        </Tooltip>
      </div>

      {modal === 'table' && <NewTableModal onClose={() => setModal(null)} onCreate={async (input) => { await createTable(input).catch((e) => { pushToast('No se pudo crear', 'err'); throw e; }); }} />}
      {modal === 'ctas' && <CtasModal onClose={() => setModal(null)} pushToast={pushToast} />}
      {gov && <GovPopup kind={gov} onClose={() => setGov(null)} pushToast={pushToast} />}

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} />

      <ExportDdlModal open={ddlOpen} diagram={diagram} modelName={diagram?.subjectArea.name ?? 'model'} onClose={() => setDdlOpen(false)} />

      {relPreset && <div className="wk-relhint">Dibujá la relación: arrastrá de una columna a otra. <button className="wk-tic" style={{ width: 'auto', padding: '0 8px', color: 'var(--on-primary)' }} onClick={() => setRelPreset(null)}>salir</button></div>}
    </div>
  );
}
