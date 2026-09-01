import {
  useEffect, useRef, useState,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, Columns3, Crosshair, Database, EllipsisVertical, Eye, KeyRound,
  Link as LinkIcon, RefreshCw, Search, Table2, X,
} from 'lucide-react';
import {
  clampDbxSplit, explorerColumns, explorerSchemas, explorerSearch, explorerSearchColumns,
  explorerTables, explorerViews, schemasForSection,
  type DbxColumn, type DbxColumnHit, type DbxHit, type DbxSchema, type DbxSection, type DbxTable, type DbxView,
} from '@/features/modeler/services/explorer.service';
import * as gov from '@/features/governance/services/governance.service';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';

// Indentación por nivel (mismos valores que ModelExplorer).
const INDENT = 14;
const PAD_BASE = 6;
/** Tope de tablas por esquema (aviso si se alcanza). */
const TABLES_CAP = 500;

/** Key namespaced de esquema expandido: un esquema sin `kind` aparece en las
 *  DOS secciones y su expansión debe ser independiente por sección. */
const schKey = (section: DbxSection, name: string) => `${section === 'tables' ? 't' : 'v'}:${name}`;

/**
 * Database Explorer (doc 18 §5 · draft-aware doc 25 · secciones + split doc 60):
 * navegación SOLO LECTURA de la BD en DOS secciones — "Canonical Tables"
 * (esquemas → tablas → columnas) y "Views" (esquemas → vistas → columnas) —
 * con búsqueda server-side por nombre. Segunda mitad del sidebar, apilada bajo
 * el Model Explorer: abierta ocupa una FRACCIÓN fija del alto (default 50%,
 * persistida) ajustable con un handle de drag sobre su borde superior.
 *
 * Cuando hay una VERSIÓN activa (draft) muestra su estado EFECTIVO (publicado +
 * overlay del changeset): las tablas/vistas/columnas creadas, renombradas o
 * borradas en la versión aparecen al instante (fuente = `explorer.service`, que
 * conmuta efectivo↔publicado). Sin versión activa muestra producción publicada.
 * Sin acciones de edición, visible para todos los roles (lectores incluidos).
 */
export default function DatabaseExplorer() {
  // Abierto por DEFAULT (doc 60: el Database Explorer vive a la mitad del
  // sidebar); el estado y el split persisten por browser como los anchos.
  const [open, setOpenRaw] = useState<boolean>(() => {
    try { return localStorage.getItem('dmh:dbxOpen') !== '0'; } catch { return true; }
  });
  const toggleOpen = () => setOpenRaw((o) => {
    const next = !o;
    try { localStorage.setItem('dmh:dbxOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  // Split vertical Model Explorer ⇄ Database Explorer: fracción del alto del
  // stack que ocupa este panel (clamp 15%–85%), draggable desde su borde
  // superior. El parent (.wk-expl-stack) da la métrica; la basis va inline.
  const sectionRef = useRef<HTMLElement>(null);
  const [split, setSplitRaw] = useState<number>(() => {
    try { return clampDbxSplit(Number(localStorage.getItem('dmh:dbxSplit') ?? '0.5')); } catch { return 0.5; }
  });
  const [splitDragging, setSplitDragging] = useState(false);
  const setSplit = (f: number) => {
    const c = Math.round(clampDbxSplit(f) * 1000) / 1000;
    setSplitRaw(c);
    try { localStorage.setItem('dmh:dbxSplit', String(c)); } catch { /* ignore */ }
  };
  const startVSplit = (e: ReactPointerEvent) => {
    e.preventDefault();
    const stack = sectionRef.current?.parentElement;   // .wk-expl-stack
    if (!stack) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setSplitDragging(true);
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      const r = stack.getBoundingClientRect();
      if (r.height > 0) setSplit((r.bottom - ev.clientY) / r.height);
    };
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      setSplitDragging(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const activeId = useChangesetStore((s) => s.activeId);
  const draft = activeId !== null;
  const [schemas, setSchemas] = useState<DbxSchema[] | null>(null);
  // Grupos "Canonical Tables" / "Views": ambos expandidos por default.
  const [expGroups, setExpGroups] = useState<Set<DbxSection>>(new Set(['tables', 'views']));
  const [expSchemas, setExpSchemas] = useState<Set<string>>(new Set());
  const [expTables, setExpTables] = useState<Set<string>>(new Set());
  const [expViews, setExpViews] = useState<Set<string>>(new Set());
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, DbxTable[]>>({});
  const [viewsBySchema, setViewsBySchema] = useState<Record<string, DbxView[]>>({});
  const [colsByTable, setColsByTable] = useState<Record<string, DbxColumn[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DbxHit[] | null>(null);
  // Búsqueda por COLUMNA (pedido de los modelers): hits con su esquema.tabla.
  const [colHits, setColHits] = useState<DbxColumnHit[] | null>(null);

  // Finder cross-canvas (pedido owner): menú "⋮" por tabla → canvases donde está
  // + click para abrir ese canvas y centrar sobre la tabla.
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const [menu, setMenu] = useState<{ tableId: string; name: string; x: number; y: number } | null>(null);
  const [menuUsage, setMenuUsage] = useState<gov.TableUsageRow[] | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);

  const openMenu = (e: ReactMouseEvent<HTMLElement>, tableId: string, name: string) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ tableId, name, x: r.right, y: r.bottom });
    setMenuUsage(null);
    setMenuLoading(true);
    gov.tableUsage(tableId)
      .then((u) => setMenuUsage(u.usage))
      .catch(() => setMenuUsage([]))
      .finally(() => setMenuLoading(false));
  };
  const closeMenu = () => { setMenu(null); setMenuUsage(null); };
  const goToCanvas = (u: gov.TableUsageRow) => {
    if (!menu) return;
    const tableId = menu.tableId;
    closeMenu();
    openCanvasAndFocus(u.canvasId, u.projectId ?? undefined, tableId)
      .catch(() => toast.error("Couldn't open the canvas"));
  };

  const kebab = (tableId: string, name: string) => (
    <button type="button" className="wk-exp-dots" style={menu?.tableId === tableId ? { opacity: 1 } : undefined}
      title="Find in canvases" aria-label="Find in canvases"
      onClick={(e) => openMenu(e, tableId, name)}>
      <EllipsisVertical size={15} />
    </button>
  );

  // Escape cierra el menú del Finder.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const mark = (key: string, on: boolean) => setLoading((s) => {
    const next = new Set(s);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const loadSchemas = async (force = false) => {
    if (schemas !== null && !force) return;
    mark('root', true);
    try { setSchemas(await explorerSchemas()); }
    catch { setSchemas([]); }
    finally { mark('root', false); }
  };

  useEffect(() => { if (open) void loadSchemas(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambió la versión activa (draft⇄producción o entre drafts): las cachés
  // quedan obsoletas → resetear y, si el panel está abierto, recargar.
  useEffect(() => {
    setTablesBySchema({}); setViewsBySchema({}); setColsByTable({});
    setExpSchemas(new Set()); setExpTables(new Set()); setExpViews(new Set());
    setHits(null); setColHits(null); setQ('');
    setSchemas(null);
    if (open) void loadSchemas(true);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    // Recarga la vista actual (versión activa o producción). Colapsa esquemas:
    // sus cachés se vacían y una expansión vieja quedaría mostrando vacío.
    setTablesBySchema({}); setViewsBySchema({}); setColsByTable({});
    setExpSchemas(new Set()); setExpTables(new Set()); setExpViews(new Set());
    void loadSchemas(true);
  };

  const toggleGroup = (g: DbxSection) => setExpGroups((s) => {
    const next = new Set(s);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });

  // Expandir un esquema carga SOLO lo de su sección (tablas O vistas): antes se
  // pedían ambas siempre; con las secciones separadas la mitad era en vano.
  const toggleSchema = (section: DbxSection, name: string) => {
    const key = schKey(section, name);
    const next = new Set(expSchemas);
    if (next.has(key)) { next.delete(key); setExpSchemas(next); return; }
    next.add(key); setExpSchemas(next);
    if (section === 'tables' && !tablesBySchema[name]) {
      mark(`sch:${key}`, true);
      void explorerTables(name).catch(() => [] as DbxTable[])
        .then((tables) => setTablesBySchema((m) => ({ ...m, [name]: tables })))
        .finally(() => mark(`sch:${key}`, false));
    } else if (section === 'views' && !viewsBySchema[name]) {
      mark(`sch:${key}`, true);
      void explorerViews(name).catch(() => [] as DbxView[])
        .then((views) => setViewsBySchema((m) => ({ ...m, [name]: views })))
        .finally(() => mark(`sch:${key}`, false));
    }
  };

  const toggleTable = (id: string) => {
    const next = new Set(expTables);
    if (next.has(id)) { next.delete(id); setExpTables(next); return; }
    next.add(id); setExpTables(next);
    if (!colsByTable[id]) {
      mark(`tbl:${id}`, true);
      void explorerColumns(id)
        .then((cols) => setColsByTable((m) => ({ ...m, [id]: cols })))
        .catch(() => {})
        .finally(() => mark(`tbl:${id}`, false));
    }
  };

  const toggleView = (id: string) => setExpViews((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Búsqueda server-side por nombre (draft-aware: efectivo si hay versión, si no
  // catálogo publicado; contains + limit). TABLAS y COLUMNAS en paralelo: los
  // hits de columna salen con su esquema.tabla (pedido de los modelers).
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits(null); setColHits(null); return; }
    let alive = true;
    const h = setTimeout(() => {
      mark('search', true);
      void Promise.all([
        explorerSearch(term, 50).catch(() => [] as DbxHit[]),
        explorerSearchColumns(term, 50).catch(() => [] as DbxColumnHit[]),
      ])
        .then(([tables, cols]) => { if (alive) { setHits(tables); setColHits(cols); } })
        .finally(() => { if (alive) mark('search', false); });
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);

  const spin = <span className="rd-spin" style={{ color: 'var(--primary)', marginLeft: 'auto' }} aria-hidden />;

  const colIcon = (c: DbxColumn) =>
    c.isPrimaryKey ? <KeyRound size={11} style={{ color: 'var(--k-pk)' }} />
      : c.isForeignKey ? <LinkIcon size={11} style={{ color: 'var(--k-fk)' }} /> : null;

  const columnRows = (tableId: string, depth: number) => {
    if (loading.has(`tbl:${tableId}`)) {
      return <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + depth * INDENT }}>Loading…</div>;
    }
    const cols = colsByTable[tableId] ?? [];
    if (cols.length === 0) {
      return <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + depth * INDENT }}>No columns.</div>;
    }
    return cols.map((c) => (
      <div key={`${tableId}:${c.ordinal}:${c.physicalName}`} className="wk-exp-row wk-dbx-col"
        style={{ paddingLeft: PAD_BASE + depth * INDENT, cursor: 'default' }}
        title={c.logicalName ? `${c.logicalName}${c.description ? ` — ${c.description}` : ''}` : c.description || undefined}>
        <span className="wk-exp-ico" style={{ width: 12, justifyContent: 'center' }}>{colIcon(c)}</span>
        <span className="wk-exp-label rd-mono" style={{ fontSize: 12 }}>{c.physicalName}</span>
        <span className="wk-dbx-type rd-mono">{c.dataType}</span>
      </div>
    ));
  };

  const tableRow = (t: DbxTable, depth: number) => {
    // En draft el doc crudo no trae columnCount → se rellena al expandir (nº de
    // columnas efectivas cargadas). En producción el reporting ya lo trae.
    const cnt = t.columnCount ?? colsByTable[t.id]?.length;
    return (
      <div key={t.id}>
        <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE + depth * INDENT }}
          title={t.logicalName || undefined} onClick={() => toggleTable(t.id)}>
          {expTables.has(t.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="wk-exp-ico"><Table2 size={13} /></span>
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{t.physicalName}</span>
          {cnt != null && <span className="wk-dbx-badge">{cnt}</span>}
          {kebab(t.id, t.physicalName)}
          {loading.has(`tbl:${t.id}`) && spin}
        </div>
        {expTables.has(t.id) && columnRows(t.id, depth + 1)}
      </div>
    );
  };

  // Hit de la búsqueda por columna: columna + esquema.tabla al que pertenece
  // (dos líneas) + tipo + Finder cross-canvas de su tabla.
  const colHitRow = (c: DbxColumnHit) => (
    <div key={c.id} className="wk-exp-row wk-dbx-col wk-dbx-colhit" title={c.logicalName || undefined}>
      <span className="wk-exp-ico" style={{ width: 12, justifyContent: 'center' }}><Columns3 size={11} /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span className="wk-exp-label rd-mono" style={{ fontSize: 12 }}>{c.physicalName}</span>
        <span className="rd-mono wk-dbx-sub">{c.schema ? `${c.schema}.` : ''}{c.table}</span>
      </span>
      {c.dataType && <span className="wk-dbx-type rd-mono">{c.dataType}</span>}
      {kebab(c.tableId, `${c.schema ? `${c.schema}.` : ''}${c.table}`)}
    </div>
  );

  const viewRow = (v: DbxView, depth: number) => (
    <div key={v.id}>
      <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE + depth * INDENT }}
        title={v.sourceTables.length ? `Sources: ${v.sourceTables.join(', ')}` : undefined}
        onClick={() => toggleView(v.id)}>
        {expViews.has(v.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="wk-exp-ico"><Eye size={13} style={{ color: 'var(--purple)' }} /></span>
        <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{v.name}</span>
        <span className="wk-dbx-badge">{v.columns.length}</span>
      </div>
      {expViews.has(v.id) && v.columns.map((c, i) => (
        <div key={`${v.id}:${i}`} className="wk-exp-row wk-dbx-col"
          style={{ paddingLeft: PAD_BASE + (depth + 1) * INDENT, cursor: 'default' }}
          title={c.expression || (c.sourceTable ? `${c.sourceTable}.${c.sourceColumn ?? ''}` : undefined)}>
          <span className="wk-exp-ico" style={{ width: 12 }} />
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12 }}>{c.outputAlias || c.sourceColumn || '—'}</span>
          {c.castType && <span className="wk-dbx-type rd-mono">{c.castType}</span>}
        </div>
      ))}
    </div>
  );

  // Esquema DENTRO de una sección: expandirlo lista sus tablas (sección
  // Canonical Tables) o sus vistas (sección Views), nunca mezcladas.
  const schemaNode = (s: DbxSchema, section: DbxSection) => {
    const key = schKey(section, s.name);
    const openSch = expSchemas.has(key);
    const loaded = section === 'tables' ? tablesBySchema[s.name] : viewsBySchema[s.name];
    return (
      <div key={`${section}:${s.id}`}>
        <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE + INDENT }} title={s.description || undefined}
          onClick={() => toggleSchema(section, s.name)}>
          {openSch ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="wk-exp-ico"><Database size={13} style={{ color: 'var(--navy)' }} /></span>
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{s.name}</span>
          {loaded && <span className="wk-dbx-badge">{loaded.length}</span>}
          {loading.has(`sch:${key}`) && spin}
        </div>
        {openSch && loaded && (
          <>
            {loaded.length === 0 && (
              <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + 2 * INDENT }}>
                {section === 'tables' ? 'No tables.' : 'No views.'}
              </div>
            )}
            {section === 'tables'
              ? (loaded as DbxTable[]).map((t) => tableRow(t, 2))
              : (loaded as DbxView[]).map((v) => viewRow(v, 2))}
            {section === 'tables' && loaded.length >= TABLES_CAP && (
              <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + 2 * INDENT }}>
                Showing the first {TABLES_CAP} tables — use the search.
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Grupo colapsable de la sección (Canonical Tables / Views) con sus esquemas
  // (filtrados por `schemas.kind`; sin clasificar entra en ambos — doc 44/52).
  const groupNode = (section: DbxSection, label: string, icon: ReactNode) => {
    const openG = expGroups.has(section);
    const list = schemasForSection(schemas ?? [], section);
    return (
      <div>
        <div className="wk-exp-row wk-dbx-group" style={{ paddingLeft: PAD_BASE }}
          onClick={() => toggleGroup(section)}>
          {openG ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="wk-exp-ico">{icon}</span>
          <span className="wk-exp-label">{label}</span>
          {schemas !== null && <span className="wk-dbx-badge">{list.length}</span>}
        </div>
        {openG && schemas !== null && schemas.length > 0 && list.length === 0 && (
          <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + INDENT }}>No schemas.</div>
        )}
        {openG && list.map((s) => schemaNode(s, section))}
      </div>
    );
  };

  return (
    <section ref={sectionRef} className={`wk-dbx${open ? ' open' : ''}`}
      style={open ? { flexBasis: `${(split * 100).toFixed(1)}%` } : undefined}
      aria-label="Database Explorer">
      {open && (
        <div className={`wk-dbx-vsplit${splitDragging ? ' dragging' : ''}`}
          onPointerDown={startVSplit} title="Drag to resize" />
      )}
      <button type="button" className="wk-dbx-head" onClick={toggleOpen}
        title={draft ? 'Active version (draft) — read-only' : 'Published production database (read-only)'}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Database size={13} />
        <span style={{ flex: 1, textAlign: 'left' }}>Database Explorer</span>
        {draft && (
          <span title="Showing the active version (draft), not published production"
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
              color: 'var(--primary)', background: 'var(--primary-soft)', padding: '1px 5px', borderRadius: 4,
            }}>version</span>
        )}
        {open && (
          <span
            role="button"
            tabIndex={0}
            className="wk-exp-headbtn"
            title={draft ? 'Refresh (active version)' : 'Refresh (production)'}
            onClick={(e) => { e.stopPropagation(); refresh(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); refresh(); } }}
          >
            <RefreshCw size={12} />
          </span>
        )}
      </button>
      {open && (
        <div className="wk-dbx-body">
          <div className="wk-dbx-search">
            <Search size={12} />
            <input placeholder="Search tables & columns…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" title="Clear" onClick={() => setQ('')}><X size={11} /></button>
            )}
          </div>
          {hits !== null || colHits !== null ? (
            <>
              {loading.has('search') && <div className="wk-exp-empty">Searching…</div>}
              {!loading.has('search') && (hits ?? []).length === 0 && (colHits ?? []).length === 0 && (
                <div className="wk-exp-empty">No results.</div>
              )}
              {hits && hits.length > 0 && (
                <>
                  <div className="wk-dbx-sect">Tables · {hits.length}</div>
                  {hits.map((t) => (
                    <div key={t.id}>
                      <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE }} title={t.logicalName}
                        onClick={() => toggleTable(t.id)}>
                        {expTables.has(t.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <span className="wk-exp-ico"><Table2 size={13} /></span>
                        <span className="wk-exp-label rd-mono" style={{ fontSize: 12 }}>
                          {t.schema ? `${t.schema}.` : ''}{t.physicalName}
                        </span>
                        {kebab(t.id, `${t.schema ? `${t.schema}.` : ''}${t.physicalName}`)}
                        {loading.has(`tbl:${t.id}`) && spin}
                      </div>
                      {expTables.has(t.id) && columnRows(t.id, 1)}
                    </div>
                  ))}
                </>
              )}
              {colHits && colHits.length > 0 && (
                <>
                  <div className="wk-dbx-sect">Columns · {colHits.length}</div>
                  {colHits.map(colHitRow)}
                </>
              )}
            </>
          ) : (
            <>
              {loading.has('root') && <div className="wk-exp-empty">Loading schemas…</div>}
              {schemas !== null && schemas.length === 0 && !loading.has('root') && (
                <div className="wk-exp-empty">No published schemas.</div>
              )}
              {groupNode('tables', 'Canonical Tables', <Table2 size={13} />)}
              {groupNode('views', 'Views', <Eye size={13} style={{ color: 'var(--purple)' }} />)}
            </>
          )}
        </div>
      )}
      {menu && (
        <>
          {/* Backdrop invisible: cualquier click fuera cierra el menú. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={closeMenu}
            onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
          <div className="rd-menu wk-exp-menu" role="menu"
            style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 274),
              top: Math.min(menu.y + 2, window.innerHeight - 264), zIndex: 1000, maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px 2px',
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--subtle)' }}>
              <Crosshair size={12} /> Find in canvases
            </div>
            <div className="rd-mono" title={menu.name} style={{ padding: '0 10px 5px', fontSize: 11, color: 'var(--muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 250 }}>{menu.name}</div>
            <div className="rd-menu-sep" />
            {menuLoading && <div className="wk-exp-empty" style={{ padding: '8px 10px' }}>Loading…</div>}
            {!menuLoading && menuUsage && menuUsage.length === 0 && (
              <div className="wk-exp-empty" style={{ padding: '8px 10px' }}>Not used on any canvas.</div>
            )}
            {menuUsage?.map((u) => (
              <button key={u.canvasId} type="button" className="rd-menu-item" role="menuitem"
                onClick={() => goToCanvas(u)} title={`Open “${u.canvas}” and center on the table`}>
                <Crosshair />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.canvas}</span>
                  {(u.project || u.folder) && (
                    <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[u.project, u.folder].filter(Boolean).join(' › ')}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
