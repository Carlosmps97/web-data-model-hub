import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Database, Eye, KeyRound, Link as LinkIcon,
  RefreshCw, Search, Table2, X,
} from 'lucide-react';
import { apiGet } from '@/services/http';
import {
  listReportColumns, listReportTables, listReportViews,
  type ReportColumnRow, type ReportTableRow, type ReportViewRow,
} from '@/services/reporting.service';
import { listPublishedSchemas, type DbSchema } from '@/features/modeler/services/schemas.service';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
// Indentación por nivel (mismos valores que ModelExplorer).
const INDENT = 14;
const PAD_BASE = 6;
/** Tope de tablas por esquema (aviso si se alcanza). */
const TABLES_CAP = 500;

interface SearchHit { id: string; physicalName: string; logicalName: string; schema?: string }

/**
 * Database Explorer (doc 18 §5): navegación SOLO LECTURA de lo publicado en
 * producción — esquemas → tablas (→ columnas) y vistas (→ columnas) — con
 * búsqueda server-side por nombre. Segunda sección del sidebar, apilada bajo
 * el Model Explorer, colapsada por defecto. SIEMPRE muestra producción
 * (endpoints de reporting/catálogo, sin overlay de changeset): un draft sin
 * publicar NO aparece acá. Sin acciones de edición, visible para todos los
 * roles (lectores incluidos).
 */
export default function DatabaseExplorer() {
  const [open, setOpen] = useState(false);
  const [schemas, setSchemas] = useState<DbSchema[] | null>(null);
  const [expSchemas, setExpSchemas] = useState<Set<string>>(new Set());
  const [expTables, setExpTables] = useState<Set<string>>(new Set());
  const [expViews, setExpViews] = useState<Set<string>>(new Set());
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, ReportTableRow[]>>({});
  const [viewsBySchema, setViewsBySchema] = useState<Record<string, ReportViewRow[]>>({});
  const [colsByTable, setColsByTable] = useState<Record<string, ReportColumnRow[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const mark = (key: string, on: boolean) => setLoading((s) => {
    const next = new Set(s);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const loadSchemas = async (force = false) => {
    if (schemas !== null && !force) return;
    mark('root', true);
    try { setSchemas(await listPublishedSchemas()); }
    catch { setSchemas([]); }
    finally { mark('root', false); }
  };

  useEffect(() => { if (open) void loadSchemas(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    // Producción no cambia con el changeset activo: refresh manual tras un publish.
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
        listReportTables({ schema: name, limit: TABLES_CAP }).catch(() => [] as ReportTableRow[]),
        listReportViews(undefined, name).catch(() => [] as ReportViewRow[]),
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
      void listReportColumns(id)
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

  // Búsqueda server-side por nombre (catálogo publicado; contains + limit).
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits(null); return; }
    let alive = true;
    const h = setTimeout(() => {
      mark('search', true);
      apiGet<SearchHit[]>(`${API_BASE}/api/catalog/tables?q=${encodeURIComponent(term)}&limit=50`)
        .then((rows) => { if (alive) setHits(rows); })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) mark('search', false); });
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);

  const spin = <span className="rd-spin" style={{ color: 'var(--primary)', marginLeft: 'auto' }} aria-hidden />;

  const colIcon = (c: ReportColumnRow) =>
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

  const tableRow = (t: { id: string; physicalName: string; logicalName?: string; columnCount?: number }, depth: number) => (
    <div key={t.id}>
      <div className="wk-exp-row" style={{ paddingLeft: PAD_BASE + depth * INDENT }}
        title={t.logicalName || undefined} onClick={() => toggleTable(t.id)}>
        {expTables.has(t.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="wk-exp-ico"><Table2 size={13} /></span>
        <span className="wk-exp-label rd-mono" style={{ fontSize: 12.5 }}>{t.physicalName}</span>
        {t.columnCount != null && <span className="wk-dbx-badge">{t.columnCount}</span>}
        {loading.has(`tbl:${t.id}`) && spin}
      </div>
      {expTables.has(t.id) && columnRows(t.id, depth + 1)}
    </div>
  );

  const viewRow = (v: ReportViewRow, depth: number) => (
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

  const schemaNode = (s: DbSchema) => {
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
        title="Published production database (read-only)">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Database size={13} />
        <span style={{ flex: 1, textAlign: 'left' }}>Database Explorer</span>
        {open && (
          <span
            role="button"
            tabIndex={0}
            className="wk-exp-headbtn"
            title="Refresh (production)"
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
    </section>
  );
}
