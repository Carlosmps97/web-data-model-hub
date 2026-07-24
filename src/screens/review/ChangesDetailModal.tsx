/**
 * ChangesDetailModal (doc 31) — popup "Change details" de la revisión:
 * master-detail con la jerarquía coloreada a la izquierda (DiffTree) y el diff
 * ANTES→DESPUÉS a nivel de campos a la derecha, cargado BAJO DEMANDA por
 * selección vía `POST /diff/details` (cache por entidad; al seleccionar una
 * tabla se trae en un lote la tabla + sus columnas cambiadas). Las relaciones
 * se prefetchean al abrir para poder rotular sus filas "PADRE → HIJO".
 * READ-ONLY: no toca nada del flujo de aprobación.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDiff, MoveRight, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { getDiffDetails } from '@/services/versioning.service';
import type { ChangesetDiff, DiffEntityDetail, DiffFieldRow } from '@/types/versioning';
import DiffTree, { type TreeSelection } from './DiffTree';

type CacheEntry = DiffEntityDetail | 'loading' | 'missing';

const BATCH = 200;
const keyOf = (collection: string, entityId: string) => `${collection}::${entityId}`;

/** Valor de campo → texto plano ('—' para vacío; contenedores compactos). */
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const ACTION_PILL: Record<DiffEntityDetail['action'], { cls: string; text: string }> = {
  created: { cls: 'is-added', text: 'added' },
  modified: { cls: 'is-edited', text: 'modified' },
  deleted: { cls: 'is-deleted', text: 'deleted' },
};

function FieldRows({ detail }: { detail: DiffEntityDetail }) {
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
            <span className={`dmh-rvd-fval ${created ? 'is-after' : 'is-before'}`}>
              {fmtVal(created ? f.after : f.before)}
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
          {f.kind === 'delta' ? (
            <span className="dmh-rvd-fval is-delta">{fmtVal(f.after)}</span>
          ) : (
            <>
              <span className="dmh-rvd-fval is-before">{fmtVal(f.before)}</span>
              <MoveRight size={13} strokeWidth={1.6} aria-hidden className="dmh-rvd-arrow" />
              <span className="dmh-rvd-fval is-after">{fmtVal(f.after)}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
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
  }, [ensure]);

  const selectedEntry = selection?.change
    ? cache[keyOf(selection.collection, selection.entityId)]
    : undefined;
  const selectedConflict = selection
    ? conflictBy[keyOf(selection.collection, selection.entityId)]
    : false;

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
          <span className="dmh-rvd-legend">
            <span className="lg lg--add"><span className="sq" />added</span>
            <span className="lg lg--mod"><span className="sq" />modified</span>
            <span className="lg lg--del"><span className="sq" />deleted</span>
          </span>
          <button type="button" className="dmh-rvd-close" onClick={onClose} aria-label="Close">
            <X size={14} strokeWidth={1.6} aria-hidden />
          </button>
        </div>

        <div className="dmh-rvd-body">
          <div className="dmh-rvd-left">
            <DiffTree
              diff={diff}
              relationshipNames={relationshipNames}
              selectedKey={selection?.key ?? null}
              onSelect={handleSelect}
            />
          </div>

          <div className="dmh-rvd-detail">
            {!selection ? (
              <div className="dmh-rvd-hint">
                <div className="dmh-rvd-hint-t">Select a changed item</div>
                <div className="dmh-rvd-hint-m">
                  Pick a colored row on the left to see its before → after, field by field.
                </div>
              </div>
            ) : (
              <>
                <div className="dmh-rvd-dhead">
                  <span className="dmh-rvd-type">{selection.type}</span>
                  <span className={`dmh-rvd-dname mono${selection.change === 'deleted' ? ' strike' : ''}`}>
                    {(typeof selectedEntry === 'object' ? selectedEntry.name : null) ?? selection.name}
                  </span>
                  {selection.change && (
                    <span className={`dmh-rv-diffrow-pill is-${selection.change}`}>
                      {selection.change === 'edited' ? 'modified' : selection.change === 'added' ? 'added' : 'deleted'}
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
                  {!selection.change ? null : selectedEntry === undefined || selectedEntry === 'loading' ? (
                    <div className="dmh-rvd-nofields">Loading diff…</div>
                  ) : selectedEntry === 'missing' ? (
                    <div className="dmh-rvd-nofields">No detail available for this entity.</div>
                  ) : (
                    <FieldRows detail={selectedEntry} />
                  )}
                  {(selection.childColumnIds?.length ?? 0) > 0 && (
                    <div className="dmh-rvd-childnote">
                      {selection.childColumnIds!.length} changed column
                      {selection.childColumnIds!.length === 1 ? '' : 's'} under this table —
                      select them in the tree to see each diff.
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
