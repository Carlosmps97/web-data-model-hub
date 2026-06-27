/**
 * OpenModelModal (pg) — "Open model — choose version and mode".
 *
 * Launched from Home (NOT over the canvas), so it uses the design-system Dialog
 * with the default `screen` backdrop. Three selectable modes (radio cards):
 *
 *   1. View production (read-only)  → openModel({mode:'readonly', versionLabel})
 *                                      → navigate('/model')
 *   2. Snapshot from production      → snapshot({...}) → openModel({mode:'editing',
 *                                      changesetId, versionLabel}) → navigate('/model')
 *   3. Continue a working version    → pick one of the actor's drafts →
 *                                      openModel({mode:'editing', changesetId}) → /model
 *
 * NO "Don't ask again" checkbox (removed from the design). Cancel / Esc close
 * without navigating. "Continue" performs the selected action.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Check, ChevronDown, Database, Eye, GitBranch, List } from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import { useSessionStore } from '@/store/useSessionStore';
import { listVersions, snapshot } from '@/services/versioning.service';
import type { SimUserDto, VersionRow } from '@/types/versioning';

type Mode = 'readonly' | 'snapshot' | 'continue';

export interface OpenModelModalProps {
  open: boolean;
  onClose: () => void;
  /** Current production version (drives the read-only / snapshot labels). */
  published: VersionRow | null;
  /** Project name for the modal title (or null → generic). */
  projectName?: string | null;
  /** Project id seeded into the snapshot body when a project filter is active. */
  defaultProjectId?: string | null;
  /** Users (id→name) to label the drafts list. */
  users: SimUserDto[];
}

export default function OpenModelModal({
  open,
  onClose,
  published,
  projectName,
  defaultProjectId,
  users,
}: OpenModelModalProps) {
  const navigate = useNavigate();
  const actor = useSessionStore((s) => s.user);
  const openModel = useSessionStore((s) => s.openModel);

  const [mode, setMode] = useState<Mode>('readonly');
  const [drafts, setDrafts] = useState<VersionRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const publishedLabel = published?.versionLabel ?? null;
  const hasProduction = Boolean(published);

  // Reset selection each time the modal opens, then load the actor's drafts.
  useEffect(() => {
    if (!open) return;
    setMode('readonly');
    setSelectedDraftId(null);
    setSubmitting(false);

    let cancelled = false;
    setDraftsLoading(true);
    listVersions()
      .then((rows) => {
        if (cancelled) return;
        const mine = rows.filter((v) => v.status === 'draft' && v.owner === actor.id);
        setDrafts(mine);
        setSelectedDraftId(mine[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load your working versions.');
      })
      .finally(() => {
        if (!cancelled) setDraftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, actor.id]);

  const userName = useMemo(
    () => (id?: string | null) =>
      (id ? users.find((u) => u.id === id)?.name : undefined) ?? id ?? 'you',
    [users],
  );

  // "Continue" is only actionable when the selected mode has a valid target.
  const canContinue = useMemo(() => {
    if (submitting) return false;
    if (mode === 'readonly') return hasProduction;
    if (mode === 'snapshot') return hasProduction;
    return Boolean(selectedDraftId);
  }, [mode, hasProduction, selectedDraftId, submitting]);

  const handleContinue = async () => {
    if (!canContinue) return;

    if (mode === 'readonly') {
      openModel({ mode: 'readonly', versionLabel: publishedLabel });
      onClose();
      navigate('/model');
      return;
    }

    if (mode === 'snapshot') {
      setSubmitting(true);
      try {
        const created = await snapshot({
          projectIds: defaultProjectId ? [defaultProjectId] : [],
        });
        openModel({
          mode: 'editing',
          changesetId: created.id,
          versionLabel: created.versionLabel,
        });
        toast.success(
          created.versionLabel
            ? `Working copy ${created.versionLabel} created.`
            : 'Working copy created.',
        );
        onClose();
        navigate('/model');
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Could not create the working copy.');
        setSubmitting(false);
      }
      return;
    }

    // continue
    const draft = drafts.find((d) => d.id === selectedDraftId);
    if (!draft) return;
    openModel({ mode: 'editing', changesetId: draft.id, versionLabel: draft.versionLabel });
    onClose();
    navigate('/model');
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" iconRight={ArrowRight} onClick={handleContinue} disabled={!canContinue}>
        Continue
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      title={projectName ? `Open ${projectName}` : 'Open model'}
      subtitle="Choose how you want to work before opening the canvas"
      icon={Database}
      onClose={onClose}
      footer={footer}
      width={620}
    >
      <div className="dmh-openmodel">
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
              {publishedLabel && (
                <span className="dmh-openmodel-tag">{publishedLabel} · current</span>
              )}
            </span>
            <span className="dmh-openmodel-desc">
              {hasProduction
                ? 'Explore the production model. Several people can view it at once without locking it.'
                : 'No production version has been published yet.'}
            </span>
          </span>
          <span className="dmh-openmodel-radio">
            {mode === 'readonly' && <span className="dot" />}
          </span>
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
                ? `Take a snapshot of ${publishedLabel ?? 'production'} and edit your own copy. On publish, production is overwritten (last to publish wins).`
                : 'Publish a production version first to snapshot from it.'}
            </span>
          </span>
          <span className="dmh-openmodel-radio">
            {mode === 'snapshot' && <span className="dot" />}
          </span>
        </button>

        {/* option 3 — continue a working version (drafts) */}
        <button
          type="button"
          className={`dmh-openmodel-opt${mode === 'continue' ? ' is-selected' : ''}`}
          onClick={() => setMode('continue')}
          disabled={!draftsLoading && drafts.length === 0}
        >
          <span className="dmh-openmodel-ico dmh-openmodel-ico--amber">
            <List size={21} strokeWidth={1.5} aria-hidden />
          </span>
          <span className="dmh-openmodel-main">
            <span className="dmh-openmodel-name">Continue a working version</span>
            <span className="dmh-openmodel-desc">
              Resume one of your drafts (working copies) where you left off.
            </span>

            {draftsLoading ? (
              <span className="dmh-openmodel-nodrafts">Loading your drafts…</span>
            ) : drafts.length === 0 ? (
              <span className="dmh-openmodel-nodrafts">You have no working versions in progress.</span>
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
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDraftId(d.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedDraftId(d.id);
                          }
                        }}
                      >
                        <span className="dmh-openmodel-draft-label">
                          {d.versionLabel ?? 'draft'}
                        </span>
                        <span className="dmh-openmodel-draft-meta">
                          {d.title ? `${d.title} · ` : ''}
                          {userName(d.owner)}
                        </span>
                        {selected ? (
                          <span className="dmh-openmodel-draft-check">
                            <Check size={14} strokeWidth={2} aria-hidden />
                          </span>
                        ) : (
                          <ChevronDown
                            size={13}
                            strokeWidth={1.6}
                            aria-hidden
                            style={{ marginLeft: 'auto', color: 'var(--text-muted-2)' }}
                          />
                        )}
                      </span>
                    );
                  })}
                </span>
              )
            )}
          </span>
          <span className="dmh-openmodel-radio">
            {mode === 'continue' && <span className="dot" />}
          </span>
        </button>
      </div>
    </Dialog>
  );
}
