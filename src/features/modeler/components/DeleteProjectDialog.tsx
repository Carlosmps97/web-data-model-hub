import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui';
import { getProjectCounts } from '@/services/projects.service';
import { apiErrorMessage, errorReason } from '@/services/http';
import { runBlocking } from '@/store/useBusyStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { Project } from '@/types/model';
import type { ScopeCounts } from '@/types/versioning';
import { canvasSessionKey } from '../lib/canvasSession';
import { deletionSummary, nameMatches } from '../lib/projectDeletion';
import { afterRevalidation, touchesVersion } from '../lib/sessionGuard';

/**
 * DeleteProjectDialog (doc 75 D5) — el borrado se GRABA en la working copy y
 * sólo ocurre al aprobarla; el revisor lo ve como cambio crítico. Confirmación
 * tipeada con el nombre exacto del proyecto.
 */
export default function DeleteProjectDialog({ open, project, onClose, onDeleted }: {
  open: boolean; project: Project; onClose: () => void; onDeleted: () => void;
}) {
  const [counts, setCounts] = useState<ScopeCounts | null>(null);
  // Doc 105 (O5): el conteo sólo INFORMA. Antes, si fallaba, el texto quedaba
  // en «Counting…» y el botón deshabilitado para siempre; ahora lo dice, ofrece
  // Retry y la confirmación tipeada basta para borrar.
  const [countError, setCountError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [typed, setTyped] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);
  const deleteProject = useModelerStore((s) => s.deleteProject);

  useEffect(() => {
    if (!open) return;
    setCounts(null); setCountError(null);
    let live = true;
    void getProjectCounts(project.id)
      .then((c) => { if (live) setCounts(c); })
      // Doc 105 (ronda 5): sin el «— try again…» del transporte: el aviso ya ofrece Retry.
      .catch((e) => { if (live) setCountError(errorReason(e, 'unknown error')); });
    return () => { live = false; };
  }, [open, project.id, attempt]);
  useEffect(() => { if (open) setTyped(''); }, [open, project.id]);

  const ok = (counts != null || countError != null) && nameMatches(typed, project.name);
  const confirm = async () => {
    const asked = useSessionStore.getState();
    const askedKey = canvasSessionKey(asked);
    try {
      await runBlocking('Recording project deletion…', () => deleteProject(project.id));
    } catch (e) {
      // Doc 105 (F1): antes el rechazo quedaba sin manejar y sin aviso. El
      // diálogo sigue abierto con el motivo. Un 403/404/409 de la versión
      // (escritura: criterio de los guardados del canvas) espera la
      // revalidación: si cambió la sesión (transferida, eliminada, enviada),
      // ella avisó y el diálogo ya no tiene sentido.
      if (touchesVersion(e, asked.activeChangesetId)) await afterRevalidation();
      if (canvasSessionKey(useSessionStore.getState()) !== askedKey) { onClose(); return; }
      const reason = apiErrorMessage(e, '').replace(/[.\s]+$/, '');
      toast.error(reason ? `Couldn't record the project deletion: ${reason}.` : "Couldn't record the project deletion.");
      return;
    }
    onDeleted();
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Delete project «${project.name}»?`} icon={AlertTriangle} width={520}
      footer={<>
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" disabled={!ok} onClick={() => void confirm()}>Delete project</button>
      </>}>
      {/* Región viva (doc 105): el conteo, su error y el reintento se anuncian. */}
      <p className="dmh-delproj-text" role="status">
        {counts ? deletionSummary(project.name, counts)
          : countError ? <>Couldn't count the project contents: {countError}. Everything in the project will still be deleted.{' '}
            {/* Retry desaparece al pulsarlo: el foco pasa al nombre, no a <body>. */}
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm"
              onClick={() => { nameRef.current?.focus(); setAttempt((n) => n + 1); }}>Retry</button></>
            : 'Counting project contents…'}
      </p>
      <p className="dmh-delproj-text">The deletion only happens when this working copy is approved; the approver will see it as a critical change.</p>
      <label className="dmh-delproj-label">Type the project name to confirm
        <input className="rd-input" ref={nameRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={project.name} autoFocus />
      </label>
    </Dialog>
  );
}
