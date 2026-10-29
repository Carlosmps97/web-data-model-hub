import { useEffect, useState } from 'react';
import { useBusyStore } from '@/store/useBusyStore';
import { useUndoStore } from '@/store/useUndoStore';
import { watchHistoryWait } from '../lib/historyWait';

/** Sin parpadeo: el aviso aparece solo si el paso tarda más que esto. */
const NOTICE_MS = 300;
/** Pasado esto, el aviso dice que se espera al servidor. */
const SLOW_MS = 10_000;

/**
 * La espera de un Undo o un Redo (doc 133 §5): mientras corre, la pantalla no
 * responde (`watchHistoryWait`). La capa nunca toma el puntero (no apaga el hover
 * del canvas en cada Ctrl+Z) y al empezar no se ve; si el paso tarda más de
 * 300 ms aparece el aviso, con el lenguaje visual de BusyOverlay (sin desenfoque
 * del fondo: doc 103).
 */
export default function HistoryOverlay() {
  const running = useUndoStore((s) => s.running);
  useEffect(() => watchHistoryWait(window), []);
  return running ? <Waiting what={running} /> : null;
}

/** Qué muestra la capa: el aviso pasados 300 ms (y un detalle si tarda mucho),
 *  salvo con otra espera bloqueante encima, que trae el suyo (borrar una tabla
 *  al deshacer su alta: «Deleting table…»). */
export function waitingView(o: { what: 'undo' | 'redo'; shown: boolean; slow: boolean; blocking: boolean }):
  { className: string; title: string | null; detail: string | null } {
  if (!o.shown || o.blocking) return { className: 'dmh-history-wait', title: null, detail: null };
  return {
    className: 'dmh-history-wait is-shown',
    title: o.what === 'undo' ? 'Undoing…' : 'Redoing…',
    detail: o.slow ? 'Still waiting for the server…' : null,
  };
}

/** La capa de un paso: nace con cada Undo o Redo, sin aviso. */
function Waiting({ what }: { what: 'undo' | 'redo' }) {
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const blocking = useBusyStore((s) => s.active !== null);
  useEffect(() => {
    const notice = setTimeout(() => setShown(true), NOTICE_MS);
    const late = setTimeout(() => setSlow(true), SLOW_MS);
    return () => { clearTimeout(notice); clearTimeout(late); };
  }, []);
  const view = waitingView({ what, shown, slow, blocking });
  return (
    <div className={view.className} role="status" aria-live="polite">
      {view.title && (
        <div className="dmh-busy-card">
          <span className="rd-spin" aria-hidden />
          <div>
            <div className="dmh-busy-title">{view.title}</div>
            {view.detail && <div className="dmh-busy-detail">{view.detail}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
