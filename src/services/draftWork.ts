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
