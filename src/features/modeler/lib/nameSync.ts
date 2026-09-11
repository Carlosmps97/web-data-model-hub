/**
 * Sincroniza el nombre LÓGICO → FÍSICO con physicalize async (naming
 * corporativo del backend), inmune a las carreras que rompían la edición en
 * vivo (doc 18 §6):
 *  1. respuestas fuera de orden → token de secuencia (solo aplica la última);
 *  2. borrar-y-reescribir → vaciar el lógico limpia el físico y anula fetchs
 *     en vuelo;
 *  3. lost-update → UN solo commit con AMBOS campos (nunca dos upserts
 *     read-modify-write concurrentes del mismo doc);
 *  4. override manual del físico → apaga el auto-physicalize (vaciar el
 *     físico lo re-enciende). Doc 68: el override ahora PERSISTE
 *     (`physicalNameOverridden` viaja en cada commit y `reset` lo re-siembra
 *     desde el doc) — sin esto, recargar + renombrar el lógico re-derivaba y
 *     pisaba el físico custom;
 *  5. regla de case del scope (doc 83) → `normalizePhysical` se aplica a lo
 *     TIPEADO en el físico (estado + commit), no al derivado (ya viene con la
 *     regla) ni a lo re-sembrado por `reset` (el backend sana lo legacy al
 *     escribir).
 * El commit del tramo auto se agenda recién al RESOLVER (o fallar) el
 * physicalize: un commit intermedio persistiría el físico viejo junto al
 * lógico nuevo.
 */
export interface NameSyncState { logical: string; physical: string }

export interface NameSyncOptions {
  physicalize: (logical: string) => Promise<{ physical: string }>;
  /** Refleja el estado en la UI (setState de los inputs). */
  onState: (s: NameSyncState) => void;
  /** Persiste ambos campos juntos (un único upsert changeset-aware) más el
   *  override del físico (doc 68). */
  onCommit: (fields: { logicalName: string; physicalName: string; physicalNameOverridden: boolean }) => void;
  /** Doc 83: normaliza el físico TIPEADO a la regla de case del scope
   *  (`applyNamingCase`). Ausente ⇒ identidad. */
  normalizePhysical?: (v: string) => string;
  debounceMs?: number;
}

export interface NameSync {
  /** Re-arma para otra identidad (cambio de fila/reload): invalida todo lo
   *  pendiente. `overridden` re-siembra el flag persistido (doc 68). */
  reset(logical: string, physical: string, overridden?: boolean): void;
  setLogical(v: string): void;
  setPhysical(v: string): void;
  /** Doc 88 §3: re-deriva el físico desde el lógico (glosario) y APAGA el
   *  override — el «rayo» del panel de atributo, par del de tabla (doc 68). */
  derive(): void;
  dispose(): void;
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

  const emit = () => opts.onState({ logical, physical });
  const scheduleCommit = () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(
      () => opts.onCommit({ logicalName: logical, physicalName: physical,
                            physicalNameOverridden: physEdited }), ms,
    );
  };

  return {
    reset(l, p, overridden = false) {
      logical = l; physical = p; physEdited = overridden;
      seq++; // invalida cualquier physicalize en vuelo del ciclo anterior
      clearTimeout(physTimer); clearTimeout(commitTimer);
    },
    setLogical(v) {
      logical = v; emit();
      const mySeq = ++seq;
      clearTimeout(physTimer);
      if (!v.trim()) {
        if (!physEdited) { physical = ''; emit(); }
        scheduleCommit();
        return;
      }
      if (physEdited) { scheduleCommit(); return; }
      physTimer = setTimeout(() => {
        opts.physicalize(v.trim()).then((r) => {
          if (mySeq !== seq) return; // respuesta stale: hubo input más nuevo
          physical = r.physical; emit(); scheduleCommit();
        }).catch(() => {
          // Sin naming disponible igual se persiste el lógico (degradado).
          if (mySeq === seq) scheduleCommit();
        });
      }, ms);
    },
    setPhysical(v) {
      physical = normalize(v);      // doc 83: la UI muestra lo que se persiste
      physEdited = physical.trim() !== ''; // vaciarlo re-enciende el auto
      seq++; // una edición manual invalida cualquier physicalize en vuelo
      emit();
      scheduleCommit();
    },
    derive() {
      const v = logical.trim();
      if (!v) return;
      const mySeq = ++seq;          // invalida physicalize en vuelo; el nuestro manda
      clearTimeout(physTimer);
      opts.physicalize(v).then((r) => {
        if (mySeq !== seq) return;  // el usuario tipeó algo después: se descarta
        physical = r.physical; physEdited = false; emit(); scheduleCommit();
      }).catch(() => { /* sin naming disponible el físico queda como está */ });
    },
    dispose() { clearTimeout(physTimer); clearTimeout(commitTimer); },
  };
}

/**
 * Decisión de guardado del panel de TABLA (doc 68). Puro.
 *
 * `sessionOverride` = intención de ESTA edición: `true` (tipeó un físico),
 * `false` (lo vació o usó el botón derive) o `null` (no lo tocó → manda el
 * flag persistido). `derive: true` ⇒ el caller re-deriva del lógico (async):
 * físico intacto + lógico renombrado (comportamiento previo, ahora gateado
 * por el override) o físico vaciado (re-enciende el auto, como en columnas).
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
