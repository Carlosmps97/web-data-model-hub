/**
 * ReportingScreen (pr — Screen 11) — tabular reporting of metadata.
 *
 * Layout (per design #pr + R6c spec):
 *   · header: REPORTING eyebrow + "Reporting" h1 + blurb
 *   · filter bar: table-name search + multi-select comboboxes
 *     (Schema · Project · Subject area) that filter the grid live, plus Clear
 *   · metadata table: Table · Schema · Subject area · #Columns · #Relations ·
 *     Projects · Functional definition — zebra rows, hover, sticky header
 *   · right rail: "Export to Excel" checklist of detail levels → xlsx workbook
 *     (one sheet per checked level), then small KPI indicators
 *
 * Data: reporting.service (tables + columns + filters), always for ONE project
 * (doc 75 D13: the Project picker at the start of the bar is mandatory; the
 * session's project, then the last opened one, is preselected). Search + chips
 * filter the loaded rows client-side; the first filter applied loads the full set.
 * Doc 92 D3–D5: without filters the grid loads pages of 50 and fetches the next
 * one when the sentinel row scrolls into view; the bar shows the REAL total
 * (`/tables/count`) and «Select all» selects every table of the project (loaded
 * or not) — the export then downloads the full set. Doc 92 D2: the Schema and
 * Subject area popovers have a «contains» search box.
 * Doc 70: the filter combos list the WHOLE catalog (`/reporting/filters`), not
 * just the values of the 50 rows loaded up-front; a Show switch renders the
 * grid as Tables · Columns · Tables + Columns (same pure row builders as the
 * Excel export, `lib/reportRows`), and the export gains the joined sheet.
 * Loading → skeleton/placeholders; errors → sonner toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Layers,
  Search,
  SlidersHorizontal,
  TableProperties,
} from 'lucide-react';

import ReportDesigner from '@/features/reporting/components/ReportDesigner';
import SheetTemplateCard from '@/features/reporting/components/SheetTemplateCard';
import SearchSelect from '@/features/modeler/components/SearchSelect';
import { Button } from '@/components/ui';
import { listProjects } from '@/services/projects.service';
import { sortProjects } from '@/lib/projects';
import { LAST_PROJECT_KEY, useSessionStore } from '@/store/useSessionStore';
import type { Project } from '@/types/model';
import {
  countReportTables,
  listReportColumns,
  listReportFilters,
  listReportTables,
  listReportViews,
  type ReportColumnRow,
  type ReportFilterOptions,
  type ReportTableRow,
} from '@/services/reporting.service';
import { getRelationshipsReport } from '@/features/reporting/query.service';
import {
  COLUMN_BATCH, chunk, columnSheetRow, joinedSheetRow, sheetHeaders, sortColumnRows, tableSheetRow, udpKeysOf, unionSorted,
  type SheetRow,
} from '@/features/reporting/lib/reportRows';

// ── export levels ─────────────────────────────────────────────────────────────

type LevelKey = 'tables' | 'columns' | 'joined' | 'relationships' | 'views' | 'definitions';
/** Doc 70 §4.2: qué muestra la grilla en pantalla. */
type ShowMode = 'tables' | 'columns' | 'joined';

interface LevelSpec {
  key: LevelKey;
  name: string;
  hint: string;
  sheet: string;
}

const EXPORT_LEVELS: LevelSpec[] = [
  { key: 'tables', name: 'Tables overview', hint: 'One row per table: schema, counts, subject areas, projects, definition, flags, UDPs.', sheet: 'Tables' },
  { key: 'columns', name: 'Columns detail', hint: 'Every field: physical & logical type, PK/FK, nullable, partition, domain, ordinals, overrides, UDPs.', sheet: 'Columns' },
  { key: 'joined', name: 'Tables + Columns (joined)', hint: 'One row per column carrying its table metadata — everything in a single sheet.', sheet: 'Tables + Columns' },
  { key: 'relationships', name: 'Relationships', hint: 'One row per relationship: tables, columns and cardinality.', sheet: 'Relationships' },
  { key: 'views', name: 'Views detail', hint: 'Views derived from the selected tables: sources, User-Defined SQL, per-column aliases, casts and expressions.', sheet: 'Views' },
  { key: 'definitions', name: 'Definitions', hint: 'Functional definition text per table.', sheet: 'Definitions' },
];

/** Columnas de un lote de tablas por tandas de 300 ids (largo de URL) — sin
 *  el viejo fallback «más de 300 tablas ⇒ descarga completa capada». */
async function fetchColumnsFor(projectId: string, ids: string[]): Promise<ReportColumnRow[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunk(ids, COLUMN_BATCH).map((part) => listReportColumns(projectId, undefined, part)));
  return parts.flat();
}

/** Proyecto inicial del módulo: el de la sesión de canvas → el último abierto → el primero A–Z. */
function initialProjectId(projects: Project[]): string | null {
  const session = useSessionStore.getState().activeProjectId;
  if (session && projects.some((p) => p.id === session)) return session;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* storage ausente */ }
  if (last && projects.some((p) => p.id === last)) return last;
  return sortProjects(projects)[0]?.id ?? null;
}

/** Selector de proyecto (doc 75 D13): obligatorio, comparte estilo con el Standards. */
function ProjectPick({ projects, projectId, onPick }: { projects: Project[]; projectId: string | null; onPick: (id: string) => void }) {
  const name = projects.find((p) => p.id === projectId)?.name ?? '';
  return (
    <span className="dmh-rep-project" title="Project">
      <SearchSelect
        options={sortProjects(projects).map((p) => ({ value: p.id, label: p.name }))}
        valueLabel={name}
        placeholder={projects.length ? 'Project…' : 'No projects yet'}
        onPick={(v) => { if (v) onPick(v); }}
        disabled={projects.length === 0}
      />
    </span>
  );
}

// ── multi-select filter popover ───────────────────────────────────────────────

const GRID_ROW_CAP = 5000;
/** Doc 92 D3: tamaño de página del scroll infinito de la grilla de tablas. */
const TABLE_PAGE = 50;

/** Doc 70 §4.2 — grilla genérica de filas ya aplanadas por las mismas funciones
 *  puras del Excel (`lib/reportRows`): encabezados = unión de claves, scroll
 *  horizontal, tope de filas en pantalla (el export no lo tiene). */
function MetaGrid({ rows, loading, notice, scopeLabel }: {
  rows: SheetRow[]; loading: boolean; notice: string | null; scopeLabel: string;
}) {
  const headers = useMemo(() => sheetHeaders(rows), [rows]);
  const shown = rows.length > GRID_ROW_CAP ? rows.slice(0, GRID_ROW_CAP) : rows;
  if (notice) {
    return (
      <div className="dmh-rep-state">
        <div className="dmh-rep-state-ico"><TableProperties size={26} strokeWidth={1.3} aria-hidden /></div>
        <div className="dmh-rep-state-t">{notice}</div>
      </div>
    );
  }
  if (loading) return <div className="dmh-rep-state"><div className="dmh-rep-state-t">Loading columns…</div></div>;
  if (rows.length === 0) {
    return (
      <div className="dmh-rep-state">
        <div className="dmh-rep-state-t">No columns in scope</div>
        <div className="dmh-rep-state-m">{scopeLabel}</div>
      </div>
    );
  }
  return (
    <>
      <div className="dmh-rep-gridnote">
        {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'} · {scopeLabel}
        {rows.length > GRID_ROW_CAP && ` · showing the first ${GRID_ROW_CAP.toLocaleString()} — export to Excel for the full set`}
      </div>
      <table className="dmh-rep-table dmh-rep-table--wide">
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {headers.map((h) => {
                const v = r[h];
                return <td key={h} title={typeof v === 'string' && v.length > 60 ? v : undefined}>{v === '' || v == null ? <span className="dmh-rep-chip-none">—</span> : String(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface MultiFilterProps {
  label: string;
  icon: typeof TableProperties;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}

function MultiFilter({ label, icon: Icon, options, selected, onToggle }: MultiFilterProps) {
  const [open, setOpen] = useState(false);
  // Doc 92 D2: filtro «contiene» (case-insensitive) sobre las opciones del popover.
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const visible = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const count = selected.size;
  return (
    <div className="dmh-rep-filter" ref={ref}>
      <button
        type="button"
        className={`dmh-rep-filter-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon className="ico" strokeWidth={1.6} aria-hidden />
        <span>{label}</span>
        {count > 0 && <span className="dmh-rep-filter-count">{count}</span>}
        <ChevronDown className="chev" strokeWidth={1.7} aria-hidden />
      </button>
      {open && (
        <div className="dmh-rep-menu" role="listbox">
          <div className="dmh-rep-menu-search">
            <Search strokeWidth={1.7} aria-hidden />
            <input
              type="text"
              autoFocus
              value={q}
              placeholder={`Filter ${label.toLowerCase()}… (contains)`}
              onChange={(e) => setQ(e.target.value)}
              aria-label={`Filter ${label.toLowerCase()}`}
            />
          </div>
          {options.length === 0 ? (
            <div className="dmh-rep-menu-empty">No options</div>
          ) : visible.length === 0 ? (
            <div className="dmh-rep-menu-empty">No matches</div>
          ) : (
            visible.map((opt) => {
              const on = selected.has(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`dmh-rep-opt${on ? ' is-on' : ''}`}
                  onClick={() => onToggle(opt)}
                >
                  <span className="dmh-rep-opt-box">{on && <Check strokeWidth={3} aria-hidden />}</span>
                  <span className="dmh-rep-opt-label">{opt}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

export default function ReportingScreenWrapper() {
  const [designer, setDesigner] = useState(false);
  // Doc 75 D13: todo reporte es de UN proyecto — el wrapper lo elige y lo comparte.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    listProjects()
      .then((ps) => { setProjects(ps); setProjectId(initialProjectId(ps)); })
      .catch(() => toast.error("Couldn't load the projects"));
  }, []);
  const pick = <ProjectPick projects={projects} projectId={projectId} onPick={setProjectId} />;
  if (!projectId) {
    return (
      <div className="dmh-rep"><div className="dmh-rep-inner">
        <div className="dmh-rep-head"><div className="dmh-rep-eyebrow">Reporting</div><h1 className="dmh-rep-h1">Reporting</h1></div>
        <div className="dmh-rep-state">
          <div className="dmh-rep-state-t">{projects.length === 0 ? 'Create a project first to report on it.' : 'Loading…'}</div>
          {projects.length > 0 && <div style={{ marginTop: 12 }}>{pick}</div>}
        </div>
      </div></div>
    );
  }
  if (designer) {
    return (
      <div style={{ height: '100%', minHeight: 0 }}>
        <ReportDesigner key={projectId} projectId={projectId} projectPicker={pick} onClose={() => setDesigner(false)} />
      </div>
    );
  }
  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';
  return <ReportingScreen key={projectId} projectId={projectId} projectName={projectName} projectPicker={pick} onDesign={() => setDesigner(true)} />;
}

function ReportingScreen({ projectId, projectName, projectPicker, onDesign }: {
  projectId: string; projectName: string; projectPicker: React.ReactNode; onDesign: () => void;
}) {
  const [tables, setTables] = useState<ReportTableRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [schemaSel, setSchemaSel] = useState<Set<string>>(new Set());
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());

  const [levels, setLevels] = useState<Set<LevelKey>>(new Set<LevelKey>(['tables', 'columns']));
  const [exporting, setExporting] = useState(false);

  // Doc 70 §4.1: universo COMPLETO de los filtros (no depende de las 50 filas
  // de la carga inicial). Si falla, los combos caen a lo derivado de las filas.
  const [serverFilters, setServerFilters] = useState<ReportFilterOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    listReportFilters(projectId).then((f) => { if (!cancelled) setServerFilters(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
  // Doc 70 §4.2: qué muestra la grilla — tablas, sus columnas o la fila unida.
  const [show, setShow] = useState<ShowMode>('tables');

  // Doc 92 D3: sin filtros la grilla se carga por PÁGINAS (orden físico) y pide
  // la siguiente cuando el centinela entra al viewport; con un filtro se
  // descarga el set completo (facetas/conteos exactos sobre todo).
  const [fullLoad, setFullLoad] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Doc 92 D4: total REAL de tablas del proyecto (null = aún no llegó).
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listReportTables(projectId, { limit: TABLE_PAGE, offset: 0 }),
      countReportTables(projectId).catch(() => null),
    ])
      .then(([rows, n]) => {
        if (cancelled) return;
        setTables(rows);
        setHasMore(rows.length === TABLE_PAGE);
        setTotal(n);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the reporting tables.');
        setTables([]);
        setHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  useEffect(() => {
    if (!fullLoad) return undefined;
    let cancelled = false;
    setLoading(true);
    listReportTables(projectId, {})
      .then((rows) => {
        if (cancelled) return;
        setTables(rows);
        setHasMore(false);
        setTotal(rows.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the reporting tables.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fullLoad, projectId]);
  const loadMore = useCallback(() => {
    if (fullLoad || !hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    listReportTables(projectId, { limit: TABLE_PAGE, offset: tables.length })
      .then((rows) => {
        setTables((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...rows.filter((r) => !seen.has(r.id))];
        });
        setHasMore(rows.length === TABLE_PAGE);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Could not load more tables.');
        setHasMore(false);
      })
      .finally(() => setLoadingMore(false));
  }, [fullLoad, hasMore, loadingMore, loading, projectId, tables.length]);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  // Centinela al final de la tabla: al asomar (200 px antes) pide la página
  // siguiente. Se re-arma cuando cambia lo cargado o el modo de la grilla.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || fullLoad || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMoreRef.current(); },
      { root: scrollRef.current, rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fullLoad, hasMore, show, loading, tables.length]);
  // Hay tablas del proyecto que la grilla aún no cargó (sin filtros).
  const partial = !fullLoad && hasMore;

  // Per-facet predicates. Building a facet's options excludes its OWN selection,
  // so the filters narrow each other (cumulative / faceted).
  const passSearch = useCallback(
    (t: ReportTableRow) => {
      const q = search.trim().toLowerCase();
      return !q || t.physicalName.toLowerCase().includes(q) || t.logicalName.toLowerCase().includes(q);
    },
    [search],
  );
  const passSchema = useCallback(
    (t: ReportTableRow) => schemaSel.size === 0 || schemaSel.has(t.schema),
    [schemaSel],
  );
  const passArea = useCallback(
    (t: ReportTableRow) => areaSel.size === 0 || t.subjectAreas.some((a) => areaSel.has(a)),
    [areaSel],
  );

  // Faceted option lists: each reflects rows passing the OTHER filters; selected
  // values are always kept visible so they can be toggled off.
  const schemaOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passArea(t)).map((t) => t.schema).filter(Boolean),
    );
    schemaSel.forEach((v) => s.add(v));
    return unionSorted(serverFilters?.schemas ?? [], s);   // doc 70: universo completo
  }, [tables, passSearch, passArea, schemaSel, serverFilters]);
  const areaOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passSchema(t)).flatMap((t) => t.subjectAreas).filter(Boolean),
    );
    areaSel.forEach((v) => s.add(v));
    return unionSorted(serverFilters?.subjectAreas ?? [], s);
  }, [tables, passSearch, passSchema, areaSel, serverFilters]);

  // Rows passing ALL filters.
  const filtered = useMemo(
    () => tables.filter((t) => passSearch(t) && passSchema(t) && passArea(t)),
    [tables, passSearch, passSchema, passArea],
  );

  // ── row selection (drives the Excel export) ──────────────────────────────────
  // Explicit set; starts EMPTY (nothing selected). Only ids among the visible
  // (filtered) rows count toward the export. Doc 92 D5: `allSelected` = TODAS
  // las tablas del proyecto (cargadas o no) — el export baja el set completo.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allSelected, setAllSelected] = useState(false);
  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const selectedIds = useMemo(
    () => (allSelected ? new Set(filteredIds) : new Set(filteredIds.filter((id) => selected.has(id)))),
    [allSelected, selected, filteredIds],
  );
  const selectedRows = useMemo(
    () => filtered.filter((t) => selectedIds.has(t.id)),
    [filtered, selectedIds],
  );
  const selectedCount = allSelected && partial && total != null ? total : selectedIds.size;
  const allRowsSelected = allSelected || (filtered.length > 0 && selectedIds.size === filtered.length);

  // Filas a exportar: la selección, o TODAS las del proyecto (filtradas) con
  // «Select all» y páginas pendientes (doc 92 D5). Las comparten el export por
  // niveles y el de plantilla (doc 95 D11).
  const resolveExportRows = useCallback(async (): Promise<ReportTableRow[]> => (
    allSelected && partial
      ? (await listReportTables(projectId, {})).filter((t) => passSearch(t) && passSchema(t) && passArea(t))
      : selectedRows
  ), [allSelected, partial, projectId, passSearch, passSchema, passArea, selectedRows]);
  const fetchColumns = useCallback((ids: string[]) => fetchColumnsFor(projectId, ids), [projectId]);

  const toggleRow = (id: string) => {
    if (allSelected) {
      // Desmarcar una fila con todo seleccionado: modo explícito sobre lo cargado (S3).
      setAllSelected(false);
      setSelected(new Set(filteredIds.filter((x) => x !== id)));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllRows = () => {
    if (allSelected) { setAllSelected(false); setSelected(new Set()); return; }
    if (partial) { setAllSelected(true); setSelected(new Set(filteredIds)); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      if (allRowsSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // Right-rail summaries derive from the (filtered) rows.
  const bySubjectArea = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((t) => t.subjectAreas.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered]);
  const maxArea = bySubjectArea[0]?.[1] ?? 1;
  const mostRelated = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => b.relationshipCount - a.relationshipCount)
        .slice(0, 5),
    [filtered],
  );

  // ── Doc 70 §4.2: columnas de las tablas en foco (selección, o las filtradas)
  // para los modos Columns / Tables + Columns. Tope por consulta: 300 tablas
  // (largo de URL); por encima se pide acotar (filtro o selección).
  const colScope = useMemo(() => (selectedRows.length > 0 ? selectedRows : filtered), [selectedRows, filtered]);
  const colScopeKey = useMemo(() => colScope.map((t) => t.id).join(','), [colScope]);
  const colScopeTooBig = colScope.length > COLUMN_BATCH;
  const [colRows, setColRows] = useState<ReportColumnRow[] | null>(null);
  const [colLoading, setColLoading] = useState(false);
  useEffect(() => {
    if (show === 'tables' || colScopeTooBig || colScope.length === 0) { setColRows(null); return undefined; }
    let cancelled = false;
    setColLoading(true);
    fetchColumnsFor(projectId, colScope.map((t) => t.id))
      .then((rows) => { if (!cancelled) setColRows(rows); })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the columns.');
        setColRows([]);
      })
      .finally(() => { if (!cancelled) setColLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, colScopeKey, colScopeTooBig]);
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t] as const)), [tables]);
  const gridRows = useMemo<SheetRow[]>(() => {
    if (show === 'tables' || !colRows) return [];
    const sorted = sortColumnRows(colRows, (id) => tableById.get(id)?.physicalName ?? id);
    const colUdp = udpKeysOf(sorted.map((c) => c.udpValues));
    if (show === 'columns') return sorted.map((c) => columnSheetRow(c, tableById.get(c.tableId), colUdp));
    const tblUdp = udpKeysOf(colScope.map((t) => t.udpValues));
    return sorted.map((c) => joinedSheetRow(c, tableById.get(c.tableId), tblUdp, colUdp));
  }, [show, colRows, tableById, colScope]);

  // La búsqueda cuenta como filtro recién con 2+ caracteres: el PRIMER
  // keystroke no debe disparar la descarga del set completo (15k tablas).
  const anyFilter =
    search.trim().length >= 2 || schemaSel.size > 0 || areaSel.size > 0;

  // The first time any filter is applied, load the full table set — con
  // debounce para que tipear rápido no encole la carga a mitad de palabra.
  useEffect(() => {
    if (!anyFilter || fullLoad) return;
    const t = setTimeout(() => setFullLoad(true), 300);
    return () => clearTimeout(t);
  }, [anyFilter, fullLoad]);

  const clearFilters = () => {
    setSearch('');
    setSchemaSel(new Set());
    setAreaSel(new Set());
  };

  const toggleSet = <T,>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const toggleLevel = (key: LevelKey) => toggleSet<LevelKey>(setLevels, key);

  // ── Excel export: one sheet per checked level ────────────────────────────────
  const handleExport = async () => {
    if (levels.size === 0) {
      toast.error('Pick at least one detail level to export.');
      return;
    }
    if (selectedRows.length === 0 && !(allSelected && partial)) {
      toast.error('Select at least one row to export.');
      return;
    }
    setExporting(true);
    try {
      // Doc 92 D5: Select all con páginas pendientes ⇒ TODAS las tablas del
      // proyecto (se bajan completas para el Excel, sin tocar la grilla).
      const rows = await resolveExportRows();
      if (rows.length === 0) {
        toast.error('Select at least one row to export.');
        return;
      }
      const wb = XLSX.utils.book_new();

      // UDPs como columnas dinámicas (una por def presente en la selección).
      // Doc 70: las MISMAS funciones puras de la grilla (lib/reportRows) arman
      // las hojas — metadata completa de tablas y columnas, por separado o unida.
      const tableUdpKeys = udpKeysOf(rows.map((t) => t.udpValues));
      if (levels.has('tables')) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((t) => tableSheetRow(t, tableUdpKeys))), 'Tables');
      }

      if (levels.has('columns') || levels.has('joined')) {
        // Columnas de las tablas seleccionadas por tandas de 300 ids (antes,
        // más de 300 tablas caía a la descarga completa capada a 20k).
        const byId = new Map(rows.map((t) => [t.id, t] as const));
        const cols = sortColumnRows(await fetchColumnsFor(projectId, rows.map((t) => t.id)), (id) => byId.get(id)?.physicalName ?? id);
        const colUdpKeys = udpKeysOf(cols.map((c) => c.udpValues));
        if (levels.has('columns')) {
          XLSX.utils.book_append_sheet(
            wb, XLSX.utils.json_to_sheet(cols.map((c) => columnSheetRow(c, byId.get(c.tableId), colUdpKeys))), 'Columns');
        }
        if (levels.has('joined')) {
          XLSX.utils.book_append_sheet(
            wb, XLSX.utils.json_to_sheet(cols.map((c) => joinedSheetRow(c, byId.get(c.tableId), tableUdpKeys, colUdpKeys))),
            'Tables + Columns');
        }
      }

      if (levels.has('relationships')) {
        // Detalle POR PAR de columnas (v2, doc 19): una FK compuesta emite una
        // fila por par (mismo Rel id + Pair). Acotado a las tablas seleccionadas.
        const ids = new Set(rows.map((t) => t.id));
        const rels = await getRelationshipsReport(projectId, 5000);
        const data = rels
          .filter((r) => (r.parentTableId && ids.has(r.parentTableId))
            || (r.childTableId && ids.has(r.childTableId)))
          .map((r) => ({
            'Parent schema': r.parentSchema ?? '',
            'Parent table': r.parentTable ?? r.parent,
            'Parent column': r.parentColumn ?? '',
            'Child schema': r.childSchema ?? '',
            'Child table': r.childTable ?? r.child,
            'Child column': r.childColumn ?? '',
            'Role name': r.roleName ?? '',
            Pair: r.pairCount && r.pairCount > 1 ? `${(r.pairIndex ?? 0) + 1}/${r.pairCount}` : '',
            Cardinality: r.cardinality,
            Identifying: r.identifying ? 'Y' : '',
            'Self-referencing': r.isSelfReferencing ? 'Y' : '',
            'Cross-schema': r.crossSchema ? 'Y' : '',
          }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Relationships');
      }

      if (levels.has('views')) {
        // Vistas derivadas de las tablas seleccionadas: 2 hojas — la vista en
        // sí (fuentes/SQL/User-Defined SQL) y su detalle columna a columna
        // (alias, origen, casteo, transformación). Mismo patrón acotado que Columns.
        const ids = rows.map((t) => t.id);
        const idSet = new Set(ids);
        const views = (await listReportViews(projectId, ids.length > 0 && ids.length <= 300 ? ids : undefined))
          .filter((v) => v.sourceTableIds.some((tid) => idSet.has(tid)));
        const viewsData = views.map((v) => ({
          View: v.name,
          Schema: v.schema ?? '',
          'Source tables': v.sourceTables.join(', '),
          '#Columns': v.columns.length,
          Mode: v.customSql ? 'Personalizada' : 'Regular',
          'On canvas': v.showOnCanvas ? 'Y' : '',
          Canvases: (v.canvases ?? []).join(', '),   // doc 70: membresía por canvas
          Description: v.description ?? '',
          SQL: v.sql ?? '',
          'User-Defined SQL': v.customSql ?? '',
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(viewsData), 'Views');
        const colsData = views.flatMap((v) =>
          v.columns.map((c) => ({
            View: v.name,
            Schema: v.schema ?? '',
            'Output alias': c.outputAlias ?? '',
            'Source table': c.sourceTable ?? '',
            'Source column': c.sourceColumn ?? '',
            'Cast type': c.castType ?? '',
            'Expression / transform': c.expression ?? '',
          })),
        );
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(colsData), 'View columns');
      }

      if (levels.has('definitions')) {
        const data = rows.map((t) => ({
          Table: t.physicalName,
          'Logical name': t.logicalName,
          'Functional definition': t.description,
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Definitions');
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const slug = projectName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
      XLSX.writeFile(wb, `data-model-hub-report-${slug}-${stamp}.xlsx`);
      toast.success('Report exported to Excel.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not build the Excel file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dmh-rep">
      <div className="dmh-rep-inner">
        {/* ── header ───────────────────────────────────────────────── */}
        <div className="dmh-rep-head">
          <div className="dmh-rep-eyebrow">Reporting</div>
          <h1 className="dmh-rep-h1">Reporting</h1>
          <p className="dmh-rep-sub">
            Tabular view of the metadata of one project — tables, columns, relationships and views.
            Pick the project, filter the grid, then export the detail levels you need to Excel.
          </p>
        </div>

        <div className="dmh-rep-cols">
          {/* ── left: filters + table ──────────────────────────────── */}
          <div className="dmh-rep-main">
            <div className="dmh-rep-bar">
              {/* Doc 75 D13: proyecto del reporte (obligatorio). */}
              {projectPicker}
              {/* Doc 70 §4.2: qué muestra la grilla — tablas, sus columnas o la fila unida. */}
              <div className="rd-seg" role="tablist" aria-label="Show">
                <button type="button" role="tab" aria-selected={show === 'tables'} className={show === 'tables' ? 'active' : ''} onClick={() => setShow('tables')}>Tables</button>
                <button type="button" role="tab" aria-selected={show === 'columns'} className={show === 'columns' ? 'active' : ''} onClick={() => setShow('columns')}>Columns</button>
                <button type="button" role="tab" aria-selected={show === 'joined'} className={show === 'joined' ? 'active' : ''} onClick={() => setShow('joined')}>Tables + Columns</button>
              </div>
              <div className="dmh-rep-search">
                <Search strokeWidth={1.7} aria-hidden />
                <input
                  type="text"
                  placeholder="Search tables by name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search tables by name"
                />
              </div>
              <MultiFilter
                label="Schema"
                icon={TableProperties}
                options={schemaOptions}
                selected={schemaSel}
                onToggle={(v) => toggleSet<string>(setSchemaSel, v)}
              />
              <MultiFilter
                label="Subject area"
                icon={Layers}
                options={areaOptions}
                selected={areaSel}
                onToggle={(v) => toggleSet<string>(setAreaSel, v)}
              />
              {anyFilter && (
                <button type="button" className="dmh-rep-clear" onClick={clearFilters}>
                  Clear
                </button>
              )}
              <span className="dmh-rep-selcount">
                <strong>{selectedCount.toLocaleString()} selected</strong> ·{' '}
                {partial
                  ? <>{tables.length.toLocaleString()} of {total == null ? '…' : total.toLocaleString()} tables</>
                  : <>{filtered.length.toLocaleString()} table{filtered.length === 1 ? '' : 's'}</>}
                {partial && <em className="dmh-rep-selcount-hint"> · scroll to load more</em>}
              </span>
            </div>

            <div className="dmh-rep-tablewrap">
              <div className="dmh-rep-tablescroll" ref={scrollRef}>
                {show !== 'tables' ? (
                  <MetaGrid
                    rows={gridRows}
                    loading={loading || colLoading}
                    notice={colScopeTooBig
                      ? `Narrow the tables to ${COLUMN_BATCH} or fewer (filter, or select rows in the Tables view) to browse their columns — ${colScope.length} in scope now.`
                      : colScope.length === 0 ? 'No tables in scope.' : null}
                    scopeLabel={`${selectedRows.length > 0 ? 'selected' : 'filtered'} table${colScope.length === 1 ? '' : 's'}: ${colScope.length}`}
                  />
                ) : (
                <table className="dmh-rep-table">
                  <thead>
                    <tr>
                      <th className="dmh-rep-check">
                        <button
                          type="button"
                          className={`dmh-rep-cbox${allRowsSelected ? ' is-on' : ''}`}
                          onClick={toggleAllRows}
                          aria-label="Select all rows"
                          disabled={filtered.length === 0}
                        >
                          {allRowsSelected && <Check strokeWidth={3} aria-hidden />}
                        </button>
                      </th>
                      <th>Table</th>
                      <th>Schema</th>
                      <th>Subject area</th>
                      <th className="num">#Columns</th>
                      <th className="num">#Relations</th>
                      <th>Projects</th>
                      <th>Functional definition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="dmh-rep-skel">
                          <td colSpan={8} className="dmh-rep-skel-row" />
                        </tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <div className="dmh-rep-state">
                            <div className="dmh-rep-state-ico">
                              <TableProperties size={26} strokeWidth={1.3} aria-hidden />
                            </div>
                            <div className="dmh-rep-state-t">
                              {anyFilter ? 'No tables match your filters' : 'No tables to report yet'}
                            </div>
                            <div className="dmh-rep-state-m">
                              {anyFilter
                                ? 'Try clearing the search or a filter.'
                                : 'Once your model has tables, they will show up here.'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filtered.map((t) => (
                        <tr key={t.id} className={selectedIds.has(t.id) ? 'is-selected' : ''}>
                          <td className="dmh-rep-check">
                            <button
                              type="button"
                              className={`dmh-rep-cbox${selectedIds.has(t.id) ? ' is-on' : ''}`}
                              onClick={() => toggleRow(t.id)}
                              aria-label={`Select ${t.physicalName}`}
                            >
                              {selectedIds.has(t.id) && <Check strokeWidth={3} aria-hidden />}
                            </button>
                          </td>
                          <td>
                            <div className="dmh-rep-tname">
                              <span className="dmh-rep-tname-phys">{t.physicalName}</span>
                              {t.logicalName && t.logicalName !== t.physicalName && (
                                <span className="dmh-rep-tname-log">{t.logicalName}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="dmh-rep-schema">{t.schema || '—'}</span>
                          </td>
                          <td>
                            {t.subjectAreas.length === 0 ? (
                              <span className="dmh-rep-chip-none">—</span>
                            ) : (
                              <div className="dmh-rep-chips">
                                {t.subjectAreas.map((a) => (
                                  <span key={a} className="dmh-rep-chip dmh-rep-chip--sa">
                                    {a}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="num">{t.columnCount}</td>
                          <td className="num">{t.relationshipCount}</td>
                          <td>
                            {t.projects.length === 0 ? (
                              <span className="dmh-rep-chip-none">—</span>
                            ) : (
                              <div className="dmh-rep-chips">
                                {t.projects.map((p) => (
                                  <span key={p} className="dmh-rep-chip dmh-rep-chip--proj">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className={`dmh-rep-def${t.description ? '' : ' is-empty'}`}>
                              {t.description || 'No definition'}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                    {/* Doc 92 D3: centinela del scroll infinito (sólo sin filtros y con páginas pendientes). */}
                    {!loading && partial && (
                      <tr ref={sentinelRef} className="dmh-rep-sentinel">
                        <td colSpan={8}>{loadingMore ? 'Loading more tables…' : 'Scroll to load more'}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          </div>

          {/* ── right: export rail + KPIs ──────────────────────────── */}
          <div className="dmh-rep-rail">
            <div className="dmh-rep-card">
              <div className="dmh-rep-card-head">
                <span className="dmh-rep-card-ico">
                  <FileSpreadsheet size={17} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="dmh-rep-card-title">Export to Excel</span>
              </div>
              <div className="dmh-rep-card-desc">
                Choose the detail levels to include — each becomes a sheet in the workbook.
                Exports respect the filters above.
              </div>
              <div className="dmh-rep-levels">
                {EXPORT_LEVELS.map((lvl) => {
                  const on = levels.has(lvl.key);
                  return (
                    <button
                      key={lvl.key}
                      type="button"
                      className={`dmh-rep-level${on ? ' is-on' : ''}`}
                      onClick={() => toggleLevel(lvl.key)}
                      aria-pressed={on}
                    >
                      <span className="dmh-rep-level-box">{on && <Check strokeWidth={3} aria-hidden />}</span>
                      <span className="dmh-rep-level-text">
                        <span className="dmh-rep-level-name">{lvl.name}</span>
                        <span className="dmh-rep-level-hint">{lvl.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="dmh-rep-card-foot">
                <Button
                  variant="success"
                  icon={Download}
                  className="dmh-rep-export-btn"
                  onClick={handleExport}
                  disabled={exporting || levels.size === 0 || selectedCount === 0 || loading}
                >
                  {exporting ? 'Exporting…' : 'Download .xlsx'}
                </Button>
                <div className="dmh-rep-export-note">
                  Only the <strong>{selectedCount} selected</strong> row
                  {selectedCount === 1 ? '' : 's'} will be exported.
                </div>
              </div>
            </div>

            {/* Doc 95 D11: formatos fijos guardados (p. ej. QA_MODELO) */}
            <SheetTemplateCard projectId={projectId} selectedCount={selectedCount} disabled={loading}
              resolveTables={resolveExportRows} fetchColumns={fetchColumns} />

            <div className="dmh-rep-card dmh-rep-sumcard">
              <div className="dmh-rep-sumcard-title">Tables by subject area</div>
              {loading ? (
                <div className="dmh-rep-sumcard-empty">Loading…</div>
              ) : bySubjectArea.length === 0 ? (
                <div className="dmh-rep-sumcard-empty">No subject areas in view.</div>
              ) : (
                <div className="dmh-rep-bars">
                  {bySubjectArea.map(([area, n]) => (
                    <div key={area} className="dmh-rep-bar-row">
                      <div className="dmh-rep-bar-head">
                        <span className="dmh-rep-bar-name">{area}</span>
                        <span className="dmh-rep-bar-val">{n}</span>
                      </div>
                      <div className="dmh-rep-bar-track">
                        <div
                          className="dmh-rep-bar-fill"
                          style={{ width: `${Math.round((n / maxArea) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dmh-rep-card dmh-rep-sumcard">
              <div className="dmh-rep-sumcard-title">Most related / in most projects</div>
              {loading ? (
                <div className="dmh-rep-sumcard-empty">Loading…</div>
              ) : mostRelated.length === 0 ? (
                <div className="dmh-rep-sumcard-empty">No tables in view.</div>
              ) : (
                <div className="dmh-rep-related">
                  {mostRelated.map((t) => (
                    <div key={t.id} className="dmh-rep-related-row">
                      <span className="dmh-rep-related-name">{t.physicalName}</span>
                      <span className="dmh-rep-related-rel">{t.relationshipCount} rel.</span>
                      <span className="dmh-rep-related-proj">· {t.projects.length} proj.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Report Designer — motor de consulta (SQL + filtros UDP). Bajo el rail. */}
            <div className="dmh-rep-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Button variant="primary" icon={SlidersHorizontal} onClick={onDesign} style={{ width: '100%', justifyContent: 'center' }}>
                Design report
              </Button>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted-2)', textAlign: 'center' }}>
                Query engine · SQL &amp; UDP filters
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
