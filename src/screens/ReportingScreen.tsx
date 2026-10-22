/**
 * ReportingScreen: reporte tabular de la metadata.
 *
 * Distribución:
 *   · cabecera: antetítulo REPORTING + h1 "Reporting" + texto breve
 *   · barra de filtros: selector Project, búsqueda por nombre de tabla y
 *     comboboxes de selección múltiple (Schema · Subject area) que filtran la
 *     grilla en vivo, más Clear
 *   · tabla de metadata: Table · Schema · Subject area · #Columns · #Relations ·
 *     Projects · Functional definition; filas cebra, hover, encabezado fijo
 *   · panel derecho: checklist "Export to Excel" de niveles de detalle → libro
 *     xlsx (una hoja por nivel marcado) y, debajo, pequeños indicadores KPI
 *
 * Datos: reporting.service (tablas + columnas + filtros), siempre de un solo
 * proyecto (el selector Project al inicio de la barra es obligatorio; se
 * preselecciona el proyecto de la sesión y, si no hay, el último abierto). La
 * búsqueda y los chips filtran en el cliente las filas cargadas; el primer filtro
 * aplicado carga el set completo. Sin filtros, la grilla carga páginas de 50 y
 * pide la siguiente cuando la fila centinela entra en la vista; la barra muestra
 * el total real (`/tables/count`) y «Select all» selecciona todas las tablas del
 * proyecto (cargadas o no): el export baja entonces el set completo. Los popovers
 * de Schema y Subject area tienen una búsqueda «contiene».
 * Los combos de filtro listan el catálogo completo (`/reporting/filters`), no solo
 * los valores de las 50 filas cargadas al inicio; el selector Show presenta la
 * grilla como Tables · Columns · Tables + Columns (con las mismas funciones puras
 * que arman las filas del Excel, `lib/reportRows`), y el export incluye la hoja
 * unida.
 * Combo Version (producción o una versión propia sin publicar): con una versión
 * propia, la grilla, los filtros y los dos exports son de esa versión; los lotes
 * de ids viajan en el cuerpo de un POST (en la URL superarían el tope de
 * cabeceras del servidor y la respuesta sería 431).
 * Carga → skeleton/placeholders; errores → toast de sonner.
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
import { NO_EXPORT_HINT } from '@/lib/permissionHints';
import type { Project } from '@/types/model';
import type { VersionRow } from '@/types/versioning';
import {
  countReportTables, listReportFilters, listReportTables,
  type ReportColumnRow, type ReportFilterOptions, type ReportTableRow,
} from '@/services/reporting.service';

// ── niveles de export ─────────────────────────────────────────────────────────

type LevelKey = 'tables' | 'columns' | 'joined' | 'relationships' | 'views' | 'definitions';
/** Qué muestra la grilla en pantalla. */
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

/** Por qué el proyecto y la versión no se pueden cambiar mientras corre un
 *  export (terminaría igual y bajaría el archivo de lo que dejó de estar en
 *  pantalla). */
const EXPORT_BUSY_HINT = 'Wait for the export to finish';

/** Id del toast «no se pudieron listar las versiones» (uno solo, aunque se repita). */
const VERSIONS_TOAST = 'dmh-rep-versions';

/** Texto solo para lectores de pantalla (visualmente oculto). */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** El motivo de un combo deshabilitado va en `title` y también como descripción
 *  accesible del input (su nombre accesible no cambia). */
function BusyHint({ id }: { id: string }) {
  return <span id={id} style={SR_ONLY}>{EXPORT_BUSY_HINT}</span>;
}

/** Selector de proyecto: obligatorio, comparte estilo con el de Standards.
 *  `busy`: un export en curso lo deshabilita. */
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

/** Valor del combo Version para producción. */
const PRODUCTION = '__production__';

/** Combo Version: producción o una de las versiones propias sin publicar del
 *  proyecto. `busy`: un export en curso lo deshabilita. */
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

// ── popover de filtro de selección múltiple ───────────────────────────────────

const GRID_ROW_CAP = 5000;
/** Tamaño de página del scroll infinito de la grilla de tablas. */
const TABLE_PAGE = 50;

/** Falló la carga de tablas de la grilla: se indica el error (no «No tables to
 *  report yet», como en un proyecto vacío). Retry relanza solo la carga que
 *  falló (la paginada o la completa). */
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

/** Falló la página siguiente del scroll infinito: la lista no se da por
 *  terminada y Retry pide la misma página. */
export function MoreTablesError({ onRetry }: { onRetry: () => void }) {
  return (
    <span role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      Couldn&apos;t load more tables.
      <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
    </span>
  );
}

/** Grilla genérica de filas ya aplanadas por las mismas funciones
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

/** Popover del filtro con la regla única de flotantes: debajo del botón,
 *  alineado dentro de la ventana o arriba si no entra (y se queda de ese lado
 *  mientras entre: no salta al filtrar), y sigue al botón con el scroll. Si el
 *  botón sale de la vista de sus contenedores con scroll, el popover se oculta
 *  en lugar de quedar recortado por su panel (`placeAnchored`). `size` lo
 *  reubica al filtrar la lista. */
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
  // Filtro «contiene» (case-insensitive) sobre las opciones del popover.
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

// ── componente ─────────────────────────────────────────────────────────────────

export default function ReportingScreenWrapper() {
  // Todo reporte es de un solo proyecto: el wrapper lo elige y lo comparte.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    listProjects()
      .then((ps) => { setProjects(ps); setProjectId(initialProjectId(ps)); })
      .catch(() => toast.error("Couldn't load the projects"));
  }, []);
  // Versión del reporte: null = producción; si no, una versión propia sin
  // publicar (borrador o en revisión) del proyecto.
  const me = useAuthStore((s) => s.user?.username ?? null);
  // Descargar la metadata (Excel) exige el permiso `export`.
  const canExport = useAuthStore((s) => s.has('export'));
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  // Solo se aplica el listado de versiones más reciente (el inicial o un
  // re-listado): una respuesta desactualizada que llegara tarde pisaría a la
  // última, con aviso falso «no longer open», vuelta a Production y el draft
  // recién elegido fuera del combo. Mismo patrón que `_explorerSeq` del canvas.
  // Si el más reciente falla, vale la última lista buena que haya llegado desde
  // el cambio de proyecto (aunque la trajera un pedido anterior); sin ninguna, se
  // avisa en lugar de dejar el combo vacío sin explicación.
  // `warned`: el aviso ya está en pantalla; re-emitirlo con el mismo id lo
  // sustituye y reinicia su vencimiento (se cerraría solo aun con el mouse
  // encima), así que sale una vez por proyecto o por lista buena.
  const versionsReq = useRef({ seq: 0, failed: 0, warned: false, good: null as { seq: number; list: VersionRow[] } | null });
  /** Llegó una lista buena: la aplica si es la más reciente ('latest') o si la
   *  más reciente falló y esta es la mejor que hay ('fallback'); si no, null. */
  const takeVersions = useCallback((seq: number, vs: VersionRow[]): 'latest' | 'fallback' | null => {
    const r = versionsReq.current;
    if (!r.good || seq > r.good.seq) r.good = { seq, list: vs };
    const how = seq === r.seq ? 'latest' : r.failed === r.seq && r.good.seq === seq ? 'fallback' : null;
    if (how) {
      setVersions(vs);
      if (r.warned) { toast.dismiss(VERSIONS_TOAST); r.warned = false; }   // la lista volvió: se retira el aviso
    }
    return how;
  }, []);
  /** Falló un listado: si era el más reciente, vale la última lista buena; sin ninguna, el aviso. */
  const versionsFailed = useCallback((seq: number) => {
    const r = versionsReq.current;
    if (seq !== r.seq) return;
    r.failed = seq;
    if (r.good) setVersions(r.good.list);
    else if (!r.warned) {
      // El aviso explica por qué el combo solo ofrece Production.
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
    r.good = null;   // cambio de proyecto: sin lista buena hasta que llegue una
    if (r.warned) { toast.dismiss(VERSIONS_TOAST); r.warned = false; }   // el aviso es del proyecto anterior
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
  // Si una lectura de la versión falla (p. ej. se publicó o se cerró en otra
  // pestaña), se vuelve a pedir la lista: si la versión dejó de estar abierta, el
  // combo deja de ofrecerla y la pantalla vuelve a producción, con aviso.
  // El aviso comparte el id del toast del error (uno solo, no dos); un 403/404
  // (se transfirió o se eliminó) vuelve a producción sin esperar la lista,
  // porque el backend ya lo confirmó.
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
        // Solo la lista más reciente trae noticias sobre la versión elegida.
        if (liveProject.current !== pid || takeVersions(seq, vs) !== 'latest') return;
        const cur = liveVersion.current;
        if (cur && !(gone && cur === was) && !ownOpenVersions(vs, pid, me).some((r) => r.id === cur)) {
          setVersionId(null);
          // ¿Se eliminó, se transfirió o se publicó/cerró? Lo dice su cabecera:
          // un pedido, solo cuando la versión elegida desaparece.
          getChangeset(cur)
            .then((header) => ({ header }), (error: unknown) => ({ error }))
            .then((read) => { toast.warning(vanishedVersionText(read, me), { id: VERSION_TOAST }); });
        }
      })
      .catch(() => { if (liveProject.current === pid) versionsFailed(seq); });   // la versión sigue elegida
  }, [me, takeVersions, versionsFailed]);
  // La lista se vuelve a pedir al recuperar el foco: así aparece un draft creado
  // en otra pestaña y deja de ofrecerse uno publicado allí.
  useEffect(() => {
    const onFocus = () => recheckVersions();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheckVersions]);
  // Export en curso (por niveles o con plantilla): Project y Version quedan
  // deshabilitados hasta que termine.
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
    <ReportingScreen key={`${projectId}:${version?.id ?? 'production'}`} projectId={projectId} projectName={projectName} canExport={canExport}
      changesetId={version?.id ?? null} versionLabel={version?.versionLabel ?? null} onVersionError={recheckVersions}
      onExportBusy={setExportBusy} projectPicker={pick} versionPicker={versionPick} />
  );
}

export function ReportingScreen({
  projectId, projectName, changesetId, versionLabel, onVersionError, onExportBusy, projectPicker, versionPicker, canExport = false,
}: {
  projectId: string; projectName: string;
  /** Versión propia sin publicar del reporte; null = producción. */
  changesetId: string | null; versionLabel: string | null;
  /** Falló una lectura de la versión: el wrapper revisa si sigue abierta (recibe
   *  el error para distinguir transferida/eliminada). */
  onVersionError: (err?: unknown) => void;
  /** Hay un export en curso (`false` también al desmontarse). */
  onExportBusy: (busy: boolean) => void;
  projectPicker: React.ReactNode; versionPicker: React.ReactNode;
  /** El usuario tiene el permiso `export` (bajar la metadata a Excel). */
  canExport?: boolean;
}) {
  // Con una versión propia el reporte es esa versión (producción + sus cambios):
  // la grilla la carga completa y toda lectura lleva su id.
  const draftMode = changesetId !== null;
  const [tables, setTables] = useState<ReportTableRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [schemaSel, setSchemaSel] = useState<Set<string>>(new Set());
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());

  const [levels, setLevels] = useState<Set<LevelKey>>(new Set<LevelKey>(['tables', 'columns']));
  const [exporting, setExporting] = useState(false);
  // La card de plantillas avisa si exporta; con cualquiera de los dos exports en
  // curso el wrapper deshabilita Project / Version.
  const [templateBusy, setTemplateBusy] = useState(false);
  const exportBusy = exporting || templateBusy;
  useEffect(() => {
    onExportBusy(exportBusy);
    return () => onExportBusy(false);
  }, [exportBusy, onExportBusy]);
  // Un export que falla después de desmontar (el wrapper volvió a Production) no
  // avisa sobre la pantalla nueva.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  /** Aviso de una lectura fallida. En modo versión, un solo toast con el id del
   *  aviso «showing Production» del wrapper (un 403/404 dice que la versión se
   *  transfirió o se eliminó) y el wrapper revisa la versión. */
  const readFailed = useCallback((err: unknown, fallback: string) => {
    if (!changesetId) { toast.error(readErrorText(err, fallback, false)); return; }
    toast.error(readErrorText(err, fallback, true), { id: VERSION_TOAST });
    onVersionError(err);
  }, [changesetId, onVersionError]);

  // Universo completo de los filtros (no depende de las 50 filas de la carga
  // inicial). Si falla, los combos caen a lo derivado de las filas.
  const [serverFilters, setServerFilters] = useState<ReportFilterOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    listReportFilters(projectId, changesetId).then((f) => { if (!cancelled) setServerFilters(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, changesetId]);
  // Qué muestra la grilla: tablas, sus columnas o la fila unida.
  const [show, setShow] = useState<ShowMode>('tables');

  // Sin filtros la grilla se carga por páginas (orden físico) y pide la siguiente
  // cuando el centinela entra al viewport; con un filtro se descarga el set
  // completo (facetas/conteos exactos sobre todo).
  const [fullLoad, setFullLoad] = useState(draftMode);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Total real de tablas del proyecto (null = sin conteo: pendiente o fallido).
  const [total, setTotal] = useState<number | null>(null);
  // Qué carga de la grilla falló (null = ninguna) y un contador de reintentos por
  // carga: uno compartido relanzaría las dos, que competirían por la grilla.
  const [loadError, setLoadError] = useState<'page' | 'full' | null>(null);
  const [pageTry, setPageTry] = useState(0);
  const [fullTry, setFullTry] = useState(0);
  const retryLoad = () => (loadError === 'full' ? setFullTry((n) => n + 1) : setPageTry((n) => n + 1));
  // Offset de la página del scroll infinito que falló (null = ninguna). Un fallo
  // no marca el fin (`hasMore` se mantiene): la barra no se presenta como
  // completa, «Select all» abarca todo el proyecto y Retry pide esa página. Cada
  // carga nueva (primera página o completa) sube la «época»: una página pedida
  // en una época anterior no toca la grilla ni avisa.
  const [moreError, setMoreError] = useState<number | null>(null);
  const pagesEpoch = useRef(0);
  useEffect(() => {
    // La versión propia la carga completa el efecto de abajo. Al pasar a la carga
    // completa, una página que llega tarde no la pisa.
    if (draftMode || fullLoad) return undefined;
    let cancelled = false;
    pagesEpoch.current += 1;   // una página de una época anterior no toca la grilla
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
    pagesEpoch.current += 1;   // una página de una época anterior no toca la grilla
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
  /** Página siguiente del scroll infinito. Con una página fallida, solo `retry`
   *  (el botón Retry) la vuelve a pedir, con el mismo offset; el scroll no reintenta solo. */
  const loadMore = useCallback((retry = false) => {
    if (fullLoad || !hasMore || loadingMore || loading) return;
    if (moreError !== null && !retry) return;
    const offset = moreError ?? tables.length;
    const epoch = pagesEpoch.current;
    // Vigente: la pantalla sigue montada y no empezó otra carga.
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
  // Centinela al final de la tabla: al asomar (con 200 px de margen) pide la página
  // siguiente. Se re-arma cuando cambia lo cargado o el modo de la grilla (y al
  // volver del error al centinela).
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
  // Quedan tablas del proyecto sin cargar en la grilla (sin filtros).
  const partial = !fullLoad && hasMore;

  // Predicados por faceta. Las opciones de una faceta excluyen su propia
  // selección, así los filtros se acotan entre sí (acumulativos / por facetas).
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

  // Listas de opciones por faceta: cada una refleja las filas que pasan los otros
  // filtros; los valores seleccionados siguen visibles para poder desmarcarlos.
  const schemaOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passArea(t)).map((t) => t.schema).filter(Boolean),
    );
    schemaSel.forEach((v) => s.add(v));
    return unionSorted(serverFilters?.schemas ?? [], s);   // universo completo del catálogo
  }, [tables, passSearch, passArea, schemaSel, serverFilters]);
  const areaOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passSchema(t)).flatMap((t) => t.subjectAreas).filter(Boolean),
    );
    areaSel.forEach((v) => s.add(v));
    return unionSorted(serverFilters?.subjectAreas ?? [], s);
  }, [tables, passSearch, passSchema, areaSel, serverFilters]);

  // Filas que pasan todos los filtros.
  const filtered = useMemo(
    () => tables.filter((t) => passSearch(t) && passSchema(t) && passArea(t)),
    [tables, passSearch, passSchema, passArea],
  );

  // ── selección de filas (alimenta el export a Excel) ──────────────────────────
  // Conjunto explícito; arranca vacío (nada seleccionado). Solo cuentan para el
  // export los ids de las filas visibles (filtradas). `allSelected` = todas las
  // tablas del proyecto (cargadas o no): el export baja el set completo.
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

  // Filas a exportar: la selección o, con «Select all» y páginas pendientes,
  // todas las del proyecto (filtradas). Las comparten el export por niveles y el
  // de plantilla.
  const resolveExportRows = useCallback(async (): Promise<ReportTableRow[]> => (
    allSelected && partial
      ? (await listReportTables(projectId, {}, changesetId)).filter((t) => passSearch(t) && passSchema(t) && passArea(t))
      : selectedRows
  ), [allSelected, partial, projectId, changesetId, passSearch, passSchema, passArea, selectedRows]);
  // Columnas de la card de plantillas: en modo versión, un error avisa al wrapper
  // (pasándole el error) y la card muestra su toast con el id compartido. Si esta
  // pantalla se desmontó, el error es de una versión que dejó de estar en
  // pantalla: no toca la que se eligió después.
  const fetchColumns = useCallback((ids: string[]) => {
    const read = fetchColumnsFor(projectId, ids, changesetId);
    return changesetId
      ? read.catch((err: unknown) => { if (alive.current) onVersionError(err); throw err; })
      : read;
  }, [projectId, changesetId, onVersionError]);

  const toggleRow = (id: string) => {
    if (allSelected) {
      // Desmarcar una fila con todo seleccionado: modo explícito sobre lo cargado.
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

  // Los resúmenes del panel derecho se derivan de las filas (filtradas).
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

  // ── Columnas de las tablas en foco (selección, o las filtradas) para los
  // modos Columns / Tables + Columns. Tope de UX: COLUMN_BATCH (300) tablas en
  // pantalla (un solo lote; los ids van en el cuerpo); por encima se pide acotar
  // (filtro o selección). El export no tiene tope.
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

  // La búsqueda cuenta como filtro recién con 2+ caracteres: el primer
  // keystroke no debe disparar la descarga del set completo (15k tablas).
  const anyFilter =
    search.trim().length >= 2 || schemaSel.size > 0 || areaSel.size > 0;

  // La primera vez que se aplica un filtro se carga el set completo de tablas,
  // con debounce para que tipear rápido no encole la carga a mitad de palabra.
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

  // ── export a Excel: una hoja por nivel marcado ───────────────────────────────
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
      // Select all con páginas pendientes ⇒ todas las tablas del proyecto (se
      // bajan completas para el Excel, sin tocar la grilla).
      const rows = await resolveExportRows();
      if (rows.length === 0) {
        toast.error('Select at least one row to export.');
        return;
      }
      const wb = XLSX.utils.book_new();

      // UDPs como columnas dinámicas (una por def presente en la selección).
      // Las mismas funciones puras de la grilla (lib/reportRows) arman las hojas:
      // metadata completa de tablas y columnas, por separado o unida.
      const tableUdpKeys = udpKeysOf(rows.map((t) => t.udpValues));
      if (levels.has('tables')) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((t) => tableSheetRow(t, tableUdpKeys))), 'Tables');
      }

      if (levels.has('columns') || levels.has('joined')) {
        // Columnas de las tablas seleccionadas, por tandas de 300 ids.
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
        // Detalle por par de columnas: una FK compuesta emite una fila por par
        // (mismo Rel id + Pair). Acotado a las tablas seleccionadas y pedido por
        // lotes de ids, para no omitir relaciones en proyectos grandes.
        const rels = await fetchRelationshipsFor(projectId, rows.map((t) => t.id), changesetId);
        const data = rels.map(relationshipSheetRow);   // incluye las frases de la relación
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Relationships');
      }

      if (levels.has('views')) {
        // Vistas derivadas de las tablas seleccionadas: 2 hojas — la vista en
        // sí (fuentes/SQL/User-Defined SQL) y su detalle columna a columna
        // (alias, origen, casteo, transformación). Mismo patrón acotado que Columns.
        const ids = rows.map((t) => t.id);
        const idSet = new Set(ids);
        // Ids en el cuerpo del request, en tandas.
        const views = (await fetchViewsFor(projectId, ids, changesetId))
          .filter((v) => v.sourceTableIds.some((tid) => idSet.has(tid)));
        const viewsData = views.map(viewSheetRow);
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

      // Con una versión propia, su etiqueta va en el nombre del archivo.
      XLSX.writeFile(wb, levelsFileName(projectName, draftMode ? (versionLabel ?? 'draft') : null, new Date()));
      toast.success('Report exported to Excel.');
    } catch (err: unknown) {
      if (!alive.current) return;   // la pantalla es otra (p. ej. volvió a Production)
      readFailed(err, 'Could not build the Excel file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dmh-rep">
      <div className="dmh-rep-inner">
        {/* ── cabecera ─────────────────────────────────────────────── */}
        <div className="dmh-rep-head">
          <div className="dmh-rep-eyebrow">Reporting</div>
          <h1 className="dmh-rep-h1">Reporting</h1>
          <p className="dmh-rep-sub">
            Tabular view of the metadata of one project — tables, columns, relationships and views.
            Pick the project, filter the grid, then export the detail levels you need to Excel.
          </p>
        </div>

        <div className="dmh-rep-cols">
          {/* ── izquierda: filtros + tabla ─────────────────────────── */}
          <div className="dmh-rep-main">
            <div className="dmh-rep-bar">
              {/* Proyecto del reporte (obligatorio) y su versión. */}
              {projectPicker}
              {versionPicker}
              {/* Qué muestra la grilla: tablas, sus columnas o la fila unida. */}
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
                    {/* Tras un fallo el scroll no carga: solo Retry, al pie. */}
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
                {/* Una carga fallida no se presenta como proyecto vacío. */}
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
                    {/* Centinela del scroll infinito (solo sin filtros y con páginas pendientes).
                        Si la página siguiente falló, el pie lo indica y ofrece Retry. */}
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

          {/* ── derecha: panel de export + KPIs ────────────────────── */}
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
                  disabled={!canExport || exporting || levels.size === 0 || selectedCount === 0 || loading}
                  title={canExport ? undefined : NO_EXPORT_HINT}
                >
                  {exporting ? 'Exporting…' : 'Download .xlsx'}
                </Button>
                <div className="dmh-rep-export-note">
                  Only the <strong>{selectedCount} selected</strong> row
                  {selectedCount === 1 ? '' : 's'} will be exported.
                </div>
              </div>
            </div>

            {/* Formatos fijos guardados (p. ej. QA_MODELO) */}
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
