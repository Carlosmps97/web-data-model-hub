/**
 * ChangesDetailModal (doc 64 §7 — v2; nace en doc 31) — popup "Change details"
 * de la revisión, rediseñado: barra de filtros (búsqueda + chips por verbo)
 * sobre el árbol, breadcrumb del path, diff de campos como CHIPS before →
 * after (valores largos colapsables) y — al seleccionar una tabla — sus
 * columnas cambiadas EXPANDIBLES inline, sin ida y vuelta de clicks. La data
 * es la misma de siempre: carga BAJO DEMANDA por selección vía
 * `POST /diff/details` (cache por entidad; lote tabla + columnas), relaciones
 * prefetcheadas al abrir para rotular "PADRE → HIJO". READ-ONLY: no toca nada
 * del flujo de aprobación.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff, MoveRight, Search, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { getDiffDetails } from '@/services/versioning.service';
import type { ChangesetDiff, DiffEntityDetail, DiffFieldRow } from '@/types/versioning';
import DiffTree, { TYPE_ICON, type DiffVerb, type TreeSelection } from './DiffTree';

type CacheEntry = DiffEntityDetail | 'loading' | 'missing';

const BATCH = 200;
const keyOf = (collection: string, entityId: string) => `${collection}::${entityId}`;
/** Umbral de "valor largo" (customSql, JSON…): pasa a bloque colapsable. */
const LONG = 120;

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

/** Renderer de filas de campo — compartido con el compare de versiones (doc 65). */
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

export default function ChangesDetailModal({ csId, title, versionLabel, diff, onClose }: {
  csId: string;
  title: string | null;
  versionLabel: string | null;
  diff: ChangesetDiff;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<TreeSelection | null>(null);
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});
  const inFlight = useRef<Set<string>>(new Set());
  // Doc 64 §7: filtros del árbol (búsqueda por nombre + chips por verbo).
  const [search, setSearch] = useState('');
  const [verbs, setVerbs] = useState<Set<DiffVerb>>(() => new Set<DiffVerb>(['added', 'edited', 'deleted']));
  // Accordions de columnas bajo la tabla seleccionada.
  const [openCols, setOpenCols] = useState<Set<string>>(new Set());

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

  const ensure = useCallback((items: { collection: string; entityId: string }[]) => {
    const missing = items.filter((it) => {
      const k = keyOf(it.collection, it.entityId);
      return !inFlight.current.has(k);
    });
    if (missing.length === 0) return;
    missing.forEach((it) => inFlight.current.add(keyOf(it.collection, it.entityId)));
    setCache((prev) => {
      const next = { ...prev };
      missing.forEach((it) => {
        const k = keyOf(it.collection, it.entityId);
        if (!(k in next)) next[k] = 'loading';
      });
      return next;
    });
    const chunks: { collection: string; entityId: string }[][] = [];
    for (let i = 0; i < missing.length; i += BATCH) chunks.push(missing.slice(i, i + BATCH));
    chunks.forEach((chunk) => {
      getDiffDetails(csId, chunk)
        .then(({ items: got }) => {
          setCache((prev) => {
            const next = { ...prev };
            const returned = new Set(got.map((d) => keyOf(d.collection, d.entityId)));
            got.forEach((d) => { next[keyOf(d.collection, d.entityId)] = d; });
            chunk.forEach((it) => {
              const k = keyOf(it.collection, it.entityId);
              if (!returned.has(k)) next[k] = 'missing';
            });
            return next;
          });
        })
        .catch((err: unknown) => {
          setCache((prev) => {
            const next = { ...prev };
            chunk.forEach((it) => {
              const k = keyOf(it.collection, it.entityId);
              inFlight.current.delete(k);
              if (next[k] === 'loading') delete next[k];
            });
            return next;
          });
          toast.error(err instanceof Error ? err.message : 'Could not load the change detail.');
        });
    });
  }, [csId]);

  // Prefetch de RELACIONES al abrir: sus filas del árbol no tienen nombre
  // legible sin el detalle ("PADRE → HIJO" lo resuelve el backend).
  useEffect(() => {
    const b = diff.collections.relationships;
    if (!b) return;
    const items = (['added', 'edited', 'deleted'] as const)
      .flatMap((v) => b[v].map((e) => ({ collection: 'relationships', entityId: e.id })));
    if (items.length > 0) ensure(items);
  }, [diff, ensure]);

  // Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <div className="dmh-rvd-overlay" onClick={onClose} role="presentation">
      <div
        className="dmh-rvd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Change details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dmh-rvd-head">
          <div className="dmh-rvd-head-ico">
            <FileDiff size={17} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="dmh-rvd-head-text">
            <div className="dmh-rvd-head-title">Change details</div>
            <div className="dmh-rvd-head-sub">
              {versionLabel ?? '—'} · {title ?? 'Untitled request'}
            </div>
          </div>
          <button type="button" className="dmh-rvd-close" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto' }}>
            <X size={14} strokeWidth={1.6} aria-hidden />
          </button>
        </div>

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
                <div className="dmh-rvd-hint-t">Select a changed item</div>
                <div className="dmh-rvd-hint-m">
                  Pick a row on the left to see its before → after, field by field.
                  Selecting a table also lists its changed columns inline.
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
                      {(typeof selectedEntry === 'object' ? selectedEntry.name : null) ?? selection.name}
                    </div>
                  </div>
                  {selection.change && (
                    <span className={`dmh-rvd-pill is-${selection.change}`}>
                      {selection.change === 'edited' ? 'modified' : selection.change}
                    </span>
                  )}
                </div>
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
                                {d?.name ?? (entry === 'missing' ? '(no detail)' : 'Loading…')}
                              </span>
                              {verb && <span className={`dmh-rvd-pill ${verb.cls}`} style={{ marginLeft: 0 }}>{verb.text}</span>}
                              {!open && d && <span className="dmh-rvd-colsum">{summaryLine(d)}</span>}
                            </button>
                            {open && (
                              <div className="dmh-rvd-colbody">
                                {d
                                  ? <FieldRows detail={d} />
                                  : <div className="dmh-rvd-nofields">{entry === 'missing' ? 'No detail available.' : 'Loading diff…'}</div>}
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
      </div>
    </div>
  );
}
