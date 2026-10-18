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
 * Doc 102: combo Version (producción o una versión propia sin publicar) — con
 * una versión propia la grilla, los filtros y los dos exports son de esa
 * versión; los lotes de ids van por POST (fin del 431).
 * Loading → skeleton/placeholders; errors → sonner toast.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Layers,
  Search,
  TableProperties,
} from 'lucide-react';

import {
  COLUMN_BATCH, SheetTemplateCard, columnSheetRow, fetchColumnsFor, fetchRelationshipsFor, fetchViewsFor,
  joinedSheetRow, levelsFileName, ownOpenVersions, productionLabel, readErrorText, relationshipSheetRow, sheetHeaders,
  sortColumnRows, tableSheetRow, udpKeysOf, unionSorted, vanishedVersionText, VERSION_TOAST, versionGoneText,
  versionOptionLabel, viewSheetRow, type SheetRow,
} from '@/features/reporting';
import SearchSelect from '@/features/modeler/components/SearchSelect';
import { Button } from '@/components/ui';
import { useFloating } from '@/components/ui/useFloating';
import { clipRect, contentBounds, placeAnchored } from '@/lib/floating';
import { listProjects } from '@/services/projects.service';
import { getChangeset, listVersions } from '@/services/versioning.service';
import { projectMeta, sortProjects } from '@/lib/projects';
import { LAST_PROJECT_KEY, useSessionStore } from '@/store/useSessionStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Project } from '@/types/model';
import type { VersionRow } from '@/types/versioning';
import {
  countReportTables, listReportFilters, listReportTables,
  type ReportColumnRow, type ReportFilterOptions, type ReportTableRow,
} from '@/services/reporting.service';

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
  { key: 'relationships', name: 'Relationships', hint: 'One row per relationship: tables, columns, cardinality and verb phrases.', sheet: 'Relationships' },
  { key: 'views', name: 'Views detail', hint: 'Views derived from the selected tables: sources, User-Defined SQL, per-column aliases, casts and expressions.', sheet: 'Views' },
  { key: 'definitions', name: 'Definitions', hint: 'Functional definition text per table.', sheet: 'Definitions' },
];

/** Proyecto inicial del módulo: el de la sesión de canvas → el último abierto → el primero A–Z. */
function initialProjectId(projects: Project[]): string | null {
  const session = useSessionStore.getState().activeProjectId;
  if (session && projects.some((p) => p.id === session)) return session;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* storage ausente */ }
  if (last && projects.some((p) => p.id === last)) return last;
  return sortProjects(projects)[0]?.id ?? null;
}

/** Doc 105 (B3): por qué el proyecto y la versión no se pueden cambiar
 *  mientras corre un export (terminaría igual y bajaría el archivo de lo que
 *  ya no está en pantalla). */
const EXPORT_BUSY_HINT = 'Wait for the export to finish';

/** Doc 105 (B4): toast de «no se pudo listar tus versiones» (uno, aunque se repita). */
const VERSIONS_TOAST = 'dmh-rep-versions';

/** Texto sólo para lectores de pantalla (visualmente oculto). */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** Doc 105 (a11y): el motivo de un combo deshabilitado estaba sólo en `title`;
 *  ahora también es la DESCRIPCIÓN accesible del input (su nombre no cambia). */
function BusyHint({ id }: { id: string }) {
  return <span id={id} style={SR_ONLY}>{EXPORT_BUSY_HINT}</span>;
}

/** Selector de proyecto (doc 75 D13): obligatorio, comparte estilo con el Standards.
 *  `busy` (doc 105 B3): un export en curso lo deshabilita. */
export function ProjectPick({ projects, projectId, onPick, busy = false }: {
  projects: Project[]; projectId: string | null; onPick: (id: string) => void; busy?: boolean;
}) {
  const name = projects.find((p) => p.id === projectId)?.name ?? '';
  const hintId = useId();
  return (
    <span className="dmh-rep-project" title={busy ? EXPORT_BUSY_HINT : 'Project'}>
      <SearchSelect
        options={sortProjects(projects).map((p) => ({ value: p.id, label: p.name }))}
        valueLabel={name}
        placeholder={projects.length ? 'Project…' : 'No projects yet'}
        onPick={(v) => { if (v) onPick(v); }}
        disabled={busy || projects.length === 0}
        ariaLabel="Project"
        ariaDescribedBy={busy ? hintId : undefined}
      />
      {busy && <BusyHint id={hintId} />}
    </span>
  );
}

/** Doc 102 (D1): valor del combo Version para producción. */
const PRODUCTION = '__production__';

/** Combo Version: producción o una de MIS versiones sin publicar del proyecto.
 *  `busy` (doc 105 B3): un export en curso lo deshabilita. */
export function VersionPick({ production, own, versionId, onPick, busy = false }: {
  production: VersionRow | null; own: VersionRow[]; versionId: string | null; onPick: (id: string | null) => void;
  busy?: boolean;
}) {
  const options = [
    { value: PRODUCTION, label: productionLabel(production) },
    ...own.map((r) => ({ value: r.id, label: versionOptionLabel(r) })),
  ];
  const current = options.find((o) => o.value === (versionId ?? PRODUCTION)) ?? options[0];
  const hintId = useId();
  return (
    <span className="dmh-rep-version" title={busy ? EXPORT_BUSY_HINT : 'Version — production or one of your unpublished versions'}>
      <SearchSelect options={options} valueLabel={current.label} placeholder="Version…"
        onPick={(v) => onPick(v === PRODUCTION ? null : v)} disabled={busy} ariaLabel="Version"
        ariaDescribedBy={busy ? hintId : undefined} />
      {busy && <BusyHint id={hintId} />}
    </span>
  );
}

// ── multi-select filter popover ───────────────────────────────────────────────

const GRID_ROW_CAP = 5000;
/** Doc 92 D3: tamaño de página del scroll infinito de la grilla de tablas. */
const TABLE_PAGE = 50;

/** Doc 105 (R2-B4): la carga de tablas de la grilla falló — antes se veía «No
 *  tables to report yet», como un proyecto vacío. Retry relanza SÓLO la carga
 *  que falló (la paginada o la completa). */
export function TablesLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="dmh-rep-state" role="alert">
      <div className="dmh-rep-state-ico"><TableProperties size={26} strokeWidth={1.3} aria-hidden /></div>
      <div className="dmh-rep-state-t">Couldn&apos;t load the tables</div>
      <div className="dmh-rep-state-m">Check your connection and try again.</div>
      <div style={{ marginTop: 12 }}><Button variant="secondary" onClick={onRetry}>Retry</Button></div>
    </div>
  );
}

/** Doc 105: la página siguiente del scroll infinito falló — antes la lista se
 *  daba por terminada («N tables», sin reintento). Retry pide LA MISMA página. */
export function MoreTablesError({ onRetry }: { onRetry: () => void }) {
  return (
    <span role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      Couldn&apos;t load more tables.
      <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
    </span>
  );
}

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

/** Alto máximo de la lista del filtro (el mismo 320 px de `.dmh-rep-menu`). */
const FILTER_MENU_CAP = 320;

/** Doc 113 §5: el popover del filtro con la regla única de flotantes — debajo
 *  del botón; alineado dentro de la ventana o ARRIBA si no entra (y se queda de
 *  ese lado mientras entre: no salta al filtrar), y sigue al botón con el
 *  scroll. Si el botón sale de la vista de sus contenedores con scroll, el
 *  popover se oculta (antes lo recortaba su panel; `placeAnchored`). `size`
 *  re-ubica al filtrar la lista. */
function FilterPopover({ anchor, size, children }: { anchor: RefObject<HTMLElement | null>; size: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useFloating(ref, (box, viewport, prev) => {
    const el = anchor.current;
    if (!el) return null;
    return placeAnchored(el.getBoundingClientRect(), clipRect(el), { width: box.width, height: Math.min(box.height, FILTER_MENU_CAP) },
      contentBounds(viewport), { side: prev?.side ?? 'bottom', align: 'start', gap: 6 });
  }, [anchor, size], { follow: true });
  const maxHeight = Math.min(FILTER_MENU_CAP, typeof place.maxHeight === 'number' ? place.maxHeight : FILTER_MENU_CAP);
  return <div ref={ref} className="dmh-rep-menu" role="listbox" style={{ ...place, maxHeight }}>{children}</div>;
}

function MultiFilter({ label, icon: Icon, options, selected, onToggle }: MultiFilterProps) {
  const [open, setOpen] = useState(false);
  // Doc 92 D2: filtro «contiene» (case-insensitive) sobre las opciones del popover.
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
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
        ref={btnRef}
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
        <FilterPopover anchor={btnRef} size={visible.length}>
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
        </FilterPopover>
      )}
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

export default function ReportingScreenWrapper() {
  // Doc 75 D13: todo reporte es de UN proyecto — el wrapper lo elige y lo comparte.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    listProjects()
      .then((ps) => { setProjects(ps); setProjectId(initialProjectId(ps)); })
      .catch(() => toast.error("Couldn't load the projects"));
  }, []);
  // Doc 102 (D1): versión del reporte — null = producción; si no, una versión
  // PROPIA sin publicar (borrador o en revisión) del proyecto.
  const me = useAuthStore((s) => s.user?.username ?? null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  // Doc 105 (R2-B5): sólo se aplica el listado de versiones MÁS RECIENTE (el
  // inicial o un re-listado): una respuesta vieja que llegaba tarde pisaba a la
  // nueva — aviso falso «no longer open», vuelta a Production y el draft recién
  // elegido fuera del combo. Mismo patrón que `_explorerSeq` del canvas.
  // Doc 105 (R6): si el más reciente FALLA, vale la última lista buena que haya
  // llegado desde el cambio de proyecto (aunque la trajera un pedido anterior);
  // sin ninguna, se avisa (B4) — antes el fallo se callaba y el combo quedaba vacío.
  // `warned`: el aviso B4 ya está en pantalla — re-emitirlo con el mismo id lo
  // reemplaza y reinicia su vencimiento (se cerraba solo aun con el mouse encima);
  // sale UNA vez por proyecto o por lista buena.
  const versionsReq = useRef({ seq: 0, failed: 0, warned: false, good: null as { seq: number; list: VersionRow[] } | null });
  /** Llegó una lista buena: la aplica si es la más reciente ('latest') o si la
   *  más reciente falló y ésta es la mejor que hay ('fallback'); si no, null. */
  const takeVersions = useCallback((seq: number, vs: VersionRow[]): 'latest' | 'fallback' | null => {
    const r = versionsReq.current;
    if (!r.good || seq > r.good.seq) r.good = { seq, list: vs };
    const how = seq === r.seq ? 'latest' : r.failed === r.seq && r.good.seq === seq ? 'fallback' : null;
    if (how) {
      setVersions(vs);
      if (r.warned) { toast.dismiss(VERSIONS_TOAST); r.warned = false; }   // B4: la lista volvió
    }
    return how;
  }, []);
  /** Falló un listado: si era el más reciente, vale la última lista buena; sin ninguna, el aviso B4. */
  const versionsFailed = useCallback((seq: number) => {
    const r = versionsReq.current;
    if (seq !== r.seq) return;
    r.failed = seq;
    if (r.good) setVersions(r.good.list);
    else if (!r.warned) {
      // Doc 105 (B4): antes el combo quedaba en Production sin decir por qué.
      r.warned = true;
      toast.error("Couldn't load your versions of this project — only Production is available.", { id: VERSIONS_TOAST });
    }
  }, []);
  useEffect(() => {
    setVersionId(null);
    setVersions([]);
    if (!projectId) return undefined;
    let cancelled = false;
    const r = versionsReq.current;
    r.good = null;   // proyecto nuevo: todavía no llegó ninguna lista buena
    if (r.warned) { toast.dismiss(VERSIONS_TOAST); r.warned = false; }   // el aviso era del proyecto anterior
    const seq = ++r.seq;
    listVersions(projectId)
      .then((vs) => { if (!cancelled) takeVersions(seq, vs); })
      .catch(() => { if (!cancelled) versionsFailed(seq); });
    return () => { cancelled = true; };
  }, [projectId, takeVersions, versionsFailed]);
  const production = useMemo(() => (projectId ? projectMeta(versions, me)[projectId]?.productionRow ?? null : null),
    [versions, me, projectId]);
  const own = useMemo(() => (projectId ? ownOpenVersions(versions, projectId, me) : []), [versions, projectId, me]);
  const version = own.find((r) => r.id === versionId) ?? null;
  // Doc 102: si una lectura de la versión falla (p. ej. se publicó o se cerró en
  // otra pestaña), se vuelve a pedir la lista: si ya no está abierta, el combo
  // deja de ofrecerla y la pantalla vuelve a producción, con aviso.
  // Doc 105: el aviso comparte el id del toast del error (R2-B3: uno solo, no
  // dos); un 403/404 (A5-o4: se transfirió o se eliminó) vuelve a producción
  // sin esperar la lista — el backend ya lo dijo.
  const liveProject = useRef<string | null>(null);
  const liveVersion = useRef<string | null>(null);
  useEffect(() => { liveProject.current = projectId; }, [projectId]);
  useEffect(() => { liveVersion.current = version?.id ?? null; }, [version]);
  const recheckVersions = useCallback((err?: unknown) => {
    const pid = liveProject.current;
    if (!pid) return;
    const was = liveVersion.current;
    const gone = was ? versionGoneText(err) : null;
    if (gone) {
      setVersionId(null);
      toast.warning(gone, { id: VERSION_TOAST });
    }
    const seq = ++versionsReq.current.seq;
    listVersions(pid)
      .then((vs) => {
        // Sólo la MÁS RECIENTE trae noticias sobre la versión elegida.
        if (liveProject.current !== pid || takeVersions(seq, vs) !== 'latest') return;
        const cur = liveVersion.current;
        if (cur && !(gone && cur === was) && !ownOpenVersions(vs, pid, me).some((r) => r.id === cur)) {
          setVersionId(null);
          // Doc 105 (A5-o4): ¿se eliminó, se transfirió o se publicó/cerró? Lo dice
          // su cabecera — un pedido, sólo cuando la versión elegida desaparece.
          getChangeset(cur)
            .then((header) => ({ header }), (error: unknown) => ({ error }))
            .then((read) => { toast.warning(vanishedVersionText(read, me), { id: VERSION_TOAST }); });
        }
      })
      .catch(() => { if (liveProject.current === pid) versionsFailed(seq); });   // la versión sigue elegida
  }, [me, takeVersions, versionsFailed]);
  // Doc 105 (R2-B5): la lista sólo se pedía al cambiar de proyecto — un draft
  // creado (o publicado) en otra pestaña no aparecía (o seguía ofrecido).
  useEffect(() => {
    const onFocus = () => recheckVersions();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheckVersions]);
  // Doc 105 (B3): export en curso (por niveles o con plantilla) — Project y
  // Version quedan deshabilitados hasta que termine.
  const [exportBusy, setExportBusy] = useState(false);
  const pick = <ProjectPick projects={projects} projectId={projectId} onPick={setProjectId} busy={exportBusy} />;
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
  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';
  const versionPick = (
    <VersionPick production={production} own={own} versionId={version?.id ?? null} onPick={setVersionId} busy={exportBusy} />
  );
  return (
    <ReportingScreen key={`${projectId}:${version?.id ?? 'production'}`} projectId={projectId} projectName={projectName}
      changesetId={version?.id ?? null} versionLabel={version?.versionLabel ?? null} onVersionError={recheckVersions}
      onExportBusy={setExportBusy} projectPicker={pick} versionPicker={versionPick} />
  );
}

export function ReportingScreen({
  projectId, projectName, changesetId, versionLabel, onVersionError, onExportBusy, projectPicker, versionPicker,
}: {
  projectId: string; projectName: string;
  /** Doc 102 (D1): versión PROPIA sin publicar del reporte; null = producción. */
  changesetId: string | null; versionLabel: string | null;
  /** Doc 102: falló una lectura de la versión — el wrapper revisa si sigue abierta
   *  (doc 105: con el error, para distinguir transferida/eliminada). */
  onVersionError: (err?: unknown) => void;
  /** Doc 105 (B3): hay un export en curso (`false` también al desmontarse). */
  onExportBusy: (busy: boolean) => void;
  projectPicker: React.ReactNode; versionPicker: React.ReactNode;
}) {
  // Doc 102: con una versión propia el reporte es ESA versión (producción + sus
  // cambios): la grilla la carga completa y toda lectura lleva su id.
  const draftMode = changesetId !== null;
  const [tables, setTables] = useState<ReportTableRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [schemaSel, setSchemaSel] = useState<Set<string>>(new Set());
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());

  const [levels, setLevels] = useState<Set<LevelKey>>(new Set<LevelKey>(['tables', 'columns']));
  const [exporting, setExporting] = useState(false);
  // Doc 105 (B3): la card de plantillas avisa si exporta; con cualquiera de los
  // dos exports en curso el wrapper deshabilita Project / Version.
  const [templateBusy, setTemplateBusy] = useState(false);
  const exportBusy = exporting || templateBusy;
  useEffect(() => {
    onExportBusy(exportBusy);
    return () => onExportBusy(false);
  }, [exportBusy, onExportBusy]);
  // Doc 105 (R2-B3): un export que falla DESPUÉS de desmontar (el wrapper volvió
  // a Production) no avisa sobre la pantalla nueva.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  /** Doc 105 (R2-B3/A5-o4): aviso de una lectura fallida. En modo versión, UN
   *  toast con el id del aviso «showing Production» del wrapper (un 403/404 dice
   *  que la versión se transfirió o se eliminó) y el wrapper revisa la versión. */
  const readFailed = useCallback((err: unknown, fallback: string) => {
    if (!changesetId) { toast.error(readErrorText(err, fallback, false)); return; }
    toast.error(readErrorText(err, fallback, true), { id: VERSION_TOAST });
    onVersionError(err);
  }, [changesetId, onVersionError]);

  // Doc 70 §4.1: universo COMPLETO de los filtros (no depende de las 50 filas
  // de la carga inicial). Si falla, los combos caen a lo derivado de las filas.
  const [serverFilters, setServerFilters] = useState<ReportFilterOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    listReportFilters(projectId, changesetId).then((f) => { if (!cancelled) setServerFilters(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, changesetId]);
  // Doc 70 §4.2: qué muestra la grilla — tablas, sus columnas o la fila unida.
  const [show, setShow] = useState<ShowMode>('tables');

  // Doc 92 D3: sin filtros la grilla se carga por PÁGINAS (orden físico) y pide
  // la siguiente cuando el centinela entra al viewport; con un filtro se
  // descarga el set completo (facetas/conteos exactos sobre todo).
  const [fullLoad, setFullLoad] = useState(draftMode);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Doc 92 D4: total REAL de tablas del proyecto (null = aún no llegó).
  const [total, setTotal] = useState<number | null>(null);
  // Doc 105 (R2-B4): qué carga de la grilla falló (null = ninguna) y un contador
  // de reintentos POR carga — uno compartido relanzaría las dos, que competirían
  // por la grilla.
  const [loadError, setLoadError] = useState<'page' | 'full' | null>(null);
  const [pageTry, setPageTry] = useState(0);
  const [fullTry, setFullTry] = useState(0);
  const retryLoad = () => (loadError === 'full' ? setFullTry((n) => n + 1) : setPageTry((n) => n + 1));
  // Doc 105: offset de la página del scroll infinito que falló (null = ninguna).
  // Un fallo NO marca el fin: antes `setHasMore(false)` dejaba la barra en «N
  // tables» como si estuviera completo, «Select all» cubría sólo lo cargado y no
  // había reintento. Cada carga nueva (primera página o completa) sube la
  // «época»: una página pedida antes ya no toca la grilla ni avisa.
  const [moreError, setMoreError] = useState<number | null>(null);
  const pagesEpoch = useRef(0);
  useEffect(() => {
    // Doc 102: la versión propia la carga completa el efecto de abajo. Doc 105:
    // al pasar a la carga completa, una página que llega tarde ya no la pisa.
    if (draftMode || fullLoad) return undefined;
    let cancelled = false;
    pagesEpoch.current += 1;   // doc 105: una página pedida antes ya no toca la grilla
    setMoreError(null);
    setLoadingMore(false);
    setLoading(true);
    setLoadError(null);
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
        setLoadError('page');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, draftMode, fullLoad, pageTry]);
  useEffect(() => {
    if (!fullLoad) return undefined;
    let cancelled = false;
    pagesEpoch.current += 1;   // doc 105: una página pedida antes ya no toca la grilla
    setMoreError(null);
    setLoadingMore(false);
    setLoading(true);
    setLoadError(null);
    listReportTables(projectId, {}, changesetId)
      .then((rows) => {
        if (cancelled) return;
        setTables(rows);
        setHasMore(false);
        setTotal(rows.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        readFailed(err, 'Could not load the reporting tables.');
        setLoadError('full');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fullLoad, projectId, changesetId, readFailed, fullTry]);
  /** Página siguiente del scroll infinito. Con una página fallida sólo `retry`
   *  (el botón Retry) la vuelve a pedir — el mismo offset; el scroll no reintenta solo. */
  const loadMore = useCallback((retry = false) => {
    if (fullLoad || !hasMore || loadingMore || loading) return;
    if (moreError !== null && !retry) return;
    const offset = moreError ?? tables.length;
    const epoch = pagesEpoch.current;
    // Vigente: la pantalla sigue montada y no empezó otra carga (doc 105).
    const current = () => alive.current && epoch === pagesEpoch.current;
    setMoreError(null);
    setLoadingMore(true);
    listReportTables(projectId, { limit: TABLE_PAGE, offset })
      .then((rows) => {
        if (!current()) return;
        setTables((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...rows.filter((r) => !seen.has(r.id))];
        });
        setHasMore(rows.length === TABLE_PAGE);
      })
      .catch((err: unknown) => {
        if (!current()) return;
        toast.error(err instanceof Error ? err.message : 'Could not load more tables.');
        setMoreError(offset);   // `hasMore` queda como estaba: quedan tablas por cargar
      })
      .finally(() => { if (current()) setLoadingMore(false); });
  }, [fullLoad, hasMore, loadingMore, loading, moreError, projectId, tables.length]);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  // Centinela al final de la tabla: al asomar (200 px antes) pide la página
  // siguiente. Se re-arma cuando cambia lo cargado o el modo de la grilla (y al
  // volver del error al centinela: doc 105).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || fullLoad || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMoreRef.current(); },
      { root: scrollRef.current, rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fullLoad, hasMore, show, loading, tables.length, moreError]);
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
      ? (await listReportTables(projectId, {}, changesetId)).filter((t) => passSearch(t) && passSchema(t) && passArea(t))
      : selectedRows
  ), [allSelected, partial, projectId, changesetId, passSearch, passSchema, passArea, selectedRows]);
  // Columnas de la card de plantillas: en modo versión, un error avisa al wrapper
  // (con el error: doc 105) — la card muestra su toast con el id compartido. Si
  // esta pantalla ya se desmontó, el error es de una versión que ya no está en
  // pantalla: no toca la que se eligió después.
  const fetchColumns = useCallback((ids: string[]) => {
    const read = fetchColumnsFor(projectId, ids, changesetId);
    return changesetId
      ? read.catch((err: unknown) => { if (alive.current) onVersionError(err); throw err; })
      : read;
  }, [projectId, changesetId, onVersionError]);

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
  // para los modos Columns / Tables + Columns. Tope de UX: COLUMN_BATCH (300)
  // tablas en pantalla (un solo lote; los ids ya van en el cuerpo, doc 102) —
  // por encima se pide acotar (filtro o selección); el export no tiene tope.
  const colScope = useMemo(() => (selectedRows.length > 0 ? selectedRows : filtered), [selectedRows, filtered]);
  const colScopeKey = useMemo(() => colScope.map((t) => t.id).join(','), [colScope]);
  const colScopeTooBig = colScope.length > COLUMN_BATCH;
  const [colRows, setColRows] = useState<ReportColumnRow[] | null>(null);
  const [colLoading, setColLoading] = useState(false);
  useEffect(() => {
    if (show === 'tables' || colScopeTooBig || colScope.length === 0) { setColRows(null); return undefined; }
    let cancelled = false;
    setColLoading(true);
    fetchColumnsFor(projectId, colScope.map((t) => t.id), changesetId)
      .then((rows) => { if (!cancelled) setColRows(rows); })
      .catch((err: unknown) => {
        if (cancelled) return;
        readFailed(err, 'Could not load the columns.');
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
        const cols = sortColumnRows(await fetchColumnsFor(projectId, rows.map((t) => t.id), changesetId), (id) => byId.get(id)?.physicalName ?? id);
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
        // Doc 105 (A3-o1): por lotes de ids (antes, las primeras 5 000 del
        // PROYECTO filtradas acá: en proyectos grandes faltaban relaciones).
        const rels = await fetchRelationshipsFor(projectId, rows.map((t) => t.id), changesetId);
        const data = rels.map(relationshipSheetRow);   // doc 98: incluye las frases
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Relationships');
      }

      if (levels.has('views')) {
        // Vistas derivadas de las tablas seleccionadas: 2 hojas — la vista en
        // sí (fuentes/SQL/User-Defined SQL) y su detalle columna a columna
        // (alias, origen, casteo, transformación). Mismo patrón acotado que Columns.
        const ids = rows.map((t) => t.id);
        const idSet = new Set(ids);
        // Doc 102: ids en el CUERPO, en tandas (antes >300 tablas bajaban TODAS las vistas del proyecto).
        const views = (await fetchViewsFor(projectId, ids, changesetId))
          .filter((v) => v.sourceTableIds.some((tid) => idSet.has(tid)));
        const viewsData = views.map(viewSheetRow);   // doc 96 D6: sin «Mode»
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

      // Doc 102: con una versión propia, su etiqueta va en el nombre del archivo.
      XLSX.writeFile(wb, levelsFileName(projectName, draftMode ? (versionLabel ?? 'draft') : null, new Date()));
      toast.success('Report exported to Excel.');
    } catch (err: unknown) {
      if (!alive.current) return;   // doc 105 (R2-B3): la pantalla ya cambió (p. ej. volvió a Production)
      readFailed(err, 'Could not build the Excel file.');
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
              {/* Doc 75 D13: proyecto del reporte (obligatorio). Doc 102: y su versión. */}
              {projectPicker}
              {versionPicker}
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
                <Button variant="secondary" onClick={clearFilters}>
                  Clear
                </Button>
              )}
              <span className="dmh-rep-selcount">
                <strong>{selectedCount.toLocaleString()} selected</strong> ·{' '}
                {partial
                  ? <>{tables.length.toLocaleString()} of {total == null ? '…' : total.toLocaleString()} tables</>
                  : <>{filtered.length.toLocaleString()} table{filtered.length === 1 ? '' : 's'}</>}
                {partial && (
                  <em className="dmh-rep-selcount-hint">
                    {/* Doc 105: tras un fallo el scroll ya no carga — sólo Retry, al pie. */}
                    {moreError !== null ? " · couldn't load more (Retry below)" : ' · scroll to load more'}
                  </em>
                )}
              </span>
            </div>
            {draftMode && (
              <div className="dmh-rep-wc" role="status">
                Working copy <strong>{versionLabel ?? 'draft'}</strong> — the grid and both exports include your unpublished changes.
              </div>
            )}

            <div className="dmh-rep-tablewrap">
              <div className="dmh-rep-tablescroll" ref={scrollRef}>
                {/* Doc 105 (R2-B4): una carga fallida no se disfraza de proyecto vacío. */}
                {loadError && !loading ? (
                  <TablesLoadError onRetry={retryLoad} />
                ) : show !== 'tables' ? (
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
                    {/* Doc 92 D3: centinela del scroll infinito (sólo sin filtros y con páginas pendientes).
                        Doc 105: si la página siguiente falló, el pie lo dice y ofrece Retry. */}
                    {!loading && partial && (moreError !== null ? (
                      <tr className="dmh-rep-sentinel">
                        <td colSpan={8}><MoreTablesError onRetry={() => loadMore(true)} /></td>
                      </tr>
                    ) : (
                      <tr ref={sentinelRef} className="dmh-rep-sentinel">
                        <td colSpan={8}>{loadingMore ? 'Loading more tables…' : 'Scroll to load more'}</td>
                      </tr>
                    ))}
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
              resolveTables={resolveExportRows} fetchColumns={fetchColumns} onBusyChange={setTemplateBusy}
              versionToastId={changesetId ? VERSION_TOAST : undefined} />

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
          </div>
        </div>
      </div>
    </div>
  );
}
