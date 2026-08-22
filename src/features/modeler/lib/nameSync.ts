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
 *     físico lo re-enciende).
 * El commit del tramo auto se agenda recién al RESOLVER (o fallar) el
 * physicalize: un commit intermedio persistiría el físico viejo junto al
 * lógico nuevo.
 */
export interface NameSyncState { logical: string; physical: string }

export interface NameSyncOptions {
  physicalize: (logical: string) => Promise<{ physical: string }>;
  /** Refleja el estado en la UI (setState de los inputs). */
  onState: (s: NameSyncState) => void;
  /** Persiste ambos campos juntos (un único upsert changeset-aware). */
  onCommit: (fields: { logicalName: string; physicalName: string }) => void;
  debounceMs?: number;
}

export interface NameSync {
  /** Re-arma para otra identidad (cambio de fila/reload): invalida todo lo pendiente. */
  reset(logical: string, physical: string): void;
  setLogical(v: string): void;
  setPhysical(v: string): void;
  dispose(): void;
}

export function createNameSync(opts: NameSyncOptions): NameSync {
  const ms = opts.debounceMs ?? 400;
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
      () => opts.onCommit({ logicalName: logical, physicalName: physical }), ms,
    );
  };

  return {
    reset(l, p) {
      logical = l; physical = p; physEdited = false;
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
      physical = v;
      physEdited = v.trim() !== ''; // vaciarlo re-enciende el auto
      seq++; // una edición manual invalida cualquier physicalize en vuelo
      emit();
      scheduleCommit();
    },
    dispose() { clearTimeout(physTimer); clearTimeout(commitTimer); },
  };
}
