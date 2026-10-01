/**
 * Pila de Undo de la sesión de edición (doc 50). Cada acción instrumentada
 * apila su INVERSA como closure que ejecuta los MISMOS servicios
 * changeset-aware — deshacer es un cambio más del draft (versionamiento y
 * change feeds ven upserts/deletes normales; cero mecánica nueva).
 *
 * Límites (pedido explícito): vive en memoria del tab y muere con la SESIÓN de
 * canvas — al cambiar de proyecto, de modo o de versión (doc 105: también
 * editar → solo lectura → editar la misma versión; suscripción en
 * useModelerStore, junto al clipboard del doc 48) — y en resetAppState
 * (logout). No hay redo.
 *
 * Doc 105 (H1): una inversa es de la sesión en que se pidió. Los servicios
 * toman la versión AL LLAMARLOS: si mientras corre se abre otra versión (o la
 * revalidación la degrada), lo que le falta se escribiría en ELLA. Por eso
 * recibe el pin de su sesión y corta antes de cada escritura que siga a un
 * `await` si la sesión cambió. Sin overlay bloqueante: sería un flash en cada
 * Ctrl+Z y `busy` ya impide dos Undo a la vez. Una acción que termina DESPUÉS
 * de un cambio de sesión no deja su inversa en la pila de la nueva (`pushUndo`
 * con el pin de la acción).
 */
import { create } from 'zustand';
import { afterRevalidation, pinSession, touchesVersion, type SessionPin } from '@/features/modeler/lib/sessionGuard';
import { ApiError, errorReason } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';

export interface UndoEntry {
  /** Qué se va a deshacer — se muestra en el tooltip del botón y en el toast. */
  label: string;
  /** Inversa: corre contra los servicios changeset-aware + reload. `pin` es la
   *  sesión en que se pidió el Undo: `pin.check()` antes de cada escritura
   *  que siga a un `await` (doc 105, H1). */
  run: (pin: SessionPin) => Promise<void>;
  /** Sesión de la ACCIÓN que apiló la inversa (doc 105, H1). */
  pin?: SessionPin;
}

const CAP = 50;
/** Doc 105 (ronda 3): la sesión de la inversa EN VUELO — `push` ignora lo que
 *  apila ella (una acción del store reusada), no lo de una sesión nueva. */
let runningPin: SessionPin | null = null;
// Doc 105 (ronda 5, R15-H2): la pila cerrada mientras se aplica una carga
// Excel (`clear({ until })`). Ronda 6 (R17a-6): en su VERSIÓN, editándola — no
// en la época de la sesión: ir a otra y volver a la de la carga no la abre.
// Ronda 7 (R18a-3): las cargas en curso POR VERSIÓN — antes una sola ranura, y
// una segunda carga en otra versión abría la de la primera (aún aplicándose).
const holds = new Map<string, Set<object>>();
const held = (): boolean => {
  const s = useSessionStore.getState();
  return !!s.activeChangesetId && s.openMode !== 'readonly' && !!holds.get(s.activeChangesetId)?.size;
};

/** Doc 105 (H3): la acción falló SIN escribir nada (p. ej. una lectura previa):
 *  se puede reintentar. `reason` es qué falló, sin punto final — undoLast arma
 *  con él su propio aviso («…: nothing was undone. Press Undo to try again.»). */
export class NothingDoneError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'NothingDoneError';
    this.reason = reason;
  }
}

interface UndoState {
  stack: UndoEntry[];
  /** Inversa en vuelo: bloquea el botón/atajo y SUPRIME la instrumentación
   *  (una inversa no apila su propia inversa). */
  busy: boolean;
  /** Apila la inversa, salvo que `e.pin` diga que la sesión de la acción ya no
   *  es la de ahora (doc 105, H1). */
  push: (e: UndoEntry) => void;
  /** Vacía la pila. Doc 105 (ronda 5, R15-H2): con `hold`, además la deja
   *  CERRADA — no apila ni deshace — hasta que `until` termine, mientras esté
   *  abierta en edición la versión de AHORA (ronda 6) — una carga Excel: no
   *  está en la pila, y una inversa vieja o de lo editado mientras tanto
   *  pisaría lo cargado. */
  clear: (hold?: { until: Promise<unknown> }) => void;
  /** Deshace la última acción. Devuelve su label (para el toast) o null si no
   *  había nada, ya corre una o la sesión cambió mientras corría (doc 105: no
   *  se avisa nada — la sesión en pantalla no es la suya). Si la inversa falla,
   *  la entrada YA salió de la pila (se descarta — no bloquea el resto) y el
   *  error se propaga; salvo que no haya escrito nada (`NothingDoneError`, H3)
   *  o que haya fallado el transporte (status 0: re-correr la inversa converge,
   *  R7-F): entonces vuelve a la pila y el aviso pide pulsar Undo otra vez. */
  undoLast: () => Promise<string | null>;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  busy: false,
  push: (e) => {
    if (held()) return;
    if (get().busy && runningPin?.holds()) return;
    if (e.pin && !e.pin.holds()) return;
    const stack = [...get().stack, e];
    if (stack.length > CAP) stack.shift();
    set({ stack });
  },
  clear: (h) => {
    const cs = useSessionStore.getState().activeChangesetId;
    if (h && cs) {
      const token = {};
      const tokens = holds.get(cs) ?? new Set<object>();
      tokens.add(token);
      holds.set(cs, tokens);
      void h.until.then(() => undefined, () => undefined).then(() => {
        tokens.delete(token);
        if (!tokens.size && holds.get(cs) === tokens) holds.delete(cs);
      });
    }
    if (get().stack.length) set({ stack: [] });
  },
  undoLast: async () => {
    const { stack, busy } = get();
    if (busy || !stack.length || held()) return null;
    const entry = stack[stack.length - 1];
    const pin = pinSession();
    const cs = useSessionStore.getState().activeChangesetId;
    runningPin = pin;
    set({ stack: stack.slice(0, -1), busy: true });
    try {
      await entry.run(pin);
      return pin.holds() ? entry.label : null;
    } catch (e) {
      // Un 403/404/409 de la versión puede ser que cambió por fuera: se espera
      // la revalidación. Si la sesión cambió, ella avisó (o el usuario abrió
      // otra): el error ya no es de lo que está en pantalla.
      if (touchesVersion(e, cs)) await afterRevalidation();
      if (!pin.holds()) return null;
      // Doc 105 (H3): no escribió nada — la entrada vuelve arriba de la pila:
      // pulsar Undo otra vez reintenta ESTA acción (no deshace la anterior).
      // Ronda 6 (R17a-5): con la pila cerrada (empezó una carga Excel mientras
      // corría) no vuelve — el cierre no se salta; y no se invita a reintentar.
      if (e instanceof NothingDoneError) {
        if (held()) throw new Error(`${e.reason}: nothing was undone.`);
        set((s) => ({ stack: [...s.stack, entry].slice(-CAP) }));
        throw new Error(`${e.reason}: nothing was undone. Press Undo to try again.`);
      }
      // Doc 105 (ronda 3, R7-F): una falla de TRANSPORTE (timeout, red: status 0)
      // no dice si la inversa escribió. Las inversas reponen pre-imágenes
      // (upserts, borrados, membresía: idempotentes) — re-correrla converge: la
      // entrada vuelve a la pila (antes se descartaba y el siguiente Undo
      // deshacía OTRA acción).
      if (e instanceof ApiError && e.status === 0) {
        const reason = errorReason(e, 'no response');
        if (held()) throw new Error(`Couldn't undo ${entry.label}: ${reason}.`);
        set((s) => ({ stack: [...s.stack, entry].slice(-CAP) }));
        throw new Error(`Couldn't undo ${entry.label}: ${reason}. Press Undo to try again.`);
      }
      throw e;
    } finally { runningPin = null; set({ busy: false }); }
  },
}));

/** Azúcar para los sitios de instrumentación (stores y popups). `pin`: la
 *  sesión en que EMPEZÓ la acción (doc 105) — si ya no es la de ahora, la
 *  inversa no se apila. */
export const pushUndo = (label: string, run: (pin: SessionPin) => Promise<void>, pin?: SessionPin) =>
  useUndoStore.getState().push({ label, run, ...(pin ? { pin } : {}) });
