import { pendingWrite } from '@/services/draftWork';
import { pinSession, type SessionPin } from './sessionGuard';

/**
 * Lo movido con flechas sobre un punto de wire: un borrador que se graba tras
 * una pausa al soltar la flecha (`pause`), al perder el foco o con otro gesto
 * sobre el punto (`commit`). La pausa graba con la sesión del momento en que se
 * soltó la flecha: si al cumplirse ya es otra, descarta el borrador (`discard`)
 * en vez de mandarlo a otra versión. Mientras hay borrador cuenta como escritura
 * agendada: Undo y Redo lo graban ya (doc 133 §5).
 */
export interface NudgeSaver<T> {
  /** Un movimiento con flechas: el borrador queda por grabar. */
  move(next: T): void;
  /** Se soltó la flecha: graba tras la pausa, con la sesión de ahora. */
  pause(): void;
  /** Graba ya el borrador, si hay uno. */
  commit(): void;
  /** Suelta el borrador sin grabarlo; dice si había uno. */
  drop(): boolean;
}

export function nudgeSaver<T>(ms: number, save: (moved: T) => void, discard: () => void): NudgeSaver<T> {
  let moved: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pin: SessionPin | null = null;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pin = null;
  };
  const drop = () => {
    stop();
    const had = moved !== null;
    moved = null;
    scheduled.release();
    return had;
  };
  const commit = () => {
    stop();
    const v = moved;
    if (v === null) return;
    moved = null;
    scheduled.release();
    save(v);
  };
  /** Se cumplió la pausa (o Undo/Redo lo piden): con la sesión de cuando se soltó la flecha. */
  const due = () => {
    if (pin && !pin.holds()) { drop(); discard(); return; }
    commit();
  };
  const scheduled = pendingWrite(due);
  return {
    move(next) {
      stop();
      moved = next;
      scheduled.hold();
    },
    pause() {
      if (moved === null) return;
      stop();
      pin = pinSession();
      timer = setTimeout(due, ms);
    },
    commit,
    drop,
  };
}
