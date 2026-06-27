/**
 * HomeScreen (p0) — the Data Model Hub workspace landing.
 *
 * Sections (per design #p0):
 *   · header: WORKSPACE eyebrow + "Data Model Hub" h1 + New project / Open model
 *   · PROJECTS filter strip (chips refilter the 5 counters; "+ New")
 *   · 5 summary cards (Tables / Views / Relationships / Subject Areas / Projects)
 *   · two columns: versions panel (left) + side rail (dark snapshot card +
 *     requests inbox) (right)
 *
 * Data: dashboard.service.getSummary + versioning.service (versions, published,
 * requests, users) + projects.service.listProjects. The actor comes from
 * useSessionStore (injects X-Dev-User). Loading → skeleton; errors → sonner.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Database, GitBranch, Inbox, Plus } from 'lucide-react';

import { Avatar } from '@/components/ui';
import OpenModelModal from '@/components/OpenModelModal';
import { useSessionStore } from '@/store/useSessionStore';
import { getSummary } from '@/services/dashboard.service';
import {
  getPublished,
  listRequests,
  listUsers,
  listVersions,
} from '@/services/versioning.service';
import { listProjects, createProject } from '@/services/projects.service';
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

// ── component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [published, setPublished] = useState<VersionRow | null>(null);
  const [requests, setRequests] = useState<VersionRow[]>([]);
  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [listsLoading, setListsLoading] = useState(true);

  const [openModelShown, setOpenModelShown] = useState(false);

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

  // Alta rápida de proyecto desde el Home (el Model Explorer también lo permite).
  const handleNewProject = useCallback(async () => {
    const name = window.prompt('Nombre del nuevo proyecto:')?.trim();
    if (!name) return;
    try {
      const p = await createProject({ name });
      setProjects((ps) => [...ps, p]);
      setActiveProjectId(p.id);
      toast.success(`Proyecto “${name}” creado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el proyecto');
    }
  }, []);

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

  // Summary reloads whenever the project filter changes.
  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    getSummary(activeProjectId ?? undefined)
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
  }, [activeProjectId]);

  /** Versions shown in the left panel: production row first, then submitted. */
  const panelRows = useMemo(() => {
    const rows: { row: VersionRow; isProduction: boolean }[] = [];
    if (published) rows.push({ row: published, isProduction: true });
    versions
      .filter((v) => v.status === 'submitted' && v.id !== published?.id)
      .forEach((v) => rows.push({ row: v, isProduction: false }));
    return rows;
  }, [versions, published]);

  const pendingCount = requests.length;
  const publishedLabel = published?.versionLabel ?? null;

  const goReview = (versionId?: string) => {
    navigate(versionId ? `/review?id=${encodeURIComponent(versionId)}` : '/review');
  };

  return (
    <div className="dmh-home">
      <div className="dmh-home-inner">
        {/* ── header ─────────────────────────────────────────────── */}
        <div className="dmh-home-head">
          <div className="dmh-home-head-titles">
            <div className="dmh-home-eyebrow">Workspace</div>
            <h1 className="dmh-home-h1">Data Model Hub</h1>
          </div>
          <div className="dmh-home-actions">
            <button
              type="button"
              className="dmh-btn dmh-btn--secondary dmh-home-cta"
              onClick={handleNewProject}
            >
              <Plus size={15} strokeWidth={1.7} aria-hidden />
              <span>New project</span>
            </button>
            <button
              type="button"
              className="dmh-btn dmh-btn--primary dmh-home-cta"
              onClick={() => setOpenModelShown(true)}
            >
              <ArrowRight size={16} strokeWidth={1.6} aria-hidden />
              <span>Open model</span>
            </button>
          </div>
        </div>

        {/* ── projects filter strip ──────────────────────────────── */}
        <div className="dmh-home-projects">
          <span className="dmh-home-projects-label">Projects</span>
          {projects.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <span
                key={p.id}
                role="button"
                tabIndex={0}
                className={`dmh-chip${active ? ' is-active' : ''}`}
                onClick={() => setActiveProjectId(active ? null : p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveProjectId(active ? null : p.id);
                  }
                }}
              >
                <Database size={13} strokeWidth={1.5} aria-hidden />
                {p.name}
              </span>
            );
          })}
          <button
            type="button"
            className="dmh-home-chip-new"
            onClick={handleNewProject}
          >
            <Plus size={12} strokeWidth={1.8} aria-hidden />
            New
          </button>
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

        {/* ── two columns ────────────────────────────────────────── */}
        <div className="dmh-home-cols">
          {/* versions panel */}
          <div className="dmh-vpanel">
            <div className="dmh-vpanel-head">
              <span className="dmh-vpanel-title">
                <GitBranch size={15} strokeWidth={1.5} aria-hidden />
                Versions
              </span>
              <span className="dmh-vpanel-spacer" />
              <button type="button" className="dmh-vpanel-link" onClick={() => goReview()}>
                Open Review &amp; publish
                <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
              </button>
            </div>
            <div className="dmh-vtable-head">
              <div>Version</div>
              <div>Status</div>
              <div>Owner</div>
              <div className="dmh-vcol-actions">Actions</div>
            </div>

            {listsLoading ? (
              <div className="dmh-vpanel-empty">Loading versions…</div>
            ) : panelRows.length === 0 ? (
              <div className="dmh-vpanel-empty">
                No published or in-review versions yet. Snapshot production to start one.
              </div>
            ) : (
              panelRows.map(({ row, isProduction }) => {
                const pill = statusPill(row.status, isProduction);
                const labelTone = isProduction
                  ? 'tone-green'
                  : row.status === 'submitted'
                    ? 'tone-blue'
                    : 'tone-muted';
                return (
                  <div
                    key={row.id}
                    className={`dmh-vrow${isProduction ? ' is-production' : ''}`}
                  >
                    <div>
                      <div className={`dmh-vrow-label ${labelTone}`}>
                        {row.versionLabel ?? '—'}
                      </div>
                      {row.title && <div className="dmh-vrow-sub">{row.title}</div>}
                    </div>
                    <div>
                      <span className={`dmh-vpill ${pill.cls}`}>
                        <span className={`dot${pill.hollow ? ' hollow' : ''}`} />
                        {pill.text}
                      </span>
                    </div>
                    <div className="dmh-vrow-owner">{userName(row.owner)}</div>
                    <div className="dmh-vrow-actions">
                      {isProduction ? (
                        <button
                          type="button"
                          className="dmh-vrow-act is-muted"
                          onClick={() => goReview(row.id)}
                        >
                          View
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="dmh-vrow-act"
                          onClick={() => goReview(row.id)}
                        >
                          Review
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* side rail */}
          <div className="dmh-home-rail">
            {/* dark snapshot card */}
            <div className="dmh-newcard">
              <div className="dmh-newcard-ico">
                <GitBranch size={18} strokeWidth={1.5} aria-hidden />
              </div>
              <div className="dmh-newcard-title">Create new version</div>
              <div className="dmh-newcard-desc">
                Take a snapshot of{' '}
                <strong>{publishedLabel ? `production ${publishedLabel}` : 'production'}</strong>{' '}
                and work on your own copy without affecting anyone.
              </div>
              <button
                type="button"
                className="dmh-newcard-btn"
                onClick={() => setOpenModelShown(true)}
              >
                {publishedLabel ? `Snapshot of ${publishedLabel} →` : 'Snapshot production →'}
              </button>
            </div>

            {/* requests inbox */}
            <div className="dmh-reqcard">
              <div className="dmh-reqcard-head">
                <div className="dmh-reqcard-ico">
                  <Inbox size={18} strokeWidth={1.5} aria-hidden />
                </div>
                <div className="dmh-reqcard-title">Requests</div>
                {pendingCount > 0 && (
                  <span className="dmh-reqcard-count">{pendingCount} pending</span>
                )}
              </div>

              {listsLoading ? (
                <div className="dmh-reqcard-empty">Loading…</div>
              ) : pendingCount === 0 ? (
                <div className="dmh-reqcard-empty">
                  No requests waiting for your review.
                </div>
              ) : (
                requests.map((req) => (
                  <button
                    key={req.id}
                    type="button"
                    className="dmh-reqrow"
                    onClick={() => goReview(req.id)}
                  >
                    <Avatar
                      initials={userInitials(req.owner)}
                      tone={avatarTone(req.owner ?? req.id)}
                      size={24}
                    />
                    <span className="dmh-reqrow-body">
                      <span className="dmh-reqrow-t">
                        {req.title ?? req.versionLabel ?? 'Untitled request'}
                      </span>
                      <span className="dmh-reqrow-m">
                        {userName(req.owner)}
                        {req.versionLabel ? ` · ${req.versionLabel}` : ''}
                      </span>
                    </span>
                    <span className="dmh-reqrow-cta">Review</span>
                  </button>
                ))
              )}

              <button type="button" className="dmh-reqcard-foot" onClick={() => goReview()}>
                Open Review &amp; publish
                <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Open model modal (pg) ───────────────────────────────── */}
      <OpenModelModal
        open={openModelShown}
        onClose={() => setOpenModelShown(false)}
        published={published}
        projectName={
          activeProjectId
            ? (projects.find((p) => p.id === activeProjectId)?.name ?? null)
            : null
        }
        defaultProjectId={activeProjectId}
        users={users}
      />
    </div>
  );
}
