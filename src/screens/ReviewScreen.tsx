/**
 * ReviewScreen (p5) — "Requests · review & approval", CROSS-PROJECT.
 *
 * Layout (per design #p5) — a two-section panel:
 *   · header: "Requests · review & approval" + close
 *   · SECTION 1 (left): From / Reviewer filters, "{N} requests", request cards
 *     (status badge, "Assigned to you", snap · vN, requester → reviewer, project)
 *   · SECTION 2 (right): open request detail — title + status, meta line
 *     (From {owner} · snapshot of vN · date · Reviewer {names}), actions
 *     (Open in canvas / Comment / Reject / Approve), an assigned-reviewer note,
 *     impact chips + legend, the requester note, "Changes · N" diff, and the
 *     reviewer comments thread + input.
 *
 * Data: versioning.service (listVersions / getPublished / listUsers /
 * getChangeset / getDiff / review / addComment) + projects.service. The actor
 * comes from useSessionStore (injects X-Dev-User). Approve/Reject are disabled
 * when the actor is NOT the assigned reviewer; on 403 we toast. Lists + detail
 * reload when the actor changes — key for validating the approval flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Inbox,
  Lock,
  MessageSquare,
  Table2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { confirmDialog } from '@/components/ui/dialogs';

import { Avatar, Tooltip } from '@/components/ui';
import { useSessionStore } from '@/store/useSessionStore';
import {
  addComment,
  getChangeset,
  getDiff,
  getPublished,
  listUsers,
  listVersions,
  reopen,
  review,
  withdraw,
} from '@/services/versioning.service';
import { listProjects } from '@/services/projects.service';
import type { Project } from '@/types/model';
import type {
  ChangesetDetail,
  ChangesetDiff,
  DiffEntity,
  DiffTreeNode,
  SimUserDto,
  VersionRow,
  VersionStatus,
} from '@/types/versioning';

// ── helpers ──────────────────────────────────────────────────────────────────

const AVATAR_TONES = ['blue', 'purple', 'green', 'navy'] as const;
/** Stable avatar tone from an id so a given user always gets the same color. */
function avatarTone(id: string): (typeof AVATAR_TONES)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Compact, locale-aware date for card meta / comments. */
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

interface StatusSpec {
  cls: string;
  text: string;
}
/** Maps a request status onto its badge (In review / Approved / Rejected). */
function statusBadge(status: VersionStatus): StatusSpec {
  switch (status) {
    case 'submitted':
      return { cls: 'dmh-rv-spill--review', text: 'In review' };
    case 'approved':
      return { cls: 'dmh-rv-spill--approved', text: 'Approved' };
    case 'rejected':
      return { cls: 'dmh-rv-spill--rejected', text: 'Rejected' };
    default:
      return { cls: 'dmh-rv-spill--draft', text: 'Editing' };
  }
}

// ── component ────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const openModel = useSessionStore((s) => s.openModel);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [published, setPublished] = useState<VersionRow | null>(null);
  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [listsLoading, setListsLoading] = useState(true);

  // Filters: From (requester/owner) + Reviewer (defaults to "Me", the actor).
  const [ownerFilter, setOwnerFilter] = useState('');
  const [reviewerFilter, setReviewerFilter] = useState(user.id);

  // Selection + detail.
  const selectedId = searchParams.get('id');
  const [detail, setDetail] = useState<ChangesetDetail | null>(null);
  const [diff, setDiff] = useState<ChangesetDiff | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  // Tras withdraw/reopen la versión volvió a draft y SALE de la lista: en vez de
  // auto-seleccionar en silencio otro request (que confunde: "Open in canvas"
  // abriría el request de OTRO), mostramos un empty-state con la vuelta al canvas.
  const [draftHint, setDraftHint] = useState<{ id: string; label: string | null } | null>(null);

  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  const userName = useCallback(
    (id?: string | null): string => {
      if (!id) return 'Unknown';
      return users.find((u) => u.id === id)?.name ?? id;
    },
    [users],
  );
  const userInitials = useCallback(
    (id?: string | null): string => {
      if (!id) return '?';
      return users.find((u) => u.id === id)?.initials ?? id.slice(0, 2).toUpperCase();
    },
    [users],
  );
  const projectName = useCallback(
    (id?: string | null): string => (id ? (projects.find((p) => p.id === id)?.name ?? id) : ''),
    [projects],
  );

  // When the actor changes, follow them with the "Reviewer: Me" default.
  useEffect(() => {
    setReviewerFilter((prev) => (prev === '' ? '' : user.id));
  }, [user.id]);

  // ── load the cross-project lists (reload when the actor changes) ────────────
  useEffect(() => {
    let cancelled = false;
    setListsLoading(true);
    Promise.all([listVersions(), getPublished(), listUsers(), listProjects()])
      .then(([vers, pub, us, proj]) => {
        if (cancelled) return;
        setVersions(vers);
        setPublished(pub);
        setUsers(us);
        setProjects(proj);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the requests.');
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // ── load the selected changeset detail + diff ───────────────────────────────
  const loadDetail = useCallback((id: string) => {
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([getChangeset(id), getDiff(id)])
      .then(([cs, df]) => {
        if (cancelled) return;
        setDetail(cs);
        setDiff(df);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDiff(null);
        toast.error(err instanceof Error ? err.message : 'Could not load this request.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload detail when the selection OR the actor changes (latter re-evaluates
  // reviewer permissions / approvals).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDiff(null);
      return;
    }
    setCommentText('');
    // Clear the previous request immediately so the detail panel shows its
    // skeleton while the new one loads (no stale content during the fetch).
    setDetail(null);
    setDiff(null);
    return loadDetail(selectedId);
  }, [selectedId, user.id, loadDetail]);

  const select = useCallback(
    (id: string) => {
      setDraftHint(null);
      const next = new URLSearchParams(searchParams);
      next.set('id', id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // ── the request list (submitted/approved/rejected, not the production base) ──
  const requestRows = useMemo(() => {
    return versions
      .filter((v) => v.status !== 'draft' && v.id !== published?.id)
      .filter((v) => !ownerFilter || v.owner === ownerFilter)
      .filter((v) => !reviewerFilter || v.reviewers.includes(reviewerFilter))
      .sort((a, b) => {
        const ta = Date.parse(a.submittedAt ?? a.updatedAt ?? a.createdAt ?? '') || 0;
        const tb = Date.parse(b.submittedAt ?? b.updatedAt ?? b.createdAt ?? '') || 0;
        return tb - ta;
      });
  }, [versions, published, ownerFilter, reviewerFilter]);

  // Auto-select the first request when nothing is selected (the design always
  // shows an open request on the right) — EXCEPT right after a withdraw/reopen,
  // where jumping to another request reads as "my request mutated into this one".
  useEffect(() => {
    if (!selectedId && !draftHint && requestRows.length > 0) select(requestRows[0].id);
  }, [selectedId, draftHint, requestRows, select]);

  // ── derived detail bits ─────────────────────────────────────────────────────
  const isReviewer = Boolean(detail && user.id && detail.reviewers.includes(user.id));
  const alreadyVoted = Boolean(detail && user.id && detail.approvals[user.id]);
  const canAct = Boolean(detail && detail.status === 'submitted' && isReviewer && !alreadyVoted);
  // El OWNER puede retirar su request mientras siga en revisión (para seguir
  // editando la versión y re-enviarla después).
  const canWithdraw = Boolean(detail && detail.status === 'submitted' && user.id && detail.owner === user.id);
  // El OWNER puede reabrir un request RECHAZADO (rejected → draft): el reject
  // nunca elimina la versión, sólo rechaza la solicitud.
  const canReopen = Boolean(detail && detail.status === 'rejected' && user.id && detail.owner === user.id);
  // Sólo el dueño de un DRAFT edita en el canvas; cualquier otro caso se abre
  // como visor (solo lectura) — la edición vuelve recién con Withdraw/Reopen.
  const isOwnDraft = Boolean(detail && detail.status === 'draft' && user.id && detail.owner === user.id);

  const reviewerNames = detail ? detail.reviewers.map(userName).join(', ') || '—' : '—';

  /** The assigned-reviewer note shown when the actor cannot act. */
  const noteText = useMemo(() => {
    if (!detail || canAct) return '';
    if (detail.status !== 'submitted') return `This request is ${detail.status}.`;
    if (!isReviewer)
      return `Only the assigned reviewer ${reviewerNames} can approve or reject this request. You can still leave a comment.`;
    if (alreadyVoted) return 'You already recorded your decision on this request.';
    return '';
  }, [detail, canAct, isReviewer, alreadyVoted, reviewerNames]);

  // Diff totals for the impact legend + "Changes · N" (+ conflictos vs producción).
  const diffTotals = useMemo(() => {
    let added = 0;
    let edited = 0;
    let deleted = 0;
    let conflicts = 0;
    if (diff)
      Object.values(diff.collections).forEach((b) => {
        added += b.added.length;
        edited += b.edited.length;
        deleted += b.deleted.length;
        conflicts += [...b.added, ...b.edited, ...b.deleted].filter((e) => e.conflict).length;
      });
    return { added, edited, deleted, conflicts, total: added + edited + deleted };
  }, [diff]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const doReview = async (decision: 'approve' | 'reject') => {
    if (!detail || acting) return;
    setActing(true);
    try {
      const updated = await review(detail.id, { decision });
      setDetail(updated);
      toast.success(decision === 'approve' ? 'Request approved.' : 'Request rejected.');
      void Promise.all([listVersions(), getPublished()])
        .then(([vers, pub]) => {
          setVersions(vers);
          setPublished(pub);
        })
        .catch(() => undefined);
      void getDiff(detail.id).then(setDiff).catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The decision could not be recorded.');
    } finally {
      setActing(false);
    }
  };

  const openInCanvas = () => {
    if (!detail) return;
    // Modo edición SÓLO para el dueño de un draft. Un request en revisión (o ya
    // decidido) se abre en SOLO LECTURA sobre su propio overlay: se ve el
    // contenido enviado, pero no se puede mutar ni re-publicar — antes este
    // camino ligaba el canvas en `editing` a un changeset no-draft y producía
    // 409 persistentes o re-submits que pisaban el envío.
    openModel({
      mode: isOwnDraft ? 'editing' : 'readonly',
      changesetId: detail.id,
      versionLabel: detail.versionLabel,
    });
    navigate('/model');
  };

  /** Post-withdraw/reopen: la versión volvió a draft — limpia selección y
   *  listas, y deja el empty-state con la vuelta directa al canvas. */
  const backToDraft = (id: string, label: string | null) => {
    setDraftHint({ id, label });
    setDetail(null);
    setDiff(null);
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    setSearchParams(next, { replace: true });
    void Promise.all([listVersions(), getPublished()])
      .then(([vers, pub]) => {
        setVersions(vers);
        setPublished(pub);
      })
      .catch(() => undefined);
  };

  /** Owner retira su request en revisión: vuelve a draft (reaparece en Open
   *  model → "Continue a working version") y sale de la lista de requests. */
  const doWithdraw = async () => {
    if (!detail || acting) return;
    const { id, versionLabel } = detail;
    setActing(true);
    try {
      const ok = await confirmDialog({
        title: 'Withdraw request',
        message: (
          <>
            The request goes back to <strong>draft</strong> so you can keep editing the version;
            reviewer decisions recorded so far are discarded. You can send it for approval again later.
          </>
        ),
        confirmLabel: 'Withdraw', cancelLabel: 'Cancel',
        action: () => withdraw(id),
      });
      if (!ok) return;
      toast.success('Request withdrawn — the version is a draft again.');
      backToDraft(id, versionLabel ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw the request.');
      // El fallo típico es una carrera (409: un revisor decidió antes): refresca
      // el detalle y las listas para no dejar botones sobre un estado que ya no existe.
      void loadDetail(id);
      void Promise.all([listVersions(), getPublished()])
        .then(([vers, pub]) => { setVersions(vers); setPublished(pub); })
        .catch(() => undefined);
    } finally {
      setActing(false);
    }
  };

  /** Owner reabre su request rechazado: rejected → draft para corregir y
   *  re-enviar (el reject nunca elimina la versión). */
  const doReopen = async () => {
    if (!detail || acting) return;
    const { id, versionLabel } = detail;
    setActing(true);
    try {
      const ok = await confirmDialog({
        title: 'Reopen as draft',
        message: (
          <>
            The rejected request goes back to <strong>draft</strong> so you can fix the version and
            send it for approval again. The recorded rejection is cleared; the version is never deleted.
          </>
        ),
        confirmLabel: 'Reopen', cancelLabel: 'Cancel',
        action: () => reopen(id),
      });
      if (!ok) return;
      toast.success('Request reopened — the version is a draft again.');
      backToDraft(id, versionLabel ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen the request.');
      void loadDetail(id);
      void Promise.all([listVersions(), getPublished()])
        .then(([vers, pub]) => { setVersions(vers); setPublished(pub); })
        .catch(() => undefined);
    } finally {
      setActing(false);
    }
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (!detail || !text || commentSending) return;
    setCommentSending(true);
    try {
      const updated = await addComment(detail.id, { text });
      setDetail(updated);
      setCommentText('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The comment could not be posted.');
    } finally {
      setCommentSending(false);
    }
  };

  const otherUsers = users.filter((u) => u.id !== user.id);

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="dmh-review">
      <div className="dmh-rv-panel">
        {/* header */}
        <div className="dmh-rv-phead">
          <div className="dmh-rv-phead-ico">
            <Inbox size={19} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="dmh-rv-phead-text">
            <div className="dmh-rv-phead-title">Requests · review &amp; approval</div>
            <div className="dmh-rv-phead-sub">
              Approve, reject or comment change requests — cross-project
            </div>
          </div>
          <button
            type="button"
            className="dmh-rv-phead-close"
            onClick={() => navigate('/')}
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.6} aria-hidden />
          </button>
        </div>

        <div className="dmh-rv-cols">
          {/* ── SECTION 1 · request list + filters ────────────────────── */}
          <div className="dmh-rv-list">
            <div className="dmh-rv-list-filters">
              <label className="dmh-rv-flt">
                <span className="lbl">From:</span>
                <select
                  className="dmh-rv-flt-sel"
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  aria-label="Filter by requester"
                >
                  <option value="">Anyone</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`dmh-rv-flt${reviewerFilter === user.id ? ' is-me' : ''}`}>
                <span className="lbl">Reviewer:</span>
                <select
                  className="dmh-rv-flt-sel"
                  value={reviewerFilter}
                  onChange={(e) => setReviewerFilter(e.target.value)}
                  aria-label="Filter by reviewer"
                >
                  <option value={user.id}>Me</option>
                  <option value="">Anyone</option>
                  {otherUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="dmh-rv-list-body">
              <div className="dmh-rv-list-count">{requestRows.length} requests</div>
              {listsLoading ? (
                <div className="dmh-rv-list-empty">Loading requests…</div>
              ) : requestRows.length === 0 ? (
                <div className="dmh-rv-list-empty">No requests match these filters.</div>
              ) : (
                requestRows.map((row) => {
                  const badge = statusBadge(row.status);
                  const assigned = row.reviewers.includes(user.id);
                  const reviewer = row.reviewers[0];
                  const cls = `dmh-rv-card${row.id === selectedId ? ' is-selected' : ''}`;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={cls}
                      onClick={() => select(row.id)}
                    >
                      <div className="dmh-rv-card-top">
                        <span className={`dmh-rv-spill ${badge.cls}`}>{badge.text}</span>
                        {assigned && <span className="dmh-rv-card-assigned">Assigned to you</span>}
                        <span className="dmh-rv-card-spacer" />
                        {row.versionLabel && (
                          <span className="dmh-rv-card-snap">snap · {row.versionLabel}</span>
                        )}
                      </div>
                      <div className="dmh-rv-card-name">{row.title ?? 'Untitled request'}</div>
                      <div className="dmh-rv-card-foot">
                        <Avatar
                          initials={userInitials(row.owner)}
                          tone={avatarTone(row.owner ?? row.id)}
                          size={18}
                        />
                        <span className="dmh-rv-card-uname">{userName(row.owner)}</span>
                        {reviewer && (
                          <>
                            <ArrowRight
                              size={13}
                              strokeWidth={1.5}
                              aria-hidden
                              className="dmh-rv-card-arrow"
                            />
                            <Avatar initials={userInitials(reviewer)} tone={avatarTone(reviewer)} size={18} />
                            <span className="dmh-rv-card-uname">{userName(reviewer)}</span>
                          </>
                        )}
                        <span className="dmh-rv-card-spacer" />
                        {row.projectIds[0] && (
                          <span className="dmh-rv-pchip">{projectName(row.projectIds[0])}</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── SECTION 2 · open request detail ───────────────────────── */}
          <div className="dmh-rv-detail">
            {!selectedId ? (
              <div className="dmh-rv-detail-empty">
                <div className="dmh-rv-detail-empty-ico">
                  <Inbox size={22} strokeWidth={1.5} aria-hidden />
                </div>
                <div className="dmh-rv-detail-empty-t">Select a request to review</div>
                <div className="dmh-rv-detail-empty-m">
                  Pick one on the left to see its impact, diff and comments.
                </div>
              </div>
            ) : detailLoading && !detail ? (
              <div className="dmh-rv-detail-loading">
                <div className="dmh-rv-skel" style={{ height: 24, width: '50%' }} />
                <div className="dmh-rv-skel" style={{ height: 18, width: '70%' }} />
                <div className="dmh-rv-skel" style={{ height: 80 }} />
                <div className="dmh-rv-skel" style={{ height: 60 }} />
              </div>
            ) : !detail ? (
              draftHint ? (
                <div className="dmh-rv-detail-empty">
                  <div className="dmh-rv-detail-empty-t">The version is a draft again</div>
                  <div className="dmh-rv-detail-empty-m">
                    {draftHint.label ?? 'Your version'} left the review queue. Keep editing it in the
                    canvas, or find it later under Open model → Continue.
                  </div>
                  <button
                    type="button"
                    className="dmh-rv-act dmh-rv-act--canvas"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      openModel({ mode: 'editing', changesetId: draftHint.id, versionLabel: draftHint.label });
                      navigate('/model');
                    }}
                  >
                    <ExternalLink size={14} strokeWidth={1.6} aria-hidden />
                    Continue editing in canvas
                  </button>
                </div>
              ) : (
                <div className="dmh-rv-detail-empty">
                  <div className="dmh-rv-detail-empty-t">Request not found</div>
                  <div className="dmh-rv-detail-empty-m">It may have been removed or is unavailable.</div>
                </div>
              )
            ) : (
              <>
                {/* detail header */}
                <div className="dmh-rv-dhead">
                  <div className="dmh-rv-dhead-row">
                    <div className="dmh-rv-dhead-main">
                      <div className="dmh-rv-dtitle-row">
                        <h1 className="dmh-rv-h1">{detail.title ?? 'Untitled request'}</h1>
                        {(() => {
                          const b = statusBadge(detail.status);
                          return <span className={`dmh-rv-spill ${b.cls}`}>{b.text}</span>;
                        })()}
                      </div>
                      <div className="dmh-rv-dmeta">
                        <Avatar
                          initials={userInitials(detail.owner)}
                          tone={avatarTone(detail.owner ?? detail.id)}
                          size={20}
                        />
                        <span>
                          From <strong>{userName(detail.owner)}</strong>
                        </span>
                        <span className="sep">·</span>
                        <span>snapshot of {detail.versionLabel ?? '—'}</span>
                        <span className="sep">·</span>
                        <span>{fmtDate(detail.submittedAt ?? detail.createdAt)}</span>
                        <span className="sep">·</span>
                        <span>
                          Reviewer <strong>{reviewerNames}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="dmh-rv-dactions">
                      <Tooltip
                        label={isOwnDraft
                          ? 'Open your working copy for editing'
                          : 'Opens read-only: the version is not a draft of yours — editing comes back with Withdraw / Reopen'}
                      >
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--canvas"
                          onClick={openInCanvas}
                        >
                          <ExternalLink size={14} strokeWidth={1.6} aria-hidden />
                          {isOwnDraft ? 'Open in canvas' : 'View in canvas'}
                        </button>
                      </Tooltip>
                      {canWithdraw && (
                        <Tooltip label="Back to draft to keep editing — reviewer decisions are discarded">
                          <button
                            type="button"
                            className="dmh-rv-act dmh-rv-act--withdraw"
                            onClick={doWithdraw}
                            disabled={acting}
                          >
                            <Undo2 size={14} strokeWidth={1.7} aria-hidden />
                            Withdraw
                          </button>
                        </Tooltip>
                      )}
                      {canReopen && (
                        <Tooltip label="Back to draft to fix the version and resubmit — a reject never deletes it">
                          <button
                            type="button"
                            className="dmh-rv-act dmh-rv-act--withdraw"
                            onClick={doReopen}
                            disabled={acting}
                          >
                            <Undo2 size={14} strokeWidth={1.7} aria-hidden />
                            Reopen as draft
                          </button>
                        </Tooltip>
                      )}
                      <button
                        type="button"
                        className="dmh-rv-act dmh-rv-act--comment"
                        onClick={() => document.getElementById('dmh-rv-comment-input')?.focus()}
                      >
                        <MessageSquare size={14} strokeWidth={1.6} aria-hidden />
                        Comment
                      </button>
                      {canAct ? (
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--reject"
                          onClick={() => doReview('reject')}
                          disabled={acting}
                        >
                          <X size={14} strokeWidth={1.7} aria-hidden />
                          Reject
                        </button>
                      ) : (
                        <Tooltip label={noteText || 'Unavailable'}>
                          <button type="button" className="dmh-rv-act dmh-rv-act--reject" disabled>
                            <X size={14} strokeWidth={1.7} aria-hidden />
                            Reject
                          </button>
                        </Tooltip>
                      )}
                      {canAct ? (
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--approve"
                          onClick={() => doReview('approve')}
                          disabled={acting}
                        >
                          <Check size={14} strokeWidth={1.9} aria-hidden />
                          Approve
                        </button>
                      ) : (
                        <Tooltip label={noteText || 'Unavailable'}>
                          <button type="button" className="dmh-rv-act dmh-rv-act--approve" disabled>
                            <Check size={14} strokeWidth={1.9} aria-hidden />
                            Approve
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {noteText && (
                    <div className="dmh-rv-note">
                      <Lock size={15} strokeWidth={1.5} aria-hidden />
                      <span>{noteText}</span>
                    </div>
                  )}

                  {diff && (
                    <div className="dmh-rv-impact">
                      <span className="dmh-rv-impact-chip">
                        <Table2 size={13} strokeWidth={1.5} aria-hidden />
                        {diff.impact.tablesTouched} tables
                      </span>
                      <span className="dmh-rv-impact-chip">{diff.impact.columnsTouched} columns</span>
                      <span className="dmh-rv-impact-chip">
                        <Boxes size={13} strokeWidth={1.5} aria-hidden />
                        {diff.impact.projectsAffected ?? detail.projectIds.length} projects affected
                      </span>
                      <span className="dmh-rv-impact-spacer" />
                      <span className="dmh-rv-impact-legend">
                        <span className="lg lg--add">
                          <span className="sq" />
                          {diffTotals.added} added
                        </span>
                        <span className="lg lg--mod">
                          <span className="sq" />
                          {diffTotals.edited} modified
                        </span>
                        <span className="lg lg--del">
                          <span className="sq" />
                          {diffTotals.deleted} deleted
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {/* detail body */}
                <div className="dmh-rv-dbody">
                  {detail.description && (
                    <div className="dmh-rv-note-card">
                      <div className="dmh-rv-note-card-head">
                        <Avatar
                          initials={userInitials(detail.owner)}
                          tone={avatarTone(detail.owner ?? detail.id)}
                          size={22}
                        />
                        <span className="dmh-rv-note-card-name">{userName(detail.owner)}</span>
                        <span className="dmh-rv-note-card-role">requester</span>
                        <span className="dmh-rv-note-card-spacer" />
                        <span className="dmh-rv-note-card-at">
                          {fmtDate(detail.submittedAt ?? detail.createdAt)}
                        </span>
                      </div>
                      <div className="dmh-rv-note-card-text">{detail.description}</div>
                    </div>
                  )}

                  {diffTotals.conflicts > 0 && (
                    <div className="dmh-rv-note" role="alert">
                      <TriangleAlert size={15} strokeWidth={1.7} aria-hidden />
                      <span>
                        <strong>{diffTotals.conflicts}</strong> {diffTotals.conflicts === 1 ? 'entity in this request was' : 'entities in this request were'} modified
                        in production after this version edited {diffTotals.conflicts === 1 ? 'it' : 'them'} — approving will overwrite those production changes.
                      </span>
                    </div>
                  )}

                  <div className="dmh-rv-changes-label">Changes · {diffTotals.total}</div>
                  <DiffBody diff={diff} />

                  {/* reviewer comments */}
                  <div className="dmh-rv-comments">
                    <div className="dmh-rv-comments-title">Reviewer comments</div>
                    {detail.comments.map((c, i) => (
                      <div key={`${c.author}-${c.at ?? i}`} className="dmh-rv-comment">
                        <Avatar initials={userInitials(c.author)} tone={avatarTone(c.author)} size={26} />
                        <div className="dmh-rv-comment-body">
                          <div className="dmh-rv-comment-meta">
                            <span className="dmh-rv-comment-author">{userName(c.author)}</span>
                            {detail.reviewers.includes(c.author) && (
                              <span className="dmh-rv-comment-role">reviewer</span>
                            )}
                            <span className="dmh-rv-comment-spacer" />
                            <span className="dmh-rv-comment-at">{fmtDate(c.at)}</span>
                          </div>
                          <div className="dmh-rv-comment-text">{c.text}</div>
                        </div>
                      </div>
                    ))}
                    <div className="dmh-rv-comment-form">
                      <Avatar initials={userInitials(user.id)} tone={avatarTone(user.id)} size={26} />
                      <input
                        id="dmh-rv-comment-input"
                        className="dmh-rv-comment-input"
                        placeholder="Add a comment…"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void submitComment();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="dmh-rv-comment-send"
                        onClick={() => void submitComment()}
                        disabled={!commentText.trim() || commentSending}
                      >
                        {commentSending ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── diff body (added / modified / deleted cards) ─────────────────────────────

/** Label legible por colección versionada (el detalle agrupa por tipo de entidad). */
const COLL_LBL: Record<string, string> = {
  canonical_tables: 'Table',
  canonical_columns: 'Column',
  relationships: 'Relationship',
  views: 'View',
  parent_domains: 'Parent Domain',
  abbreviation_dict: 'UDP term',
};

// Render por páginas: un changeset grande (migración/refactor) puede tocar
// miles de entidades — montar una card por cada una congela la pantalla.
const DIFF_PAGE = 100;

const CHANGE_PILL: Record<string, string> = { added: 'added', edited: 'modified', deleted: 'deleted' };
const TYPE_LABEL: Record<string, string> = {
  project: 'Project', folder: 'Folder', canvas: 'Canvas', schema: 'Schema',
  table: 'Table', view: 'View', column: 'Column',
};
const TREE_TYPE_STYLE: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px',
  color: 'var(--subtle)', minWidth: 46, flex: 'none',
};

function DiffBody({ diff }: { diff: ChangesetDiff | null }) {
  // Tablas colapsadas por default (concentran el grueso: las columnas).
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(DIFF_PAGE);
  const toggle = (k: string) =>
    setOpenTables((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const flat = useMemo(() => {
    if (!diff) return [];
    const out: { kind: 'added' | 'edited' | 'deleted'; entity: DiffEntity }[] = [];
    Object.values(diff.collections).forEach((bucket) => {
      bucket.added.forEach((entity) => out.push({ kind: 'added', entity }));
      bucket.edited.forEach((entity) => out.push({ kind: 'edited', entity }));
      bucket.deleted.forEach((entity) => out.push({ kind: 'deleted', entity }));
    });
    return out;
  }, [diff]);
  useEffect(() => { setShown(DIFF_PAGE); setOpenTables(new Set()); }, [diff]);

  if (!diff) return <div className="dmh-rv-diff-empty">Loading diff…</div>;

  const tree = diff.tree ?? [];
  const orphans = diff.orphans ?? [];
  const structure = diff.structure ?? [];
  const hasHierarchy = tree.length > 0 || orphans.length > 0 || structure.length > 0;

  // ── Render jerárquico (Proyecto→Folder→Canvas→Esquema→Tabla→Columnas) ──
  const renderNode = (node: DiffTreeNode, depth: number, path: string): React.ReactNode => {
    const key = `${path}/${node.type}:${node.id}`;
    const kids = node.children ?? [];
    const isTable = node.type === 'table';
    const collapsible = isTable && kids.length > 0;
    const expanded = !isTable || openTables.has(key);
    return (
      <div key={key}>
        <div
          className="dmh-rv-treerow"
          style={{
            display: 'flex', alignItems: 'center', gap: 7, minHeight: 27,
            paddingLeft: 8 + depth * 15, paddingRight: 8,
            borderBottom: '1px solid var(--border-soft)',
            cursor: collapsible ? 'pointer' : 'default',
          }}
          onClick={collapsible ? () => toggle(key) : undefined}
          role={collapsible ? 'button' : undefined}
        >
          {collapsible
            ? (expanded ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />)
            : <span style={{ width: 13, flex: 'none' }} />}
          <span style={TREE_TYPE_STYLE}>{TYPE_LABEL[node.type] ?? node.type}</span>
          <span
            className={`mono${node.change === 'deleted' ? ' strike' : ''}`}
            style={{ fontSize: 12.5, color: node.change ? 'var(--ink)' : 'var(--muted)', fontWeight: node.change ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {node.name}
          </span>
          {node.change && <span className={`dmh-rv-diffrow-pill is-${node.change}`}>{CHANGE_PILL[node.change]}</span>}
          {isTable && kids.length > 0 && (
            <span style={{ fontSize: 10.5, color: 'var(--subtle)', marginLeft: 'auto', flex: 'none' }}>
              {kids.length} col{kids.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {expanded && kids.map((c) => renderNode(c, depth + 1, key))}
      </div>
    );
  };

  const section = (label: string) => (
    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--subtle)', padding: '10px 8px 4px' }}>{label}</div>
  );

  if (hasHierarchy) {
    return (
      <div className="dmh-rv-diff">
        {tree.map((n) => renderNode(n, 0, ''))}
        {orphans.length > 0 && (<>{section('Not on any canvas')}{orphans.map((n) => renderNode(n, 0, 'orphan'))}</>)}
        {structure.length > 0 && (<>
          {section('Structure changes')}
          {structure.map((s) => (
            <div key={`${s.type}:${s.id}`} className="dmh-rv-treerow"
              style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 27, paddingLeft: 8, paddingRight: 8, borderBottom: '1px solid var(--border-soft)' }}>
              <span style={{ width: 13, flex: 'none' }} />
              <span style={TREE_TYPE_STYLE}>{s.kind}</span>
              <span className={`mono${s.change === 'deleted' ? ' strike' : ''}`} style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{s.name}</span>
              <span className={`dmh-rv-diffrow-pill is-${s.change}`}>{CHANGE_PILL[s.change]}</span>
            </div>
          ))}
        </>)}
      </div>
    );
  }

  // ── Fallback plano (backend viejo / sin jerarquía) ──
  if (flat.length === 0)
    return <div className="dmh-rv-diff-empty">No structural changes in this request.</div>;
  const meta: Record<'added' | 'edited' | 'deleted', { pill: string; verb: string }> = {
    added: { pill: 'added', verb: 'added' },
    edited: { pill: 'modified', verb: 'modified' },
    deleted: { pill: 'deleted', verb: 'deleted' },
  };
  return (
    <div className="dmh-rv-diff">
      {flat.slice(0, shown).map(({ kind, entity }) => {
        const m = meta[kind];
        return (
          <div key={`${kind}-${entity.id}`} className={`dmh-rv-diffrow is-${kind}`}>
            <div className="dmh-rv-diffrow-head">
              <span className="dmh-rv-diffrow-name">
                <span className={`mono${kind === 'deleted' ? ' strike' : ''}`}>{entity.name}</span> {m.verb}
              </span>
              <span className={`dmh-rv-diffrow-pill is-${kind}`}>{m.pill}</span>
              {entity.conflict && (
                <span className="dmh-rv-diffrow-conflict" title="Modified in production after this version edited it.">
                  <TriangleAlert size={11} strokeWidth={1.8} aria-hidden /> changed in production
                </span>
              )}
              <span className="dmh-rv-diffrow-spacer" />
              {entity.collection && (
                <span className="dmh-rv-diffrow-coll">{COLL_LBL[entity.collection] ?? entity.collection}</span>
              )}
            </div>
          </div>
        );
      })}
      {flat.length > shown && (
        <button type="button" className="dmh-rv-act" style={{ margin: '8px auto' }} onClick={() => setShown((n) => n + DIFF_PAGE)}>
          Show {Math.min(DIFF_PAGE, flat.length - shown)} more ({flat.length - shown} remaining)
        </button>
      )}
    </div>
  );
}
