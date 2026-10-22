import { Avatar } from '@/components/ui';
import type { RequestCycle } from '@/types/versioning';
import { OUTCOME_BADGE, decidedVerb, fmtDate } from './requestState';

/**
 * Historial de solicitudes de una versión: un bloque por ciclo de envío (más
 * reciente primero) con quién la envió y a quién, el resultado, quién decidió
 * y, en un rechazo, el motivo (obligatorio). Sobrevive a que la versión vuelva
 * a draft, se re-envíe o se publique.
 */
export default function RequestHistory({ rows, userName, userInitials, avatarTone }: {
  rows: RequestCycle[];
  userName: (id?: string | null) => string;
  userInitials: (id?: string | null) => string;
  avatarTone: (id: string) => 'blue' | 'purple' | 'green' | 'navy';
}) {
  if (!rows.length) return null;
  return (
    <div className="dmh-rv-hist">
      <div className="dmh-rv-hist-title">Request history</div>
      {rows.map((r) => {
        const badge = OUTCOME_BADGE[r.outcome];
        const decided = r.outcome !== 'pending';
        const decisions = Object.entries(r.decisions ?? {});
        return (
          <div key={r.id} className={`dmh-rv-hist-row is-${r.outcome}`}>
            <div className="dmh-rv-hist-head">
              <span className="dmh-rv-hist-cycle">#{r.cycle}</span>
              <span className={`dmh-rv-spill ${badge.cls}`}>{badge.text}</span>
              <span className="dmh-rv-hist-meta">
                Sent by <strong>{userName(r.submittedBy)}</strong> · {fmtDate(r.submittedAt)} · Reviewer{' '}
                <strong>{r.reviewers.map(userName).join(', ') || '—'}</strong>
              </span>
            </div>
            {r.title && <div className="dmh-rv-hist-t">{r.title}</div>}
            {r.description && <div className="dmh-rv-hist-desc">{r.description}</div>}
            {decided && (
              <div className="dmh-rv-hist-meta">
                {decidedVerb(r.outcome)} by <strong>{userName(r.decidedBy)}</strong> · {fmtDate(r.decidedAt)}
              </div>
            )}
            {r.note && (
              <div className="dmh-rv-hist-note">
                <Avatar initials={userInitials(r.decidedBy)} tone={avatarTone(r.decidedBy ?? r.id)} size={20} />
                <span><strong>Reason:</strong> {r.note}</span>
              </div>
            )}
            {decisions.length > 0 && (
              <ul className="dmh-rv-hist-decisions">
                {decisions.map(([uid, a]) => (
                  <li key={uid}>
                    <strong>{userName(uid)}</strong> {a.status === 'approved' ? 'approved' : 'rejected'}
                    {a.note ? ` — ${a.note}` : ''} · {fmtDate(a.at)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
