/**
 * Doc 104 — qué pasa con la sesión de canvas cuando su versión cambió POR
 * FUERA: otra sesión la transfirió, la eliminó, la envió a revisión o la
 * decidió. Puro: WorkspaceScreen lo aplica al entrar a Model y cuando una
 * respuesta 403/404/409 de ESA versión (`touchesChangeset`) avisa que cambió,
 * en vez de dejar un canvas que falla en cada guardado o, peor, que muestra
 * otra cosa sin avisar.
 */
import { ApiError } from '@/services/http';
import { canOpenVersion, isAsOfChangesetId } from '@/services/versioning.service';
import { useSessionStore, type OpenMode } from '@/store/useSessionStore';
import type { VersionStatus } from '@/types/versioning';
import { canvasSessionKey } from './canvasSession';

export type SessionFate =
  | { kind: 'keep' }
  /** La versión ya no existe: vuelve al chooser (Open model). */
  | { kind: 'close'; message: string }
  /** Solo lectura sobre la misma versión o, con `changesetId: null`, producción. */
  | { kind: 'readonly'; changesetId: string | null; message: string };

export interface SessionVersionState {
  status: VersionStatus;
  owner: string | null;
  reviewers?: string[];
  appliedAt?: string | null;
}

const STATUS_TEXT: Record<VersionStatus, string> = {
  draft: 'draft',
  submitted: 'sent to review',
  approved: 'published',
  rejected: 'rejected',
};

export function sessionFate(args: {
  mode: OpenMode;
  changesetId: string;
  versionLabel: string | null;
  me: string;
  /** `versions.view_all` o `admin.manage`: puede ver versiones ajenas. */
  canViewAll: boolean;
  /** Cabecera actual de la versión; null = ya no existe (404). */
  cs: SessionVersionState | null;
  userName: (id: string) => string;
}): SessionFate {
  const { mode, changesetId, versionLabel, me, canViewAll, cs, userName } = args;
  const label = versionLabel ? `Version ${versionLabel}` : 'This version';
  if (!cs) return { kind: 'close', message: `${label} was deleted — pick another version to keep working.` };
  const visible = canOpenVersion(cs, me, () => canViewAll);
  if (mode === 'editing') {
    if (cs.status === 'draft' && cs.owner === me) return { kind: 'keep' };
    // Una sesión de edición es siempre del dueño: si el dueño ya no es el
    // actor, la versión cambió de manos (doc 104).
    if (cs.owner !== me) {
      const moved = cs.owner ? `was transferred to ${userName(cs.owner)}` : 'is no longer yours';
      return visible
        ? { kind: 'readonly', changesetId, message: `${label} ${moved}: the canvas is now read-only.` }
        : { kind: 'readonly', changesetId: null,
            message: `${label} ${moved}: you can no longer open it. Showing production (read-only).` };
    }
    return { kind: 'readonly', changesetId,
             message: `${label} is no longer in draft (${STATUS_TEXT[cs.status]}): the canvas is now read-only.` };
  }
  if (visible) return { kind: 'keep' };
  // Visor: no se sabe qué cambió (lo re-enviaron a otro revisor, o nunca pudo
  // verla — p.ej. un request ajeno abierto desde Review): no se afirma nada.
  return { kind: 'readonly', changesetId: null,
           message: `${label} isn't available to you: only its owner, its assigned reviewers and administrators `
             + 'can open it. Showing production (read-only).' };
}

/** ¿El error es de la versión ABIERTA (403 = ya no la puede ver o editar,
 *  404 = eliminada)? Quien lo reciba no debe concluir otra cosa (p.ej. «el
 *  proyecto se borró»): la revalidación de la sesión da el aviso correcto.
 *  Un 409 no cuenta: «This project was deleted.» sigue siendo del proyecto. */
export function isVersionError(e: unknown, changesetId: string | null | undefined): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404)
    && touchesChangeset(e.url ?? '', changesetId);
}

/** ¿Un 403/404/409 de la versión? Puede deberse a que cambió por fuera
 *  (transferida, eliminada, enviada) — o no (rol perdido, nombre duplicado,
 *  proxy): quien lo recibe espera la revalidación (`afterRevalidation`) y sólo
 *  calla si la sesión cambió (entonces ya hubo un aviso mejor). */
export function touchesVersion(e: unknown, changesetId: string | null | undefined): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 409)
    && touchesChangeset(e.url ?? '', changesetId);
}

// Revalidación de la sesión en curso (la registra WorkspaceScreen). Módulo:
// el store y el Explorer no conocen al componente.
let pendingRevalidation: Promise<void> | null = null;

/** Registra la revalidación en curso (sus errores no se propagan). */
export function trackRevalidation(p: Promise<void>): void {
  const tracked = p.catch(() => undefined);
  pendingRevalidation = tracked;
  void tracked.then(() => { if (pendingRevalidation === tracked) pendingRevalidation = null; });
}

/** Resuelve cuando termina la revalidación en curso (al instante si no hay). */
export async function afterRevalidation(): Promise<void> {
  await pendingRevalidation;
}

/** Doc 105 (F2): ¿se avisa el error de algo pedido en la sesión `askedKey`
 *  (`canvasSessionKey` al PEDIR) sobre la versión `askedCs`? Si es un error de
 *  esa versión, espera la revalidación. Calla si la sesión ya no es la pedida:
 *  la cambió la revalidación (ella avisó) o el usuario abrió otra (el error ya
 *  no le corresponde a lo que tiene en pantalla). */
export async function stillAskedSession(
  e: unknown, askedCs: string | null, askedKey: string | null, currentKey: () => string | null,
): Promise<boolean> {
  if (isVersionError(e, askedCs)) await afterRevalidation();
  return currentKey() === askedKey;
}

/** ¿Es la lectura de la CABECERA de la versión (`GET /api/changesets/{id}`)?
 *  Es la que hace la propia revalidación: su error no debe volver a dispararla
 *  (un 403 del proxy de Databricks la repetiría sin fin). */
export function isVersionHeaderUrl(url: string, changesetId: string | null | undefined): boolean {
  if (!changesetId || isAsOfChangesetId(changesetId)) return false;
  const esc = changesetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/api/changesets/${esc}($|[?#])`).test(url);
}

/** ¿La URL de una respuesta de error es de ESTA versión (en la ruta o en el
 *  query string)? Un snapshot `asof:` nunca: las publicadas no se transfieren
 *  ni se eliminan. */
export function touchesChangeset(url: string, changesetId: string | null | undefined): boolean {
  if (!changesetId || isAsOfChangesetId(changesetId)) return false;
  const esc = changesetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[/=])${esc}($|[/?&#])`).test(url);
}

// ── Doc 105 (H1): acciones atadas a la sesión donde empezaron ───────────────
// Los servicios toman la versión AL LLAMARLOS. Una acción de varias escrituras
// (la inversa de un Undo, borrar una tabla con su cascada) que sigue corriendo
// cuando se abre otra versión — u otro modo, u otro proyecto — escribiría lo
// que le falta en ESA sesión. El pin corta antes de cada escritura.

/** La sesión de canvas cambió mientras corría una acción de varias escrituras:
 *  lo que faltaba NO se escribió. Quien la pidió no lo avisa: la sesión que
 *  está en pantalla no es la suya (y si la cambió la revalidación, ella avisó). */
export class SessionChangedError extends Error {
  constructor() {
    super('Another version was opened while this change was being saved: the rest of it was not saved.');
    this.name = 'SessionChangedError';
  }
}

/** Sube con CADA cambio de la sesión de canvas (proyecto, modo o versión),
 *  también cuando después vuelve a la misma: un pin compara épocas, no claves. */
let sessionEpoch = 0;
useSessionStore.subscribe((s, prev) => {
  if (canvasSessionKey(s) !== canvasSessionKey(prev)) sessionEpoch += 1;
});

export interface SessionPin {
  /** ¿Sigue la sesión en que se tomó el pin (sin ningún cambio en el medio)? */
  holds: () => boolean;
  /** Corta con `SessionChangedError` si ya no: va ANTES de cada escritura. */
  check: () => void;
}

/** Ata lo que sigue a la sesión de AHORA (se toma al empezar la acción). */
export function pinSession(): SessionPin {
  const at = sessionEpoch;
  const holds = () => sessionEpoch === at;
  return { holds, check: () => { if (!holds()) throw new SessionChangedError(); } };
}

/** Doc 105 (H5/H7): el `.catch` de una ESCRITURA pedida AHORA (se crea al
 *  pedirla: toma su sesión). Patrón de DeleteProjectDialog: un 403/404/409 de
 *  su versión espera la revalidación y, si la sesión ya no es la pedida — la
 *  cambió la revalidación (transferida, eliminada, enviada: ya avisó) o el
 *  usuario abrió otra —, calla. Si no, `report(e)`: el motivo real. */
export function reportWriteError(report: (e: unknown) => void): (e: unknown) => Promise<void> {
  const pin = pinSession();
  const cs = useSessionStore.getState().activeChangesetId;
  return async (e) => {
    if (touchesVersion(e, cs)) await afterRevalidation();
    if (pin.holds()) report(e);
  };
}
