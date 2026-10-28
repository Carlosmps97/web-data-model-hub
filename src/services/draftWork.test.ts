// Lo que esta pestaña ya mandó a escribir y todavía no terminó: Undo y Redo lo
// esperan antes de empezar (también lo que empieza mientras esperan, y lo que
// falla).
import { describe, expect, it } from 'vitest';
import { draftWorkSettled, trackDraftWork } from './draftWork';

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
