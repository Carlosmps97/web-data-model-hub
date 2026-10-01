/**
 * TransferVersionDialog (doc 104) — pasa un DRAFT a otro usuario desde
 * Home › Version tools › Version details. Lo abre su dueño o un
 * administrador (también para asignárselo a sí mismo).
 *
 * Sólo ofrece usuarios cuyo rol edita modelos (`model.edit`), sin el dueño
 * actual: quien la reciba debe poder editarla y enviarla. La nota es opcional
 * y queda en la historia de la versión. El backend re-valida todo (403/409/400
 * con mensaje legible, que se muestra acá sin cerrar el diálogo).
 *
 * Pinta por ENCIMA del popup de herramientas (`dmh-backdrop--top`) y consume
 * su propio ESC en captura para no cerrar también el popup de abajo. El foco
 * entra al diálogo al abrirse (y al selector cuando la lista termina de
 * cargar) y Tab no sale de él; el popup de abajo queda `inert` mientras tanto.
 * Viaja el dueño que mostraba la pantalla (`expectedOwner`): si otra sesión lo
 * cambió en el medio, el backend responde 409 y no se mueve el draft ajeno.
 */
import { useEffect, useRef, useState } from 'react';
import { trapTab } from '@/components/ui/focusTrap';
import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { ApiError, apiErrorMessage } from '@/services/http';
import { listUsers, transferVersion } from '@/services/versioning.service';
import { transferTargets } from '@/lib/versionAdmin';
import type { ChangesetDetail, SimUserDto } from '@/types/versioning';

export default function TransferVersionDialog({
  version, me, userName, onClose, onTransferred, onStale, returnFocus,
}: {
  version: ChangesetDetail;
  me: string | null;
  userName: (id?: string | null) => string;
  onClose: () => void;
  onTransferred: (updated: ChangesetDetail) => void;
  /** La versión cambió por fuera (403/404/409): el padre recarga lista y
   *  detalle; este diálogo sigue abierto con el motivo. */
  onStale: (status: number) => void;
  /** Adónde va el foco al cerrar si quien abrió el diálogo ya no está en
   *  pantalla (el padre recargó el detalle y re-creó el botón). */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const [users, setUsers] = useState<SimUserDto[] | null>(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sube cuando un 400 dice que la lista quedó vieja (el destino perdió el rol).
  const [usersTick, setUsersTick] = useState(0);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al abrir (el botón Transfer): lo recupera al cerrar.
  const openerRef = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const label = version.versionLabel ?? 'this version';
  const mine = !!me && version.owner === me;

  useEffect(() => {
    let alive = true;
    listUsers('model.edit')
      .then((rows) => {
        if (!alive) return;
        const targets = transferTargets(rows, version.owner);
        setUsers(targets);
        setTo((cur) => (targets.some((u) => u.id === cur) ? cur : ''));
      })
      .catch((e: unknown) => { if (alive) { setUsers([]); setError(apiErrorMessage(e, "Couldn't load the users.")); } });
    return () => { alive = false; };
  }, [version.owner, usersTick]);

  // Foco: al abrir, el diálogo (el selector está deshabilitado mientras carga
  // la lista); cuando la lista llega, el selector — sólo si el usuario no
  // movió el foco (p. ej. ya está escribiendo la nota). Al cerrar, vuelve a
  // quien abrió el diálogo si sigue en pantalla; si no, a lo que indique el
  // padre (`returnFocus` lee el DOM al cerrar: la primera versión alcanza).
  useEffect(() => {
    boxRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      const usable = (el: Element | null | undefined): el is HTMLElement =>
        el instanceof HTMLElement && el.isConnected && !(el as HTMLButtonElement).disabled;
      const target = usable(opener) ? opener : returnFocus?.();
      if (usable(target)) target.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = users !== null;
  useEffect(() => {
    if (loaded && document.activeElement === boxRef.current) selectRef.current?.focus();
  }, [loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);


  const submit = async () => {
    if (!to || busy) return;
    // Al deshabilitarse el botón enfocado el navegador manda el foco a <body>
    // (y Tab escaparía a la página de atrás): el foco queda en el diálogo.
    boxRef.current?.focus();
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      onTransferred(await transferVersion(version.id, {
        to, ...(trimmed ? { note: trimmed } : {}), expectedOwner: version.owner,
      }));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't transfer the version."));
      if (e instanceof ApiError) {
        if (e.status === 400) setUsersTick((t) => t + 1);      // la lista de destinos quedó vieja
        if (e.status === 403 || e.status === 404 || e.status === 409) onStale(e.status);
      }
      setBusy(false);
    }
  };

  return (
    <div className="dmh-backdrop dmh-backdrop--top" role="presentation">
      <div
        className="dmh-modal"
        style={{ width: 500, outline: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dmh-transfer-title"
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, boxRef.current)}
      >
        <div className="m-body">
          <h3 id="dmh-transfer-title" className="rd-h3" style={{ marginBottom: 6 }}>
            Transfer ownership · {label}
          </h3>
          <p className="dmh-vt-desc">
            The new owner can edit this draft, send it for approval and will appear as its author once it is
            published. The version keeps a record of who started it and of every transfer.
          </p>

          <label className="rd-label" htmlFor="dmh-transfer-to">New owner</label>
          <select
            id="dmh-transfer-to"
            ref={selectRef}
            className="rd-input"
            value={to}
            disabled={busy || users === null}
            onChange={(e) => { setTo(e.target.value); setError(null); }}
          >
            <option value="">{users === null ? 'Loading users…' : 'Choose a user…'}</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.id === me ? `${u.name} (you)` : u.name}</option>
            ))}
          </select>
          {users !== null && users.length === 0 && !error && (
            <div className="dmh-vt-none" style={{ marginTop: 6 }}>
              No other user can edit models — ask an administrator to assign the role first.
            </div>
          )}

          <label className="rd-label" htmlFor="dmh-transfer-note" style={{ marginTop: 14 }}>Note (optional)</label>
          <textarea
            id="dmh-transfer-note"
            className="rd-input"
            rows={2}
            maxLength={500}
            disabled={busy}
            placeholder="e.g. On vacation until Oct 15 — Carla continues these changes"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="dmh-vt-warn" style={{ marginTop: 14, marginBottom: 0 }}>
            <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
            <span>
              {mine
                ? 'You will no longer be able to edit it. Save your work in the canvas first — unsaved changes are lost.'
                : `${userName(version.owner)} will no longer be able to edit it. If they have it open, their unsaved changes are lost.`}
            </span>
          </div>
          {error && <div className="dmh-vt-error" role="alert">{error}</div>}
        </div>
        <div className="m-foot">
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={!to || busy} onClick={() => void submit()}>
            {busy ? <span className="rd-spin" aria-hidden /> : <ArrowRightLeft size={13} strokeWidth={1.8} aria-hidden />}
            Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
