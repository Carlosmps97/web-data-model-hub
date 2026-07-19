import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, Crosshair, Database, EllipsisVertical, Eye, KeyRound, Link as LinkIcon,
  RefreshCw, Search, Table2, X,
} from 'lucide-react';
import {
  explorerColumns, explorerSchemas, explorerSearch, explorerTables, explorerViews,
  type DbxColumn, type DbxHit, type DbxSchema, type DbxTable, type DbxView,
} from '@/features/modeler/services/explorer.service';
import * as gov from '@/features/governance/services/governance.service';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';

// Indentación por nivel (mismos valores que ModelExplorer).
const INDENT = 14;
const PAD_BASE = 6;
/** Tope de tablas por esquema (aviso si se alcanza). */
const TABLES_CAP = 500;

/**
 * Database Explorer (doc 18 §5 · draft-aware doc 25): navegación SOLO LECTURA
 * de la BD — esquemas → tablas (→ columnas) y vistas (→ columnas) — con
 * búsqueda server-side por nombre. Segunda sección del sidebar, apilada bajo el
 * Model Explorer, colapsada por defecto.
 *
 * Cuando hay una VERSIÓN activa (draft) muestra su estado EFECTIVO (publicado +
 * overlay del changeset): las tablas/vistas/columnas creadas, renombradas o
 * borradas en la versión aparecen al instante (fuente = `explorer.service`, que
 * conmuta efectivo↔publicado). Sin versión activa muestra producción publicada.
 * Sin acciones de edición, visible para todos los roles (lectores incluidos).
 */
export default function DatabaseExplorer() {
  const [open, setOpen] = useState(false);
  const activeId = useChangesetStore((s) => s.activeId);
  const draft = activeId !== null;
  const [schemas, setSchemas] = useState<DbxSchema[] | null>(null);
  const [expSchemas, setExpSchemas] = useState<Set<string>>(new Set());
  const [expTables, setExpTables] = useState<Set<string>>(new Set());
  const [expViews, setExpViews] = useState<Set<string>>(new Set());
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, DbxTable[]>>({});
  const [viewsBySchema, setViewsBySchema] = useState<Record<string, DbxView[]>>({});
  const [colsByTable, setColsByTable] = useState<Record<string, DbxColumn[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DbxHit[] | null>(null);

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
    setExpTables(new Set()); setExpViews(new Set()); setHits(null); setQ('');
    setSchemas(null);
    if (open) void loadSchemas(true);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    // Recarga la vista actual (versión activa o producción).
    setTablesBySchema({}); setViewsBySchema({}); setColsByTable({});
    setExpTables(new Set()); setExpViews(new Set());
    void loadSchemas(true);
  };

  const toggleSchema = (name: string) => {
    const next = new Set(expSchemas);
    if (next.has(name)) { next.delete(name); setExpSchemas(next); return; }
    next.add(name); setExpSchemas(next);
    if (!tablesBySchema[name]) {
      mark(`sch:${name}`, true);
      void Promise.all([
        explorerTables(name).catch(() => [] as DbxTable[]),
        explorerViews(name).catch(() => [] as DbxView[]),
      ]).then(([tables, views]) => {
        setTablesBySchema((m) => ({ ...m, [name]: tables }));
        setViewsBySchema((m) => ({ ...m, [name]: views }));
      }).finally(() => mark(`sch:${name}`, false));
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
  // catálogo publicado; contains + limit).
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits(null); return; }
    let alive = true;
    const h = setTimeout(() => {
      mark('search', true);
      explorerSearch(term, 50)
        .then((rows) => { if (alive) setHits(rows); })
        .catch(() => { if (alive) setHits([]); })
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
      return <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + depth * INDENT }}>Cargando…</div>;
    }
    const cols = colsByTable[tableId] ?? [];
    if (cols.length === 0) {
      return <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + depth * INDENT }}>Sin columnas.</div>;
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

  const viewRow = (v: DbxView, depth: number) => (
    <div key={v.id}>
      <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE + depth * INDENT }}
        title={v.sourceTables.length ? `Fuentes: ${v.sourceTables.join(', ')}` : undefined}
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

  const schemaNode = (s: DbxSchema) => {
    const openSch = expSchemas.has(s.name);
    const tables = tablesBySchema[s.name];
    const views = viewsBySchema[s.name] ?? [];
    return (
      <div key={s.id}>
        <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE }} title={s.description || undefined}
          onClick={() => toggleSchema(s.name)}>
          {openSch ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="wk-exp-ico"><Database size={13} style={{ color: 'var(--navy)' }} /></span>
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{s.name}</span>
          {tables && <span className="wk-dbx-badge">{tables.length + views.length}</span>}
          {loading.has(`sch:${s.name}`) && spin}
        </div>
        {openSch && tables && (
          <>
            {tables.length === 0 && views.length === 0 && (
              <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + INDENT }}>Empty schema.</div>
            )}
            {tables.map((t) => tableRow(t, 1))}
            {tables.length >= TABLES_CAP && (
              <div className="wk-exp-empty" style={{ paddingLeft: PAD_BASE + INDENT }}>
                Mostrando las primeras {TABLES_CAP} tablas — usá la búsqueda.
              </div>
            )}
            {views.map((v) => viewRow(v, 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <section className={`wk-dbx${open ? ' open' : ''}`} aria-label="Database Explorer">
      <button type="button" className="wk-dbx-head" onClick={() => setOpen((o) => !o)}
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
            <input placeholder="Search table…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" title="Limpiar" onClick={() => setQ('')}><X size={11} /></button>
            )}
          </div>
          {hits !== null ? (
            <>
              {loading.has('search') && <div className="wk-exp-empty">Buscando…</div>}
              {!loading.has('search') && hits.length === 0 && <div className="wk-exp-empty">Sin resultados.</div>}
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
          ) : (
            <>
              {loading.has('root') && <div className="wk-exp-empty">Cargando esquemas…</div>}
              {schemas !== null && schemas.length === 0 && !loading.has('root') && (
                <div className="wk-exp-empty">No hay esquemas publicados.</div>
              )}
              {(schemas ?? []).map(schemaNode)}
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
