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
  Check,
  Database,
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
import { runBlocking } from '@/store/useBusyStore';
import {
  publishBlockedDetail,
  addComment,
  getChangeset,
  getDiff,
  listUsers,
  listVersions,
  reopen,
  review,
  withdraw,
} from '@/services/versioning.service';
import { listProjects } from '@/services/projects.service';
import { sortProjects } from '@/lib/projects';
import ChangesDetailModal from '@/screens/review/ChangesDetailModal';
import ChangesSummary from '@/screens/review/ChangesSummary';
import PublishBlockedPanel from '@/screens/review/PublishBlockedPanel';
import CriticalDeletionBlock from '@/screens/review/CriticalDeletionBlock';
import ApproveDeletionDialog from '@/screens/review/ApproveDeletionDialog';
import RejectDialog from '@/screens/review/RejectDialog';
import RequestHistory from '@/screens/review/RequestHistory';
import { activityAt, historyOf, isRequest, outcomeOf, requestBadge } from '@/screens/review/requestState';
import { conflictCounts } from '@/screens/review/conflicts';
import type { Project } from '@/types/model';
import type {
  PublishBlockedDetail,
  ChangesetDetail,
  ChangesetDiff,
  RequestOutcome,
  SimUserDto,
  VersionRow,
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

/** Doc 88 §6: chips de resultado de la bandeja (All por defecto). */
const OUTCOME_CHIPS: { key: 'all' | RequestOutcome; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

// ── component ────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const openModel = useSessionStore((s) => s.openModel);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [listsLoading, setListsLoading] = useState(true);

  // Filters: From (requester/owner) + Reviewer (defaults to "Me", the actor)
  // + Project (doc 75 D20: bandeja global, proyecto siempre diferenciado).
  const [ownerFilter, setOwnerFilter] = useState('');
  const [reviewerFilter, setReviewerFilter] = useState(user.id);
  const [projectFilter, setProjectFilter] = useState('');
  // Doc 88 §6: la bandeja muestra TODAS las solicitudes (cualquier resultado)
  // por defecto; el chip acota por resultado del último ciclo.
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | RequestOutcome>('all');
  // Doc 88 §5: rechazar pasa por un diálogo con el motivo obligatorio.
  const [rejectOpen, setRejectOpen] = useState(false);
  // Doc 75 D5: aprobar un request que borra su proyecto exige confirmación tipeada.
  const [approveDeletionOpen, setApproveDeletionOpen] = useState(false);

  // Selection + detail.
  const selectedId = searchParams.get('id');
  const [detail, setDetail] = useState<ChangesetDetail | null>(null);
  const [diff, setDiff] = useState<ChangesetDiff | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  // Popup "Change details" (doc 31) — se cierra solo al cambiar de request.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Doc 84 A1: publish bloqueado (409/422 estructurado del approve) — panel
  // persistente con la lista completa; se limpia al cambiar de request.
  const [blocked, setBlocked] = useState<PublishBlockedDetail | null>(null);
  useEffect(() => { setBlocked(null); }, [selectedId]);
  // Tras withdraw/reopen la versión volvió a draft y SALE de la lista: en vez de
  // auto-seleccionar en silencio otro request (que confunde: "Open in canvas"
  // abriría el request de OTRO), mostramos un empty-state con la vuelta al canvas.
  const [draftHint, setDraftHint] = useState<{ id: string; projectId: string; label: string | null } | null>(null);

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
    Promise.all([listVersions(), listUsers(), listProjects()])
      .then(([vers, us, proj]) => {
        if (cancelled) return;
        setVersions(vers);
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
    setDetailsOpen(false);
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

  // ── the request list (doc 88 §6): every version that was EVER sent for
  //    review (its history survives withdraw / reject / publish), filtered by
  //    requester, reviewer, project and outcome; pending first, then by activity ──
  const allRequests = useMemo(() => {
    return versions
      .filter(isRequest)
      .filter((v) => !ownerFilter || v.owner === ownerFilter)
      .filter((v) => !reviewerFilter || v.reviewers.includes(reviewerFilter))
      .filter((v) => !projectFilter || v.projectId === projectFilter);
  }, [versions, ownerFilter, reviewerFilter, projectFilter]);
  const outcomeCounts = useMemo(() => {
    const m: Record<string, number> = { all: allRequests.length };
    allRequests.forEach((v) => { const o = outcomeOf(v) ?? 'pending'; m[o] = (m[o] ?? 0) + 1; });
    return m;
  }, [allRequests]);
  const requestRows = useMemo(() => {
    return allRequests
      .filter((v) => outcomeFilter === 'all' || (outcomeOf(v) ?? 'pending') === outcomeFilter)
      .sort((a, b) => {
        const pa = outcomeOf(a) === 'pending' ? 0 : 1;
        const pb = outcomeOf(b) === 'pending' ? 0 : 1;
        return pa - pb || activityAt(b) - activityAt(a);
      });
  }, [allRequests, outcomeFilter]);

  // Auto-select the first request when nothing is selected (the design always
  // shows an open request on the right) — EXCEPT right after a withdraw/reopen,
  // where jumping to another request reads as "my request mutated into this one".
  useEffect(() => {
    if (!selectedId && !draftHint && requestRows.length > 0) select(requestRows[0].id);
  }, [selectedId, draftHint, requestRows, select]);

  // ── derived detail bits ─────────────────────────────────────────────────────
  const isReviewer = Boolean(detail && user.id && detail.reviewers.includes(user.id));
  const alreadyVoted = Boolean(detail && user.id && detail.approvals[user.id]);
  // Doc 88 §6: sólo un ciclo EN REVISIÓN admite acciones y comentarios; una
  // solicitud cerrada (aprobada, rechazada → draft, retirada) se lee nomás.
  const isOpenRequest = Boolean(detail && detail.status === 'submitted');
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
    if (detail.status !== 'submitted') {
      const o = outcomeOf({ status: detail.status, lastRequest: detail.requests?.at(-1) ?? null, appliedAt: detail.appliedAt });
      if (o === 'rejected' && detail.status === 'draft') return 'This request was rejected — the version is back in draft for its owner to fix and resubmit.';
      if (o === 'withdrawn') return 'This request was withdrawn by its owner — the version is a draft again.';
      if (o === 'approved') return detail.appliedAt ? 'This request was approved and published.' : 'This request was approved and is being published.';
      return `This request is ${detail.status}.`;
    }
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
    if (diff)
      Object.values(diff.collections).forEach((b) => {
        added += b.added.length;
        edited += b.edited.length;
        deleted += b.deleted.length;
      });
    const conflicts = diff ? conflictCounts(diff) : { overwrites: 0, restores: 0, total: 0 };
    return { added, edited, deleted, conflicts, total: added + edited + deleted };
  }, [diff]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const deletesProject = diff?.impact.deletesProject ?? null;
  const doReview = async (decision: 'approve' | 'reject', note?: string) => {
    if (!detail || acting) return;
    setActing(true);
    try {
      const title = decision === 'approve' && deletesProject
        ? 'Applying decision… deleting the project'
        : 'Applying decision…';
      const updated = await runBlocking(title, () => review(detail.id, note ? { decision, note } : { decision }));
      setDetail(updated);
      setBlocked(null);
      toast.success(decision === 'approve' ? 'Request approved.' : 'Request rejected — the version is back in draft for its owner.');
      void listVersions().then(setVersions).catch(() => undefined);
      void getDiff(detail.id).then(setDiff).catch(() => undefined);
    } catch (err) {
      // Doc 84 A1: un publish bloqueado llega estructurado → panel persistente
      // con la lista completa; el toast sólo avisa (el bloqueo en sí no cambió).
      const blockedDetail = publishBlockedDetail(err);
      if (blockedDetail) {
        setBlocked(blockedDetail);
        toast.error('Publish blocked — nothing was published. See the details on this page.');
      } else {
        toast.error(err instanceof Error ? err.message : 'The decision could not be recorded.');
      }
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
      projectId: detail.projectId,
      mode: isOwnDraft ? 'editing' : 'readonly',
      changesetId: detail.id,
      versionLabel: detail.versionLabel,
    });
    navigate('/model');
  };

  /** Post-withdraw/reopen: la versión volvió a draft — limpia selección y
   *  listas, y deja el empty-state con la vuelta directa al canvas. */
  const backToDraft = (id: string, projectId: string, label: string | null) => {
    setDraftHint({ id, projectId, label });
    setDetail(null);
    setDiff(null);
    setBlocked(null);
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    setSearchParams(next, { replace: true });
    void listVersions().then(setVersions).catch(() => undefined);
  };

  /** Owner retira su request en revisión: vuelve a draft (reaparece en Open
   *  model → "Continue a working version") y sale de la lista de requests. */
  const doWithdraw = async () => {
    if (!detail || acting) return;
    const { id, projectId, versionLabel } = detail;
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
        action: () => runBlocking('Applying decision…', () => withdraw(id)),
      });
      if (!ok) return;
      toast.success('Request withdrawn — the version is a draft again.');
      backToDraft(id, projectId, versionLabel ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw the request.');
      // El fallo típico es una carrera (409: un revisor decidió antes): refresca
      // el detalle y las listas para no dejar botones sobre un estado que ya no existe.
      void loadDetail(id);
      void listVersions().then(setVersions).catch(() => undefined);
    } finally {
      setActing(false);
    }
  };

  /** Owner reabre su request rechazado: rejected → draft para corregir y
   *  re-enviar (el reject nunca elimina la versión). */
  const doReopen = async () => {
    if (!detail || acting) return;
    const { id, projectId, versionLabel } = detail;
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
        action: () => runBlocking('Applying decision…', () => reopen(id)),
      });
      if (!ok) return;
      toast.success('Request reopened — the version is a draft again.');
      backToDraft(id, projectId, versionLabel ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen the request.');
      void loadDetail(id);
      void listVersions().then(setVersions).catch(() => undefined);
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
              <label className="dmh-rv-flt">
                <span className="lbl">Project:</span>
                <select
                  className="dmh-rv-flt-sel"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  aria-label="Filter by project"
                >
                  <option value="">All projects</option>
                  {sortProjects(projects).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Doc 88 §6: resultado del último ciclo — All por defecto */}
            <div className="dmh-rv-chips" role="tablist" aria-label="Filter by outcome">
              {OUTCOME_CHIPS.map((c) => (
                <button
                  key={c.key} type="button" role="tab" aria-selected={outcomeFilter === c.key}
                  className={`dmh-rv-chip${outcomeFilter === c.key ? ' is-on' : ''}`}
                  onClick={() => setOutcomeFilter(c.key)}
                >
                  {c.label}<span className="dmh-rv-chip-n">{outcomeCounts[c.key] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="dmh-rv-list-body">
              <div className="dmh-rv-list-count">{requestRows.length} requests</div>
              {listsLoading ? (
                <div className="dmh-rv-list-empty">Loading requests…</div>
              ) : requestRows.length === 0 ? (
                <div className="dmh-rv-list-empty">No requests match these filters.</div>
              ) : (
                requestRows.map((row) => {
                  const badge = requestBadge(row);
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
                        {row.deletesProject && <span className="dmh-rv-spill dmh-rv-spill--critical">Deletes project</span>}
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
                        <span className="dmh-rv-pchip" title="Project">
                          <Database size={11} strokeWidth={1.6} aria-hidden />
                          {projectName(row.projectId)}
                        </span>
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
                      openModel({ projectId: draftHint.projectId, mode: 'editing', changesetId: draftHint.id, versionLabel: draftHint.label });
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
                          const b = requestBadge({ status: detail.status, lastRequest: detail.requests?.at(-1) ?? null, appliedAt: detail.appliedAt });
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
                        <span>
                          Project <strong>{projectName(detail.projectId)}</strong>
                        </span>
                        <span className="sep">·</span>
                        <span>snapshot of {detail.versionLabel ?? '—'}</span>
                        {diff?.lastChangeAt && (
                          <>
                            <span className="sep">·</span>
                            <span title="When the owner recorded the last change of this request">
                              last change {fmtDate(diff.lastChangeAt)}
                            </span>
                          </>
                        )}
                        <span className="sep">·</span>
                        <span>{fmtDate(detail.submittedAt ?? detail.createdAt)}</span>
                        <span className="sep">·</span>
                        <span>
                          Reviewer <strong>{reviewerNames}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="dmh-rv-dactions">
                      {/* Doc 88 §6: una solicitud cerrada no se abre desde acá (evita
                          conflictos con la versión que sigue su vida); el owner de un
                          draft rechazado sí sigue editando la suya. */}
                      <Tooltip
                        label={isOwnDraft
                          ? 'Open your working copy for editing'
                          : isOpenRequest
                            ? 'Opens read-only: the version is not a draft of yours — editing comes back with Withdraw'
                            : 'This request is closed — open the version from Home › Versions'}
                      >
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--canvas"
                          onClick={openInCanvas}
                          disabled={!isOpenRequest && !isOwnDraft}
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
                      {isOpenRequest && (
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--comment"
                          onClick={() => document.getElementById('dmh-rv-comment-input')?.focus()}
                        >
                          <MessageSquare size={14} strokeWidth={1.6} aria-hidden />
                          Comment
                        </button>
                      )}
                      {canAct ? (
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--reject"
                          onClick={() => setRejectOpen(true)}
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
                          onClick={() => (deletesProject ? setApproveDeletionOpen(true) : doReview('approve'))}
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
                  {blocked && (
                    <PublishBlockedPanel
                      detail={blocked}
                      ownerName={userName(detail.owner)}
                      isOwner={detail.owner === user.id}
                      onWithdraw={canWithdraw ? () => void doWithdraw() : undefined}
                      onDismiss={() => setBlocked(null)}
                      userName={userName}
                    />
                  )}
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

                  {/* Doc 88 §6: historial de ciclos (motivo del rechazo incluido) */}
                  <RequestHistory rows={historyOf(detail)} userName={userName} userInitials={userInitials} avatarTone={avatarTone} />

                  {diffTotals.conflicts.total > 0 && (
                    <div className="dmh-rv-note" role="alert">
                      <TriangleAlert size={15} strokeWidth={1.7} aria-hidden />
                      <span>
                        {diffTotals.conflicts.overwrites > 0 && (
                          <>
                            <strong>{diffTotals.conflicts.overwrites}</strong> {diffTotals.conflicts.overwrites === 1 ? 'entity in this request was' : 'entities in this request were'} modified
                            in production after this version edited {diffTotals.conflicts.overwrites === 1 ? 'it' : 'them'} — approving will overwrite those production changes.
                          </>
                        )}
                        {/* Doc 100 (P3): lo que otra versión borró vuelve al aprobar. */}
                        {diffTotals.conflicts.restores > 0 && (
                          <>
                            {diffTotals.conflicts.overwrites > 0 ? ' ' : ''}
                            <strong>{diffTotals.conflicts.restores}</strong> {diffTotals.conflicts.restores === 1 ? 'entity in this request was' : 'entities in this request were'} deleted
                            in production after this version was opened — approving will restore {diffTotals.conflicts.restores === 1 ? 'it' : 'them'}.
                          </>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Doc 75 D5/D20: el request borra su proyecto — aviso crítico. */}
                  {deletesProject && <CriticalDeletionBlock deletes={deletesProject} />}

                  {/* Resumen (doc 31) — el detalle fino vive en el popup */}
                  <ChangesSummary diff={diff} onOpenDetails={() => setDetailsOpen(true)} />

                  {detailsOpen && diff && (
                    <ChangesDetailModal
                      csId={detail.id}
                      title={detail.title}
                      versionLabel={detail.versionLabel ?? null}
                      diff={diff}
                      ownerName={userName(detail.owner)}
                      onClose={() => setDetailsOpen(false)}
                    />
                  )}

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
                    {!isOpenRequest && (
                      <div className="dmh-rv-comments-closed">This request is closed — the thread is read-only. Comments reopen with the next submission.</div>
                    )}
                    {isOpenRequest && (
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
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <RejectDialog
        open={rejectOpen} title={detail?.title ?? detail?.versionLabel ?? null} busy={acting}
        onCancel={() => setRejectOpen(false)}
        onConfirm={(note) => { setRejectOpen(false); void doReview('reject', note); }}
      />
      {deletesProject && (
        <ApproveDeletionDialog
          open={approveDeletionOpen}
          deletes={deletesProject}
          onCancel={() => setApproveDeletionOpen(false)}
          onConfirm={() => { setApproveDeletionOpen(false); void doReview('approve'); }}
        />
      )}
    </div>
  );
}

// El viejo DiffBody inline (árbol + fallback plano) se movió al popup
// "Change details" (doc 31): screens/review/DiffTree.tsx + ChangesDetailModal.
