/**
 * OpenModelModal (pg · doc 75 D8) — "Open model" in two steps:
 *
 *   Step 1 · Project  → ProjectPicker (A–Z, production + own drafts per project)
 *   Step 2 · Mode     → three radio cards for THAT project:
 *     1. View production (read-only)  → openModel({projectId, mode:'readonly', versionLabel})
 *     2. Snapshot from production      → snapshot({projectId}) → openModel({projectId, mode:'editing',
 *                                        changesetId, versionLabel}) → navigate('/model')
 *     3. Continue a working version    → pick one of the actor's drafts of the project →
 *                                        openModel({projectId, mode:'editing', changesetId}) → /model
 *
 * Launched from Home / the Toolbar (NOT over the canvas), so it uses the
 * design-system Dialog with the default `screen` backdrop. Cancel / Esc close
 * without navigating. The snapshot runs under the session-blocking overlay.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Database, Eye, FolderPlus, GitBranch, List } from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import ProjectPicker from '@/components/ProjectPicker';
import { projectMeta, type ProjectMeta } from '@/lib/projects';
import { listProjects } from '@/services/projects.service';
import { listVersions, snapshot } from '@/services/versioning.service';
import { runBlocking } from '@/store/useBusyStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { Project } from '@/types/model';
import type { SimUserDto, VersionRow } from '@/types/versioning';

type Mode = 'readonly' | 'snapshot' | 'continue';
type Step = 'project' | 'mode';

export interface OpenModelModalProps {
  open: boolean;
  onClose: () => void;
  /** Project preselected in step 1 (last opened / current session). */
  defaultProjectId?: string | null;
  /** Users (id→name) to label the drafts list. */
  users: SimUserDto[];
  /** «New project…» link of step 1 (Home / Workspace open the NewProjectModal). */
  onNewProject?: () => void;
}

export default function OpenModelModal({ open, onClose, defaultProjectId, users, onNewProject }: OpenModelModalProps) {
  const navigate = useNavigate();
  const actor = useSessionStore((s) => s.user);
  const openModel = useSessionStore((s) => s.openModel);

  const [step, setStep] = useState<Step>('project');
  const [projects, setProjects] = useState<Project[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('readonly');
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset each time the modal opens, then load projects + versions (one request each).
  useEffect(() => {
    if (!open) return;
    setStep('project');
    setMode('readonly');
    setSelectedDraftId(null);
    setSubmitting(false);
    let cancelled = false;
    setLoading(true);
    Promise.all([listProjects(), listVersions()])
      .then(([ps, vs]) => {
        if (cancelled) return;
        setProjects(ps);
        setVersions(vs);
        const preset = defaultProjectId && ps.some((p) => p.id === defaultProjectId) ? defaultProjectId : null;
        setProjectId(preset ?? (ps.length === 1 ? ps[0].id : null));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the projects.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, defaultProjectId]);

  const meta = useMemo<Record<string, ProjectMeta>>(() => projectMeta(versions, actor.id), [versions, actor.id]);
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);
  const published = projectId ? (meta[projectId]?.productionRow ?? null) : null;
  const drafts = useMemo(
    () => versions.filter((v) => v.projectId === projectId && v.status === 'draft' && v.owner === actor.id),
    [versions, projectId, actor.id],
  );
  const publishedLabel = published?.versionLabel ?? null;
  const hasProduction = Boolean(published);

  const userName = useMemo(
    () => (id?: string | null) => (id ? users.find((u) => u.id === id)?.name : undefined) ?? id ?? 'you',
    [users],
  );

  const goMode = () => {
    if (!projectId) return;
    setMode(hasProduction ? 'readonly' : (drafts.length ? 'continue' : 'readonly'));
    setSelectedDraftId(drafts[0]?.id ?? null);
    setStep('mode');
  };

  // "Continue" is only actionable when the selected mode has a valid target.
  const canContinue = useMemo(() => {
    if (submitting || !projectId) return false;
    if (mode === 'readonly') return hasProduction;
    if (mode === 'snapshot') return hasProduction;
    return Boolean(selectedDraftId);
  }, [mode, hasProduction, selectedDraftId, submitting, projectId]);

  const handleContinue = async () => {
    if (!canContinue || !projectId) return;

    if (mode === 'readonly') {
      openModel({ projectId, mode: 'readonly', versionLabel: publishedLabel });
      onClose();
      navigate('/model');
      return;
    }

    if (mode === 'snapshot') {
      setSubmitting(true);
      try {
        const created = await runBlocking('Creating working copy…', () => snapshot({ projectId }),
          project ? `Snapshot of ${publishedLabel ?? 'production'} in «${project.name}»` : undefined);
        openModel({ projectId, mode: 'editing', changesetId: created.id, versionLabel: created.versionLabel });
        toast.success(created.versionLabel ? `Working copy ${created.versionLabel} created.` : 'Working copy created.');
        onClose();
        navigate('/model');
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Could not create the working copy.');
        setSubmitting(false);
      }
      return;
    }

    const draft = drafts.find((d) => d.id === selectedDraftId);
    if (!draft) return;
    openModel({ projectId, mode: 'editing', changesetId: draft.id, versionLabel: draft.versionLabel });
    onClose();
    navigate('/model');
  };

  const footer = step === 'project' ? (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" iconRight={ArrowRight} onClick={goMode} disabled={!projectId || loading}>Continue</Button>
    </>
  ) : (
    <>
      <div className="dmh-dialog-foot-left">
        <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep('project')} disabled={submitting}>Back</Button>
      </div>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" iconRight={ArrowRight} onClick={handleContinue} disabled={!canContinue}>Continue</Button>
    </>
  );

  return (
    <Dialog
      open={open}
      title={step === 'mode' && project ? `Open ${project.name}` : 'Open model'}
      subtitle={step === 'project' ? 'Choose the project you want to work on' : 'Choose how you want to work before opening the canvas'}
      icon={Database}
      onClose={onClose}
      footer={footer}
      width={620}
    >
      {step === 'project' ? (
        <div className="dmh-projpick-wrap">
          <div className="dmh-openmodel-step">Step <b>1</b> of 2 · Project</div>
          {loading ? (
            <div className="dmh-openmodel-nodrafts">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="dmh-openmodel-nodrafts">There are no projects yet.</div>
          ) : (
            <ProjectPicker projects={projects} meta={meta} selectedId={projectId} onSelect={setProjectId} />
          )}
          {onNewProject && (
            <Button variant="secondary" size="sm" icon={FolderPlus} className="dmh-openmodel-new" onClick={onNewProject}>
              New project…
            </Button>
          )}
        </div>
      ) : (
        <div className="dmh-openmodel">
          <div className="dmh-openmodel-step">Step <b>2</b> of 2 · Mode · <b>{project?.name}</b></div>
          {/* option 1 — read-only production */}
          <button
            type="button"
            className={`dmh-openmodel-opt${mode === 'readonly' ? ' is-selected' : ''}`}
            onClick={() => setMode('readonly')}
            disabled={!hasProduction}
          >
            <span className="dmh-openmodel-ico dmh-openmodel-ico--blue">
              <Eye size={21} strokeWidth={1.5} aria-hidden />
            </span>
            <span className="dmh-openmodel-main">
              <span className="dmh-openmodel-row">
                <span className="dmh-openmodel-name">View production (read-only)</span>
                {publishedLabel && <span className="dmh-openmodel-tag">{publishedLabel} · current</span>}
              </span>
              <span className="dmh-openmodel-desc">
                {hasProduction
                  ? 'Explore the production model. Several people can view it at once without locking it.'
                  : 'No production version has been published for this project yet.'}
              </span>
            </span>
            <span className="dmh-openmodel-radio">{mode === 'readonly' && <span className="dot" />}</span>
          </button>

          {/* option 2 — snapshot from production */}
          <button
            type="button"
            className={`dmh-openmodel-opt${mode === 'snapshot' ? ' is-selected' : ''}`}
            onClick={() => setMode('snapshot')}
            disabled={!hasProduction}
          >
            <span className="dmh-openmodel-ico dmh-openmodel-ico--purple">
              <GitBranch size={21} strokeWidth={1.5} aria-hidden />
            </span>
            <span className="dmh-openmodel-main">
              <span className="dmh-openmodel-name">Create new version from production</span>
              <span className="dmh-openmodel-desc">
                {hasProduction
                  ? `Take a snapshot of ${publishedLabel ?? 'production'} and edit your own copy. On publish, production of this project is overwritten (last to publish wins).`
                  : 'Publish a production version first to snapshot from it.'}
              </span>
            </span>
            <span className="dmh-openmodel-radio">{mode === 'snapshot' && <span className="dot" />}</span>
          </button>

          {/* option 3 — continue a working version (drafts of THIS project) */}
          <button
            type="button"
            className={`dmh-openmodel-opt${mode === 'continue' ? ' is-selected' : ''}`}
            onClick={() => setMode('continue')}
            disabled={drafts.length === 0}
          >
            <span className="dmh-openmodel-ico dmh-openmodel-ico--amber">
              <List size={21} strokeWidth={1.5} aria-hidden />
            </span>
            <span className="dmh-openmodel-main">
              <span className="dmh-openmodel-name">Continue a working version</span>
              <span className="dmh-openmodel-desc">Resume one of your drafts (working copies) of this project where you left off.</span>
              {drafts.length === 0 ? (
                <span className="dmh-openmodel-nodrafts">You have no working versions in progress for this project.</span>
              ) : (
                mode === 'continue' && (
                  <span className="dmh-openmodel-drafts">
                    {drafts.map((d) => {
                      const selected = d.id === selectedDraftId;
                      return (
                        <span
                          key={d.id}
                          role="button"
                          tabIndex={0}
                          className={`dmh-openmodel-draft${selected ? ' is-selected' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setSelectedDraftId(d.id); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedDraftId(d.id);
                            }
                          }}
                        >
                          <span className="dmh-openmodel-draft-label">{d.versionLabel ?? 'draft'}</span>
                          <span className="dmh-openmodel-draft-meta">
                            {d.title ? `${d.title} · ` : ''}
                            {userName(d.owner)}
                            {/* Doc 104: draft recibido por una transferencia. */}
                            {d.transfers?.length ? ` · received from ${userName(d.transfers[d.transfers.length - 1].from)}` : ''}
                          </span>
                          {selected ? (
                            <span className="dmh-openmodel-draft-check">
                              <Check size={14} strokeWidth={2} aria-hidden />
                            </span>
                          ) : (
                            <ChevronDown size={13} strokeWidth={1.6} aria-hidden style={{ marginLeft: 'auto', color: 'var(--text-muted-2)' }} />
                          )}
                        </span>
                      );
                    })}
                  </span>
                )
              )}
            </span>
            <span className="dmh-openmodel-radio">{mode === 'continue' && <span className="dot" />}</span>
          </button>
        </div>
      )}
    </Dialog>
  );
}
