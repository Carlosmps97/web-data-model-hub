/**
 * ChangesSummary (doc 31) — card de resumen que reemplaza al árbol inline en
 * el panel del request: proyectos/modelos afectados (nombres reales) + matriz
 * de conteos por tipo de entidad × Added/Modified/Deleted (verde/ámbar/rojo).
 * Todo sale del `GET /diff` ya cargado — cero requests extra. El detalle fino
 * vive en el popup (CTA "Open change details").
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
        <button type="button" className="dmh-rv-act dmh-rvs-open" onClick={onOpenDetails}>
          <ListTree size={14} strokeWidth={1.6} aria-hidden />
          Open change details
        </button>
      </div>

      <ChipsRow label="Projects" names={s.projects} />
      <ChipsRow label="Models" names={s.models} />

      <table className="dmh-rvs-table">
        <thead>
          <tr>
            <th aria-label="Entity" />
            <th className="is-added"><span className="sq" />Added</th>
            <th className="is-edited"><span className="sq" />Modified</th>
            <th className="is-deleted"><span className="sq" />Deleted</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.collection}>
              <td className="dmh-rvs-rowlbl">{r.label}</td>
              <td className={r.added ? 'is-added' : 'is-zero'}>{r.added || '—'}</td>
              <td className={r.edited ? 'is-edited' : 'is-zero'}>{r.edited || '—'}</td>
              <td className={r.deleted ? 'is-deleted' : 'is-zero'}>{r.deleted || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
