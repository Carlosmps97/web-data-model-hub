// Doc 105 (B8): lecturas por lote con tope de concurrencia — el timeout de 30 s
// de cada pedido corre desde que SALE, así que 50 POST a la vez se vencían en
// cola. `mapPool` despacha de a `limit`, conserva el orden y corta al primer error.
import { describe, expect, it } from 'vitest';
import { mapPool } from './pool';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('conserva el orden de entrada aunque terminen al revés', async () => {
    const out = await mapPool([1, 2, 3, 4, 5, 6], 3, async (n, i) => {
      await sleep(12 - 2 * n);   // el último en salir de cada tanda termina primero
      return `${i}:${n * 10}`;
    });
    expect(out).toEqual(['0:10', '1:20', '2:30', '3:40', '4:50', '5:60']);
  });

  it('nunca tiene más de `limit` en vuelo, y sí llega a `limit`', async () => {
    let inflight = 0;
    let peak = 0;
    const out = await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await sleep(1 + (n % 3));
      inflight -= 1;
      return n;
    });
    expect(peak).toBe(4);
    expect(out).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('al primer error deja de despachar y rechaza con ESE error (el segundo no queda sin manejar)', async () => {
    const started: number[] = [];
    const run = mapPool([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2, async (n) => {
      started.push(n);
      if (n === 1) { await sleep(1); throw new Error('first'); }
      await sleep(5);
      if (n === 0) throw new Error('second');   // termina DESPUÉS del primer error
      return n;
    });
    await expect(run).rejects.toThrow('first');
    await sleep(20);   // el 0 ya terminó: si el pool siguiera, habría despachado el 2, 3…
    expect(started).toEqual([0, 1]);
  });

  it('lista vacía: [] sin llamar a la función', async () => {
    let calls = 0;
    expect(await mapPool([], 4, async () => { calls += 1; return 1; })).toEqual([]);
    expect(calls).toBe(0);
  });

  it('un tope menor que 1 corre de a uno (no se cuelga ni devuelve huecos)', async () => {
    let inflight = 0;
    let peak = 0;
    const out = await mapPool(['a', 'b', 'c'], 0, async (s) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await sleep(1);
      inflight -= 1;
      return s.toUpperCase();
    });
    expect(out).toEqual(['A', 'B', 'C']);
    expect(peak).toBe(1);
  });
});
