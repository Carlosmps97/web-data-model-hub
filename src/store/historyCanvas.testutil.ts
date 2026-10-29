/**
 * Desde el doc 133, Undo y Redo solo corren con el canvas de la acción abierto;
 * el usuario sí puede abrir otro mientras el paso corre. Esto lo abre apenas
 * arranca cada paso (cuando su entrada sale de la pila): el paso tiene que
 * seguir escribiendo en su canvas y no tocar la pantalla del otro.
 */
import { useUndoStore } from './useUndoStore';

export function openOtherCanvasWhileStepRuns(open: () => unknown): { stop: () => void; opened: () => Promise<unknown> } {
  let last: Promise<unknown> = Promise.resolve();
  const stop = useUndoStore.subscribe((s, prev) => {
    if (s.running && (s.stack.length < prev.stack.length || s.redoStack.length < prev.redoStack.length)) {
      last = Promise.resolve(open());
    }
  });
  return { stop, opened: () => last };
}
