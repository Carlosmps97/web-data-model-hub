/**
 * PublishModal: envía la working copy a aprobación.
 *
 * Se abre desde el botón verde **Publish** del toolbar del canvas. Se dibuja
 * sobre el Dialog del sistema de diseño con el backdrop **canvas**, de modo que
 * solo se oscurece la superficie de modelado bajo el toolbar de 64px y el
 * toolbar queda nítido (patrón de popup del diseño). El usuario completa Title +
 * Description, elige uno o más **revisores** (chips conmutables con avatar +
 * nombre) y envía la working copy (`activeChangesetId`) a aprobación vía
 * `submit(id, {title, description, reviewers})` → estado `submitted`.
 *
 * Guardas:
 *  - Sin `activeChangesetId` (p. ej. abierto en solo lectura): muestra un aviso
 *    y deshabilita el envío; primero hay que abrir una versión editable.
 *  - Se requiere al menos un revisor para enviar.
 *  - Si la versión cambia objetos que otra versión borró y publicó, el envío se
 *    bloquea (409 `deleted_in_production`): el popup lista esos objetos con su
 *    nombre y su id y ofrece descartar esos cambios; después se envía de nuevo.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowUpToLine, Check, Info, ShieldAlert, Trash2 } from 'lucide-react';

import { Avatar, Button, Dialog } from '@/components/ui';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { historyRunning, useUndoStore } from '@/store/useUndoStore';
import { runBlocking } from '@/store/useBusyStore';
import { apiErrorMessage, errorReason } from '@/services/http';
import { canvasSessionKey } from '../lib/canvasSession';
import { stillAskedSession } from '../lib/sessionGuard';
import {
  discardDeleted, getPublished, listUserNames, listUsers, publishBlockedDetail, submit,
} from '@/services/versioning.service';
import { blockedTitle, fmtWhen, groupBlockedItems, itemContext, itemLabel, itemWhere } from '@/screens/review/publishBlocked';
import type { PublishBlockedDetail, SimUserDto } from '@/types/versioning';

export interface PublishModalProps {
  open: boolean;
  onClose: () => void;
}

/** Tono de avatar determinista: cada revisor conserva el mismo color. */
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
  // La working copy borra su proyecto: se avisa antes de enviar.
  const deletesProject = useModelerStore((s) => s.projectDeletionPending);
  const projectName = useModelerStore((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name ?? null);

  const [users, setUsers] = useState<SimUserDto[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Objetos que otra versión borró y que esta cambia: bloquean el envío.
  const [blocked, setBlocked] = useState<PublishBlockedDetail | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  // Foco: con el bloqueo va a «Discard»; al descartar, de vuelta a «Send».
  const discardRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const focusSend = useRef(false);

  // Reinicia el formulario cada vez que se abre el modal y luego carga la lista de revisores.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setReviewers([]);
    setSubmitting(false);
    setBlocked(null);
    setDiscarding(false);

    let cancelled = false;
    setUsersLoading(true);
    // Solo usuarios que pueden decidir (rol con `review.decide`): asignar a
    // alguien sin ese permiso dejaría el request trabado (unanimidad imposible)
    // y ese revisor recibiría un 403 al intentar aprobar.
    listUsers('review.decide', projectId)
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
  }, [open, projectId]);

  // Nombres de quienes publicaron los borrados (best-effort: sin la lista, el id).
  useEffect(() => {
    if (!blocked) return;
    let cancelled = false;
    listUserNames()
      .then((rows) => { if (!cancelled) setNames(Object.fromEntries(rows.map((u) => [u.id, u.name]))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [blocked]);
  const userName = (id: string) => names[id] ?? id;

  useEffect(() => {
    if (blocked && !discarding) discardRef.current?.focus();   // también tras un descarte que falló
  }, [blocked, discarding]);
  useEffect(() => {
    if (!discarding && !blocked && focusSend.current) {
      focusSend.current = false;
      sendRef.current?.focus();
    }
  }, [discarding, blocked]);

  const toggleReviewer = (id: string) =>
    setReviewers((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const hasChangeset = Boolean(changesetId);
  const canSend = hasChangeset && reviewers.length > 0 && !submitting && !blocked && !discarding;

  const handleSend = async () => {
    if (!changesetId || !canSend || !projectId) return;
    // Un Undo/Redo en vuelo seguiría escribiendo en la versión que se envía.
    const running = historyRunning('send');
    if (running) { toast.error(running); return; }
    setSubmitting(true);
    try {
      await runBlocking('Sending for approval…', () => submit(changesetId, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        reviewers,
      }));
      // Enviado = checkpoint: la sesión no conserva cambios "sin guardar".
      useModelerStore.getState().clearDirty();
      // La working copy salió de `draft` (submitted): el backend rechaza nuevas
      // ediciones (409). Transiciona la sesión a solo lectura (producción del
      // proyecto) para no dejar al usuario "editando" una versión bloqueada.
      const pub = await getPublished(projectId).catch(() => null);
      useSessionStore.getState().openModel({ projectId, mode: 'readonly', versionLabel: pub?.versionLabel ?? null });
      toast.success('Request sent — the canvas is now read-only (production)');
      onClose();
    } catch (err: unknown) {
      const detail = publishBlockedDetail(err);
      // Lo que otra versión borró: la lista completa queda en el popup, con la
      // acción para descartarlo (un toast la truncaría).
      if (detail?.code === 'deleted_in_production') setBlocked(detail);
      else toast.error(err instanceof Error ? err.message : "Couldn't send the request.");
      setSubmitting(false);
    }
  };

  const handleDiscard = async () => {
    if (!changesetId || discarding) return;
    // Un Undo/Redo en vuelo podría volver a escribir sobre lo descartado.
    const running = historyRunning('discard');
    if (running) { toast.error(running); return; }
    setDiscarding(true);
    const asked = useSessionStore.getState();
    const askedKey = canvasSessionKey(asked);
    try {
      const res = await runBlocking('Discarding changes…', () => discardDeleted(changesetId));
      setBlocked(null);
      focusSend.current = true;
      if (useSessionStore.getState().activeChangesetId === changesetId) {
        // Los cambios quitados no están en la pila de Undo: una inversa previa
        // podría volver a ponerlos (misma política que una carga Excel). El
        // canvas y el Explorer pasan a mostrar la versión sin esos cambios; un
        // fallo del refresco se avisa con el criterio de sessionGuard.
        useUndoStore.getState().clear();
        await useModelerStore.getState().refreshExplorer().catch(async (e: unknown) => {
          const current = () => canvasSessionKey(useSessionStore.getState());
          if (!(await stillAskedSession(e, asked.activeChangesetId, askedKey, current))) return;
          toast.error(`Couldn't reload the explorer: ${errorReason(e, 'unknown error')}. Use Refresh to try again.`,
            { id: `dmh-explorer-load:${askedKey}` });
        });
      }
      const n = res.discarded.length;
      toast.success(n
        ? `${n} ${n === 1 ? 'change' : 'changes'} discarded — you can send the version now`
        : 'Nothing left to discard — you can send the version now');
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Couldn't discard the changes."));
    } finally {
      setDiscarding(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button ref={sendRef} variant="success" icon={ArrowUpToLine} onClick={handleSend} disabled={!canSend}>
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
        {blocked && (
          <section className="dmh-rvb" role="alert" aria-label="Changes on deleted objects">
            <div className="dmh-rvb-head">
              <ShieldAlert size={18} strokeWidth={1.7} aria-hidden />
              <div style={{ minWidth: 0 }}>
                <div className="dmh-rvb-title">{blockedTitle(blocked)}</div>
                <div className="dmh-rvb-sub">
                  Nothing was sent. Discard your changes on these objects, then send the version again.
                </div>
              </div>
            </div>
            {groupBlockedItems(blocked.items).map((g) => (
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
                          <span className="mono">{itemLabel(it)}</span>
                          {ctx && <span className="dmh-rvb-ctx">{ctx}</span>}
                        </div>
                        <div className="dmh-rvb-where">{itemWhere(it, fmtWhen, userName)}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div className="dmh-rvb-next">
              <Button ref={discardRef} variant="danger" icon={Trash2} onClick={handleDiscard} disabled={discarding}>
                Discard changes on deleted objects
              </Button>
            </div>
          </section>
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
