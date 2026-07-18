/**
 * HomeScreen (p0) — the Data Model Hub workspace landing.
 *
 * Per the DMH-Erwin v20260625-2 design (#p0) the Home is purely informational:
 *   · title row: "Workspace overview" eyebrow + "Welcome back, {name}" + a note
 *     pointing to Model (canvas) for choosing / creating a version
 *   · PROJECTS strip (chips refilter the 5 counters; "+N more")
 *   · 5 summary cards (Tables / Views / Relationships / Subject Areas / Projects)
 *   · two columns: Requests assigned to you (left) + Versions read-only (right)
 *
 * Version creation / snapshot now lives INSIDE Model (the Open-model entry moved
 * to the canvas toolbar), so the Versions panel here is read-only.
 *
 * Data: dashboard.service.getSummary + versioning.service (versions, published,
 * requests, users) + projects.service.listProjects. The actor comes from
 * useSessionStore (injects X-Dev-User). Loading → skeleton; errors → sonner.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Database, GitBranch, Inbox, Info, Undo2 } from 'lucide-react';

import { Avatar } from '@/components/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/store/useAuthStore';
import { useSessionStore } from '@/store/useSessionStore';
import { getSummary } from '@/services/dashboard.service';
import {
  getPublished,
  listRequests,
  listUsers,
  listVersions,
  rollbackVersion,
} from '@/services/versioning.service';
import { listProjects } from '@/services/projects.service';
import type { Project } from '@/types/model';
import type {
  DashboardSummary,
  SimUserDto,
  VersionRow,
  VersionStatus,
} from '@/types/versioning';

// ── helpers ──────────────────────────────────────────────────────────────────

interface PillSpec {
  cls: string;
  text: string;
  hollow?: boolean;
}

/** Maps a real backend status onto the design's inline status pill. */
function statusPill(status: VersionStatus, isProduction: boolean): PillSpec {
  if (isProduction) return { cls: 'dmh-vpill--production', text: 'Production' };
  switch (status) {
    case 'submitted':
      return { cls: 'dmh-vpill--review', text: 'In review' };
    case 'draft':
      return { cls: 'dmh-vpill--draft', text: 'Editing (draft)' };
    case 'rejected':
      return { cls: 'dmh-vpill--rejected', text: 'Rejected' };
    case 'approved':
      return { cls: 'dmh-vpill--historical', text: 'Historical', hollow: true };
    default:
      return { cls: 'dmh-vpill--draft', text: status };
  }
}

/** Label tone for the version mono code, matching the status. */
function labelTone(status: VersionStatus, isProduction: boolean): string {
  if (isProduction) return 'tone-green';
  if (status === 'submitted') return 'tone-blue';
  return 'tone-muted';
}

const STAT_DEFS: { key: keyof DashboardSummary; label: string }[] = [
  { key: 'tables', label: 'Tables' },
  { key: 'views', label: 'Views' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'subjectAreas', label: 'Subject Areas' },
  { key: 'projects', label: 'Projects' },
];

const AVATAR_TONES = ['blue', 'purple', 'green', 'navy'] as const;
/** Stable avatar tone from an id so a given user always gets the same color. */
function avatarTone(id: string): (typeof AVATAR_TONES)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Epoch ms of the most recent timestamp on a row (for sorting). */
function rowTs(v: VersionRow): number {
  const iso = v.submittedAt ?? v.updatedAt ?? v.createdAt ?? null;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Compact relative time ("2h ago", "yesterday", "3d ago", or a date). */
function relTime(iso?: string | null): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.floor(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)}h ago`;
  const day = hr / 24;
  if (day < 2) return 'yesterday';
  if (day < 7) return `${Math.floor(day)}d ago`;
  const wk = day / 7;
  if (wk < 5) return `${Math.floor(wk)}w ago`;
  return new Date(then).toLocaleDateString();
}

const MAX_PROJECT_CHIPS = 6;

// ── component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const firstName = user.name.split(' ')[0] || user.name;

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [published, setPublished] = useState<VersionRow | null>(null);
  const [requests, setRequests] = useState<VersionRow[]>([]);
  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [listsLoading, setListsLoading] = useState(true);

  // Rollback de la versión en producción (crea un draft inverso; doc 16 §5d).
  const canEdit = useAuthStore((s) => s.has('model.edit'));
  const [rollbackTarget, setRollbackTarget] = useState<VersionRow | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const doRollback = async () => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      const draft = await rollbackVersion(rollbackTarget.id);
      toast.success(`Draft "${draft.title ?? 'Rollback'}" created — open it in Model (Open model) `
        + 'to review it and send it for approval. Production does not change until the approve.');
      setRollbackTarget(null);
      listVersions().then(setVersions).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the rollback.");
    } finally {
      setRollingBack(false);
    }
  };

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
    (id?: string | null): string | null => {
      if (!id) return null;
      return projects.find((p) => p.id === id)?.name ?? null;
    },
    [projects],
  );

  // Project list + non-summary lists load once (actor-scoped via the http header).
  useEffect(() => {
    let cancelled = false;
    setListsLoading(true);
    Promise.all([
      listProjects(),
      listVersions(),
      getPublished(),
      listRequests({ reviewer: user.id }),
      listUsers(),
    ])
      .then(([proj, vers, pub, reqs, us]) => {
        if (cancelled) return;
        setProjects(proj);
        setVersions(vers);
        setPublished(pub);
        setRequests(reqs);
        setUsers(us);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the workspace.');
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-run when the simulated actor changes so the inbox reflects them.
  }, [user.id]);

  // Stable key for the multi-project filter (sorted ids) → drives the summary.
  const projectFilterKey = useMemo(
    () => [...selectedProjectIds].sort().join(','),
    [selectedProjectIds],
  );

  // Summary reloads whenever the project filter (union) changes.
  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    getSummary(projectFilterKey ? projectFilterKey.split(',') : [])
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the summary counters.');
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectFilterKey]);

  /** Read-only version list: production first, then everything else by recency. */
  const versionRows = useMemo(() => {
    const rows: { row: VersionRow; isProduction: boolean }[] = [];
    const seen = new Set<string>();
    if (published) {
      rows.push({ row: published, isProduction: true });
      seen.add(published.id);
    }
    [...versions]
      .filter((v) => !seen.has(v.id))
      .sort((a, b) => rowTs(b) - rowTs(a))
      .forEach((v) => {
        rows.push({ row: v, isProduction: false });
        seen.add(v.id);
      });
    return rows;
  }, [versions, published]);

  const shownProjects = showAllProjects ? projects : projects.slice(0, MAX_PROJECT_CHIPS);
  const hiddenProjects = Math.max(0, projects.length - MAX_PROJECT_CHIPS);
  const pendingCount = requests.length;

  const goReview = (versionId?: string) => {
    navigate(versionId ? `/review?id=${encodeURIComponent(versionId)}` : '/review');
  };

  return (
    <div className="dmh-home">
      <div className="dmh-home-inner">
        {/* ── title row ──────────────────────────────────────────── */}
        <div className="dmh-home-head">
          <div className="dmh-home-head-titles">
            <div className="dmh-home-eyebrow">Workspace overview</div>
            <h1 className="dmh-home-h1">Welcome back, {firstName}</h1>
          </div>
          <div className="dmh-home-note">
            Open{' '}
            <Link to="/model" className="dmh-home-note-link">
              Model (canvas)
            </Link>{' '}
            to choose
            <br />
            or create a version.
          </div>
        </div>

        {/* ── projects filter strip ──────────────────────────────── */}
        <div className="dmh-home-projects">
          <span className="dmh-home-projects-label">Projects</span>
          {shownProjects.map((p) => {
            const active = selectedProjectIds.has(p.id);
            const toggle = () =>
              setSelectedProjectIds((prev) => {
                const next = new Set(prev);
                if (next.has(p.id)) next.delete(p.id);
                else next.add(p.id);
                return next;
              });
            return (
              <span
                key={p.id}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                className={`dmh-chip${active ? ' is-active' : ''}`}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <Database size={13} strokeWidth={1.5} aria-hidden />
                {p.name}
              </span>
            );
          })}
          {!showAllProjects && hiddenProjects > 0 && (
            <button
              type="button"
              className="dmh-home-projects-more"
              onClick={() => setShowAllProjects(true)}
            >
              +{hiddenProjects} more
            </button>
          )}
          {showAllProjects && projects.length > MAX_PROJECT_CHIPS && (
            <button
              type="button"
              className="dmh-home-projects-more"
              onClick={() => setShowAllProjects(false)}
            >
              Show less
            </button>
          )}
          {selectedProjectIds.size > 0 && (
            <button
              type="button"
              className="dmh-home-projects-clear"
              onClick={() => setSelectedProjectIds(new Set())}
            >
              Clear
            </button>
          )}
        </div>

        {/* ── 5 summary cards ────────────────────────────────────── */}
        <div className="dmh-home-stats">
          {STAT_DEFS.map((stat) => (
            <div key={stat.key} className="dmh-stat">
              <div className="dmh-stat-label">{stat.label}</div>
              {summaryLoading || !summary ? (
                <div className="dmh-stat-value is-loading" aria-hidden />
              ) : (
                <div className="dmh-stat-value">{summary[stat.key]}</div>
              )}
            </div>
          ))}
        </div>

        {/* ── two columns: requests (left) · versions read-only (right) ── */}
        <div className="dmh-home-cols">
          {/* requests assigned to the logged-in user */}
          <div className="dmh-reqpanel">
            <div className="dmh-reqpanel-head">
              <div className="dmh-reqpanel-ico">
                <Inbox size={16} strokeWidth={1.5} aria-hidden />
              </div>
              <div className="dmh-reqpanel-htext">
                <div className="dmh-reqpanel-title">Requests</div>
                <div className="dmh-reqpanel-sub">
                  Change requests across projects waiting for review
                </div>
              </div>
              {pendingCount > 0 && (
                <span className="dmh-reqpanel-count">{pendingCount} pending</span>
              )}
              <button
                type="button"
                className="dmh-btn dmh-btn--primary dmh-reqpanel-cta"
                onClick={() => goReview()}
              >
                <Inbox size={14} strokeWidth={1.6} aria-hidden />
                Review requests
              </button>
            </div>

            <div className="dmh-reqpanel-body">
              {listsLoading ? (
                <div className="dmh-reqpanel-empty">Loading…</div>
              ) : pendingCount === 0 ? (
                <div className="dmh-reqpanel-empty">
                  No requests waiting for your review.
                </div>
              ) : (
                requests.map((req) => {
                  const proj = projectName(req.projectIds[0]);
                  return (
                    <button
                      key={req.id}
                      type="button"
                      className="dmh-reqitem"
                      onClick={() => goReview(req.id)}
                    >
                      <Avatar
                        initials={userInitials(req.owner)}
                        tone={avatarTone(req.owner ?? req.id)}
                        size={32}
                      />
                      <span className="dmh-reqitem-body">
                        <span className="dmh-reqitem-top">
                          <span className="dmh-reqitem-t">
                            {req.title ?? req.versionLabel ?? 'Untitled request'}
                          </span>
                          {proj && <span className="dmh-reqitem-proj">{proj}</span>}
                        </span>
                        <span className="dmh-reqitem-m">
                          {userName(req.owner)}
                          {req.versionLabel ? ` · snapshot of ${req.versionLabel}` : ''}
                          {relTime(req.submittedAt ?? req.createdAt)
                            ? ` · ${relTime(req.submittedAt ?? req.createdAt)}`
                            : ''}
                        </span>
                      </span>
                      <span className="dmh-reqitem-cta">Review</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* versions (read-only, all projects) */}
          <div className="dmh-vside">
            <div className="dmh-vside-head">
              <div className="dmh-vside-ico">
                <GitBranch size={16} strokeWidth={1.5} aria-hidden />
              </div>
              <div>
                <div className="dmh-vside-title">Versions</div>
                <div className="dmh-vside-sub">{versionRows.length} total · all projects</div>
              </div>
            </div>

            <div className="dmh-vside-body">
              {listsLoading ? (
                <div className="dmh-reqpanel-empty">Loading versions…</div>
              ) : versionRows.length === 0 ? (
                <div className="dmh-reqpanel-empty">No versions yet.</div>
              ) : (
                versionRows.map(({ row, isProduction }) => {
                  const pill = statusPill(row.status, isProduction);
                  const proj = projectName(row.projectIds[0]);
                  return (
                    <div
                      key={row.id}
                      className={`dmh-vside-row${isProduction ? ' is-production' : ''}`}
                    >
                      <span className={`dmh-vside-label ${labelTone(row.status, isProduction)}`}>
                        {row.versionLabel ?? '—'}
                      </span>
                      <span className="dmh-vside-meta">
                        {proj ? `${proj} · ` : ''}
                        {userName(row.owner)}
                      </span>
                      {/* Rollback: solo la versión EN PRODUCCIÓN es reversible
                          (deshacer en orden). Crea un draft inverso que pasa
                          por el flujo normal de revisión (doc 16 §5d). */}
                      {isProduction && canEdit && (
                        <button
                          type="button"
                          className="dmh-vside-rollback"
                          title="Create a draft that reverts this version (goes through review)"
                          onClick={() => setRollbackTarget(row)}
                        >
                          <Undo2 size={11} strokeWidth={1.9} aria-hidden />
                          Rollback
                        </button>
                      )}
                      <span className={`dmh-vpill ${pill.cls}`}>
                        <span className={`dot${pill.hollow ? ' hollow' : ''}`} />
                        {pill.text}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="dmh-vside-foot">
              <Info size={13} strokeWidth={1.5} aria-hidden />
              Read-only · manage versions inside Model
            </div>

            {rollbackTarget && (
              <ConfirmDialog
                open
                variant="danger"
                title={`Rollback of ${rollbackTarget.versionLabel ?? 'the published version'}`}
                confirmLabel="Create rollback draft"
                message={
                  <>
                    A <strong>draft</strong> will be created with the inverse changes of{' '}
                    <strong>{rollbackTarget.versionLabel ?? rollbackTarget.title}</strong>{' '}
                    (it restores the previous state of each entity it touched).
                    Production <strong>does not change</strong> until that draft goes through
                    review and gets approved — like any publish.
                  </>
                }
                busy={rollingBack}
                onConfirm={doRollback}
                onCancel={() => { if (!rollingBack) setRollbackTarget(null); }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
