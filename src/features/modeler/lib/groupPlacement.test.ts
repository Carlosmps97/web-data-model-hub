// Dónde nace un grupo pegado (doc 134 §3.7): conserva la distribución entre sus
// tablas; al costado de los originales (+36 px) si se ven, si no centrado en lo
// que se ve; dos pegados seguidos no quedan uno encima del otro.
import { describe, expect, it } from 'vitest';
import { groupSpots } from './groupPlacement';

const size = (w: number, h: number) => ({ w, h });

describe('groupSpots', () => {
  it('al costado de los originales: las mismas distancias corridas 36 px', () => {
    const out = groupSpots([
      { id: 'a', pos: { x: 100, y: 100 }, size: size(200, 100) },
      { id: 'b', pos: { x: 500, y: 300 }, size: size(200, 100) },
    ], { beside: true, view: null, others: [], recent: [] });
    expect(out).toEqual({ a: { x: 136, y: 136 }, b: { x: 536, y: 336 } });
  });

  it('las que no traen posición van en fila a la derecha del grupo', () => {
    const out = groupSpots([
      { id: 'a', pos: { x: 0, y: 0 }, size: size(200, 100) },
      { id: 'c', pos: null, size: size(150, 80) },
      { id: 'd', pos: null, size: size(100, 50) },
    ], { beside: true, view: null, others: [], recent: [] });
    expect(out).toEqual({ a: { x: 36, y: 36 }, c: { x: 284, y: 36 }, d: { x: 482, y: 36 } });
  });

  it('sin los originales a la vista, el grupo entero centrado en lo que se ve', () => {
    const view = { center: { x: 1000, y: 1000 }, rect: { left: 0, top: 0, right: 2000, bottom: 2000 } };
    const out = groupSpots([
      { id: 'a', pos: { x: 100, y: 100 }, size: size(200, 100) },
      { id: 'b', pos: { x: 500, y: 300 }, size: size(200, 100) },
    ], { beside: false, view, others: [], recent: [] });
    expect(out).toEqual({ a: { x: 700, y: 850 }, b: { x: 1100, y: 1050 } });
  });

  it('un segundo pegado no cae en el mismo lugar que el primero', () => {
    const items = [{ id: 'a', pos: { x: 100, y: 100 }, size: size(200, 100) }];
    const first = groupSpots(items, { beside: true, view: null, others: [], recent: [] });
    const second = groupSpots(items, { beside: true, view: null, others: [], recent: [{ ...first.a, w: 200 }] });
    expect(second.a).not.toEqual(first.a);
  });

  it('posiciones enteras', () => {
    const view = { center: { x: 1000.4, y: 999.7 }, rect: { left: 0, top: 0, right: 2000, bottom: 2000 } };
    const out = groupSpots([{ id: 'a', pos: { x: 10.6, y: 20.2 }, size: size(201, 101) }], { beside: false, view, others: [], recent: [] });
    expect(Number.isInteger(out.a.x) && Number.isInteger(out.a.y)).toBe(true);
  });
});
