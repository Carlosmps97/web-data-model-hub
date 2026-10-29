/**
 * Sincroniza el nombre lógico → físico con physicalize async (reglas de
 * naming del backend), inmune a las carreras propias de la edición en vivo:
 *  1. respuestas fuera de orden → token de secuencia (solo aplica la última);
 *  2. borrar-y-reescribir → vaciar el lógico limpia el físico y anula fetchs
 *     en vuelo;
 *  3. lost-update → un solo commit con ambos campos (nunca dos upserts
 *     read-modify-write concurrentes del mismo documento);
 *  4. override manual del físico → apaga el auto-physicalize (vaciar el
 *     físico lo re-enciende). El override persiste (`physicalNameOverridden`
 *     viaja en cada commit y `reset` lo re-siembra desde el documento): sin
 *     esto, recargar + renombrar el lógico re-derivaría y pisaría el físico
 *     custom;
 *  5. regla de case del scope → `normalizePhysical` se aplica a lo tipeado en
 *     el físico (estado + commit), no al derivado (ya viene con la regla) ni a
 *     lo re-sembrado por `reset` (el backend aplica la regla al escribir).
 * El commit del tramo auto se agenda recién al resolver (o fallar) el
 * physicalize: un commit intermedio persistiría el físico desactualizado junto
 * al lógico recién editado.
 *
 * Lo tipeado sin grabar cuenta como escritura agendada: Undo y Redo lo graban ya
 * (doc 133 §5), y también cerrar el panel. El commit agendado sale en el acto; si
 * falta el físico derivado, se pide ya y el commit sale apenas llega, y mientras
 * tanto es trabajo en vuelo (el Undo lo espera).
 */
import { pendingWrite, trackDraftWork } from '@/services/draftWork';

export interface NameSyncState { logical: string; physical: string }

export interface NameSyncOptions {
  physicalize: (logical: string) => Promise<{ physical: string }>;
  /** Refleja el estado en la UI (setState de los inputs). */
  onState: (s: NameSyncState) => void;
  /** Persiste ambos campos juntos (un único upsert changeset-aware) más el
   *  override del físico. */
  onCommit: (fields: { logicalName: string; physicalName: string; physicalNameOverridden: boolean }) => void;
  /** Normaliza el físico tipeado a la regla de case del scope
   *  (`applyNamingCase`). Ausente ⇒ identidad. */
  normalizePhysical?: (v: string) => string;
  debounceMs?: number;
}

export interface NameSync {
  /** Re-arma para otra identidad (cambio de fila/reload): invalida todo lo
   *  pendiente. `overridden` re-siembra el flag persistido. */
  reset(logical: string, physical: string, overridden?: boolean): void;
  setLogical(v: string): void;
  setPhysical(v: string): void;
  /** Re-deriva el físico a partir del lógico (glosario) y apaga el
   *  override: el «rayo» del panel de atributo, par del de tabla. */
  derive(): void;
  /** Se cierra el panel: lo agendado sale ya; el físico que falta se pide ya
   *  y su commit sale apenas llega. */
  dispose(): void;
  /** Nada agendado ni en vuelo: lo que muestra es lo grabado (o lo sembrado). */
  idle(): boolean;
}

export function createNameSync(opts: NameSyncOptions): NameSync {
  const ms = opts.debounceMs ?? 400;
  const normalize = opts.normalizePhysical ?? ((v: string) => v);
  let logical = '';
  let physical = '';
  let physEdited = false;
  let seq = 0;
  let physTimer: ReturnType<typeof setTimeout> | undefined;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  /** El físico por pedir cuando se cumpla `physTimer`: el lógico y su turno. */
  let ask: { v: string; mySeq: number } | null = null;
  /** El physicalize en vuelo y si su commit sale apenas llegue (lo pidió un
   *  Undo o Redo). */
  let deriving: { done: Promise<void>; now: boolean } | null = null;
  const scheduled = pendingWrite(() => flush());

  const emit = () => opts.onState({ logical, physical });
  const settle = () => {
    if (physTimer === undefined && commitTimer === undefined && !deriving) scheduled.release();
  };
  const stopPhys = () => { clearTimeout(physTimer); physTimer = undefined; ask = null; };
  const commit = () => {
    clearTimeout(commitTimer); commitTimer = undefined;
    settle();
    opts.onCommit({ logicalName: logical, physicalName: physical, physicalNameOverridden: physEdited });
  };
  const scheduleCommit = (now = false) => {
    clearTimeout(commitTimer); commitTimer = undefined;
    if (now) { commit(); return; }
    commitTimer = setTimeout(commit, ms);
    scheduled.hold();
  };
  /** Pide el físico de `v` con el turno `mySeq`: si al llegar sigue siendo el
   *  vigente, `apply` lo toma y se agenda el commit (también si falla, con
   *  `commitOnFail`). */
  const request = (v: string, mySeq: number, apply: (r: { physical: string }) => void, commitOnFail: boolean) => {
    const entry: { done: Promise<void>; now: boolean } = { done: Promise.resolve(), now: false };
    entry.done = opts.physicalize(v).then((r) => {
      if (mySeq !== seq) return; // respuesta stale: hubo input más nuevo
      apply(r); emit(); scheduleCommit(entry.now);
    }).catch(() => { if (mySeq === seq && commitOnFail) scheduleCommit(entry.now); })
      .finally(() => { if (deriving === entry) { deriving = null; settle(); } });
    deriving = entry;
    scheduled.hold();
  };
  const fromLogical = (v: string, mySeq: number) => request(v, mySeq, (r) => { physical = r.physical; },
    // Sin naming disponible igual se persiste el lógico (degradado).
    true);
  /** Undo o Redo: lo agendado sale ya; el físico que falta se pide ya (salvo que
   *  ya no sea el vigente: un físico tipeado después lo reemplazó) y su commit
   *  sale apenas llega; hasta entonces es trabajo en vuelo del draft. */
  const flush = () => {
    if (physTimer !== undefined && ask) {
      const { v, mySeq } = ask;
      stopPhys();
      if (mySeq === seq) fromLogical(v, mySeq);
    }
    if (commitTimer !== undefined) commit();
    if (deriving) { deriving.now = true; void trackDraftWork(deriving.done); }
    settle();
  };

  return {
    reset(l, p, overridden = false) {
      logical = l; physical = p; physEdited = overridden;
      seq++; // invalida cualquier physicalize en vuelo del ciclo anterior
      stopPhys(); clearTimeout(commitTimer); commitTimer = undefined;
      deriving = null;
      settle();
    },
    setLogical(v) {
      logical = v; emit();
      const mySeq = ++seq;
      stopPhys();
      if (!v.trim()) {
        if (!physEdited) { physical = ''; emit(); }
        scheduleCommit();
        return;
      }
      if (physEdited) { scheduleCommit(); return; }
      ask = { v: v.trim(), mySeq };
      physTimer = setTimeout(() => {
        physTimer = undefined; ask = null;
        fromLogical(v.trim(), mySeq);
      }, ms);
      scheduled.hold();
    },
    setPhysical(v) {
      physical = normalize(v);      // la UI muestra lo que se persiste
      physEdited = physical.trim() !== ''; // vaciarlo re-enciende el auto
      seq++; // una edición manual invalida cualquier physicalize en vuelo
      emit();
      scheduleCommit();
    },
    derive() {
      const v = logical.trim();
      if (!v) return;
      const mySeq = ++seq;          // invalida physicalize en vuelo; el de esta llamada manda
      stopPhys();
      // Sin naming disponible el físico queda como está.
      request(v, mySeq, (r) => { physical = r.physical; physEdited = false; }, false);
    },
    dispose() {
      // Como ante un Undo: cerrar el panel o cambiar de columna no pierde lo
      // tipeado (quien lo graba decide si la columna sigue en la versión).
      flush();
    },
    idle: () => physTimer === undefined && commitTimer === undefined && !deriving,
  };
}

/**
 * Decisión de guardado del panel de tabla. Puro.
 *
 * `sessionOverride` = intención de esta edición: `true` (tipeó un físico),
 * `false` (lo vació o usó el botón derive) o `null` (no lo tocó → manda el
 * flag persistido). `derive: true` ⇒ el caller re-deriva del lógico (async):
 * físico intacto + lógico renombrado (solo sin override) o físico vaciado
 * (re-enciende el auto, como en columnas).
 */
export function tableNamePlan(args: {
  logical: string;
  physical: string;
  prev: { logicalName: string; physicalName: string; physicalNameOverridden?: boolean };
  sessionOverride: boolean | null;
}): { physical: string; overridden: boolean; derive: boolean } {
  const overridden = args.sessionOverride ?? args.prev.physicalNameOverridden ?? false;
  const derive = !overridden && args.logical !== ''
    && (args.physical === args.prev.physicalName
      ? args.logical !== args.prev.logicalName
      : args.physical === '');
  return { physical: args.physical, overridden, derive };
}
