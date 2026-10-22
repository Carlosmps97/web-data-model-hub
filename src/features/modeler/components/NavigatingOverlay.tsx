import { useEffect } from 'react';
import { useModelerStore } from '@/store/useModelerStore';

/** Techo de seguridad: si el canvas nunca termina de centrar, se libera la UI. */
const MAX_MS = 12_000;

/**
 * Overlay bloqueante de navegación: «Locate on canvas» cierra el popup y abre
 * otro canvas; sin feedback, parecería que no pasó nada y el usuario repetiría
 * el click. `navigating` lo enciende `openCanvasAndFocus` y lo apaga
 * `setPendingFocus(null)` (el canvas centró o desistió) o el fallo de carga.
 */
export default function NavigatingOverlay() {
  const navigating = useModelerStore((s) => s.navigating);
  useEffect(() => {
    if (!navigating) return undefined;
    const h = setTimeout(() => useModelerStore.setState({ navigating: null }), MAX_MS);
    return () => clearTimeout(h);
  }, [navigating]);
  if (!navigating) return null;
  return (
    <div className="wk-nav-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="wk-nav-card">
        <span className="rd-spin" aria-hidden />
        <div>
          Opening <b>{navigating.canvas || 'the canvas'}</b>
          {navigating.target ? <> and centering on <span className="rd-mono">{navigating.target}</span></> : null}…
        </div>
      </div>
    </div>
  );
}
