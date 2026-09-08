/**
 * PublishModal (Screen 04b — "Publish request, request approval", ppub).
 *
 * Opened from the canvas toolbar's green **Publish** button. Renders over the
 * design-system Dialog with the **canvas** backdrop, so only the modeling
 * surface below the 64px toolbar is dimmed+blurred while the toolbar stays
 * sharp (the design's popup pattern). The user fills a Title + Description,
 * picks one or more **reviewers** (toggle chips with avatar + name), and sends
 * the working copy (`activeChangesetId`) for approval via
 * `submit(id, {title, description, reviewers})` → status `submitted`.
 *
 * Guards:
 *  - No `activeChangesetId` (e.g. opened read-only): show a hint and disable
 *    sending — you must open an editable version first.
 *  - At least one reviewer is required to send.
 *
 * NOTE: this is wiring + UI only; the changeset/session reconciliation is R4-0.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowUpToLine, Check, Info } from 'lucide-react';

import { Avatar, Button, Dialog } from '@/components/ui';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { runBlocking } from '@/store/useBusyStore';
import { getPublished, listUsers, submit } from '@/services/versioning.service';
import type { SimUserDto } from '@/types/versioning';

export interface PublishModalProps {
  open: boolean;
  onClose: () => void;
}

/** Deterministic avatar tone so each reviewer keeps the same color. */
const TONES = ['blue', 'purple', 'green', 'navy'] as const;
const toneFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
};

export default function PublishModal({ open, onClose }: PublishModalProps) {
  const changesetId = useSessionStore((s) => s.activeChangesetId);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  const projectId = useSessionStore((s) => s.activeProjectId);
  // Doc 75 D5/D20: la working copy borra su proyecto — se avisa ANTES de enviar.
  const deletesProject = useModelerStore((s) => s.projectDeletionPending);
  const projectName = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name ?? null);

  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the modal opens, then load the reviewer list.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setReviewers([]);
    setSubmitting(false);

    let cancelled = false;
    setUsersLoading(true);
    // Solo usuarios que PUEDEN decidir (rol con `review.decide`): asignar a
    // alguien sin ese permiso dejaba el request trabado (unanimidad imposible)
    // y ese revisor recibía un 403 al intentar aprobar.
    listUsers('review.decide')
      .then((rows) => {
        if (!cancelled) setUsers(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Couldn't load the reviewers.");
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleReviewer = (id: string) =>
    setReviewers((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const hasChangeset = Boolean(changesetId);
  const canSend = hasChangeset && reviewers.length > 0 && !submitting;

  const handleSend = async () => {
    if (!changesetId || !canSend || !projectId) return;
    setSubmitting(true);
    try {
      await runBlocking('Sending for approval…', () => submit(changesetId, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        reviewers,
      }));
      // Publicado = checkpoint: ya no hay cambios "sin guardar" en la sesión.
      useModelerStore.getState().clearDirty();
      // La working copy salió de `draft` (submitted): el backend rechaza nuevas
      // ediciones (409). Transiciona la sesión a SOLO LECTURA (producción del
      // proyecto) para no dejar al usuario "editando" una versión bloqueada.
      const pub = await getPublished(projectId).catch(() => null);
      useSessionStore.getState().openModel({ projectId, mode: 'readonly', versionLabel: pub?.versionLabel ?? null });
      toast.success('Request sent — the canvas is now read-only (production)');
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the request.");
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="success" icon={ArrowUpToLine} onClick={handleSend} disabled={!canSend}>
        Send for Approval
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      title="Publish — request approval"
      subtitle={versionLabel ? `Working copy ${versionLabel}` : 'Send your working copy for review'}
      icon={ArrowUpToLine}
      onClose={onClose}
      footer={footer}
      width={560}
      backdrop="canvas"
      canvasTop={136}
    >
      <div className="ppub">
        {!hasChangeset && (
          <div className="ppub-hint">
            Open an editable version (Open model) to publish.
          </div>
        )}
        {deletesProject && (
          <div className="dmh-rv-critical" role="alert">
            <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />
            <div>
              <strong>This working copy deletes project «{projectName ?? '…'}».</strong>{' '}
              The reviewer will be asked to confirm the deletion explicitly.
            </div>
          </div>
        )}

        <label className="ppub-field">
          <span className="ppub-label">Title</span>
          <input
            className="rd-input"
            placeholder="Change summary (e.g. Adds transactions table)"
            value={title}
            disabled={!hasChangeset}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="ppub-field">
          <span className="ppub-label">Description</span>
          <textarea
            className="rd-input ppub-textarea"
            placeholder="Detail of what changed and why (optional)"
            value={description}
            disabled={!hasChangeset}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="ppub-field">
          <span className="ppub-label">
            Reviewers
            <span className="ppub-req">· at least 1</span>
          </span>
          {usersLoading ? (
            <div className="ppub-loading">Loading reviewers…</div>
          ) : (
            <div className="ppub-reviewers">
              {users.map((u) => {
                const selected = reviewers.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`ppub-reviewer${selected ? ' is-selected' : ''}`}
                    onClick={() => toggleReviewer(u.id)}
                    disabled={!hasChangeset}
                    aria-pressed={selected}
                  >
                    <Avatar initials={u.initials} size={24} tone={toneFor(u.id)} />
                    <span className="ppub-reviewer-name">{u.name}</span>
                    {selected && (
                      <span className="ppub-reviewer-check">
                        <Check size={14} strokeWidth={2.4} aria-hidden />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="ppub-info">
          <Info size={15} strokeWidth={1.7} aria-hidden />
          <span>The assigned reviewers must approve before publishing.</span>
        </div>
      </div>
    </Dialog>
  );
}
