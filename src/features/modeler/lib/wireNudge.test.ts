// Mover un punto de wire con flechas: el trazo vive como borrador y se graba
// tras una pausa al soltar la flecha, al perder el foco o con otro gesto sobre
// el punto. Se graba con la sesión del momento en que se soltó: si al llegar la
// pausa ya es otra, el borrador se descarta (no va a otra versión). Undo y Redo
// lo graban ya, antes de esperar lo en vuelo (doc 133 §5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingWrites, hasPendingWrites } from '@/services/draftWork';
import { useSessionStore } from '@/store/useSessionStore';
import { nudgeSaver } from './wireNudge';

const open = (changesetId: string) => useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId });

describe('nudgeSaver', () => {
  beforeEach(() => { vi.useFakeTimers(); open('cs1'); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = () => {
    const save = vi.fn();
    const discard = vi.fn();
    return { save, discard, n: nudgeSaver<string>(600, save, discard) };
  };

  it('graba tras la pausa al soltar la flecha; otra flecha en la pausa la reinicia', () => {
    const { save, n } = setup();
    n.move('a');
    n.pause();
    vi.advanceTimersByTime(300);
    n.move('b');
    vi.advanceTimersByTime(600);
    expect(save).not.toHaveBeenCalled();
    n.pause();
    vi.advanceTimersByTime(599);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save.mock.calls).toEqual([['b']]);
    expect(hasPendingWrites()).toBe(false);
  });

  it('si al llegar la pausa la sesión es otra, descarta el borrador sin grabar', () => {
    const { save, discard, n } = setup();
    n.move('a');
    n.pause();
    open('cs2');
    vi.advanceTimersByTime(600);
    expect(save).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(hasPendingWrites()).toBe(false);
  });

  it('commit graba ya; drop suelta sin grabar y dice si había algo', () => {
    const { save, n } = setup();
    n.move('a');
    n.commit();
    expect(save.mock.calls).toEqual([['a']]);
    expect(n.drop()).toBe(false);
    n.move('b');
    n.pause();
    expect(n.drop()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(save.mock.calls).toEqual([['a']]);
    expect(hasPendingWrites()).toBe(false);
    n.commit();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cuenta como agendado desde la primera flecha: Undo/Redo lo graban ya, con la tecla abajo o en la pausa', () => {
    const { save, n } = setup();
    n.move('a');
    expect(hasPendingWrites()).toBe(true);
    flushPendingWrites();
    expect(save.mock.calls).toEqual([['a']]);
    n.move('b');
    n.pause();
    flushPendingWrites();
    expect(save.mock.calls).toEqual([['a'], ['b']]);
    vi.advanceTimersByTime(600);
    expect(save).toHaveBeenCalledTimes(2);
    expect(hasPendingWrites()).toBe(false);
  });

  it('en la pausa, si la sesión cambió, Undo/Redo no lo graban: lo descartan', () => {
    const { save, discard, n } = setup();
    n.move('a');
    n.pause();
    open('cs2');
    flushPendingWrites();
    expect(save).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(hasPendingWrites()).toBe(false);
  });
});
