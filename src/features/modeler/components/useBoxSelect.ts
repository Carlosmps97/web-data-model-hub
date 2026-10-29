import { useEffect, useState, type RefObject } from 'react';
import { flowBox, useModelerStore } from '@/store/useModelerStore';
import { createBoxGesture, tablesInBox, type ScreenRect } from '../lib/boxSelect';

/** Ataja el `click` que el navegador manda al soltar un cuadro: sin esto, el clic
 *  en el fondo limpiaría lo recién seleccionado. Si no llega, se retira solo. */
function swallowNextClick(): void {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); window.removeEventListener('click', stop, true); };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

/**
 * El cuadro de selección del canvas (doc 134 §3.2): arrastrar sobre el fondo
 * vacío con «Select area» encendido o con Shift. Empieza con el `mousedown` en
 * burbuja sobre `wrapRef`, así el escudo del doble clic (en captura, doc 114) lo
 * ataja como a cualquier clic del canvas; con Espacio apretado no empieza (se
 * mueve la vista). Devuelve el rectángulo a dibujar, relativo a `wrapRef`.
 */
export function useBoxSelect(wrapRef: RefObject<HTMLDivElement | null>): ScreenRect | null {
  const [rect, setRect] = useState<ScreenRect | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let space = false;
    let gesture: ReturnType<typeof createBoxGesture> | null = null;
    let origin = { x: 0, y: 0 };
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') space = e.type === 'keydown'; };
    const onBlur = () => { space = false; };
    const stopListening = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
    };
    const move = (e: MouseEvent) => {
      const r = gesture?.move({ x: e.clientX, y: e.clientY }) ?? null;
      setRect(r && { ...r, left: r.left - origin.x, top: r.top - origin.y });
    };
    const up = (e: MouseEvent) => {
      const boxed = gesture?.up({ x: e.clientX, y: e.clientY }) ?? false;
      gesture = null;
      setRect(null);
      stopListening();
      if (boxed) swallowNextClick();
    };
    const down = (e: MouseEvent) => {
      const st = useModelerStore.getState();
      const target = e.target as HTMLElement | null;
      if (e.button !== 0 || space || !target?.classList.contains('react-flow__pane')) return;
      if (!(st.boxSelect || e.shiftKey) || st.canvasLocked || st.relPreset || st.subcatArmed || !st.flow) return;
      const flow = st.flow;
      const box = el.getBoundingClientRect();
      origin = { x: box.left, y: box.top };
      gesture = createBoxGesture({
        toFlow: (p) => flow.screenToFlowPosition(p),
        pick: (b) => tablesInBox(flow.getNodes(), b, (n) => flowBox(n, useModelerStore.getState().viewMode)),
        onSelect: (ids) => useModelerStore.getState().selectBox(ids),
      });
      gesture.down({ x: e.clientX, y: e.clientY });
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    };
    el.addEventListener('mousedown', down);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      stopListening();
      gesture?.cancel();
    };
  }, [wrapRef]);
  return rect;
}
