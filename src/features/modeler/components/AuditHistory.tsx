import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import * as gov from '@/services/governance.service';
import type { HistoryItem } from '@/services/governance.service';
import { ACTION_LABEL, fieldValue, formatWhen, originText, refLabel, userLabel } from '../lib/history';

/**
 * Sección "History" de la pestaña Metadata (doc 51) — auditoría PUBLICADA de
 * una tabla o columna: quién / qué acción / qué versión / cuándo, con el
 * detalle de campos BAJO DEMANDA (fila expandible) para no recargar el panel.
 * Se monta solo con Metadata activa ⇒ el fetch es bajo demanda; cambiar de
 * entidad re-consulta. Read-only puro: no toca changeset ni versionamiento.
 */
export default function AuditHistory({ kind, entityId }: { kind: 'table' | 'column' | 'view'; entityId: string }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setItems(null); setError(false); setOpenIdx(null);
    const fetcher = kind === 'table' ? gov.tableHistory : kind === 'view' ? gov.viewHistory : gov.columnHistory;
    fetcher(entityId)
      .then((r) => { if (alive) setItems(r.items); })
      .catch(() => { if (alive) { setError(true); setItems([]); } });
    return () => { alive = false; };
  }, [kind, entityId, tick]);

  return (
    <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid #EAEDF2' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2B4A', marginBottom: 8 }}>
        History{items && items.length > 0 ? ` · ${items.length} event${items.length === 1 ? '' : 's'}` : ''}
      </div>
      {items === null && <div className="rd-small" style={{ color: 'var(--muted)' }}>Loading…</div>}
      {error && (
        <div className="rd-small" style={{ color: 'var(--muted)' }}>
          Couldn’t load the history.{' '}
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setTick((t) => t + 1)}>Retry</button>
        </div>
      )}
      {items !== null && !error && items.length === 0 && (
        <div className="rd-small" style={{ color: 'var(--muted)' }}>
          No published history yet — changes appear here once their version is published.
        </div>
      )}
      {items !== null && items.length > 0 && (
        <div className="wk-pp-hist">
          {items.map((it, i) => {
            const open = openIdx === i;
            const origin = originText(it);
            return (
              <div key={`${it.csId ?? 'x'}-${i}`} className={`wk-pp-histrow${open ? ' open' : ''}`}>
                <button type="button" className="wk-pp-histhead" title={open ? 'Hide details' : 'Show details'}
                  onClick={() => setOpenIdx(open ? null : i)}>
                  <span className={`wk-pp-histact ${it.action}`}>{ACTION_LABEL[it.action]}</span>
                  <span className="wk-pp-histuser" title={it.user?.email ?? undefined}>{userLabel(it)}</span>
                  {it.version && <span className="wk-pp-histver rd-mono">{it.version}</span>}
                  {it.restoredFrom && (
                    <span
                      className="wk-pp-histver rd-mono"
                      title={`This version restored the model to ${it.restoredFrom.versionLabel ?? 'a previous version'}`}
                    >
                      ↩{it.restoredFrom.versionLabel ?? '—'}
                    </span>
                  )}
                  <span className="wk-pp-histwhen">{formatWhen(it.at)}</span>
                  <ChevronDown size={12} className="wk-pp-histcaret" aria-hidden />
                </button>
                {open && (
                  <div className="wk-pp-histdetail">
                    {origin && <div className="wk-pp-histmeta">{origin}</div>}
                    {it.user?.email && <div className="wk-pp-histmeta">By {refLabel(it.user)} · {it.user.email}</div>}
                    {it.approvedBy.length > 0 && (
                      <div className="wk-pp-histmeta">Approved by {it.approvedBy.map(refLabel).join(', ')}</div>
                    )}
                    {it.publishedBy && (
                      <div className="wk-pp-histmeta">Published by {refLabel(it.publishedBy)}</div>
                    )}
                    {it.versionTitle && (
                      <div className="wk-pp-histmeta">Version {it.version ?? '—'} — “{it.versionTitle}”</div>
                    )}
                    {it.restoredFrom && (
                      <div className="wk-pp-histmeta">
                        Restore of {it.restoredFrom.versionLabel ?? '—'} — publishing that version put the entity back to that state.
                      </div>
                    )}
                    {!it.synthetic && it.editedAt && (
                      <div className="wk-pp-histmeta">Drafted {formatWhen(it.editedAt)}</div>
                    )}
                    {it.fields.length > 0 && (
                      <div className="wk-pp-histfields">
                        {it.fields.map((f) => (
                          <div key={f.key} className="wk-pp-histfield">
                            <span className="wk-pp-histflabel">{f.label}</span>
                            <span className="wk-pp-histfvals">
                              {it.action === 'edited'
                                ? <>{fieldValue(f.before)} <span className="wk-pp-histarrow">→</span> {fieldValue(f.after)}</>
                                : fieldValue(it.action === 'deleted' ? f.before : f.after)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="wk-pp-cap" style={{ margin: '4px 0 0' }}>
            Published changes only — draft edits appear after their version is published.
          </p>
        </div>
      )}
    </div>
  );
}
