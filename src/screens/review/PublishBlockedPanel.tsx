/**
 * PublishBlockedPanel (doc 84 A1) — un approve que el backend rechazó (409/422
 * con `detail` estructurado) se explica ENTERO y se queda en la página: qué
 * chocó (lista completa agrupada por tipo, con su contexto y con qué existe en
 * producción), qué NO pasó (nada se publicó, el request sigue en revisión) y
 * qué hacer ahora, con la acción a mano para el owner. Reemplaza al toast
 * largo, mezclado y truncado. El bloqueo en sí no cambió.
 */
import { ShieldAlert, Undo2, X } from 'lucide-react';
import type { PublishBlockedDetail } from '@/types/versioning';
import { blockedTitle, groupBlockedItems, itemContext, itemWhere } from './publishBlocked';

function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PublishBlockedPanel({ detail, ownerName, isOwner, onWithdraw, onDismiss, userName }: {
  detail: PublishBlockedDetail;
  ownerName: string;
  isOwner: boolean;
  /** Presente cuando el actor puede retirar el request desde acá. */
  onWithdraw?: () => void;
  onDismiss: () => void;
  userName: (id: string) => string;
}) {
  const groups = groupBlockedItems(detail.items);
  const dupes = detail.code === 'duplicate_names';
  return (
    <section className="dmh-rvb" role="alert" aria-label="Publish blocked">
      <div className="dmh-rvb-head">
        <ShieldAlert size={18} strokeWidth={1.7} aria-hidden />
        <div style={{ minWidth: 0 }}>
          <div className="dmh-rvb-title">{blockedTitle(detail)}</div>
          <div className="dmh-rvb-sub">
            Nothing was published. Production is unchanged and the request stays in review.
          </div>
        </div>
        <button type="button" className="dmh-rvb-close" onClick={onDismiss} aria-label="Hide this notice">
          <X size={14} strokeWidth={1.7} aria-hidden />
        </button>
      </div>

      {groups.map((g) => (
        <div key={g.kind} className="dmh-rvb-group">
          <div className="dmh-rvb-glabel">
            {g.label}
            <span className="dmh-rvb-gcount">{g.items.length}</span>
          </div>
          <ul className="dmh-rvb-list">
            {g.items.map((it, i) => {
              const ctx = itemContext(it);
              return (
                <li key={`${it.entityId ?? it.name ?? i}-${i}`} className="dmh-rvb-item">
                  <div className="dmh-rvb-item-name">
                    <span className="mono">{it.name ?? it.message}</span>
                    {ctx && <span className="dmh-rvb-ctx">{ctx}</span>}
                  </div>
                  {it.name && <div className="dmh-rvb-where">{itemWhere(it, fmtWhen, userName)}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="dmh-rvb-next">
        <div className="dmh-rvb-next-t">What to do next</div>
        <ol>
          <li>
            {isOwner ? 'Withdraw the request to get the draft back.' : `${ownerName} withdraws the request to get the draft back.`}
          </li>
          {dupes ? (
            <li>
              Remove or rename the listed items in the draft. If a table already exists in production,
              add your columns to that table instead of creating it again.
            </li>
          ) : (
            <li>{detail.next || 'Fix the listed items in the draft.'}</li>
          )}
          <li>Send the request for approval again.</li>
        </ol>
        {isOwner && onWithdraw && (
          <button type="button" className="dmh-rv-act dmh-rv-act--withdraw" onClick={onWithdraw}>
            <Undo2 size={14} strokeWidth={1.7} aria-hidden />
            Withdraw and fix
          </button>
        )}
      </div>
    </section>
  );
}
