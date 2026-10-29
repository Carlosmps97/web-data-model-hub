/** Trabajo de esta pestaña sobre el draft todavía en vuelo: cada escritura y
 *  cada operación en fila que termina escribiendo (el canvas, una tabla o vista).
 *  Undo y Redo esperan a que termine antes de empezar: así lo mandado antes de
 *  pulsarlos avisa su escritura fuera del paso (no cuenta como del paso). */
const draftWork = new Set<Promise<unknown>>();

export function trackDraftWork<T>(work: Promise<T>): Promise<T> {
  draftWork.add(work);
  const done = () => { draftWork.delete(work); };
  work.then(done, done);
  return work;
}

/** Resuelve cuando no queda trabajo en vuelo (también el que empiece mientras se espera). */
export async function draftWorkSettled(): Promise<void> {
  while (draftWork.size) await Promise.allSettled([...draftWork]);
}

/** Escrituras agendadas tras una espera (un campo tipeado, flechas sobre un
 *  punto de wire, el selector de color, los dibujos): Undo y Redo las mandan ya,
 *  antes de esperar lo en vuelo (doc 133 §5). */
const pendingWrites = new Set<{ flush: () => void }>();
/** Cuántas veces se agendó algo: dice si un envío agendó otra cosa. */
let holds = 0;

export interface PendingWrite {
  /** Hay algo agendado: cuenta hasta `release` (repetirlo no suma). */
  hold(): void;
  /** Lo agendado se mandó o se descartó. */
  release(): void;
}

/** Quien agenda escrituras. `flush` manda ya lo agendado (lo que mande queda en
 *  vuelo) y lo suelta. */
export function pendingWrite(flush: () => void): PendingWrite {
  const entry = {
    flush,
    hold: () => { holds += 1; pendingWrites.add(entry); },
    release: () => { pendingWrites.delete(entry); },
  };
  return entry;
}

export const hasPendingWrites = (): boolean => pendingWrites.size > 0;

/** Manda ya todo lo agendado. Lo que un envío agenda (de nuevo) en otra fuente
 *  —el color elegido para un dibujo agenda el guardado de los dibujos— sale en
 *  otra pasada, hasta tres. */
export function flushPendingWrites(): void {
  for (let pass = 0; pass < 3; pass += 1) {
    const mark = holds;
    for (const w of [...pendingWrites]) {
      try { w.flush(); } catch { /* el fallo de uno no deja sin mandar lo del resto */ }
    }
    if (holds === mark) return;
  }
}
