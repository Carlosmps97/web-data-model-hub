import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Crosshair, Database, EllipsisVertical, Eye, Table2 } from 'lucide-react';
import {
  explorerColumns, projectInventory,
  type DbxColumn, type DbxTable, type DbxView, type ProjectInventory,
} from '../services/explorer.service';
import type { Project } from '../services/modeler.service';
import { useModelerStore, type InspectTarget } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import {
  canvasesWithTable, canvasesWithView, groupBySchema, matchesFilter, pickCanvas, projectTableIds, schemaSummary,
  type CanvasLike,
} from '../lib/explorerTree';
import { ColumnLine, EmptyLine, Spin, ViewColumnLines, padFor } from './explorerRows';

// Profundidades: ramas del proyecto a depth 1 (hermanas de «Models»); esquema 2 · objeto 3 · columna 4.
type Branch = 'tables' | 'views' | 'schemas';

interface Picker { x: number; y: number; label: string; candidates: CanvasLike[]; targetId: string; colId?: string }
/** Menú ⋮ de una fila (doc 72): qué inspeccionar y cómo localizar. */
interface RowMenu { x: number; y: number; label: string; inspect: InspectTarget; candidates: CanvasLike[]; targetId: string; colId?: string }
type RowMenuSpec = Omit<RowMenu, 'x' | 'y'>;

/**
 * Ramas Tables · Views · Schemas de UN proyecto (doc 71 §1): el catálogo acotado
 * a las tablas de sus canvases. Doc 72 §1: el inventario (tablas con conteo de
 * columnas + vistas) llega en UNA request server-side, se carga al abrir
 * cualquiera de las ramas (o al filtrar) y se cachea hasta que cambie la
 * versión activa o la membresía de los canvases. Las columnas de una tabla se
 * cargan al expandirla. Click en tabla/columna/vista = ir al objeto (canvas
 * abierto → centrar; único canvas → abrirlo y centrar; varios → elegir); el
 * menú ⋮ ofrece además «Inspect metadata» (Object Inspector, sin canvas).
 */
export default function ProjectCatalog({ project, filter, pushToast }: {
  project: Project;
  filter: string;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const tree = useModelerStore((s) => s.trees[project.id]);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const focusTable = useModelerStore((s) => s.focusTable);
  const focusColumn = useModelerStore((s) => s.focusColumn);
  const activeCs = useSessionStore((s) => s.activeChangesetId);

  const canvases: CanvasLike[] = useMemo(() => tree?.subjectAreas ?? [], [tree]);
  const tableIds = useMemo(() => projectTableIds(canvases), [canvases]);
  const idsKey = tableIds.join(',');
  const filtering = filter.trim() !== '';

  const [open, setOpen] = useState<Set<Branch>>(new Set());
  const [inv, setInv] = useState<ProjectInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [cols, setCols] = useState<Record<string, DbxColumn[]>>({});
  const [colBusy, setColBusy] = useState<Set<string>>(new Set());
  const [expSchemas, setExpSchemas] = useState<Set<string>>(new Set());
  const [expTables, setExpTables] = useState<Set<string>>(new Set());
  const [expViews, setExpViews] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<Picker | null>(null);
  const [menu, setMenu] = useState<RowMenu | null>(null);

  // Cambió la versión activa o la membresía de los canvases → inventario obsoleto.
  useEffect(() => {
    setInv(null); setCols({});
    setExpSchemas(new Set()); setExpTables(new Set()); setExpViews(new Set());
  }, [activeCs, idsKey]);

  // UNA request por proyecto (doc 72 §1) al abrir cualquier rama o al filtrar.
  const wanted = open.size > 0 || filtering;
  useEffect(() => {
    if (inv !== null || !wanted || !tree || loadingRef.current) return undefined;
    loadingRef.current = true;
    setLoading(true);
    let alive = true;
    projectInventory(project.id)
      .then((d) => { if (alive) setInv(d); })
      .catch(() => { if (alive) { setInv({ tables: [], views: [], canvases: 0 }); pushToast("Couldn't load the project catalog", 'err'); } })
      .finally(() => { loadingRef.current = false; if (alive) setLoading(false); });
    return () => { alive = false; loadingRef.current = false; };
  }, [inv, wanted, tree, project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOpen = (b: Branch) => open.has(b) || filtering;   // el filtro abre todo
  const toggle = (b: Branch) => setOpen((s) => { const n = new Set(s); if (n.has(b)) n.delete(b); else n.add(b); return n; });
  const toggleSet = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); setter(next);
  };
  const toggleTable = (id: string) => {
    const next = new Set(expTables);
    if (next.has(id)) { next.delete(id); setExpTables(next); return; }
    next.add(id); setExpTables(next);
    if (!cols[id]) {
      setColBusy((s) => new Set(s).add(id));
      explorerColumns(id)
        .then((c) => setCols((m) => ({ ...m, [id]: c })))
        .catch(() => {})
        .finally(() => setColBusy((s) => { const n = new Set(s); n.delete(id); return n; }));
    }
  };

  // ── Ir al objeto ──
  const go = (canvas: CanvasLike, targetId: string, colId?: string, label?: string) => {
    setPicker(null);
    if (canvas.id === activeSaId) { if (colId) focusColumn(targetId, colId); else focusTable(targetId); return; }
    openCanvasAndFocus(canvas.id, project.id, targetId, colId, label).catch(() => pushToast("Couldn't open the canvas", 'err'));
  };
  const resolveAt = (x: number, y: number, label: string, candidates: CanvasLike[], targetId: string, colId?: string) => {
    const pick = pickCanvas(candidates, activeSaId);
    if (pick === undefined) { pushToast('Not placed on any canvas of this project yet — use Inspect metadata to read it', 'err'); return; }
    if (pick === null) { setPicker({ x, y, label, candidates, targetId, colId }); return; }
    go(pick, targetId, colId, label);
  };
  const resolve = (e: ReactMouseEvent, label: string, candidates: CanvasLike[], targetId: string, colId?: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    resolveAt(r.left + 24, r.bottom + 2, label, candidates, targetId, colId);
  };
  const goTable = (e: ReactMouseEvent, t: DbxTable, colId?: string, colName?: string) =>
    resolve(e, colName ? `${t.physicalName} · ${colName}` : t.physicalName, canvasesWithTable(canvases, t.id), t.id, colId);
  const goView = (e: ReactMouseEvent, v: DbxView) =>
    resolve(e, v.name, canvasesWithView(canvases, v.id, v.sourceTableIds), v.id);

  // ── Menú ⋮ (doc 72): Inspect metadata / Locate on canvas ──
  const openMenu = (e: ReactMouseEvent, spec: RowMenuSpec) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ ...spec, x: r.right, y: r.bottom + 2 });
  };
  const menuInspect = () => { if (!menu) return; const t = menu.inspect; setMenu(null); openInspector(t); };
  const menuLocate = () => {
    if (!menu) return;
    const m = menu; setMenu(null);
    resolveAt(Math.max(8, m.x - 220), m.y, m.label, m.candidates, m.targetId, m.colId);
  };
  const tableMenu = (t: DbxTable, c?: DbxColumn): RowMenuSpec => ({
    label: c ? `${t.physicalName} · ${c.physicalName}` : t.physicalName,
    inspect: { kind: 'table', id: t.id, colId: c?.id ?? null },
    candidates: canvasesWithTable(canvases, t.id), targetId: t.id, colId: c?.id,
  });
  const viewMenu = (v: DbxView): RowMenuSpec => ({
    label: v.name, inspect: { kind: 'view', id: v.id },
    candidates: canvasesWithView(canvases, v.id, v.sourceTableIds), targetId: v.id,
  });
  const kebab = (spec: RowMenuSpec) => (
    <button type="button" className="wk-exp-dots" title="Inspect metadata · Locate on canvas" aria-label="Options" onClick={(e) => openMenu(e, spec)}>
      <EllipsisVertical size={14} />
    </button>
  );

  useEffect(() => {
    if (!picker && !menu) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPicker(null); setMenu(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, menu]);

  // ── Datos filtrados / agrupados ──
  const tables = inv?.tables ?? null;
  const views = inv?.views ?? null;
  const visTables = useMemo(
    () => (tables ?? []).filter((t) => matchesFilter(t.physicalName, filter) || matchesFilter(t.logicalName, filter)),
    [tables, filter],
  );
  const visViews = useMemo(() => (views ?? []).filter((v) => matchesFilter(v.name, filter)), [views, filter]);
  const tableGroups = useMemo(() => groupBySchema(visTables, (t) => t.schema, (t) => t.physicalName), [visTables]);
  const viewGroups = useMemo(() => groupBySchema(visViews, (v) => v.schema, (v) => v.name), [visViews]);
  const summary = useMemo(() => (inv ? schemaSummary(inv.tables, inv.views) : null), [inv]);

  const branchRow = (b: Branch, icon: ReactNode, label: string, count: number | null | undefined) => (
    <div className="wk-exp-row" data-kind="branch" style={{ paddingLeft: padFor(1) }} onClick={() => toggle(b)}>
      {isOpen(b) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      <span className="wk-exp-ico">{icon}</span>
      <span className="wk-exp-label">{label}</span>
      {count != null && <span className="wk-exp-count">{count}</span>}
      {loading && isOpen(b) && <Spin />}
    </div>
  );
  const empty = (text: string, depth = 2) => <EmptyLine depth={depth}>{text}</EmptyLine>;
  /** Cuerpo de una rama: nada hasta que llegue el inventario. */
  const body = (b: Branch, content: () => ReactNode) => (isOpen(b) && inv !== null ? content() : null);

  const columnRows = (t: DbxTable, depth: number) => {
    if (colBusy.has(t.id)) return <EmptyLine depth={depth}>Loading…</EmptyLine>;
    const list = cols[t.id] ?? [];
    if (!list.length) return <EmptyLine depth={depth}>No columns.</EmptyLine>;
    return list.map((c) => (
      <ColumnLine key={`${t.id}:${c.id ?? c.physicalName}`} col={c} depth={depth}
        onClick={(e) => goTable(e, t, c.id, c.physicalName)} onMenu={(e) => openMenu(e, tableMenu(t, c))} />
    ));
  };

  const tableRow = (t: DbxTable, depth: number) => {
    const cnt = t.columnCount ?? cols[t.id]?.length;
    const here = canvasesWithTable(canvases, t.id).some((c) => c.id === activeSaId);
    return (
      <div key={t.id}>
        <div className={`wk-exp-row${here ? ' here' : ''}`} style={{ paddingLeft: padFor(depth) }} title={t.logicalName || undefined}>
          <span role="button" tabIndex={-1} className="wk-exp-chev" onClick={(e) => { e.stopPropagation(); toggleTable(t.id); }} aria-label="Toggle columns">
            {expTables.has(t.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="wk-exp-ico" onClick={(e) => goTable(e, t)}><Table2 size={13} /></span>
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }} onClick={(e) => goTable(e, t)}>{t.physicalName}</span>
          {cnt != null && <span className="wk-dbx-badge">{cnt}</span>}
          {kebab(tableMenu(t))}
          {colBusy.has(t.id) && <Spin />}
        </div>
        {expTables.has(t.id) && columnRows(t, depth + 1)}
      </div>
    );
  };

  const viewRow = (v: DbxView, depth: number) => (
    <div key={v.id}>
      <div className="wk-exp-row" style={{ paddingLeft: padFor(depth) }}
        title={v.sourceTables.length ? `Sources: ${v.sourceTables.join(', ')}${v.custom ? ' · custom SQL' : ''}` : undefined}>
        <span role="button" tabIndex={-1} className="wk-exp-chev" onClick={(e) => { e.stopPropagation(); toggleSet(expViews, setExpViews, v.id); }} aria-label="Toggle columns">
          {expViews.has(v.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="wk-exp-ico" onClick={(e) => goView(e, v)}><Eye size={13} style={{ color: 'var(--purple)' }} /></span>
        <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }} onClick={(e) => goView(e, v)}>{v.name}</span>
        <span className="wk-dbx-badge">{v.columns.length}</span>
        {kebab(viewMenu(v))}
      </div>
      {expViews.has(v.id) && <ViewColumnLines view={v} depth={depth + 1} />}
    </div>
  );

  const schemaNode = (kind: 'tables' | 'views', schema: string, count: number, children: ReactNode) => {
    const key = `${kind}:${schema}`;
    const openSch = expSchemas.has(key) || filtering;
    return (
      <div key={key}>
        <div className="wk-exp-row" style={{ paddingLeft: padFor(2) }} onClick={() => toggleSet(expSchemas, setExpSchemas, key)}>
          {openSch ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="wk-exp-ico"><Database size={13} style={{ color: 'var(--navy)' }} /></span>
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{schema}</span>
          <span className="wk-dbx-badge">{count}</span>
        </div>
        {openSch && children}
      </div>
    );
  };

  return (
    <>
      {branchRow('tables', <Table2 size={14} />, 'Tables', tables?.length)}
      {body('tables', () => (
        tableIds.length === 0 ? empty('No tables on the canvases of this project yet.')
          : tableGroups.length === 0 ? empty(filtering ? 'No tables match the filter.' : 'No tables.')
            : tableGroups.map((g) => schemaNode('tables', g.schema, g.items.length, g.items.map((t) => tableRow(t, 3))))
      ))}
      {branchRow('views', <Eye size={14} style={{ color: 'var(--purple)' }} />, 'Views', views?.length)}
      {body('views', () => (
        viewGroups.length === 0 ? empty(filtering ? 'No views match the filter.' : 'No views on this project.')
          : viewGroups.map((g) => schemaNode('views', g.schema, g.items.length, g.items.map((v) => viewRow(v, 3))))
      ))}
      {branchRow('schemas', <Database size={14} style={{ color: 'var(--navy)' }} />, 'Schemas', summary?.length)}
      {body('schemas', () => (
        !summary || summary.length === 0 ? empty('No schemas in use.')
          : summary.map((s) => (
            <div key={s.schema} className="wk-exp-row" style={{ paddingLeft: padFor(2), cursor: 'default' }}>
              <span style={{ width: 13 }} />
              <span className="wk-exp-ico"><Database size={13} style={{ color: 'var(--navy)' }} /></span>
              <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{s.schema}</span>
              <span className="wk-dbx-badge">{s.tables} tbl · {s.views} vw</span>
            </div>
          ))
      ))}

      {menu && (
        <>
          <div className="wk-exp-scrim" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="rd-menu wk-exp-menu" role="menu"
            style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 236), top: Math.min(menu.y, window.innerHeight - 110), zIndex: 1000 }}>
            <div className="rd-mono wk-exp-menu-title" title={menu.label}>{menu.label}</div>
            <div className="rd-menu-sep" />
            <button type="button" className="rd-menu-item" role="menuitem" onClick={menuInspect}><Eye /> Inspect metadata</button>
            <button type="button" className="rd-menu-item" role="menuitem" onClick={menuLocate}><Crosshair /> Locate on canvas</button>
          </div>
        </>
      )}

      {picker && (
        <>
          <div className="wk-exp-scrim" onClick={() => setPicker(null)} onContextMenu={(e) => { e.preventDefault(); setPicker(null); }} />
          <div className="rd-menu wk-exp-menu" role="menu"
            style={{ position: 'fixed', left: Math.min(picker.x, window.innerWidth - 274), top: Math.min(picker.y, window.innerHeight - 264), zIndex: 1000, maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px 2px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--subtle)' }}>
              <Crosshair size={12} /> Open on…
            </div>
            <div className="rd-mono wk-exp-menu-title" title={picker.label}>{picker.label}</div>
            <div className="rd-menu-sep" />
            {picker.candidates.map((c) => (
              <button key={c.id} type="button" className="rd-menu-item" role="menuitem" onClick={() => go(c, picker.targetId, picker.colId, picker.label)}>
                <Crosshair /> {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
