/**
 * DiffExplorer (doc 84) — el explorador de cambios que hasta ahora vivía dentro
 * del popup «Change details» (doc 64 §7): barra de filtros (búsqueda + chips
 * por verbo), árbol jerárquico a la izquierda y diff de campos before → after
 * a la derecha, con las columnas cambiadas de una tabla expandibles inline.
 * Extraído para que el Compare de versiones (doc 65) muestre EXACTAMENTE lo
 * mismo: la fuente del detalle se inyecta (`loadDetails`, cache por entidad,
 * lote de hasta 200) y la atribución del cambio también (`attribution`: quién
 * y cuándo en la revisión; versión y autor en el compare). READ-ONLY.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, MoveRight, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { DiffEntityDetail, DiffFieldRow } from '@/types/versioning';
import DiffTree, { TYPE_ICON, type DiffLike, type DiffVerb, type TreeSelection } from './DiffTree';
import {
  applyFailed, applyLoaded, keyOf, markLoading, type CacheMap, type DetailRef,
} from './diffDetailCache';

const BATCH = 200;
/** Umbral de "valor largo" (customSql, JSON…): pasa a bloque colapsable. */
const LONG = 120;

/** Fecha legible corta ("Sep 10, 2026, 01:44") o '—'. */
export function fmtWhen(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Valor de campo → texto plano ('—' para vacío; contenedores compactos). */
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Chip de valor: '—' apagado; los largos se colapsan con "show all". */
function Val({ v, tone }: { v: unknown; tone: 'before' | 'after' | 'delta' }) {
  const s = fmtVal(v);
  if (s === '—') return <span className="dmh-rvd-val is-none">—</span>;
  if (s.length <= LONG && !s.includes('\n')) return <span className={`dmh-rvd-val is-${tone}`}>{s}</span>;
  const head = s.replace(/\s+/g, ' ').slice(0, 72);
  return (
    <details className={`dmh-rvd-vlong is-${tone}`}>
      <summary>{head}… <em>show all</em></summary>
      <pre>{s}</pre>
    </details>
  );
}

const ACTION_PILL: Record<DiffEntityDetail['action'], { cls: string; text: string }> = {
  created: { cls: 'is-added', text: 'added' },
  modified: { cls: 'is-edited', text: 'modified' },
  deleted: { cls: 'is-deleted', text: 'deleted' },
};

/** Renderer de filas de campo — compartido por la revisión y el compare (doc 65). */
export function FieldRows({ detail }: { detail: DiffEntityDetail }) {
  if (detail.fields.length === 0) {
    return (
      <div className="dmh-rvd-nofields">
        No visible field changes (internal metadata only).
      </div>
    );
  }
  if (detail.action !== 'modified') {
    const created = detail.action === 'created';
    return (
      <div className={`dmh-rvd-panel ${created ? 'is-created' : 'is-deleted'}`}>
        <div className="dmh-rvd-panel-title">
          {created ? 'New — fields of the created entity' : 'Removed — what this delete takes away'}
        </div>
        {detail.fields.map((f) => (
          <div key={f.key} className="dmh-rvd-fieldrow">
            <span className="dmh-rvd-flabel">{f.label}</span>
            <span className="dmh-rvd-fvals">
              <Val v={created ? f.after : f.before} tone={created ? 'after' : 'before'} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="dmh-rvd-fields">
      {detail.fields.map((f: DiffFieldRow) => (
        <div key={f.key} className="dmh-rvd-fieldrow">
          <span className="dmh-rvd-flabel">{f.label}</span>
          <span className="dmh-rvd-fvals">
            {f.kind === 'delta' ? (
              <Val v={f.after} tone="delta" />
            ) : (
              <>
                <Val v={f.before} tone="before" />
                <MoveRight size={13} strokeWidth={1.6} aria-hidden className="dmh-rvd-arrow" />
                <Val v={f.after} tone="after" />
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Resumen de UNA línea de un detalle (cabecera del accordion de columna). */
function summaryLine(d: DiffEntityDetail): string {
  if (d.action !== 'modified') {
    return d.fields.length ? `${d.fields.length} field${d.fields.length === 1 ? '' : 's'}` : '';
  }
  const parts = d.fields.slice(0, 2).map((f) => f.label);
  const extra = d.fields.length - parts.length;
  return parts.join(' · ') + (extra > 0 ? ` · +${extra} more` : '');
}

export interface DiffExplorerProps {
  diff: DiffLike;
  /** Detalle de campos de entidades puntuales (revisión: /diff/details; compare: /versions/compare/details). */
  loadDetails: (items: DetailRef[]) => Promise<{ items: DiffEntityDetail[] }>;
  /** Doc 84 B3/C2: quién/cuándo (revisión) o versión/autor (compare) del ítem seleccionado. */
  attribution?: (sel: TreeSelection, detail: DiffEntityDetail | null) => ReactNode;
  /** Estado vacío del panel derecho. */
  hint?: { title: string; body: string };
}

export default function DiffExplorer({ diff, loadDetails, attribution, hint }: DiffExplorerProps) {
  const [selection, setSelection] = useState<TreeSelection | null>(null);
  const [cache, setCache] = useState<CacheMap>({});
  const inFlight = useRef<Set<string>>(new Set());
  // La fuente del detalle puede cambiar de identidad en cada render del caller:
  // se lee por ref para que `ensure` sea estable (el prefetch no se repite).
  const loadRef = useRef(loadDetails);
  loadRef.current = loadDetails;
  // Doc 64 §7: filtros del árbol (búsqueda por nombre + chips por verbo).
  const [search, setSearch] = useState('');
  const [verbs, setVerbs] = useState<Set<DiffVerb>>(() => new Set<DiffVerb>(['added', 'edited', 'deleted']));
  // Accordions de columnas bajo la tabla seleccionada.
  const [openCols, setOpenCols] = useState<Set<string>>(new Set());

  // Otro diff (p.ej. re-comparar): selección y cache vuelven a cero.
  useEffect(() => {
    setSelection(null);
    setCache({});
    inFlight.current.clear();
  }, [diff]);

  const toggleVerb = (v: DiffVerb) => setVerbs((prev) => {
    const next = new Set(prev);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next.size === 0 ? prev : next;   // siempre queda al menos un verbo
  });

  // Totales para los chips (y su conteo aunque el verbo esté apagado).
  const totals = useMemo(() => {
    let added = 0; let edited = 0; let deleted = 0;
    Object.values(diff.collections).forEach((b) => {
      added += b.added.length; edited += b.edited.length; deleted += b.deleted.length;
    });
    return { added, edited, deleted };
  }, [diff]);

  // conflicto por entidad — ya viene en el /diff, no se recomputa.
  const conflictBy = useMemo(() => {
    const m: Record<string, boolean> = {};
    Object.entries(diff.collections).forEach(([collection, bucket]) => {
      (['added', 'edited', 'deleted'] as const).forEach((v) => {
        bucket[v].forEach((e) => { if (e.conflict) m[keyOf(collection, e.id)] = true; });
      });
    });
    return m;
  }, [diff]);

  const ensure = useCallback((items: DetailRef[], force = false) => {
    const missing = force ? items : items.filter((it) => !inFlight.current.has(keyOf(it.collection, it.entityId)));
    if (missing.length === 0) return;
    missing.forEach((it) => inFlight.current.add(keyOf(it.collection, it.entityId)));
    setCache((prev) => markLoading(prev, missing));
    const chunks: DetailRef[][] = [];
    for (let i = 0; i < missing.length; i += BATCH) chunks.push(missing.slice(i, i + BATCH));
    chunks.forEach((chunk) => {
      loadRef.current(chunk)
        .then(({ items: got }) => setCache((prev) => applyLoaded(prev, chunk, got)))
        .catch((err: unknown) => {
          // Doc 80 §8: el fallo se MARCA (antes se borraba la entrada y el
          // panel volvía a "Loading diff…" para siempre).
          chunk.forEach((it) => inFlight.current.delete(keyOf(it.collection, it.entityId)));
          setCache((prev) => applyFailed(prev, chunk));
          toast.error(err instanceof Error ? err.message : 'Could not load the change detail.');
        });
    });
  }, []);

  /** Reintento puntual desde el estado de error. */
  const retry = useCallback((items: DetailRef[]) => ensure(items, true), [ensure]);

  // Prefetch de RELACIONES al abrir: sus filas del árbol no tienen nombre
  // legible sin el detalle ("PADRE → HIJO" lo resuelve el backend).
  useEffect(() => {
    const b = diff.collections.relationships;
    if (!b) return;
    const items = (['added', 'edited', 'deleted'] as const)
      .flatMap((v) => b[v].map((e) => ({ collection: 'relationships', entityId: e.id })));
    if (items.length > 0) ensure(items);
  }, [diff, ensure]);

  const relationshipNames = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    const b = diff.collections.relationships;
    if (!b) return out;
    (['added', 'edited', 'deleted'] as const).forEach((v) => {
      b[v].forEach((e) => {
        const entry = cache[keyOf('relationships', e.id)];
        out[e.id] = typeof entry === 'object' ? entry.name ?? undefined : undefined;
      });
    });
    return out;
  }, [diff, cache]);

  const handleSelect = useCallback((sel: TreeSelection) => {
    setSelection(sel);
    const items: { collection: string; entityId: string }[] = [];
    if (sel.change) items.push({ collection: sel.collection, entityId: sel.entityId });
    (sel.childColumnIds ?? []).forEach((id) =>
      items.push({ collection: 'canonical_columns', entityId: id }));
    if (items.length > 0) ensure(items);
    // Columnas: pocas → abiertas de una; muchas → colapsadas (resumen visible).
    const ids = sel.childColumnIds ?? [];
    setOpenCols(ids.length <= 5 ? new Set(ids) : new Set());
  }, [ensure]);

  const selectedEntry = selection?.change
    ? cache[keyOf(selection.collection, selection.entityId)]
    : undefined;
  const selectedDetail = typeof selectedEntry === 'object' ? selectedEntry : null;
  const selectedConflict = selection
    ? conflictBy[keyOf(selection.collection, selection.entityId)]
    : false;

  const verbChip = (v: DiffVerb, label: string, count: number) => (
    <button
      type="button"
      className={`dmh-rvd-vchip v-${v}${verbs.has(v) ? ' on' : ''}`}
      title={verbs.has(v) ? `Hide ${label} changes` : `Show ${label} changes`}
      onClick={() => toggleVerb(v)}
    >
      <span className="sq" aria-hidden />{label} · {count}
    </button>
  );

  return (
    <>
      {/* Doc 64 §7: filtros — búsqueda + verbos (leyenda incluida). */}
      <div className="dmh-rvd-filters">
        <div className="dmh-rvd-search">
          <Search size={13} aria-hidden />
          <input value={search} placeholder="Search by name…" onChange={(e) => setSearch(e.target.value)} />
        </div>
        {verbChip('added', 'added', totals.added)}
        {verbChip('edited', 'modified', totals.edited)}
        {verbChip('deleted', 'deleted', totals.deleted)}
        <span className="dmh-rvd-filters-note">Click a row to see its before → after</span>
      </div>

      <div className="dmh-rvd-body">
        <div className="dmh-rvd-left">
          <DiffTree
            diff={diff}
            relationshipNames={relationshipNames}
            selectedKey={selection?.key ?? null}
            onSelect={handleSelect}
            search={search}
            verbs={verbs}
          />
        </div>

        <div className="dmh-rvd-detail">
          {!selection ? (
            <div className="dmh-rvd-hint">
              <div className="dmh-rvd-hint-t">{hint?.title ?? 'Select a changed item'}</div>
              <div className="dmh-rvd-hint-m">
                {hint?.body ?? 'Pick a row on the left to see its before → after, field by field. Selecting a table also lists its changed columns inline.'}
              </div>
            </div>
          ) : (
            <>
              {(selection.path?.length ?? 0) > 0 && (
                <div className="dmh-rvd-crumb">
                  {selection.path!.map((p, i) => (
                    <span key={`${p}-${i}`} style={{ display: 'inline-flex', gap: 5 }}>
                      {i > 0 && <span className="sep">›</span>}
                      <span>{p}</span>
                    </span>
                  ))}
                  <span className="sep">›</span>
                  <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{selection.name}</span>
                </div>
              )}
              <div className="dmh-rvd-dhead">
                <span className="dmh-rvd-ico" aria-hidden>{TYPE_ICON[selection.iconType ?? ''] ?? null}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="dmh-rvd-type">{selection.type}</div>
                  <div className={`dmh-rvd-dname mono${selection.change === 'deleted' ? ' strike' : ''}`}>
                    {selectedDetail?.name ?? selection.name}
                  </div>
                </div>
                {selection.change && (
                  <span className={`dmh-rvd-pill is-${selection.change}`}>
                    {selection.change === 'edited' ? 'modified' : selection.change}
                  </span>
                )}
              </div>
              {attribution && selection.change ? attribution(selection, selectedDetail) : null}
              {selectedConflict && (
                <div className="dmh-rv-note" role="alert" style={{ marginTop: 10 }}>
                  <TriangleAlert size={15} strokeWidth={1.7} aria-hidden />
                  <span>Modified in production after this version edited it — approving overwrites that.</span>
                </div>
              )}
              <div className="dmh-rvd-dbody">
                {!selection.change ? (
                  (selection.childColumnIds?.length ?? 0) > 0
                    ? <div className="dmh-rvd-nofields">The table itself didn't change — its changed columns are listed below.</div>
                    : null
                ) : selectedEntry === undefined || selectedEntry === 'loading' ? (
                  <div className="dmh-rvd-nofields">Loading diff…</div>
                ) : selectedEntry === 'missing' ? (
                  <div className="dmh-rvd-nofields">No detail available for this entity.</div>
                ) : selectedEntry === 'error' ? (
                  <div className="dmh-rvd-nofields">
                    Couldn't load this detail.{' '}
                    <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm"
                      onClick={() => retry([{ collection: selection.collection, entityId: selection.entityId }])}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <FieldRows detail={selectedEntry} />
                )}

                {/* Doc 64 §7: columnas cambiadas de la tabla, inline. */}
                {(selection.childColumnIds?.length ?? 0) > 0 && (
                  <div className="dmh-rvd-cols">
                    <div className="dmh-rvd-cols-title">
                      Changed columns under this table
                      <span className="dmh-rvd-seccount">{selection.childColumnIds!.length}</span>
                    </div>
                    {selection.childColumnIds!.map((id) => {
                      const entry = cache[keyOf('canonical_columns', id)];
                      const d = typeof entry === 'object' ? entry : null;
                      const open = openCols.has(id);
                      const verb = d ? ACTION_PILL[d.action] : null;
                      return (
                        <div key={id} className={`dmh-rvd-colcard ${verb?.cls ?? ''}`}>
                          <button
                            type="button"
                            className="dmh-rvd-colhead"
                            onClick={() => setOpenCols((prev) => {
                              const n = new Set(prev);
                              if (n.has(id)) n.delete(id);
                              else n.add(id);
                              return n;
                            })}
                          >
                            {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                            <span className={`dmh-rvd-colname${d?.action === 'deleted' ? ' strike' : ''}`}>
                              {d?.name ?? (entry === 'missing' ? '(no detail)'
                                : entry === 'error' ? '(failed to load)' : 'Loading…')}
                            </span>
                            {verb && <span className={`dmh-rvd-pill ${verb.cls}`} style={{ marginLeft: 0 }}>{verb.text}</span>}
                            {!open && d && <span className="dmh-rvd-colsum">{summaryLine(d)}</span>}
                          </button>
                          {open && (
                            <div className="dmh-rvd-colbody">
                              {d ? <FieldRows detail={d} /> : (
                                <div className="dmh-rvd-nofields">
                                  {entry === 'missing' ? 'No detail available.'
                                    : entry === 'error' ? (
                                      <>
                                        Couldn't load this detail.{' '}
                                        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm"
                                          onClick={() => retry([{ collection: 'canonical_columns', entityId: id }])}>
                                          Retry
                                        </button>
                                      </>
                                    ) : 'Loading diff…'}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
