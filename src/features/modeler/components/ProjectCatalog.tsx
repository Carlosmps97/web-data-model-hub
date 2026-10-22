import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { facetNouns } from '@/lib/facets';
import { ChevronDown, ChevronRight, Crosshair, Database, EllipsisVertical, Eye, Table2 } from 'lucide-react';
import {
  explorerColumns, explorerViewColumns, mapViewCols, projectInventory,
  type DbxColumn, type DbxTable, type DbxView, type DbxViewCol, type ProjectInventory,
} from '../services/explorer.service';
import type { Project } from '../services/modeler.service';
import { useModelerStore, type InspectTarget } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import {
  buildCanvasIndex, groupBySchema, indexCanvasesWithTable, indexCanvasesWithView, matchesFilter, pickCanvas,
  projectTableIds, schemaSummary, type CanvasLike,
} from '../lib/explorerTree';
import { ColumnLine, EmptyLine, Spin, ViewColumnLines, padFor } from './explorerRows';
import { useFloating } from '@/components/ui/useFloating';
import { placeNextTo, type RectLike } from '@/lib/floating';

// Profundidades: ramas del proyecto a depth 1 (hermanas de «Models»); esquema 2 · objeto 3 · columna 4.
type Branch = 'tables' | 'views' | 'schemas';

/** `at`: dónde se ancla; los dos menús se ubican con la regla única de
 *  flotantes. */
interface Picker { at: RectLike; label: string; candidates: CanvasLike[]; targetId: string; colId?: string }
/** Menú ⋮ de una fila: qué inspeccionar y cómo localizar. */
interface RowMenu { at: RectLike; label: string; inspect: InspectTarget; candidates: CanvasLike[]; targetId: string; colId?: string }
type RowMenuSpec = Omit<RowMenu, 'at'>;

/** Ancla de ancho cero en `x`, a la altura de la fila `r`. */
const anchorAt = (x: number, r: RectLike): RectLike => ({ left: x, right: x, top: r.top, bottom: r.bottom });

/** Menú flotante del Explorer: debajo del ancla, arriba si no entra, siempre
 *  dentro de la ventana (con scroll si no entra en ningún lado). `cap`: alto
 *  máximo propio (una lista larga hace scroll aunque entre en la ventana). */
function FloatingMenu({ at, cap, children }: { at: RectLike; cap?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useFloating(ref, (box, bounds) => placeNextTo(
    at, cap ? { width: box.width, height: Math.min(box.height, cap) } : box, bounds, { side: 'bottom', align: 'start', gap: 2 },
  ), [at, cap]);
  const capped = cap ? { maxHeight: Math.min(cap, typeof place.maxHeight === 'number' ? place.maxHeight : cap), overflowY: 'auto' as const } : {};
  return <div ref={ref} className="rd-menu wk-exp-menu" role="menu" style={{ ...place, ...capped, zIndex: 1000 }}>{children}</div>;
}

/**
 * Ramas Tables · Views · Schemas de un proyecto: el catálogo acotado a las
 * tablas de sus canvases. El inventario (tablas con conteo de columnas + vistas)
 * llega en una sola request server-side, se carga al abrir cualquiera de las
 * ramas (o al filtrar) y se cachea hasta que cambie la versión activa o la
 * membresía de los canvases. Tablas y vistas traen solo el conteo de columnas:
 * las columnas de una y otra se cargan al expandirlas. Clic en
 * tabla/columna/vista = ir al objeto (canvas abierto → centrar; único canvas →
 * abrirlo y centrar; varios → elegir); el menú ⋮ ofrece además «Inspect
 * metadata» (Object Inspector, sin canvas).
 */
export default function ProjectCatalog({ project, filter, pushToast }: {
  project: Project;
  filter: string;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const tree = useModelerStore((s) => s.trees[project.id]);
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const focusTable = useModelerStore((s) => s.focusTable);
  const focusColumn = useModelerStore((s) => s.focusColumn);
  const activeCs = useSessionStore((s) => s.activeChangesetId);
  const explorerTick = useModelerStore((s) => s.explorerTick);

  const canvases: CanvasLike[] = useMemo(() => tree?.subjectAreas ?? [], [tree]);
  const tableIds = useMemo(() => projectTableIds(canvases), [canvases]);
  // Rendimiento: índice inverso canvas→objeto calculado una vez, en lugar de barrer
  // los cientos de canvases por cada fila y en cada re-render (O(filas×canvases)).
  const canvasIndex = useMemo(() => buildCanvasIndex(canvases), [canvases]);
  const activeCanvasTables = useMemo(
    () => new Set(canvases.find((c) => c.id === activeSaId)?.tableIds ?? []),
    [canvases, activeSaId],
  );
  const idsKey = tableIds.join(',');
  const filtering = filter.trim() !== '';

  const [open, setOpen] = useState<Set<Branch>>(new Set());
  const [inv, setInv] = useState<ProjectInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [cols, setCols] = useState<Record<string, DbxColumn[]>>({});
  const [colBusy, setColBusy] = useState<Set<string>>(new Set());
  // Columnas de vista: como las de tabla, se piden al expandir (el inventario
  // solo trae el conteo; ver `explorer.service`).
  const [viewCols, setViewCols] = useState<Record<string, DbxViewCol[]>>({});
  const [viewColBusy, setViewColBusy] = useState<Set<string>>(new Set());
  const [expSchemas, setExpSchemas] = useState<Set<string>>(new Set());
  const [expTables, setExpTables] = useState<Set<string>>(new Set());
  const [expViews, setExpViews] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<Picker | null>(null);
  const [menu, setMenu] = useState<RowMenu | null>(null);

  // Nombres físicos del inventario: resuelven la tabla fuente de las columnas
  // de vista, que el backend manda por id.
  const tableNames = useMemo(
    () => new Map((inv?.tables ?? []).map((t) => [t.id, t.physicalName])),
    [inv],
  );

  // Cambio de versión activa, de membresía de los canvases o de estructura del
  // canvas activo (`explorerTick`) → inventario desactualizado. Se vuelve a pedir solo
  // si hay una rama abierta (carga perezosa).
  useEffect(() => {
    setInv(null); setCols({}); setViewCols({});
    setExpSchemas(new Set()); setExpTables(new Set()); setExpViews(new Set());
  }, [activeCs, idsKey, explorerTick]);

  // Una sola request por proyecto al abrir cualquier rama o al filtrar.
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
  const toggleView = (id: string) => {
    const next = new Set(expViews);
    if (next.has(id)) { next.delete(id); setExpViews(next); return; }
    next.add(id); setExpViews(next);
    if (!viewCols[id]) {
      setViewColBusy((s) => new Set(s).add(id));
      explorerViewColumns(id)
        .then((raw) => setViewCols((m) => ({ ...m, [id]: mapViewCols(raw, (tid) => tableNames.get(tid)) })))
        .catch(() => {})
        .finally(() => setViewColBusy((s) => { const n = new Set(s); n.delete(id); return n; }));
    }
  };

  // ── Ir al objeto ──
  const go = (canvas: CanvasLike, targetId: string, colId?: string, label?: string) => {
    setPicker(null);
    if (canvas.id === activeSaId) { if (colId) focusColumn(targetId, colId); else focusTable(targetId); return; }
    openCanvasAndFocus(canvas.id, project.id, targetId, colId, label).catch(() => pushToast("Couldn't open the canvas", 'err'));
  };
  const resolveAt = (at: RectLike, label: string, candidates: CanvasLike[], targetId: string, colId?: string) => {
    const pick = pickCanvas(candidates, activeSaId);
    if (pick === undefined) { pushToast('Not placed on any canvas of this project yet — use Inspect metadata to read it', 'err'); return; }
    if (pick === null) { setPicker({ at, label, candidates, targetId, colId }); return; }
    go(pick, targetId, colId, label);
  };
  const resolve = (e: ReactMouseEvent, label: string, candidates: CanvasLike[], targetId: string, colId?: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    resolveAt(anchorAt(r.left + 24, r), label, candidates, targetId, colId);
  };
  const goTable = (e: ReactMouseEvent, t: DbxTable, colId?: string, colName?: string) =>
    resolve(e, colName ? `${t.physicalName} · ${colName}` : t.physicalName, indexCanvasesWithTable(canvasIndex, t.id), t.id, colId);
  const goView = (e: ReactMouseEvent, v: DbxView) =>
    resolve(e, v.name, indexCanvasesWithView(canvasIndex, v.id, v.sourceTableIds), v.id);

  // ── Menú ⋮: Inspect metadata / Locate on canvas ──
  const openMenu = (e: ReactMouseEvent, spec: RowMenuSpec) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ ...spec, at: anchorAt(r.right, r) });
  };
  const menuInspect = () => { if (!menu) return; const t = menu.inspect; setMenu(null); openInspector(t); };
  const menuLocate = () => {
    if (!menu) return;
    const m = menu; setMenu(null);
    resolveAt(anchorAt(Math.max(8, m.at.left - 220), m.at), m.label, m.candidates, m.targetId, m.colId);
  };
  const tableMenu = (t: DbxTable, c?: DbxColumn): RowMenuSpec => ({
    label: c ? `${t.physicalName} · ${c.physicalName}` : t.physicalName,
    inspect: { kind: 'table', id: t.id, colId: c?.id ?? null },
    candidates: indexCanvasesWithTable(canvasIndex, t.id), targetId: t.id, colId: c?.id,
  });
  const viewMenu = (v: DbxView): RowMenuSpec => ({
    label: v.name, inspect: { kind: 'view', id: v.id },
    candidates: indexCanvasesWithView(canvasIndex, v.id, v.sourceTableIds), targetId: v.id,
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
    if (!list.length) return <EmptyLine depth={depth}>No {n.members}.</EmptyLine>;
    return list.map((c) => (
      <ColumnLine key={`${t.id}:${c.id ?? c.physicalName}`} col={c} depth={depth}
        onClick={(e) => goTable(e, t, c.id, c.physicalName)} onMenu={(e) => openMenu(e, tableMenu(t, c))} />
    ));
  };

  const viewColumnRows = (v: DbxView, depth: number) => {
    if (viewColBusy.has(v.id)) return <EmptyLine depth={depth}>Loading…</EmptyLine>;
    const list = viewCols[v.id] ?? [];
    if (!list.length) return <EmptyLine depth={depth}>No columns.</EmptyLine>;
    return <ViewColumnLines viewId={v.id} cols={list} depth={depth} />;
  };

  const tableRow = (t: DbxTable, depth: number) => {
    const cnt = t.columnCount ?? cols[t.id]?.length;
    const here = activeCanvasTables.has(t.id);
    return (
      <div key={t.id} className="wk-exp-cv">
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
    <div key={v.id} className="wk-exp-cv">
      <div className="wk-exp-row" style={{ paddingLeft: padFor(depth) }}
        title={v.sourceTables.length ? `Sources: ${v.sourceTables.join(', ')}${v.custom ? ' · custom SQL' : ''}` : undefined}>
        <span role="button" tabIndex={-1} className="wk-exp-chev" onClick={(e) => { e.stopPropagation(); toggleView(v.id); }} aria-label="Toggle columns">
          {expViews.has(v.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="wk-exp-ico" onClick={(e) => goView(e, v)}><Eye size={13} style={{ color: 'var(--purple)' }} /></span>
        <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }} onClick={(e) => goView(e, v)}>{v.name}</span>
        <span className="wk-dbx-badge">{v.columnCount}</span>
        {kebab(viewMenu(v))}
        {viewColBusy.has(v.id) && <Spin />}
      </div>
      {expViews.has(v.id) && viewColumnRows(v, depth + 1)}
    </div>
  );

  // `children` es un thunk: las filas del esquema solo se construyen cuando está
  // abierto (evita crear miles de elementos por un esquema colapsado).
  const schemaNode = (kind: 'tables' | 'views', schema: string, count: number, children: () => ReactNode) => {
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
        {openSch && children()}
      </div>
    );
  };

  return (
    <>
      {branchRow('tables', <Table2 size={14} />, n.Many, tables?.length)}
      {body('tables', () => (
        tableIds.length === 0 ? empty(`No ${n.many} on the canvases of this project yet.`)
          : tableGroups.length === 0 ? empty(filtering ? `No ${n.many} match the filter.` : `No ${n.many}.`)
            : tableGroups.map((g) => schemaNode('tables', g.schema, g.items.length, () => g.items.map((t) => tableRow(t, 3))))
      ))}
      {/* Las vistas son del modelo físico: la rama no se lista en Logical. */}
      {viewMode === 'physical' && branchRow('views', <Eye size={14} style={{ color: 'var(--purple)' }} />, 'Views', views?.length)}
      {viewMode === 'physical' && body('views', () => (
        viewGroups.length === 0 ? empty(filtering ? 'No views match the filter.' : 'No views on this project.')
          : viewGroups.map((g) => schemaNode('views', g.schema, g.items.length, () => g.items.map((v) => viewRow(v, 3))))
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
          <FloatingMenu at={menu.at}>
            <div className="rd-mono wk-exp-menu-title" title={menu.label}>{menu.label}</div>
            <div className="rd-menu-sep" />
            <button type="button" className="rd-menu-item" role="menuitem" onClick={menuInspect}><Eye /> Inspect metadata</button>
            <button type="button" className="rd-menu-item" role="menuitem" onClick={menuLocate}><Crosshair /> Locate on canvas</button>
          </FloatingMenu>
        </>
      )}

      {picker && (
        <>
          <div className="wk-exp-scrim" onClick={() => setPicker(null)} onContextMenu={(e) => { e.preventDefault(); setPicker(null); }} />
          <FloatingMenu at={picker.at} cap={260}>
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
          </FloatingMenu>
        </>
      )}
    </>
  );
}
