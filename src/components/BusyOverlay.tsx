import { useBusyStore } from '@/store/useBusyStore';

/**
 * Overlay bloqueante global: mismo lenguaje visual que NavigatingOverlay
 * (scrim + tarjeta con spinner); sin botón de cierre: termina cuando termina
 * la acción de esta sesión (`runBlocking`).
 */
export default function BusyOverlay() {
  const active = useBusyStore((s) => s.active);
  if (!active) return null;
  return (
    <div className="dmh-busy-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="dmh-busy-card">
        <span className="rd-spin" aria-hidden />
        <div>
          <div className="dmh-busy-title">{active.title}</div>
          {active.detail && <div className="dmh-busy-detail">{active.detail}</div>}
        </div>
      </div>
    </div>
  );
}
