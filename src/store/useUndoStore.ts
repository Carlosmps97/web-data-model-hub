/**
 * Pila de Undo de la sesión de edición. Cada acción instrumentada apila su
 * inversa como closure que ejecuta los mismos servicios changeset-aware:
 * deshacer es un cambio más del draft (versionamiento y change feeds ven
 * upserts/deletes normales, sin mecánica adicional).
 *
 * Límites: vive en memoria del tab y muere con la sesión de canvas (al cambiar
 * de proyecto, de modo o de versión, incluido editar → solo lectura → editar la
 * misma versión; la suscripción está en useModelerStore) y en resetAppState
 * (logout). No hay redo.
 *
 * Una inversa es de la sesión en que se pidió. Los servicios toman la versión
 * al llamarlos: si mientras corre se abre otra versión (o la revalidación la
 * degrada), lo que le falta se escribiría en esa otra. Por eso recibe el pin de
 * su sesión y corta antes de cada escritura que siga a un `await` si la sesión
 * ya es otra. Sin overlay bloqueante: sería un flash en cada Ctrl+Z y `busy` ya
 * impide dos Undo a la vez. Una acción que termina después de un cambio de
 * sesión no deja su inversa en la pila de la nueva (`pushUndo` con el pin de la
 * acción).
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
   *  que siga a un `await`. */
  run: (pin: SessionPin) => Promise<void>;
  /** Sesión de la acción que apiló la inversa. */
  pin?: SessionPin;
}

const CAP = 50;
/** La sesión de la inversa en vuelo: `push` ignora lo que apila ella (una
 *  acción del store reusada), no lo de una sesión nueva. */
let runningPin: SessionPin | null = null;
// La pila queda cerrada mientras se aplica una carga Excel (`clear({ until })`),
// en la versión de la carga y mientras se edita (no en la época de la sesión: ir
// a otra versión y volver a la de la carga no la abre). Las cargas en curso se
// registran por versión: con una sola ranura, una segunda carga en otra versión
// abriría la pila de la primera mientras esta sigue aplicándose.
const holds = new Map<string, Set<object>>();
const held = (): boolean => {
  const s = useSessionStore.getState();
  return !!s.activeChangesetId && s.openMode !== 'readonly' && !!holds.get(s.activeChangesetId)?.size;
};

/** La acción falló sin escribir nada (p. ej. una lectura previa): se puede
 *  reintentar. `reason` es qué falló, sin punto final; undoLast arma con él su
 *  propio aviso («…: nothing was undone. Press Undo to try again.»). */
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
  /** Inversa en vuelo: bloquea el botón/atajo y suprime la instrumentación
   *  (una inversa no apila su propia inversa). */
  busy: boolean;
  /** Apila la inversa, salvo que `e.pin` indique que la sesión de la acción es
   *  distinta de la actual. */
  push: (e: UndoEntry) => void;
  /** Vacía la pila. Con `hold`, además la deja cerrada (no apila ni deshace)
   *  hasta que `until` termine, mientras esté abierta en edición la versión
   *  actual. Es el caso de una carga Excel: no está en la pila, y una inversa
   *  previa o de lo editado mientras tanto pisaría lo cargado. */
  clear: (hold?: { until: Promise<unknown> }) => void;
  /** Deshace la última acción. Devuelve su label (para el toast) o null si no
   *  hay nada, ya corre una o la sesión cambia mientras corre (no se avisa
   *  nada: la sesión en pantalla no es la suya). Si la inversa falla, la
   *  entrada ya salió de la pila (se descarta y no bloquea el resto) y el
   *  error se propaga; salvo que no haya escrito nada (`NothingDoneError`) o
   *  que haya fallado el transporte (status 0: re-correr la inversa converge):
   *  entonces vuelve a la pila y el aviso pide pulsar Undo otra vez. */
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
      // Un 403/404/409 de la versión puede deberse a un cambio externo: se
      // espera la revalidación. Si la sesión cambia, la revalidación ya avisó (o
      // el usuario abrió otra): el error no corresponde a lo que está en pantalla.
      if (touchesVersion(e, cs)) await afterRevalidation();
      if (!pin.holds()) return null;
      // No escribió nada: la entrada vuelve arriba de la pila y pulsar Undo otra
      // vez reintenta esta acción (no deshace la anterior). Con la pila cerrada
      // (empezó una carga Excel mientras corría) no vuelve, para no saltarse el
      // cierre, y no se invita a reintentar.
      if (e instanceof NothingDoneError) {
        if (held()) throw new Error(`${e.reason}: nothing was undone.`);
        set((s) => ({ stack: [...s.stack, entry].slice(-CAP) }));
        throw new Error(`${e.reason}: nothing was undone. Press Undo to try again.`);
      }
      // Una falla de transporte (timeout, red: status 0) no dice si la inversa
      // escribió. Las inversas reponen pre-imágenes (upserts, borrados,
      // membresía: idempotentes) y re-correrla converge: la entrada vuelve a la
      // pila (si se descartara, el siguiente Undo desharía otra acción).
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
 *  sesión en que empezó la acción; si es distinta de la actual, la inversa no
 *  se apila. */
export const pushUndo = (label: string, run: (pin: SessionPin) => Promise<void>, pin?: SessionPin) =>
  useUndoStore.getState().push({ label, run, ...(pin ? { pin } : {}) });
