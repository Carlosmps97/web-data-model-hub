/**
 * ReviewScreen (p5) — Review & publish / Versioning, CROSS-PROJECT.
 *
 * Layout (per design #p5):
 *   · breadcrumb "All projects / Change history" (globe)
 *   · filters: by requester (owner) + by approver (reviewer)
 *   · versions table (grid 80 / 1.4fr / 1fr / 1fr / 150; production row green,
 *     selected row blue) — data: listVersions() + getPublished()
 *   · body: version-card rail (left) + detail panel (right). Selecting a version
 *     (or arriving with `?id=`) loads getChangeset(id) + getDiff(id) and renders
 *     the approval stepper, impact summary, diff panel, actions, and comments.
 *
 * The actor comes from useSessionStore (injects X-Dev-User). Approve/Reject are
 * disabled (with tooltip) when the actor is NOT in `reviewers`; on 403 we toast.
 * Lists + detail reload when the actor changes — key for validating the flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Globe,
  GitCompare,
  MessageSquare,
  X,
} from 'lucide-react';

import { Avatar, Tooltip } from '@/components/ui';
import { useSessionStore } from '@/store/useSessionStore';
import {
  addComment,
  getChangeset,
  getDiff,
  getPublished,
  listUsers,
  listVersions,
  review,
} from '@/services/versioning.service';
import { listProjects } from '@/services/projects.service';
import type { Project } from '@/types/model';
import type {
  ChangesetDetail,
  ChangesetDiff,
  DiffEntity,
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

/** Compact, locale-aware date for table rows / card meta. */
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

interface CardPillSpec {
  cls: string;
  text: string;
}
/** Maps a status (+ production flag) onto the version-card status pill. */
function cardPill(status: VersionStatus, isProduction: boolean): CardPillSpec {
  if (isProduction) return { cls: 'dmh-rv-spill--published', text: 'Published · global' };
  switch (status) {
    case 'submitted':
      return { cls: 'dmh-rv-spill--review', text: 'In review' };
    case 'draft':
      return { cls: 'dmh-rv-spill--draft', text: 'Editing' };
    case 'rejected':
      return { cls: 'dmh-rv-spill--rejected', text: 'Rejected' };
    case 'approved':
      return { cls: 'dmh-rv-spill--historical', text: 'Historical' };
    default:
      return { cls: 'dmh-rv-spill--draft', text: status };
  }
}

type StepState = 'completed' | 'current' | 'pending' | 'rejected';
interface Step {
  key: string;
  label: string;
  mono?: string;
  state: StepState;
}

/**
 * Derives the approval stepper from the changeset:
 *   Submitted → (one step per reviewer) → Published.
 * - Submitted: completed once the changeset has been submitted (not a draft).
 * - Reviewer steps: approved → completed, rejected → rejected; the first pending
 *   reviewer of a submitted changeset is the `current` step, the rest pending.
 * - Published: completed when status==='approved'; `current` once every reviewer
 *   approved (awaiting publish); pending otherwise.
 */
function deriveSteps(cs: ChangesetDetail, userName: (id?: string | null) => string): Step[] {
  const submitted = cs.status !== 'draft';
  const isApproved = cs.status === 'approved';
  const isRejected = cs.status === 'rejected';

  const steps: Step[] = [
    {
      key: 'submitted',
      label: 'Submitted for review',
      state: submitted ? 'completed' : 'current',
    },
  ];

  let currentAssigned = false;
  cs.reviewers.forEach((rid) => {
    const verdict = cs.approvals[rid]?.status;
    let state: StepState;
    if (verdict === 'approved') state = 'completed';
    else if (verdict === 'rejected') state = 'rejected';
    else if (submitted && !isApproved && !isRejected && !currentAssigned) {
      state = 'current';
      currentAssigned = true;
    } else {
      state = 'pending';
    }
    steps.push({ key: `rev-${rid}`, label: `Review · ${userName(rid)}`, state });
  });

  const everyApproved =
    cs.reviewers.length > 0 && cs.reviewers.every((rid) => cs.approvals[rid]?.status === 'approved');
  steps.push({
    key: 'published',
    label: 'Publish',
    mono: cs.versionLabel ?? undefined,
    state: isApproved
      ? 'completed'
      : everyApproved && submitted && !isRejected
        ? 'current'
        : 'pending',
  });

  return steps;
}

/** Splits a column-ish entity name into chips for the diff row (best-effort). */
function colChips(entity: DiffEntity): string[] {
  // Backend may pack columns into `name`; keep it as a single chip otherwise.
  return [entity.name];
}

// ── component ────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useSessionStore((s) => s.user);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [published, setPublished] = useState<VersionRow | null>(null);
  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [listsLoading, setListsLoading] = useState(true);

  // Filters (by requester / approver).
  const [ownerFilter, setOwnerFilter] = useState('');
  const [reviewerFilter, setReviewerFilter] = useState('');

  // Selection + detail.
  const selectedId = searchParams.get('id');
  const [detail, setDetail] = useState<ChangesetDetail | null>(null);
  const [diff, setDiff] = useState<ChangesetDiff | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);

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
    (id: string): string => projects.find((p) => p.id === id)?.name ?? id,
    [projects],
  );

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
        toast.error(err instanceof Error ? err.message : 'Could not load the change history.');
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
        toast.error(err instanceof Error ? err.message : 'Could not load this change.');
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
    return loadDetail(selectedId);
  }, [selectedId, user.id, loadDetail]);

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('id', id);
    setSearchParams(next, { replace: true });
  };

  // ── derive the table rows (published first, then everything else) ───────────
  const tableRows = useMemo(() => {
    const matchesFilters = (v: VersionRow) =>
      (!ownerFilter || v.owner === ownerFilter) &&
      (!reviewerFilter || v.reviewers.includes(reviewerFilter));

    const out: { row: VersionRow; isProduction: boolean }[] = [];
    if (published && matchesFilters(published)) out.push({ row: published, isProduction: true });
    versions
      .filter((v) => v.id !== published?.id && matchesFilters(v))
      .forEach((v) => out.push({ row: v, isProduction: false }));
    return out;
  }, [versions, published, ownerFilter, reviewerFilter]);

  const filtersActive = Boolean(ownerFilter || reviewerFilter);

  // ── derived detail bits ─────────────────────────────────────────────────────
  const isReviewer = Boolean(detail && user.id && detail.reviewers.includes(user.id));
  const alreadyVoted = Boolean(detail && user.id && detail.approvals[user.id]);
  const canAct = Boolean(detail && detail.status === 'submitted' && isReviewer && !alreadyVoted);
  const actDisabledReason = !detail
    ? ''
    : detail.status !== 'submitted'
      ? `This change is ${detail.status}; no decision is needed.`
      : !isReviewer
        ? 'Only assigned reviewers can approve or reject this change.'
        : alreadyVoted
          ? 'You have already recorded a decision on this change.'
          : '';

  const steps = useMemo(
    () => (detail ? deriveSteps(detail, userName) : []),
    [detail, userName],
  );

  // ── actions ─────────────────────────────────────────────────────────────────
  const doReview = async (decision: 'approve' | 'reject') => {
    if (!detail || acting) return;
    setActing(true);
    try {
      const updated = await review(detail.id, { decision });
      setDetail(updated);
      toast.success(decision === 'approve' ? 'Change approved.' : 'Change rejected.');
      // Refresh the cross-project lists so the table/cards reflect the new state.
      void Promise.all([listVersions(), getPublished()])
        .then(([vers, pub]) => {
          setVersions(vers);
          setPublished(pub);
        })
        .catch(() => undefined);
      // Re-fetch the diff (impact may shift once published).
      void getDiff(detail.id).then(setDiff).catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The decision could not be recorded.');
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

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="dmh-review">
      <div className="dmh-review-inner">
        {/* breadcrumb */}
        <div className="dmh-rv-crumb">
          <Globe size={14} strokeWidth={1.4} aria-hidden />
          All projects <span className="sep">/</span>
          <span className="leaf">Change history</span>
        </div>

        {/* filters */}
        <div className="dmh-rv-filters">
          <div className="dmh-rv-filter">
            <span className="dmh-rv-filter-label">Requester</span>
            <select
              className="dmh-rv-select"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              aria-label="Filter by requester"
            >
              <option value="">All requesters</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="dmh-rv-filter">
            <span className="dmh-rv-filter-label">Approver</span>
            <select
              className="dmh-rv-select"
              value={reviewerFilter}
              onChange={(e) => setReviewerFilter(e.target.value)}
              aria-label="Filter by approver"
            >
              <option value="">All approvers</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          {filtersActive && (
            <button
              type="button"
              className="dmh-rv-filter-clear"
              onClick={() => {
                setOwnerFilter('');
                setReviewerFilter('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* versions table */}
        <div className="dmh-rv-table">
          <div className="dmh-rv-thead">
            <div>Version</div>
            <div>Title</div>
            <div>Owner</div>
            <div>Updated</div>
            <div>Projects</div>
          </div>
          {listsLoading ? (
            <div className="dmh-rv-table-empty">Loading change history…</div>
          ) : tableRows.length === 0 ? (
            <div className="dmh-rv-table-empty">
              {filtersActive
                ? 'No versions match the current filters.'
                : 'No versions yet. Snapshot production to start one.'}
            </div>
          ) : (
            tableRows.map(({ row, isProduction }) => {
              const cls = [
                'dmh-rv-trow',
                isProduction ? 'is-production' : '',
                row.id === selectedId ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={cls}
                  onClick={() => select(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select(row.id);
                    }
                  }}
                >
                  <div className="dmh-rv-tlabel">{row.versionLabel ?? '—'}</div>
                  <div className="dmh-rv-ttitle">{row.title ?? 'Untitled change'}</div>
                  <div className="dmh-rv-towner">
                    <Avatar
                      initials={userInitials(row.owner)}
                      tone={avatarTone(row.owner ?? row.id)}
                      size={22}
                    />
                    <span className="dmh-rv-towner-name">{userName(row.owner)}</span>
                  </div>
                  <div className="dmh-rv-tdate">{fmtDate(row.updatedAt ?? row.createdAt)}</div>
                  <div className="dmh-rv-tchips">
                    {row.projectIds.length === 0 ? (
                      <span className="dmh-rv-tchips-empty">—</span>
                    ) : (
                      row.projectIds.map((pid) => (
                        <span key={pid} className="dmh-rv-pchip">
                          {projectName(pid)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* body: card rail + detail */}
        <div className="dmh-rv-body">
          {/* version-card rail */}
          <div className="dmh-rv-rail">
            <div className="dmh-rv-rail-head">
              <div className="dmh-rv-rail-title">Versions</div>
              <div className="dmh-rv-rail-sub">across all projects · changes can be cross-project</div>
            </div>
            {listsLoading ? (
              <div className="dmh-rv-rail-empty">Loading…</div>
            ) : tableRows.length === 0 ? (
              <div className="dmh-rv-rail-empty">No versions to show.</div>
            ) : (
              tableRows.map(({ row, isProduction }) => {
                const pill = cardPill(row.status, isProduction);
                const cls = [
                  'dmh-rv-card',
                  isProduction ? 'is-published' : '',
                  row.id === selectedId ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button key={row.id} type="button" className={cls} onClick={() => select(row.id)}>
                    <div className="dmh-rv-card-top">
                      <span className={`dmh-rv-spill ${pill.cls}`}>{pill.text}</span>
                      <span className="dmh-rv-card-ver">{row.versionLabel ?? '—'}</span>
                    </div>
                    <div className="dmh-rv-card-name">{row.title ?? 'Untitled change'}</div>
                    {row.projectIds.length > 0 && (
                      <div className="dmh-rv-card-chips">
                        {row.projectIds.map((pid) => (
                          <span key={pid} className="dmh-rv-pchip">
                            {projectName(pid)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="dmh-rv-card-author">
                      <Avatar
                        initials={userInitials(row.owner)}
                        tone={avatarTone(row.owner ?? row.id)}
                        size={18}
                      />
                      <span className="dmh-rv-card-author-name">{userName(row.owner)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* detail panel */}
          <div className="dmh-rv-detail">
            {!selectedId ? (
              <div className="dmh-rv-detail-empty">
                <div className="dmh-rv-detail-empty-ico">
                  <GitCompare size={22} strokeWidth={1.5} aria-hidden />
                </div>
                <div className="dmh-rv-detail-empty-t">Select a version to review</div>
                <div className="dmh-rv-detail-empty-m">
                  Pick a row or a card to see its approval flow, impact and diff.
                </div>
              </div>
            ) : detailLoading && !detail ? (
              <div className="dmh-rv-detail-loading">
                <div className="dmh-rv-skel" style={{ height: 22, width: '40%' }} />
                <div className="dmh-rv-skel" style={{ height: 28, width: '60%' }} />
                <div className="dmh-rv-skel" style={{ height: 80 }} />
                <div className="dmh-rv-skel" style={{ height: 60 }} />
              </div>
            ) : !detail ? (
              <div className="dmh-rv-detail-empty">
                <div className="dmh-rv-detail-empty-t">Change not found</div>
                <div className="dmh-rv-detail-empty-m">It may have been removed or is unavailable.</div>
              </div>
            ) : (
              <>
                <div className="dmh-rv-detail-head">
                  {/* approval stepper */}
                  <div className="dmh-rv-stepper">
                    {steps.map((step, i) => (
                      <div key={step.key} style={{ display: 'contents' }}>
                        {i > 0 && (
                          <span
                            className={`dmh-rv-step-conn${
                              steps[i - 1].state === 'completed'
                                ? ' is-done'
                                : steps[i - 1].state === 'current'
                                  ? ' is-active'
                                  : ''
                            }`}
                          />
                        )}
                        <div className={`dmh-rv-step is-${step.state}`}>
                          <span className="dmh-rv-step-dot">
                            {step.state === 'completed' ? (
                              <Check size={12} strokeWidth={2.4} color="#fff" aria-hidden />
                            ) : step.state === 'rejected' ? (
                              <X size={12} strokeWidth={2.4} color="#fff" aria-hidden />
                            ) : (
                              <span className="dmh-rv-step-dot-inner" />
                            )}
                          </span>
                          <span className="dmh-rv-step-label">
                            {step.label}
                            {step.mono ? <> <span className="mono">{step.mono}</span></> : null}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* headline + actions */}
                  <div className="dmh-rv-headline">
                    <div className="dmh-rv-headline-main">
                      <div className="dmh-rv-headline-title-row">
                        <h1 className="dmh-rv-h1">{detail.title ?? 'Untitled change'}</h1>
                        {(() => {
                          const p = cardPill(detail.status, false);
                          return <span className={`dmh-rv-spill ${p.cls}`}>{p.text}</span>;
                        })()}
                      </div>
                      <div className="dmh-rv-meta">
                        <Avatar
                          initials={userInitials(detail.owner)}
                          tone={avatarTone(detail.owner ?? detail.id)}
                          size={22}
                        />
                        <span className="dmh-rv-meta-text">
                          <strong>{userName(detail.owner)}</strong> took a snapshot
                          {detail.versionLabel ? <> of {detail.versionLabel}</> : null}
                          {detail.submittedAt ? ` · ${fmtDate(detail.submittedAt)}` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="dmh-rv-actions">
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
                        <Tooltip label={actDisabledReason || 'Unavailable'}>
                          <button type="button" className="dmh-rv-act dmh-rv-act--reject" disabled>
                            <X size={14} strokeWidth={1.7} aria-hidden />
                            Reject
                          </button>
                        </Tooltip>
                      )}
                      <button
                        type="button"
                        className="dmh-rv-act dmh-rv-act--comment"
                        onClick={() => {
                          document.getElementById('dmh-rv-comment-input')?.focus();
                        }}
                      >
                        <MessageSquare size={14} strokeWidth={1.6} aria-hidden />
                        Comment
                      </button>
                      {canAct ? (
                        <button
                          type="button"
                          className="dmh-rv-act dmh-rv-act--approve"
                          onClick={() => doReview('approve')}
                          disabled={acting}
                        >
                          <Check size={14} strokeWidth={1.9} aria-hidden />
                          Approve and publish
                        </button>
                      ) : (
                        <Tooltip label={actDisabledReason || 'Unavailable'}>
                          <button type="button" className="dmh-rv-act dmh-rv-act--approve" disabled>
                            <Check size={14} strokeWidth={1.9} aria-hidden />
                            Approve and publish
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {/* reviewers row */}
                  {detail.reviewers.length > 0 && (
                    <div className="dmh-rv-reviewers">
                      <span className="dmh-rv-reviewers-label">Reviewers</span>
                      {detail.reviewers.map((rid) => {
                        const verdict = detail.approvals[rid]?.status;
                        const stateCls =
                          verdict === 'approved'
                            ? 'dmh-rv-reviewer-state--approved'
                            : verdict === 'rejected'
                              ? 'dmh-rv-reviewer-state--rejected'
                              : 'dmh-rv-reviewer-state--pending';
                        const stateText =
                          verdict === 'approved'
                            ? 'approved'
                            : verdict === 'rejected'
                              ? 'rejected'
                              : 'pending';
                        return (
                          <span key={rid} className="dmh-rv-reviewer">
                            <Avatar
                              initials={userInitials(rid)}
                              tone={avatarTone(rid)}
                              size={22}
                            />
                            <span className="dmh-rv-reviewer-name">{userName(rid)}</span>
                            <span className={`dmh-rv-reviewer-state ${stateCls}`}>{stateText}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* impact summary */}
                  {diff && (
                    <div className="dmh-rv-impact">
                      <span className="dmh-rv-impact-counts">
                        <GitCompare size={15} strokeWidth={1.6} aria-hidden />
                        <span className="n">{diff.impact.tablesTouched}</span> tables /{' '}
                        <span className="n">{diff.impact.columnsTouched}</span> columns touched
                      </span>
                      {diff.impact.affectedOtherTables.length > 0 && (
                        <span className="dmh-rv-impact-affected">
                          <span className="dmh-rv-impact-affected-label">
                            <AlertTriangle size={14} strokeWidth={1.6} aria-hidden />
                            Also affects
                          </span>
                          {diff.impact.affectedOtherTables.map((t) => (
                            <span key={t.id} className="dmh-rv-affected-chip">
                              {t.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* diff body */}
                <DiffBody diff={diff} />

                {/* comments */}
                <div className="dmh-rv-comments">
                  <div className="dmh-rv-comments-title">
                    <MessageSquare size={15} strokeWidth={1.6} aria-hidden />
                    Comments
                    <span className="dmh-rv-comments-count">{detail.comments.length}</span>
                  </div>
                  {detail.comments.length === 0 ? (
                    <div className="dmh-rv-comments-empty">No comments yet. Start the discussion.</div>
                  ) : (
                    detail.comments.map((c, i) => (
                      <div key={`${c.author}-${c.at ?? i}`} className="dmh-rv-comment">
                        <Avatar
                          initials={userInitials(c.author)}
                          tone={avatarTone(c.author)}
                          size={26}
                        />
                        <div className="dmh-rv-comment-body">
                          <div className="dmh-rv-comment-meta">
                            <span className="dmh-rv-comment-author">{userName(c.author)}</span>
                            <span className="dmh-rv-comment-at">{fmtDate(c.at)}</span>
                          </div>
                          <div className="dmh-rv-comment-text">{c.text}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div className="dmh-rv-comment-form">
                    <textarea
                      id="dmh-rv-comment-input"
                      className="dmh-rv-comment-input"
                      placeholder="Add a comment…"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          void submitComment();
                        }
                      }}
                      rows={1}
                    />
                    <button
                      type="button"
                      className="dmh-rv-comment-send"
                      onClick={() => void submitComment()}
                      disabled={!commentText.trim() || commentSending}
                    >
                      {commentSending ? 'Posting…' : 'Comment'}
                    </button>
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

// ── diff body (added / edited / deleted rows) ────────────────────────────────

function DiffBody({ diff }: { diff: ChangesetDiff | null }) {
  const rows = useMemo(() => {
    if (!diff) return [];
    const out: { kind: 'added' | 'edited' | 'deleted'; entity: DiffEntity }[] = [];
    Object.values(diff.collections).forEach((bucket) => {
      bucket.added.forEach((entity) => out.push({ kind: 'added', entity }));
      bucket.edited.forEach((entity) => out.push({ kind: 'edited', entity }));
      bucket.deleted.forEach((entity) => out.push({ kind: 'deleted', entity }));
    });
    return out;
  }, [diff]);

  if (!diff) return <div className="dmh-rv-diff-empty">Loading diff…</div>;
  if (rows.length === 0)
    return <div className="dmh-rv-diff-empty">No structural changes in this version.</div>;

  const meta: Record<typeof rows[number]['kind'], { sign: string; pill: string; verb: string }> = {
    added: { sign: '+', pill: 'added', verb: 'added' },
    edited: { sign: '~', pill: 'edited', verb: 'modified' },
    deleted: { sign: '−', pill: 'deleted', verb: 'deleted' },
  };

  return (
    <div className="dmh-rv-diff">
      {rows.map(({ kind, entity }) => {
        const m = meta[kind];
        const chips = kind === 'deleted' ? [] : colChips(entity);
        return (
          <div key={`${kind}-${entity.id}`} className={`dmh-rv-diffrow is-${kind}`}>
            <div className="dmh-rv-diffrow-head">
              <span className="dmh-rv-diffrow-sign">{m.sign}</span>
              <span className="dmh-rv-diffrow-name">
                <span className="mono">{entity.name}</span> {m.verb}
              </span>
              <span className="dmh-rv-diffrow-pill">{m.pill}</span>
              <span className="dmh-rv-diffrow-spacer" />
              {entity.collection && (
                <span className="dmh-rv-diffrow-coll">{entity.collection}</span>
              )}
            </div>
            {chips.length > 0 && (
              <div className="dmh-rv-diffrow-cols">
                {chips.map((c, i) => (
                  <span key={`${c}-${i}`} className="dmh-rv-colchip">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
