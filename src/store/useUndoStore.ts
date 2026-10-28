/**
 * Historial de la sesión de edición: Undo y Redo. Cada acción instrumentada
 * apila un paso (`HistoryStep`) que deshace por los mismos servicios
 * changeset-aware — deshacer es un cambio más del draft (versionamiento y
 * change feeds ven upserts/deletes normales, sin mecánica adicional) — y
 * devuelve el paso contrario, armado con lo que acaba de dejar escrito:
 * deshacer deja ese contrario para rehacer y rehacer deja el suyo para volver a
 * deshacer.
 *
 * Límites: vive en memoria del tab y muere con la sesión de canvas (al cambiar
 * de proyecto, de modo o de versión, incluido editar → solo lectura → editar la
 * misma versión; la suscripción está en useModelerStore) y en resetAppState
 * (logout).
 *
 * Un paso es de la sesión en que se pidió. Los servicios toman la versión al
 * llamarlos: si mientras corre se abre otra versión (o la revalidación la
 * degrada), lo que le falta se escribiría en esa otra. Por eso recibe el pin de
 * su sesión y corta antes de cada escritura que siga a un `await` si la sesión
 * ya es otra. Sin overlay bloqueante: sería un flash en cada Ctrl+Z y `busy` ya
 * impide dos pasos a la vez. Una acción que termina después de un cambio de
 * sesión no deja su inversa en la pila de la nueva (`pushUndo` con el pin de la
 * acción).
 *
 * Rehacer solo sobre la versión tal como la dejó el Undo: las escrituras del
 * Undo (números consecutivos del contador `writeSeq` de la versión, avisados
 * por `onDraftWrite`) fijan la base de lo pendiente de rehacer, y antes de
 * escribir el Redo lee el contador: si alguien escribió en el medio (esta
 * pestaña fuera del historial, otra pestaña, un esquema, una carga Excel), no
 * rehace. Cualquier escritura de esta pestaña en la versión fuera de un
 * Undo/Redo vacía lo pendiente de rehacer en el acto. Undo y Redo esperan
 * antes lo que esta pestaña ya mandó a escribir (`draftWorkSettled`): su aviso
 * cae fuera del paso y la acción que lo mandó queda arriba del historial.
 */
import { create } from 'zustand';
import { afterRevalidation, pinSession, touchesVersion, type SessionPin } from '@/features/modeler/lib/sessionGuard';
import { onDraftWrite, writeSeqOf } from '@/services/changeset.service';
import { draftWorkSettled } from '@/services/draftWork';
import { ApiError, errorReason } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';

/** Un paso del historial: deshace (o rehace) y devuelve el paso que lo
 *  revierte, armado con lo que acaba de escribir; null si no lo hay. `pin` es
 *  la sesión en que se pidió: `pin.check()` antes de cada escritura que siga a
 *  un `await`. */
export type HistoryStep = (pin: SessionPin) => Promise<HistoryStep | null>;

export interface UndoEntry {
  /** Qué se deshace o rehace — se muestra en el tooltip de los botones y en el toast. */
  label: string;
  /** El paso que corre al deshacer (en `stack`) o al rehacer (en `redoStack`). */
  run: HistoryStep;
  /** Sesión de la acción que apiló la entrada. */
  pin?: SessionPin;
}

const CAP = 50;
/** La sesión del paso en vuelo: `push` ignora lo que apila él (una acción del
 *  store reusada), no lo de una sesión nueva. */
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

/** El contador de escrituras de la versión (`writeSeq`) con que vale
 *  `redoStack`: el que dejó el último Undo/Redo. */
let redoBase: number | null = null;
/** Sube con lo que invalida lo pendiente de rehacer (acción nueva, `clear`,
 *  `dropRedo`): un paso en vuelo que la ve cambiar no deja su contrario. */
let epoch = 0;
/** Escrituras en la versión mientras corre un paso: sus números y si alguna
 *  llegó sin número. */
interface Run { seqs: number[]; unknown: boolean }
let run: Run | null = null;

/** Cómo quedó la versión tras un paso: `none` si no escribió; la primera y la
 *  última escritura si sus números son consecutivos; null si hubo un hueco
 *  (algo ajeno escribió en el medio) o una escritura sin número. */
function written(r: Run): 'none' | { first: number; last: number } | null {
  if (r.unknown) return null;
  if (!r.seqs.length) return 'none';
  const s = [...r.seqs].sort((a, b) => a - b);
  for (let i = 1; i < s.length; i += 1) if (s[i] !== s[i - 1] + 1) return null;
  return { first: s[0], last: s[s.length - 1] };
}

/** Los pasos marcados con `freshStep`. */
const freshSteps = new WeakSet<HistoryStep>();
/** Entradas de Undo de un paso fresco que falló después de poder escribir y
 *  volvieron a la pila: al reintentarse, su contrario no sirve para rehacer. */
const partialUndos = new WeakSet<UndoEntry>();

/** La versión cambió después del Undo: no se rehace nada. */
class StaleRedoError extends Error {
  constructor() { super("This version changed after the undo: there's nothing to redo."); }
}

/** La acción falló sin escribir nada (p. ej. una lectura previa): se puede
 *  reintentar. `reason` es qué falló, sin punto final; undoLast/redoLast arman
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
  /** Lo deshecho que se puede rehacer (lo último deshecho, arriba). */
  redoStack: UndoEntry[];
  /** Un paso en vuelo (Undo o Redo): bloquea los botones/atajos y suprime la
   *  instrumentación (un paso no apila su propia inversa). */
  busy: boolean;
  /** Cuál corre (el botón que muestra la espera). */
  running: 'undo' | 'redo' | null;
  /** Apila la inversa de una acción nueva y vacía lo pendiente de rehacer,
   *  salvo que `e.pin` indique que la sesión de la acción es distinta de la
   *  actual. Mientras corre un paso, no apila y vacía lo pendiente de rehacer. */
  push: (e: UndoEntry) => void;
  /** Vacía las dos pilas. Con `hold`, además las deja cerradas (no apilan, ni
   *  deshacen, ni rehacen) hasta que `until` termine, mientras esté abierta en
   *  edición la versión actual. Es el caso de una carga Excel: no está en la
   *  pila, y una inversa previa o de lo editado mientras tanto pisaría lo
   *  cargado. */
  clear: (hold?: { until: Promise<unknown> }) => void;
  /** Vacía lo pendiente de rehacer (la versión cambió fuera del historial). */
  dropRedo: () => void;
  /** Deshace la última acción, después de que termine lo que esta pestaña ya
   *  mandó a escribir. Devuelve su label (para el toast) o null si no
   *  hay nada, ya corre un paso o la sesión cambia mientras corre (no se avisa
   *  nada: la sesión en pantalla no es la suya). Si el paso falla, la entrada
   *  ya salió de la pila (se descarta y no bloquea el resto) y el error se
   *  propaga; salvo que no haya escrito nada (`NothingDoneError`) o que haya
   *  fallado el transporte (status 0: re-correr el paso converge): entonces
   *  vuelve a la pila y el aviso pide pulsar Undo otra vez. */
  undoLast: () => Promise<string | null>;
  /** Rehace lo último deshecho, con el mismo criterio de `undoLast`, si la
   *  versión sigue como la dejó el Undo; si no, vacía lo pendiente y avisa. */
  redoLast: () => Promise<string | null>;
}

export const useUndoStore = create<UndoState>((set, get) => {
  /** Lo que deja un Undo para rehacer: su contrario, si sus escrituras son
   *  consecutivas, nada invalidó lo pendiente mientras corría y no es el
   *  reintento de un paso fresco que había escrito parte. Lo que ya había sigue
   *  solo si el Undo empezó justo donde lo dejó el anterior. */
  const keepRedo = (entry: UndoEntry, back: HistoryStep | null, r: Run, start: number) => {
    const w = written(r);
    if (epoch !== start || held() || !back || partialUndos.has(entry) || w === null || w === 'none') { get().dropRedo(); return; }
    const keep = redoBase !== null && w.first === redoBase + 1 ? get().redoStack : [];
    redoBase = w.last;
    set({ redoStack: [...keep, { label: entry.label, run: back }].slice(-CAP) });
  };
  /** Un paso que falló sin escribir (o por transporte) vuelve a su pila para
   *  reintentarlo, salvo con la pila cerrada (empezó una carga Excel mientras
   *  corría) o con `keep` en false (un Redo cuya versión ya no es la del Undo):
   *  ahí no vuelve, para no saltarse el cierre, y no se invita a reintentar. */
  const retry = (to: 'stack' | 'redoStack', entry: UndoEntry, message: string, again: string, keep = true): Error => {
    if (held() || !keep) return new Error(message);
    set((s) => (to === 'stack' ? { stack: [...s.stack, entry].slice(-CAP) } : { redoStack: [...s.redoStack, entry].slice(-CAP) }));
    return new Error(`${message} ${again}`);
  };
  return {
    stack: [],
    redoStack: [],
    busy: false,
    running: null,
    push: (e) => {
      if (held()) return;
      if (get().busy && runningPin?.holds()) { get().dropRedo(); return; }
      if (e.pin && !e.pin.holds()) return;
      epoch += 1;
      redoBase = null;
      set({ stack: [...get().stack, e].slice(-CAP), redoStack: [] });
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
      epoch += 1;
      redoBase = null;
      if (get().stack.length || get().redoStack.length) set({ stack: [], redoStack: [] });
    },
    dropRedo: () => {
      epoch += 1;
      redoBase = null;
      if (get().redoStack.length) set({ redoStack: [] });
    },
    undoLast: async () => {
      if (get().busy || !get().stack.length || held()) return null;
      const pin = pinSession();
      const cs = useSessionStore.getState().activeChangesetId;
      set({ busy: true, running: 'undo' });
      // Lo que esta pestaña ya mandó a escribir termina antes: su aviso cae fuera
      // del paso y, si la acción que lo mandó apila su inversa, es la que se deshace.
      await draftWorkSettled();
      const { stack } = get();
      if (!pin.holds() || held() || !stack.length) { set({ busy: false, running: null }); return null; }
      const entry = stack[stack.length - 1];
      const start = epoch;
      const r: Run = { seqs: [], unknown: false };
      runningPin = pin;
      run = r;
      set({ stack: stack.slice(0, -1) });
      try {
        const back = await entry.run(pin);
        if (!pin.holds()) return null;
        keepRedo(entry, back, r, start);
        return entry.label;
      } catch (e) {
        // Un 403/404/409 de la versión puede deberse a un cambio externo: se
        // espera la revalidación. Si la sesión cambia, la revalidación ya avisó (o
        // el usuario abrió otra): el error no corresponde a lo que está en pantalla.
        if (touchesVersion(e, cs)) await afterRevalidation();
        if (!pin.holds()) return null;
        // No escribió nada: la entrada vuelve arriba de la pila y pulsar Undo otra
        // vez reintenta esta acción (no deshace la anterior).
        if (e instanceof NothingDoneError) throw retry('stack', entry, `${e.reason}: nothing was undone.`, 'Press Undo to try again.');
        // Una falla de transporte (timeout, red: status 0) no dice si el paso
        // escribió. Los pasos reponen pre-imágenes (upserts, borrados,
        // membresía: idempotentes) y re-correrlo converge: la entrada vuelve a la
        // pila (si se descartara, el siguiente Undo desharía otra acción). Si el
        // paso es fresco y pudo escribir, el reintento no deja qué rehacer.
        if (e instanceof ApiError && e.status === 0) {
          if (freshSteps.has(entry.run) && written(r) !== 'none') partialUndos.add(entry);
          throw retry('stack', entry, `Couldn't undo ${entry.label}: ${errorReason(e, 'no response')}.`, 'Press Undo to try again.');
        }
        // Pudo dejar algo a medias: lo pendiente de rehacer ya no calza.
        get().dropRedo();
        throw e;
      } finally { runningPin = null; run = null; set({ busy: false, running: null }); }
    },
    redoLast: async () => {
      const cs = useSessionStore.getState().activeChangesetId;
      if (get().busy || !get().redoStack.length || held() || !cs) return null;
      const pin = pinSession();
      const start = epoch;
      set({ busy: true, running: 'redo' });
      // Lo que esta pestaña ya mandó a escribir termina antes: si escribió en la
      // versión, su aviso vacía lo pendiente y ya no hay qué rehacer.
      await draftWorkSettled();
      const { redoStack } = get();
      if (!pin.holds() || held()) { set({ busy: false, running: null }); return null; }
      if (epoch !== start || !redoStack.length) {
        set({ busy: false, running: null });
        get().dropRedo();
        throw new StaleRedoError();
      }
      const entry = redoStack[redoStack.length - 1];
      const r: Run = { seqs: [], unknown: false };
      let writeSeq = 0;
      let checked = false;
      set({ redoStack: redoStack.slice(0, -1) });
      try {
        // Candado: la versión sigue donde la dejó el último Undo/Redo.
        ({ writeSeq } = await writeSeqOf(cs));
        if (!pin.holds()) return null;
        if (epoch !== start || redoBase === null || writeSeq !== redoBase) throw new StaleRedoError();
        checked = true;
        runningPin = pin;
        run = r;
        const back = await entry.run(pin);
        if (!pin.holds()) return null;
        if (back && !held()) set((s) => ({ stack: [...s.stack, { label: entry.label, run: back }].slice(-CAP) }));
        // Lo que queda por rehacer sigue sobre lo que este paso escribió, si nada
        // ajeno escribió en el medio.
        const w = written(r);
        if (epoch === start && w !== 'none') {
          if (w !== null && w.first === writeSeq + 1) redoBase = w.last;
          else get().dropRedo();
        }
        return entry.label;
      } catch (e) {
        if (touchesVersion(e, cs)) await afterRevalidation();
        if (!pin.holds()) return null;
        if (e instanceof StaleRedoError) { get().dropRedo(); throw e; }
        // Algo cambió la versión mientras corría (otra acción, otra escritura): lo
        // deshecho ya no vuelve a la pila.
        const current = epoch === start;
        if (!checked) {
          if (!current) { get().dropRedo(); throw new StaleRedoError(); }
          throw retry('redoStack', entry, "Couldn't check the version: nothing was redone.", 'Press Redo to try again.');
        }
        if (e instanceof NothingDoneError) throw retry('redoStack', entry, `${e.reason}: nothing was redone.`, 'Press Redo to try again.', current);
        // Lo que alcanzó a escribir antes de la falla es suyo si sus números siguen
        // a la base: el reintento parte de ahí (re-correr un paso por valor
        // converge). Con una escritura de resultado desconocido no se sabe qué
        // quedó, y un paso fresco partiría de un estado a medias: no se reintenta.
        if (e instanceof ApiError && e.status === 0) {
          const w = written(r);
          const own = current && w !== null && (w === 'none' || (w.first === writeSeq + 1 && !freshSteps.has(entry.run)));
          if (!own) get().dropRedo();
          else if (w !== 'none') redoBase = w.last;
          throw retry('redoStack', entry, `Couldn't redo ${entry.label}: ${errorReason(e, 'no response')}.`, 'Press Redo to try again.', own);
        }
        // Pudo dejar algo a medias: lo que quedaba por rehacer dependía de él.
        get().dropRedo();
        throw e;
      } finally { runningPin = null; run = null; set({ busy: false, running: null }); }
    },
  };
});

// Las escrituras de esta pestaña en la versión abierta: las de un paso en vuelo
// son suyas (fijan la base del Redo); cualquier otra cambia la versión fuera
// del historial y vacía lo pendiente de rehacer.
onDraftWrite((cs, _changes, seq) => {
  const s = useSessionStore.getState();
  if (s.openMode !== 'editing' || s.activeChangesetId !== cs) return;
  if (run) {
    if (seq == null) run.unknown = true;
    else run.seqs.push(seq);
    return;
  }
  useUndoStore.getState().dropRedo();
});

/** Marca un paso fresco: arma su contrario con lo que lee o escribe al correr
 *  (los borrados en cascada, entrar o salir del canvas). Tras una falla a
 *  mitad, re-correrlo parte de un estado a medias y su contrario sale
 *  incompleto: no se reintenta en un Redo y, reintentado en un Undo, no deja
 *  qué rehacer. */
export function freshStep(step: HistoryStep): HistoryStep {
  freshSteps.add(step);
  return step;
}

/** El aviso para quien no puede seguir mientras corre un Undo o un Redo (sus
 *  escrituras seguirían cayendo en la versión): null si no corre ninguno. */
export const historyRunning = (then: string): string | null =>
  useUndoStore.getState().busy ? `Undo or redo is still running — ${then} when it finishes.` : null;

/** Azúcar para los sitios de instrumentación (stores y popups). `pin`: la
 *  sesión en que empezó la acción; si es distinta de la actual, la inversa no
 *  se apila. */
export const pushUndo = (label: string, run: HistoryStep, pin?: SessionPin) =>
  useUndoStore.getState().push({ label, run, ...(pin ? { pin } : {}) });
