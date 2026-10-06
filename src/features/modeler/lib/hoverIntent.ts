import { useModelerStore } from '@/store/useModelerStore';

/**
 * Doc 111 — resaltado de relaciones al pasar el mouse, sin trabar el canvas.
 *
 * Antes, cada bloque (y cada wire) que el mouse cruzaba prendía y apagaba el
 * resaltado: TODOS los wires del canvas se re-renderizaban y animaban su
 * opacidad dos veces por bloque. Ir de un objeto a otro cruzando el canvas
 * dejaba el hilo principal ocupado y la selección respondía tarde (medido:
 * ~1 s con CPU ×4 en un canvas de 131 tablas). Ahora:
 * - sólo resalta si el mouse SE QUEDA `HOVER_INTENT_MS` sobre el bloque o el
 *   wire (pasar de largo no hace nada); salir apaga en el acto;
 * - un dibujo no resalta nada (no tiene relaciones; antes atenuaba todo);
 * - el atenuado del resto lo hace una clase del canvas (`bindHoverDim`): cada
 *   wire sólo dice si es de los resaltados, ninguno lee «¿hay hover?».
 */
export const HOVER_INTENT_MS = 90;

export interface HoverIntent {
  enter: (id: string) => void;
  leave: () => void;
  dispose: () => void;
}

export function createHoverIntent(apply: (id: string | null) => void,
                                  delay = HOVER_INTENT_MS): HoverIntent {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown: string | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    enter(id) {
      cancel();
      timer = setTimeout(() => { timer = null; shown = id; apply(id); }, delay);
    },
    leave() {
      cancel();
      if (shown !== null) { shown = null; apply(null); }
    },
    dispose: cancel,
  };
}

/** El id que resalta el mouse sobre un nodo del canvas; un dibujo, ninguno. */
export function hoverTargetOf(node: { id: string; type?: string }): string | null {
  return node.type === 'shape' ? null : node.id;
}

const HOVER_CLASS = 'wk-canvas--hover';

/** Prende `wk-canvas--hover` en `el` mientras haya un bloque o un wire
 *  resaltado (sin re-renderizar nada: la clase la mira el CSS). Devuelve la
 *  función que la desengancha. */
export function bindHoverDim(el: HTMLElement): () => void {
  const apply = (s: { hoverNodeId: string | null; hoverEdgeId: string | null }) => {
    el.classList.toggle(HOVER_CLASS, !!s.hoverNodeId || !!s.hoverEdgeId);
  };
  apply(useModelerStore.getState());
  return useModelerStore.subscribe(apply);
}
