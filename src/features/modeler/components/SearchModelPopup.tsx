// Buscador del Model. Un solo popup busca en toda la versión (no solo el
// canvas abierto) por tabla, columna, definición de columna y —en el modelo
// físico, el único que tiene vistas— vista. Cada hit muestra
// los canvases donde está y dos acciones (siempre visibles):
//   · Locate on canvas — redirige al canvas (si hace falta) y centra sobre la
//     tabla o la vista; para columnas, además selecciona la fila y abre su Properties.
//     El clic en la fila / Enter hacen esto.
//   · Inspect metadata — abre el Object Inspector (solo lectura, sin canvas).
//
// Navegación y paginación: los filtros por sí solos listan su alcance (sin
// término); en el alcance «All» cada grupo muestra su primera página y
// «Show all…» pasa al alcance del grupo, donde la lista carga por bloques de
// 50 al llegar al final del scroll (o con «Load more»).
//
// Abierto desde un canvas, arranca acotado a ese canvas: los filtros
// Project › Sub-project › Domain › Model se pre-llenan con su ruta y la lista
// muestra sus tablas de una vez; «Search everywhere» amplía a toda la versión.
//
// Selectores y filtros: alcance All · Tables / entities · Columns /
// attributes · Definitions · Views (solo en físico), y filtros en cascada con la misma jerarquía del
// Model Explorer: Project › Sub-project (carpeta raíz) › Domain (sub-carpeta)
// › Model (canvas). Cada nivel queda bloqueado (plomo + candado) hasta elegir
// el anterior; el backend alcanza el subárbol completo de la carpeta elegida.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react';
import { facetNouns } from '@/lib/facets';
import { Columns3, Crosshair, Eye, FileText, Lock, MapPin, Search, Table2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import * as gov from '@/services/governance.service';
import type {
  ModelSearchCanvas, ModelSearchColumn, ModelSearchResult, ModelSearchScope, ModelSearchTable, ModelSearchView,
} from '@/services/governance.service';
import * as struct from '../services/structure.service';
import type { Folder, SubjectArea } from '../services/modeler.service';
import { useModelerStore } from '@/store/useModelerStore';
import { folderSubtree } from '../lib/explorerMove';
import { columnPath, folderChain, pickTargetCanvas, snippet, splitHighlight } from '../lib/searchModel';
import SearchSelect from './SearchSelect';
import { useSessionStore } from '@/store/useSessionStore';

const MIN_CHARS = 2;
/** Alcance «All»: primera página de cada grupo (vista general). */
const OVERVIEW_LIMIT = 25;
/** Alcance de un grupo: bloques al hacer scroll. */
const PAGE = 50;
const DEBOUNCE_MS = 300;

const SCOPES: { id: ModelSearchScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tables', label: 'Tables / entities' },
  { id: 'columns', label: 'Columns / attributes' },
  { id: 'definitions', label: 'Definitions' },
  { id: 'views', label: 'Views' },
];
type Group = Exclude<ModelSearchScope, 'all'>;
const GROUP_LABEL: Record<Group, string> = { tables: 'tables', columns: 'columns', definitions: 'definitions', views: 'views' };

type Opt = { value: string; label: string };
const labelOf = (opts: Opt[], v: string) => opts.find((o) => o.value === v)?.label ?? '';
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Une una página más a un grupo sin repetir ids (el overlay del draft podría re-emitir). */
function appendPage(prev: ModelSearchResult, more: ModelSearchResult, group: Group): ModelSearchResult {
  const seen = new Set(prev[group].map((x) => x.id));
  const merged = [...prev[group], ...more[group].filter((x) => !seen.has(x.id))] as ModelSearchResult[typeof group];
  return { ...prev, [group]: merged, offset: more.offset, next: { ...prev.next, [group]: more.next[group] } };
}

/** Resalta las ocurrencias de `q` en `text` (contiene, case-insensitive). */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  return (
    <>
      {splitHighlight(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export default function SearchModelPopup({ onClose, pushToast }: {
  onClose: () => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  // Las vistas solo existen en el modelo físico: en lógico no hay alcance Views.
  const withViews = viewMode === 'physical';
  const scopes = withViews ? SCOPES : SCOPES.filter((s) => s.id !== 'views');
  // Canvas abierto al abrir el popup: semilla de los filtros.
  const activeCanvas = useModelerStore((s) => (s.activeSaId ? (s.diagram?.subjectArea ?? null) : null));
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<ModelSearchScope>('all');
  const [res, setRes] = useState<ModelSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef(false);   // request de página en vuelo (evita duplicados por scroll)

  // ── Filtros en cascada dentro del proyecto de la sesión:
  //    sub-proyecto → dominio → modelo.
  const projectId = useSessionStore((s) => s.activeProjectId) ?? '';
  const projectName = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name ?? null);
  const [subprojectId, setSubprojectId] = useState('');
  const [domainId, setDomainId] = useState('');
  const [canvasId, setCanvasId] = useState(activeCanvas?.id ?? '');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [canvases, setCanvases] = useState<SubjectArea[]>([]);
  useEffect(() => {
    if (!projectId) { setFolders([]); setCanvases([]); return undefined; }
    let alive = true;
    Promise.all([struct.listFolders(projectId), struct.listSubjectAreas(projectId)])
      .then(([f, c]) => { if (alive) { setFolders(f); setCanvases(c); } })
      .catch(() => { if (alive) { setFolders([]); setCanvases([]); } });
    return () => { alive = false; };
  }, [projectId]);
  // Sub-project (carpeta raíz) y Domain (2.º nivel) del canvas abierto, una sola
  // vez cuando llegan las carpetas de su proyecto; el usuario puede cambiarlos.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !activeCanvas || folders.length === 0 || projectId !== activeCanvas.projectId) return;
    seeded.current = true;
    const chain = folderChain(folders, activeCanvas.folderId);
    if (chain[0]) setSubprojectId(chain[0].id);
    if (chain[1]) setDomainId(chain[1].id);
  }, [folders, activeCanvas, projectId]);
  useEffect(() => { if (!withViews && scope === 'views') setScope('all'); }, [withViews, scope]);
  const scopedToOpenCanvas = !!activeCanvas && canvasId === activeCanvas.id;
  const clearFilters = () => { setSubprojectId(''); setDomainId(''); setCanvasId(''); };
  const pickSubproject = (v: string) => { setSubprojectId(v); setDomainId(''); setCanvasId(''); };
  const pickDomain = (v: string) => { setDomainId(v); setCanvasId(''); };

  // Sub-proyectos = carpetas raíz del proyecto; dominios = sub-carpetas del sub-proyecto elegido.
  const subprojectOpts = useMemo<Opt[]>(
    () => folders.filter((f) => !f.parentFolderId).sort(byName).map((f) => ({ value: f.id, label: f.name })),
    [folders],
  );
  const domainOpts = useMemo<Opt[]>(
    () => (subprojectId ? folders.filter((f) => f.parentFolderId === subprojectId).sort(byName).map((f) => ({ value: f.id, label: f.name })) : []),
    [folders, subprojectId],
  );
  // Modelos = canvases del subárbol del dominio (o del sub-proyecto si no hay
  // dominio): el modelo puede colgar de cualquier nivel bajo la carpeta elegida.
  const modelOpts = useMemo<Opt[]>(() => {
    const root = domainId || subprojectId;
    if (!root) return [];
    const tree = folderSubtree(folders, root);
    return canvases.filter((c) => c.folderId && tree.has(c.folderId)).sort(byName).map((c) => ({ value: c.id, label: c.name }));
  }, [canvases, folders, domainId, subprojectId]);

  const term = q.trim();
  const folderFilter = domainId || subprojectId || '';
  const anyFilter = !!(subprojectId || domainId || canvasId);
  // Con término (≥2), con un filtro o con un alcance concreto se lista
  // (navegación); solo «All» sin nada muestra la ayuda.
  const ready = term.length >= MIN_CHARS || anyFilter || scope !== 'all';
  const pageSize = scope === 'all' ? OVERVIEW_LIMIT : PAGE;

  // Primera página (server-side, con debounce); `alive` descarta respuestas fuera de orden.
  useEffect(() => {
    if (!ready) { setRes(null); setLoading(false); setError(null); return undefined; }
    let alive = true;
    setLoading(true);
    const h = setTimeout(() => {
      gov.searchModel(term, { limit: pageSize, scope, views: withViews, folderId: folderFilter || null, canvasId: canvasId || null })
        .then((r) => { if (alive) { setRes(r); setError(null); listRef.current?.scrollTo({ top: 0 }); } })
        .catch((e: unknown) => { if (alive) { setRes(null); setError(e instanceof Error && e.message ? e.message : "Couldn't search the model"); } })
        .finally(() => { if (alive) setLoading(false); });
    }, term ? DEBOUNCE_MS : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [term, ready, scope, withViews, pageSize, folderFilter, canvasId]);

  // Página siguiente del grupo (alcance de un solo grupo): al llegar al final del scroll o con «Load more».
  const group: Group | null = scope === 'all' ? null : scope;
  const nextOffset = group && res ? res.next[group] : null;
  const loadMore = () => {
    if (!group || nextOffset == null || moreRef.current) return;
    moreRef.current = true;
    setLoadingMore(true);
    gov.searchModel(term, { limit: PAGE, offset: nextOffset, scope, views: withViews, folderId: folderFilter || null, canvasId: canvasId || null })
      .then((more) => setRes((prev) => (prev ? appendPage(prev, more, group) : more)))
      .catch(() => pushToast("Couldn't load more results", 'err'))
      .finally(() => { moreRef.current = false; setLoadingMore(false); });
  };
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) loadMore();
  };

  const showTables = scope === 'all' || scope === 'tables';
  const showCols = scope === 'all' || scope === 'columns';
  const showDefs = scope === 'all' || scope === 'definitions';
  const showViews = withViews && (scope === 'all' || scope === 'views');
  const views = res?.views ?? [];
  const total = (res?.tables.length ?? 0) + (res?.columns.length ?? 0) + (res?.definitions.length ?? 0)
    + (showViews ? views.length : 0);

  /** Locate: redirige (si hace falta) y centra la tabla o la vista (`targetId`);
   *  con `colId` abre además la columna. */
  const go = (canvas: ModelSearchCanvas | null, targetId: string, colId: string | undefined, label: string, noun: string) => {
    if (!canvas) { pushToast(`This ${noun} is not placed on any canvas yet — use Inspect to read it`, 'err'); return; }
    onClose();
    openCanvasAndFocus(canvas.id, canvas.projectId ?? undefined, targetId, colId, label)
      .catch(() => pushToast("Couldn't open the canvas", 'err'));
  };
  const locate = (canvases: ModelSearchCanvas[], targetId: string, colId: string | undefined, label: string, noun: string) =>
    go(pickTargetCanvas(canvases, activeSaId), targetId, colId, label, noun);
  /** Inspect: Object Inspector de la tabla (columna preseleccionada) o de la vista, sin canvas. */
  const inspect = (kind: 'table' | 'view', id: string, colId?: string) => {
    onClose();
    openInspector(kind === 'view' ? { kind, id } : { kind, id, colId: colId ?? null });
  };

  // Enter = primer hit (tablas, luego columnas, luego definiciones, luego vistas).
  const first = useMemo(() => {
    if (!res) return null;
    const t = res.tables[0];
    if (t) return { canvases: t.canvases, targetId: t.id, colId: undefined as string | undefined, label: t.physicalName, noun: n.one };
    const c = res.columns[0] ?? res.definitions[0];
    if (c) return { canvases: c.canvases, targetId: c.tableId, colId: c.id, label: `${c.tableName} · ${c.physicalName}`, noun: n.one };
    const v = showViews ? res.views?.[0] : undefined;
    return v ? { canvases: v.canvases, targetId: v.id, colId: undefined, label: v.name, noun: 'view' } : null;
  }, [res, showViews, n.one]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !first) return;
    // Cierra el popup en este keydown; sin preventDefault, el keypress del
    // mismo Enter «clicaría» al botón que lo abrió (lo reabriría, o haría Undo).
    e.preventDefault();
    locate(first.canvases, first.targetId, first.colId, first.label, first.noun);
  };

  /** Lo que hace cada fila: la tabla (o su columna) o la vista que ubica e inspecciona. */
  interface Hit { kind: 'table' | 'view'; targetId: string; colId?: string; label: string }
  const nounOf = (hit: Hit) => (hit.kind === 'view' ? 'view' : n.one);

  const chips = (canvases: ModelSearchCanvas[], hit: Hit) => (
    <span className="wk-srch-chips" style={{ maxWidth: '34%' }}>
      {canvases.length === 0 && <span className="wk-srch-none">not on any canvas</span>}
      {[...canvases]
        .sort((a, b) => Number(b.id === activeSaId) - Number(a.id === activeSaId) || a.name.localeCompare(b.name))
        .slice(0, 3)
        .map((c) => (
          <button key={c.id} type="button" className={`wk-srch-chip${c.id === activeSaId ? ' here' : ''}`}
            title={c.id === activeSaId ? 'Center on this canvas' : `Open “${c.name}” and center`}
            onClick={(e) => { e.stopPropagation(); go(c, hit.targetId, hit.colId, hit.label, nounOf(hit)); }}>
            {c.id === activeSaId ? 'This canvas' : c.name}
          </button>
        ))}
      {canvases.length > 3 && <span className="wk-srch-none">+{canvases.length - 3} more</span>}
    </span>
  );

  const row = (key: string, main: React.ReactNode, canvases: ModelSearchCanvas[], hit: Hit) => {
    const go = () => locate(canvases, hit.targetId, hit.colId, hit.label, nounOf(hit));
    return (
      <div key={key} role="button" tabIndex={0} className="wk-srch-row"
        onClick={go}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
        <div className="wk-srch-main">{main}</div>
        {chips(canvases, hit)}
        <span className="wk-srch-acts">
          <button type="button" className="wk-srch-act primary" title="Open the canvas and center on it"
            onClick={(e) => { e.stopPropagation(); go(); }}>
            <Crosshair size={12} /> Locate
          </button>
          <button type="button" className="wk-srch-act" title="Read the metadata — no canvas needed"
            onClick={(e) => { e.stopPropagation(); inspect(hit.kind, hit.targetId, hit.colId); }}>
            <Eye size={12} /> Inspect
          </button>
        </span>
      </div>
    );
  };

  const tableRow = (t: ModelSearchTable) => row(`t:${t.id}`, (
    <>
      <span className="wk-srch-name rd-mono"><Hl text={`${t.schema ? `${t.schema}.` : ''}${t.physicalName}`} q={term} /></span>
      <span className="wk-srch-sub"><Hl text={t.logicalName} q={term} /></span>
    </>
  ), t.canvases, { kind: 'table', targetId: t.id, label: t.physicalName });

  const columnRow = (c: ModelSearchColumn) => row(`c:${c.id}`, (
    <>
      <span className="wk-srch-name rd-mono"><Hl text={c.physicalName} q={term} />{c.dataType ? <span className="wk-srch-type"> {c.dataType}</span> : null}</span>
      <span className="wk-srch-sub"><Hl text={c.logicalName} q={term} /> · in {c.schema ? `${c.schema}.` : ''}{c.tableName}</span>
    </>
  ), c.canvases, { kind: 'table', targetId: c.tableId, colId: c.id, label: `${c.tableName} · ${c.physicalName}` });

  const definitionRow = (c: ModelSearchColumn) => row(`d:${c.id}`, (
    <>
      <span className="wk-srch-name rd-mono">{columnPath(c)}</span>
      <span className="wk-srch-def"><Hl text={term ? snippet(c.description ?? '', term) : (c.description ?? '')} q={term} /></span>
    </>
  ), c.canvases, { kind: 'table', targetId: c.tableId, colId: c.id, label: `${c.tableName} · ${c.physicalName}` });

  /** Fuentes de una vista: las tres primeras y cuántas más. */
  const sourcesText = (v: ModelSearchView) => (v.sourceTables.length === 0 ? 'view'
    : `view of ${v.sourceTables.slice(0, 3).join(', ')}${v.sourceTables.length > 3 ? ` +${v.sourceTables.length - 3} more` : ''}`);

  const viewRow = (v: ModelSearchView) => row(`v:${v.id}`, (
    <>
      <span className="wk-srch-name rd-mono"><Hl text={`${v.schema ? `${v.schema}.` : ''}${v.name}`} q={term} /></span>
      <span className="wk-srch-sub">
        {sourcesText(v)} · {v.columnCount} column{v.columnCount === 1 ? '' : 's'}{v.custom ? ' · User-Defined SQL' : ''}
      </span>
    </>
  ), v.canvases, { kind: 'view', targetId: v.id, label: v.name });

  /** Sección de un grupo; en «All» ofrece pasar al alcance del grupo para ver el resto. */
  const section = (g: Group, icon: React.ReactNode, title: string, body: React.ReactNode) => {
    const n = res?.[g]?.length ?? 0;
    const more = res?.next[g] != null;
    return (
      <>
        <div className="wk-srch-sec">{icon}{title} <span className="wk-srch-count">· {n}{more && scope === 'all' ? '+' : ''}</span></div>
        {n === 0 ? <div className="wk-srch-none" style={{ padding: '2px 8px 6px' }}>No matches</div> : body}
        {more && scope === 'all' && (
          <div className="wk-srch-more">
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={() => setScope(g)}>
              Show all {GROUP_LABEL[g]} — first {n} shown
            </button>
          </div>
        )}
      </>
    );
  };

  /** Un filtro en cascada; `lockedBy` = nombre del nivel anterior que falta. */
  const filter = (label: string, opts: Opt[], value: string, onPick: (v: string) => void, allLabel: string, lockedBy?: string) => {
    const locked = !!lockedBy;
    return (
      <label className={locked ? 'is-locked' : ''}>
        <span>{locked && <Lock size={10} strokeWidth={2} aria-hidden />}{label}</span>
        <SearchSelect options={opts} valueLabel={labelOf(opts, value)} placeholder={locked ? `Pick a ${lockedBy} first` : allLabel}
          emptyLabel={allLabel} onPick={onPick} disabled={locked} />
      </label>
    );
  };

  return (
    <Dialog
      open
      title="Search the model"
      subtitle={`${n.Many}, ${n.members}${withViews ? `, ${n.member} definitions and views` : ` and ${n.member} definitions`} across every canvas of ${projectName ? `«${projectName}»` : 'this project'} in this version — Locate opens the canvas and centers on the hit; Inspect reads its metadata without a canvas`}
      icon={Search}
      backdrop="canvas"
      canvasTop={136}
      width={760}
      onClose={onClose}
      footer={<button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Close</button>}
    >
      {/* Alcance: qué se busca (tablas/entidades, columnas/atributos, definiciones y, en físico, vistas). */}
      <div className="rd-seg wk-srch-scope" role="tablist" aria-label="Search scope">
        {scopes.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} className={scope === s.id ? 'active' : ''} onClick={() => setScope(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="wk-findres-search">
        <Search size={14} aria-hidden />
        <input autoFocus value={q}
          placeholder={scopedToOpenCanvas ? 'Type to narrow down this canvas — the list below already shows all of it…' : 'Type at least 2 characters — or just pick a filter to browse…'}
          onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Search the model" />
        {loading && <span className="rd-spin" aria-hidden />}
      </div>
      {/* Filtros en cascada con la jerarquía del Model Explorer. */}
      <div className="wk-srch-filters">
        {filter('Sub-project', subprojectOpts, subprojectId, pickSubproject, 'All sub-projects')}
        {filter('Domain', domainOpts, domainId, pickDomain, 'All domains', subprojectId ? undefined : 'sub-project')}
        {filter('Model', modelOpts, canvasId, setCanvasId, 'All models', subprojectId ? undefined : 'sub-project')}
        {anyFilter && (
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={clearFilters}>Clear filters</button>
        )}
      </div>
      {scopedToOpenCanvas && activeCanvas && (
        <div className="wk-srch-scopechip">
          <MapPin size={12} aria-hidden /> Searching in the open canvas <b className="rd-mono">{activeCanvas.name}</b>
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={clearFilters}>Search everywhere</button>
        </div>
      )}
      <div className="wk-findres-list" style={{ maxHeight: 420 }} ref={listRef} onScroll={onScroll}>
        {!ready && (
          <div className="wk-srch-hint">
            Search by <b>{n.one}</b> (logical or physical name), <b>{n.member}</b> (logical or physical name){withViews ? <>, <b>{n.member} definition</b> or <b>view</b> (name)</> : <> or <b>{n.member} definition</b></>} —
            or pick a filter (Sub-project › Domain › Model) or a scope to browse without typing.
            Results cover the whole project in this version, not just the open canvas; long lists load in blocks as you scroll.
            <b> Locate</b> opens the canvas and centers on the hit; <b>Inspect</b> shows its full metadata without any canvas.
            Press <span className="wk-srch-kbd">Enter</span> for the first hit.
          </div>
        )}
        {error && <div className="wk-findres-empty rd-small" role="alert">{error}</div>}
        {ready && res && total === 0 && !loading && (
          <div className="wk-findres-empty rd-small">
            No {scope === 'all' ? (withViews ? 'tables, columns, definitions or views' : 'tables, columns or definitions') : SCOPES.find((s) => s.id === scope)?.label.toLowerCase()}
            {term ? ` match “${term}”` : ''}{anyFilter ? ' with the current filters' : ''}.
          </div>
        )}
        {res && total > 0 && (
          <>
            {showTables && section('tables', <Table2 size={12} aria-hidden />, n.Many, res.tables.map(tableRow))}
            {showCols && section('columns', <Columns3 size={12} aria-hidden />, n.Members, res.columns.map(columnRow))}
            {showDefs && section('definitions', <FileText size={12} aria-hidden />, `${n.Member} definitions`, res.definitions.map(definitionRow))}
            {showViews && section('views', <Eye size={12} aria-hidden />, 'Views', views.map(viewRow))}
            {group && loadingMore && <div className="wk-srch-loading"><span className="rd-spin" aria-hidden /> Loading more…</div>}
            {group && !loadingMore && nextOffset != null && (
              <div className="wk-srch-more">
                <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={loadMore}>Load more (scroll also loads)</button>
              </div>
            )}
            {group && nextOffset == null && res[group].length >= PAGE && (
              <div className="wk-srch-none" style={{ textAlign: 'center', padding: '6px 0' }}>End of the list · {res[group].length} {GROUP_LABEL[group]}</div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
