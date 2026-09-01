/**
 * ChangesSummary (doc 64 §7 — v2; nace en doc 31) — card de resumen del
 * request: totales por verbo como 3 stat-pills, chips de proyectos/modelos
 * afectados y la matriz por tipo de entidad como filas con chips de conteo
 * (solo los ≠ 0). El detalle fino vive en el popup rediseñado (CTA "Review
 * changes in detail"). Todo sale del `GET /diff` ya cargado — cero requests
 * extra.
 */
import { ListTree } from 'lucide-react';
import { summarizeDiff } from '@/services/versioning.service';
import type { ChangesetDiff } from '@/types/versioning';

const MAX_CHIPS = 6;

function ChipsRow({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_CHIPS);
  const rest = names.slice(MAX_CHIPS);
  return (
    <div className="dmh-rvs-chips">
      <span className="dmh-rvs-chips-lbl">{label}</span>
      {shown.map((n) => (
        <span key={n} className="dmh-rvs-chip" title={n}>{n}</span>
      ))}
      {rest.length > 0 && (
        <span className="dmh-rvs-chip is-more" title={rest.join(' · ')}>
          +{rest.length} more
        </span>
      )}
    </div>
  );
}

export default function ChangesSummary({ diff, onOpenDetails }: {
  diff: ChangesetDiff | null;
  onOpenDetails: () => void;
}) {
  if (!diff) {
    return (
      <div className="dmh-rvs-card">
        <div className="dmh-rvs-head">
          <span className="dmh-rvs-title">Changes summary</span>
        </div>
        <div className="dmh-rv-diff-empty">Loading changes…</div>
      </div>
    );
  }
  const s = summarizeDiff(diff);
  if (s.total === 0) {
    return (
      <div className="dmh-rvs-card">
        <div className="dmh-rvs-head">
          <span className="dmh-rvs-title">Changes summary</span>
        </div>
        <div className="dmh-rv-diff-empty">No structural changes in this request.</div>
      </div>
    );
  }
  return (
    <div className="dmh-rvs-card">
      <div className="dmh-rvs-head">
        <span className="dmh-rvs-title">Changes summary</span>
        <span className="dmh-rvs-total">{s.total} change{s.total === 1 ? '' : 's'}</span>
        <span className="dmh-rvs-spacer" />
        <button type="button" className="dmh-rvs-cta" onClick={onOpenDetails}>
          <ListTree size={14} strokeWidth={1.6} aria-hidden />
          Review changes in detail
        </button>
      </div>

      {/* Totales por verbo — 3 stat-pills. */}
      <div className="dmh-rvs-stats">
        <div className="dmh-rvs-stat is-added"><span className="n">+{s.added}</span><span className="t">added</span></div>
        <div className="dmh-rvs-stat is-edited"><span className="n">~{s.edited}</span><span className="t">modified</span></div>
        <div className="dmh-rvs-stat is-deleted"><span className="n">−{s.deleted}</span><span className="t">deleted</span></div>
      </div>

      <ChipsRow label="Projects" names={s.projects} />
      <ChipsRow label="Models" names={s.models} />

      {/* Matriz por tipo de entidad: filas con chips de conteo (solo ≠ 0). */}
      <div className="dmh-rvs-rows">
        {s.rows.map((r) => (
          <div key={r.collection} className="dmh-rvs-row">
            <span className="dmh-rvs-rowlbl">{r.label}</span>
            <span className="dmh-rvs-rowchips">
              {r.added > 0 && <span className="dmh-rvs-cnt is-added">+{r.added}</span>}
              {r.edited > 0 && <span className="dmh-rvs-cnt is-edited">~{r.edited}</span>}
              {r.deleted > 0 && <span className="dmh-rvs-cnt is-deleted">−{r.deleted}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
