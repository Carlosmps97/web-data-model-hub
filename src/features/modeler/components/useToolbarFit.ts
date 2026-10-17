import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { fitLevel } from '../lib/toolbarFit';

/**
 * Doc 114 — nivel de compactación de la barra del canvas (`toolbarFit.ts`):
 * mide el contenido contra el ancho y sube o baja pasos hasta que entra en una
 * fila. Tras cada render (antes de pintar: sin parpadeo); un cambio de ANCHO de
 * la barra, en el cuadro siguiente (el alto cambia con el nivel y no decide
 * nada). Se re-mide desde cero cuando cambia `contentKey` (otra píldora de
 * versión, «Saving…») y cuando cargan las fuentes. `max`: el último nivel (el
 * llamador decide qué significa; la barra lo usa para envolver antes que
 * esconder botones en una ventana angostísima).
 */
export function useToolbarFit(ref: RefObject<HTMLElement | null>, max: number, contentKey: string, enabled = true): number {
  const [level, setLevel] = useState(0);
  const current = useRef(0);
  // Revisión doc 114: con un cambio de ancho en curso, el chequeo lo hace el cuadro
  // siguiente — aplicado dentro de la ronda de ResizeObserver (React Flow re-renderiza
  // ahí), el cambio de alto de la barra daba «ResizeObserver loop completed…».
  const resizing = useRef(false);
  const need = useRef<Record<number, number>>({});
  const apply = useCallback((next: number) => {
    if (next === current.current) return;
    current.current = next;
    setLevel(next);
  }, []);
  const reset = useCallback(() => { need.current = {}; apply(0); }, [apply]);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    apply(fitLevel(current.current, { available: el.clientWidth, content: el.scrollWidth }, need.current, max));
  }, [ref, max, enabled, apply]);

  // Contenido distinto: se re-mide desde el nivel 0 (antes que el chequeo de abajo).
  useLayoutEffect(() => { reset(); }, [contentKey, reset]);
  useLayoutEffect(() => { if (!resizing.current) check(); });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastW = el.clientWidth;
    let frame = 0;
    // Revisión 2 doc 114: el nivel nuevo se aplica en ESTE cuadro (flushSync) —
    // dejado a React, lo confirmaba dentro de la ronda del ResizeObserver de React
    // Flow y el cambio de alto seguía dando «ResizeObserver loop completed…».
    const settle = () => { resizing.current = false; flushSync(check); };
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastW) return;
      lastW = el.clientWidth;
      resizing.current = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(settle);
    });
    ro.observe(el);
    // Revisión 2: al rearmarse (cambió `enabled` o `max`) el cuadro pendiente se
    // canceló y el observador nuevo arranca con el ancho ya cambiado: se mide igual.
    frame = requestAnimationFrame(settle);
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) reset(); });
    return () => { alive = false; ro.disconnect(); cancelAnimationFrame(frame); resizing.current = false; };
  }, [ref, check, reset]);

  return level;
}
