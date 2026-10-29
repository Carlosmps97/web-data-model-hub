// Lo que esta pestaña ya mandó a escribir y todavía no terminó: Undo y Redo lo
// esperan antes de empezar (también lo que empieza mientras esperan, y lo que
// falla).
import { describe, expect, it } from 'vitest';
import { draftWorkSettled, flushPendingWrites, hasPendingWrites, pendingWrite, trackDraftWork } from './draftWork';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('draftWork', () => {
  it('sin trabajo en vuelo resuelve enseguida', async () => {
    await expect(draftWorkSettled()).resolves.toBeUndefined();
  });

  it('devuelve la misma promesa y espera a que termine', async () => {
    const order: string[] = [];
    const work = sleep(10).then(() => { order.push('escribió'); return 7; });
    expect(trackDraftWork(work)).toBe(work);
    await draftWorkSettled().then(() => order.push('listo'));
    expect(order).toEqual(['escribió', 'listo']);
  });

  it('espera también el trabajo que empieza mientras se espera', async () => {
    const order: string[] = [];
    void trackDraftWork(sleep(10).then(() => {
      order.push('uno');
      void trackDraftWork(sleep(10).then(() => { order.push('dos'); }));
    }));
    await draftWorkSettled();
    expect(order).toEqual(['uno', 'dos']);
  });

  it('lo que falla también deja de contar', async () => {
    const failed = trackDraftWork(sleep(5).then(() => { throw new Error('red'); }));
    await expect(failed).rejects.toThrow('red');
    await expect(draftWorkSettled()).resolves.toBeUndefined();
  });
});

// Lo agendado tras una espera (un campo tipeado, flechas sobre un punto de wire,
// el selector de color, los dibujos): Undo y Redo lo mandan ya, antes de
// esperar lo en vuelo (doc 133 §5).
describe('escrituras agendadas', () => {
  it('quien tiene algo agendado cuenta hasta mandarlo o descartarlo', () => {
    const w = pendingWrite(() => undefined);
    expect(hasPendingWrites()).toBe(false);
    w.hold();
    w.hold();
    expect(hasPendingWrites()).toBe(true);
    w.release();
    expect(hasPendingWrites()).toBe(false);
  });

  it('flushPendingWrites manda lo de cada uno; uno que falla no frena al resto', () => {
    const sent: string[] = [];
    const a = pendingWrite(() => { sent.push('a'); a.release(); });
    const b = pendingWrite(() => { throw new Error('roto'); });
    const c = pendingWrite(() => { sent.push('c'); c.release(); });
    a.hold(); b.hold(); c.hold();
    flushPendingWrites();
    expect(sent).toEqual(['a', 'c']);
    b.release();
    expect(hasPendingWrites()).toBe(false);
  });

  it('lo que un envío agenda en otra fuente también sale (el color de un dibujo agenda el guardado de los dibujos)', () => {
    const sent: string[] = [];
    const drawings = pendingWrite(() => { sent.push('dibujos'); drawings.release(); });
    const picker = pendingWrite(() => { sent.push('color'); picker.release(); drawings.hold(); });
    picker.hold();
    flushPendingWrites();
    expect(sent).toEqual(['color', 'dibujos']);
    expect(hasPendingWrites()).toBe(false);
  });

  it('también lo que vuelve a agendarse después de mandado en la misma pasada', () => {
    const sent: string[] = [];
    const drawings = pendingWrite(() => { sent.push('dibujos'); drawings.release(); });
    const picker = pendingWrite(() => { sent.push('color'); picker.release(); drawings.hold(); });
    drawings.hold();
    picker.hold();
    flushPendingWrites();
    expect(sent).toEqual(['dibujos', 'color', 'dibujos']);
    expect(hasPendingWrites()).toBe(false);
  });

  it('una fuente que se vuelve a agendar sola no deja el envío girando', () => {
    let flushes = 0;
    const loop = pendingWrite(() => { flushes += 1; loop.hold(); });
    loop.hold();
    flushPendingWrites();
    expect(flushes).toBeLessThanOrEqual(3);
    loop.release();
  });

  it('sin nada agendado no manda nada', () => {
    const sent: string[] = [];
    const a = pendingWrite(() => { sent.push('a'); });
    a.hold(); a.release();
    flushPendingWrites();
    expect(sent).toEqual([]);
  });
});
