import { describe, expect, it } from 'vitest';
import type { Relationship } from '@/services/governance.service';
import {
  MAX_ROUTE_COORD, MAX_ROUTE_ID_LEN, MAX_ROUTE_POINTS, STUB_BLOCK,
  arrangeResetWarning, cleanRoute, cleanRoutes, handleSegments, insertPoint, movePoint, pathMidpoint, pruneRoutes,
  removePoint, roundedPath, routableWireIds, routeOf, routeWire, routedGeometry, sameRoute, snapPoint, trunkRouteId,
  wireEnds, wireIdsOfTable,
  type RoutePoint, type WireEnd,
} from './wireRoute';

const rel = (id: string, parent: string, child: string, symbol?: string): Relationship => ({
  id, parentTableId: parent, childTableId: child, pairs: [],
  ...(symbol ? { subcategory: true, subtypeSymbolId: symbol } : {}),
} as unknown as Relationship);

// Padre a la izquierda saliendo por la derecha; hijo a la derecha entrando por la izquierda.
const S: WireEnd = { x: 100, y: 50, dir: 1, stub: STUB_BLOCK };
const T: WireEnd = { x: 400, y: 200, dir: -1, stub: STUB_BLOCK };

const orthogonal = (pts: RoutePoint[]) =>
  pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.5 || Math.abs(p.y - pts[i - 1].y) < 0.5);

/** ¿`p` cae sobre algún tramo del camino? */
const onPath = (pts: RoutePoint[], p: RoutePoint) => pts.some((b, i) => {
  if (i === 0) return false;
  const a = pts[i - 1];
  const within = (v: number, m: number, n: number) => v >= Math.min(m, n) - 0.5 && v <= Math.max(m, n) + 0.5;
  return (Math.abs(a.x - b.x) < 0.5 && Math.abs(p.x - a.x) < 0.5 && within(p.y, a.y, b.y))
    || (Math.abs(a.y - b.y) < 0.5 && Math.abs(p.y - a.y) < 0.5 && within(p.x, a.x, b.x));
});

/** ¿Algún tramo vuelve sobre el anterior (mismo eje, sentido contrario)? */
const backtracks = (pts: RoutePoint[]) => pts.some((c, i) => {
  if (i < 2) return false;
  const a = pts[i - 2], b = pts[i - 1];
  const sameX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
  const sameY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
  return (sameX && Math.sign(b.y - a.y) === -Math.sign(c.y - b.y))
    || (sameY && Math.sign(b.x - a.x) === -Math.sign(c.x - b.x));
});

describe('cleanRoute / cleanRoutes — espejo de clean_routes del backend', () => {
  it('conserva un trazo válido y solo sus x/y', () => {
    expect(cleanRoute([{ x: 1, y: 2, z: 3 }, { x: 3.5, y: -4 }])).toEqual([{ x: 1, y: 2 }, { x: 3.5, y: -4 }]);
  });

  it.each([
    ['no es lista', 'texto'],
    ['lista vacía', []],
    ['punto nulo', [null]],
    ['punto sin x', [{ y: 2 }]],
    ['x de texto', [{ x: '1', y: 2 }]],
    ['NaN', [{ x: Number.NaN, y: 2 }]],
    ['infinito', [{ x: 1, y: Number.POSITIVE_INFINITY }]],
    ['booleano', [{ x: true, y: 2 }]],
    ['fuera de rango', [{ x: MAX_ROUTE_COORD + 1, y: 2 }]],
    ['un punto malo invalida todo el trazo', [{ x: 1, y: 2 }, { x: 'a', y: 2 }]],
    ['más puntos que el tope', Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => ({ x: i, y: i }))],
  ])('descarta el trazo: %s', (_name, raw) => {
    expect(cleanRoute(raw)).toBeNull();
  });

  it('el tope de puntos es inclusivo', () => {
    const exact = Array.from({ length: MAX_ROUTE_POINTS }, (_, i) => ({ x: i, y: i }));
    expect(cleanRoute(exact)).toEqual(exact);
  });

  it.each([[null], [undefined], ['x'], [5], [[{ x: 1, y: 2 }]]])('un mapa que no es mapa (%j) se lee vacío', (raw) => {
    expect(cleanRoutes(raw)).toEqual({});
  });

  it('descarta los trazos rotos y conserva los sanos', () => {
    expect(cleanRoutes({
      ok: [{ x: 1, y: 2 }], roto: [{ x: 'a', y: 2 }], raro: 'texto', vacio: [], '': [{ x: 1, y: 2 }],
    })).toEqual({ ok: [{ x: 1, y: 2 }] });
  });

  it('no muta la entrada', () => {
    const raw = { r: [{ x: 1, y: 2, z: 3 }] };
    cleanRoutes(raw);
    expect(raw).toEqual({ r: [{ x: 1, y: 2, z: 3 }] });
  });

  it('ignora ids de wire que el backend rechazaría (control, desmedidos)', () => {
    const ok = [{ x: 1, y: 2 }];
    expect(cleanRoutes({
      bueno: ok, 'a\u0000b': ok, 'a\nb': ok, '\t': ok, ['x'.repeat(MAX_ROUTE_ID_LEN + 1)]: ok,
      ['y'.repeat(MAX_ROUTE_ID_LEN)]: ok, 'a.b': ok, 'subsym-sym-1': ok,
    })).toEqual({ bueno: ok, ['y'.repeat(MAX_ROUTE_ID_LEN)]: ok, 'a.b': ok, 'subsym-sym-1': ok });
  });

  it('la llave `__proto__` se ignora: asignarla cambiaría el prototipo del mapa', () => {
    // JSON.parse SÍ la crea como propiedad propia; `out[id] = …` no.
    const raw = JSON.parse('{"__proto__": [{"x": 1, "y": 2}], "constructor": [{"x": 3, "y": 4}], "r": [{"x": 5, "y": 6}]}');
    const out = cleanRoutes(raw);
    expect(Object.keys(out).sort()).toEqual(['constructor', 'r']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Array.isArray(Object.getPrototypeOf(out))).toBe(false);
    expect(out.r).toEqual([{ x: 5, y: 6 }]);
    expect(out.constructor).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('ids de los wires ruteables', () => {
  const rels = [
    rel('r1', 'A', 'B'),
    rel('s1', 'A', 'C', 'sym1'), rel('s2', 'A', 'D', 'sym1'),
    rel('s3', 'B', 'E', 'sym2'),
  ];

  it('una relación usa su id; una subcategoría suma el tronco de su símbolo', () => {
    expect(trunkRouteId('sym1')).toBe('subsym-sym1');
    expect(routableWireIds(rels).sort()).toEqual(['r1', 's1', 's2', 's3', 'subsym-sym1', 'subsym-sym2'].sort());
  });

  it('wires de una tabla: sus relaciones y el tronco de los grupos donde es SUPERTIPO', () => {
    expect(wireIdsOfTable(rels, 'A').sort()).toEqual(['r1', 's1', 's2', 'subsym-sym1'].sort());
    // B es hija en r1 y supertipo de sym2
    expect(wireIdsOfTable(rels, 'B').sort()).toEqual(['r1', 's3', 'subsym-sym2'].sort());
    // C es subtipo: sale su rama, el tronco del grupo se queda
    expect(wireIdsOfTable(rels, 'C')).toEqual(['s1']);
    expect(wireIdsOfTable(rels, 'Z')).toEqual([]);
  });

  it('una relación recursiva aparece una sola vez', () => {
    expect(wireIdsOfTable([rel('rr', 'A', 'A')], 'A')).toEqual(['rr']);
  });

  it('pruneRoutes deja solo los trazos de wires que existen', () => {
    const routes = { r1: [{ x: 1, y: 2 }], huerfano: [{ x: 3, y: 4 }], 'subsym-sym1': [{ x: 5, y: 6 }] };
    expect(pruneRoutes(routes, routableWireIds(rels))).toEqual({ r1: [{ x: 1, y: 2 }], 'subsym-sym1': [{ x: 5, y: 6 }] });
    expect(routes).toHaveProperty('huerfano');                       // no muta
  });

  it('pruneRoutes devuelve el MISMO objeto si no hay nada que podar', () => {
    const routes = { r1: [{ x: 1, y: 2 }] };
    expect(pruneRoutes(routes, ['r1', 'otro'])).toBe(routes);
  });
});

describe('wireEnds — el lado lo decide el primer y el último punto', () => {
  const sBox = { x: 0, w: 100 }, tBox = { x: 400, w: 100 };
  const ends = (via: RoutePoint[]) =>
    wireEnds({ sBox, sy: 50, sStub: 28, tBox, ty: 200, tStub: 10, via });

  it('punto a la derecha del centro ⇒ sale por la derecha; a la izquierda ⇒ por la izquierda', () => {
    expect(ends([{ x: 250, y: 0 }]).s).toEqual({ x: 100, y: 50, dir: 1, stub: 28 });
    expect(ends([{ x: -80, y: 0 }]).s).toEqual({ x: 0, y: 50, dir: -1, stub: 28 });
  });

  it('el hijo entra por el lado que mira al ÚLTIMO punto', () => {
    expect(ends([{ x: 250, y: 0 }]).t).toEqual({ x: 400, y: 200, dir: -1, stub: 10 });
    expect(ends([{ x: 250, y: 0 }, { x: 700, y: 0 }]).t).toEqual({ x: 500, y: 200, dir: 1, stub: 10 });
  });

  it('justo en el centro sale por la derecha (misma regla que el wire automático)', () => {
    expect(ends([{ x: 50, y: -100 }]).s.dir).toBe(1);
  });
});

describe('routeWire — camino ortogonal por los puntos', () => {
  it('un punto entre los bloques mueve el tramo vertical del medio (H-V-H)', () => {
    const r = routeWire(S, T, [{ x: 250, y: 120 }]);
    expect(r.corners).toEqual([{ x: 100, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 200 }, { x: 400, y: 200 }]);
  });

  it('con un punto sobre el tramo vertical, su Y no cambia el camino', () => {
    const a = routeWire(S, T, [{ x: 250, y: 60 }]).corners;
    const b = routeWire(S, T, [{ x: 250, y: 190 }]).corners;
    expect(a).toEqual(b);
  });

  it('un punto por encima de los dos bloques: el wire PASA por él, sin volver sobre sí', () => {
    const via = [{ x: 250, y: -40 }];
    const r = routeWire(S, T, via);
    // Hay dos caminos con los mismos quiebres; gana el que conserva el ARRANQUE
    // (horizontal desde el padre y vertical en la X del punto, como cuando el
    // punto estaba entre los bloques): al subir el punto, el tramo no salta.
    expect(r.corners).toEqual([
      { x: 100, y: 50 }, { x: 250, y: 50 }, { x: 250, y: -40 },
      { x: 372, y: -40 }, { x: 372, y: 200 }, { x: 400, y: 200 },
    ]);
    expect(orthogonal(r.corners)).toBe(true);
    expect(backtracks(r.corners)).toBe(false);
    expect(onPath(r.corners, via[0])).toBe(true);
  });

  it('dos puntos alineados dibujan el «sombrero» por encima', () => {
    const r = routeWire(S, T, [{ x: 200, y: 0 }, { x: 300, y: 0 }]);
    expect(r.corners).toEqual([
      { x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 0 },
      { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 400, y: 200 },
    ]);
  });

  it('agregar un punto cerca del hijo NO cambia el arranque del camino', () => {
    // Caso real de la verificación en navegador: con (1001,158) el wire salía
    // horizontal y subía por x=1001. Al agregar un segundo punto más abajo y a
    // la derecha hay dos caminos de igual costo; el que dobla pegado al padre
    // (x=808) movía un tramo que el usuario no tocó.
    const s: WireEnd = { x: 780, y: 232, dir: 1, stub: STUB_BLOCK };
    const t: WireEnd = { x: 1120, y: 84, dir: -1, stub: STUB_BLOCK };
    const one = routeWire(s, t, [{ x: 1001, y: 158 }]).corners;
    const two = routeWire(s, t, [{ x: 1001, y: 158 }, { x: 1047, y: 174 }]).corners;
    expect(one.slice(0, 2)).toEqual([{ x: 780, y: 232 }, { x: 1001, y: 232 }]);
    expect(two).toEqual([
      { x: 780, y: 232 }, { x: 1001, y: 232 }, { x: 1001, y: 158 }, { x: 1047, y: 158 },
      { x: 1047, y: 174 }, { x: 1092, y: 174 }, { x: 1092, y: 84 }, { x: 1120, y: 84 },
    ]);
    expect(backtracks(two)).toBe(false);
  });

  it('dos puntos desalineados siguen siendo ortogonales (dobla una vez entre ellos)', () => {
    const via = [{ x: 200, y: 0 }, { x: 300, y: -60 }];
    const r = routeWire(S, T, via);
    expect(orthogonal(r.corners)).toBe(true);
    expect(backtracks(r.corners)).toBe(false);
    for (const p of via) expect(onPath(r.corners, p)).toBe(true);
  });

  it('PUNTOS FIJOS: al mover el padre solo cambia el primer tramo', () => {
    const via = [{ x: 200, y: 0 }, { x: 300, y: 0 }];
    const before = routeWire(S, T, via).corners;
    const moved = routeWire({ ...S, x: 60, y: 140 }, T, via).corners;
    expect(moved).toEqual([
      { x: 60, y: 140 }, { x: 200, y: 140 }, { x: 200, y: 0 },
      { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 400, y: 200 },
    ]);
    expect(moved.slice(2)).toEqual(before.slice(2));
  });

  it('entra al hijo por la derecha cuando el último punto queda de ese lado (forma de C)', () => {
    const r = routeWire(S, { x: 500, y: 200, dir: 1, stub: STUB_BLOCK }, [{ x: 600, y: 100 }]);
    expect(r.corners).toEqual([{ x: 100, y: 50 }, { x: 600, y: 50 }, { x: 600, y: 200 }, { x: 500, y: 200 }]);
  });

  it('un punto detrás del tramo fijo del padre no pisa el bloque con un retroceso', () => {
    // El punto queda a 10 px del borde (dentro de los 28 del tramo fijo) y arriba.
    const r = routeWire(S, T, [{ x: 110, y: -60 }]);
    expect(r.corners.slice(0, 3)).toEqual([{ x: 100, y: 50 }, { x: 128, y: 50 }, { x: 128, y: -60 }]);
    expect(orthogonal(r.corners)).toBe(true);
    expect(onPath(r.corners, { x: 110, y: -60 })).toBe(true);
  });

  it('sale y entra SIEMPRE horizontal, en el sentido de cada lado', () => {
    const cases: [WireEnd, WireEnd, RoutePoint[]][] = [
      [S, T, [{ x: 250, y: 120 }]],
      [S, T, [{ x: 250, y: -400 }, { x: 900, y: 900 }]],
      [{ ...S, dir: -1, x: 0 }, { ...T, dir: 1, x: 500 }, [{ x: -200, y: 300 }, { x: 700, y: -50 }]],
    ];
    for (const [s, t, via] of cases) {
      const c = routeWire(s, t, via).corners;
      expect(c[0]).toEqual({ x: s.x, y: s.y });
      expect(c[c.length - 1]).toEqual({ x: t.x, y: t.y });
      expect(c[1].y).toBe(s.y);
      expect(Math.sign(c[1].x - c[0].x)).toBe(s.dir);
      expect(c[c.length - 2].y).toBe(t.y);
      expect(Math.sign(c[c.length - 1].x - c[c.length - 2].x)).toBe(-t.dir);
    }
  });

  it('puntos repetidos o pegados a un anclaje no rompen el camino', () => {
    const r = routeWire(S, T, [{ x: 128, y: 50 }, { x: 250, y: 120 }, { x: 250, y: 120 }]);
    expect(orthogonal(r.corners)).toBe(true);
    expect(r.corners[0]).toEqual({ x: 100, y: 50 });
    expect(r.corners[r.corners.length - 1]).toEqual({ x: 400, y: 200 });
    expect(r.path).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('es ortogonal y pasa por TODOS los puntos con cualquier entrada (barrido)', () => {
    // Generador determinista (LCG): mismas entradas en cada corrida.
    let seed = 20260927;
    const rnd = (min: number, max: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.round(min + (seed / 4294967296) * (max - min));
    };
    for (let i = 0; i < 400; i++) {
      const s: WireEnd = { x: rnd(-500, 500), y: rnd(-500, 500), dir: rnd(0, 1) ? 1 : -1, stub: STUB_BLOCK };
      const t: WireEnd = { x: rnd(-500, 500), y: rnd(-500, 500), dir: rnd(0, 1) ? 1 : -1, stub: rnd(0, 1) ? STUB_BLOCK : 10 };
      const via = Array.from({ length: rnd(1, 6) }, () => ({ x: rnd(-600, 600), y: rnd(-600, 600) }));
      const r = routeWire(s, t, via);
      expect(orthogonal(r.corners), `caso ${i}`).toBe(true);
      expect(r.corners[0]).toEqual({ x: s.x, y: s.y });
      expect(r.corners[r.corners.length - 1]).toEqual({ x: t.x, y: t.y });
      for (const p of via) expect(onPath(r.corners, p), `caso ${i} punto ${JSON.stringify(p)}`).toBe(true);
      expect(r.path).not.toMatch(/NaN|Infinity|undefined/);
      expect(Number.isFinite(r.mid.x) && Number.isFinite(r.mid.y)).toBe(true);
    }
  });

  it('es determinista: misma entrada, mismo camino', () => {
    const via = [{ x: 250, y: -40 }, { x: 310, y: 95 }];
    expect(routeWire(S, T, via)).toEqual(routeWire(S, T, via));
  });

  it('no muta los puntos de entrada', () => {
    const via = [{ x: 250, y: 120 }];
    routeWire(S, T, via);
    expect(via).toEqual([{ x: 250, y: 120 }]);
  });
});

describe('handleSegments — dónde se puede crear un punto', () => {
  it('cada tramo sabe en qué posición de la lista entra su punto nuevo', () => {
    const via = [{ x: 250, y: 120 }];
    const segs = routeWire(S, T, via).segments;
    // tramo fijo · horizontal del padre · vertical hasta el punto | vertical desde el punto · horizontal al hijo · tramo fijo
    expect(segs.map((s) => s.insertAt)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(segs[2]).toEqual({ a: { x: 250, y: 50 }, b: { x: 250, y: 120 }, insertAt: 0 });
    expect(segs[3]).toEqual({ a: { x: 250, y: 120 }, b: { x: 250, y: 200 }, insertAt: 1 });
  });

  it('solo ofrece tiradores en tramos con largo suficiente, en su punto medio', () => {
    const segs = routeWire(S, T, [{ x: 250, y: 120 }]).segments;
    const handles = handleSegments(segs, 36);
    // fuera: los dos tramos fijos (28 px); quedan los 4 largos
    expect(handles).toEqual([
      { x: 189, y: 50, insertAt: 0 },
      { x: 250, y: 85, insertAt: 0 },
      { x: 250, y: 160, insertAt: 1 },
      { x: 311, y: 200, insertAt: 1 },
    ]);
  });
});

describe('pathMidpoint', () => {
  it('es el punto a mitad del LARGO del camino, no el promedio de las esquinas', () => {
    // 100 horizontal + 300 vertical ⇒ mitad a 200: cae sobre el tramo vertical
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }])).toEqual({ x: 100, y: 100 });
  });

  it('con un solo punto o ninguno no falla', () => {
    expect(pathMidpoint([{ x: 5, y: 6 }])).toEqual({ x: 5, y: 6 });
    expect(pathMidpoint([])).toEqual({ x: 0, y: 0 });
  });
});

describe('roundedPath', () => {
  it('redondea las esquinas con curvas Q y empieza/termina en los extremos', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10);
    expect(d).toBe('M 0,0 L 90,0 Q 100,0 100,10 L 100,100');
  });

  it('el radio nunca excede la mitad del tramo más corto', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 100 }], 10);
    expect(d).toBe('M 0,0 L 4,0 Q 8,0 8,4 L 8,100');
  });

  it('puntos en línea recta no generan curva', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 10)).toBe('M 0,0 L 50,0 L 100,0');
  });

  it('menos de dos puntos ⇒ sin camino', () => {
    expect(roundedPath([], 10)).toBe('');
    expect(roundedPath([{ x: 1, y: 1 }], 10)).toBe('');
  });
});

describe('edición del trazo', () => {
  const via = [{ x: 10, y: 10 }, { x: 20, y: 20 }];

  it('insertPoint agrega en la posición pedida, con coordenadas enteras', () => {
    expect(insertPoint(via, 1, { x: 15.4, y: 15.6 })).toEqual([{ x: 10, y: 10 }, { x: 15, y: 16 }, { x: 20, y: 20 }]);
    expect(insertPoint(via, 0, { x: 1, y: 1 })[0]).toEqual({ x: 1, y: 1 });
    expect(insertPoint(via, 2, { x: 9, y: 9 })[2]).toEqual({ x: 9, y: 9 });
    expect(via).toHaveLength(2);                                     // no muta
  });

  it('insertPoint respeta el tope de puntos', () => {
    const full = Array.from({ length: MAX_ROUTE_POINTS }, (_, i) => ({ x: i, y: i }));
    expect(insertPoint(full, 3, { x: 1, y: 1 })).toBe(full);
  });

  it('movePoint cambia solo ese punto', () => {
    expect(movePoint(via, 1, { x: 99.5, y: -3.2 })).toEqual([{ x: 10, y: 10 }, { x: 100, y: -3 }]);
    expect(movePoint(via, 7, { x: 1, y: 1 })).toBe(via);             // índice inexistente
    expect(via[1]).toEqual({ x: 20, y: 20 });
  });

  it('removePoint quita el punto; sin puntos el wire vuelve al camino automático', () => {
    expect(removePoint(via, 0)).toEqual([{ x: 20, y: 20 }]);
    expect(removePoint([{ x: 1, y: 1 }], 0)).toEqual([]);
    expect(removePoint(via, 9)).toBe(via);
  });

  it('sameRoute compara por valor', () => {
    expect(sameRoute(via, [{ x: 10, y: 10 }, { x: 20, y: 20 }])).toBe(true);
    expect(sameRoute(via, [{ x: 10, y: 10 }])).toBe(false);
    expect(sameRoute(via, [{ x: 10, y: 10 }, { x: 20, y: 21 }])).toBe(false);
    expect(sameRoute(undefined, [])).toBe(true);                      // sin trazo ≡ trazo vacío
    expect(sameRoute(undefined, undefined)).toBe(true);
  });
});

describe('snapPoint — imán a los ejes de los vecinos', () => {
  const prev = { x: 100, y: 50 }, next = { x: 300, y: 200 };

  it('dentro de la tolerancia se alinea con el vecino más cercano en cada eje', () => {
    expect(snapPoint({ x: 104, y: 120 }, [prev, next], 6)).toEqual({ x: 100, y: 120 });
    expect(snapPoint({ x: 180, y: 196 }, [prev, next], 6)).toEqual({ x: 180, y: 200 });
    expect(snapPoint({ x: 297, y: 53 }, [prev, next], 6)).toEqual({ x: 300, y: 50 });
  });

  it('fuera de la tolerancia no toca el punto', () => {
    expect(snapPoint({ x: 110, y: 120 }, [prev, next], 6)).toEqual({ x: 110, y: 120 });
  });

  it('entre dos vecinos al alcance gana el más cercano', () => {
    expect(snapPoint({ x: 103, y: 0 }, [{ x: 100, y: 0 }, { x: 105, y: 0 }], 6)).toEqual({ x: 105, y: 0 });
  });

  it('sin vecinos o sin tolerancia devuelve el punto igual', () => {
    expect(snapPoint({ x: 1, y: 2 }, [], 6)).toEqual({ x: 1, y: 2 });
    expect(snapPoint({ x: 104, y: 120 }, [prev], 0)).toEqual({ x: 104, y: 120 });
  });
});

describe('routedGeometry — lo que dibujan el canvas y el export', () => {
  const input = {
    sBox: { x: 0, w: 100 }, sy: 50, sStub: STUB_BLOCK,
    tBox: { x: 400, w: 100 }, ty: 200, tStub: 10,
    via: [{ x: 250, y: 120 }],
  };

  it('une extremos y camino: mismos lados que wireEnds, mismo camino que routeWire', () => {
    const g = routedGeometry(input);
    const { s, t } = wireEnds(input);
    expect(g.s).toEqual(s);
    expect(g.t).toEqual(t);
    expect(g.corners).toEqual(routeWire(s, t, input.via).corners);
    expect(g.path).toBe(routeWire(s, t, input.via).path);
    expect(g.corners).toEqual([{ x: 100, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 200 }, { x: 400, y: 200 }]);
  });

  it('expone dónde termina cada tramo fijo (vecinos del primer y último punto para el imán)', () => {
    const g = routedGeometry(input);
    expect(g.sOut).toEqual({ x: 128, y: 50 });
    expect(g.tOut).toEqual({ x: 390, y: 200 });
  });
});

describe('arrangeResetWarning — aviso del auto-arrange', () => {
  it('dice cuántos trazos se reinician, en singular y en plural', () => {
    expect(arrangeResetWarning(1)).toBe(
      'Auto-arrange moves every block, so the 1 manual wire route on this canvas will be reset to the automatic path. You can bring it back with Undo.');
    expect(arrangeResetWarning(3)).toBe(
      'Auto-arrange moves every block, so the 3 manual wire routes on this canvas will be reset to the automatic path. You can bring them back with Undo.');
  });

  it('sin trazos no hay nada que avisar', () => {
    expect(arrangeResetWarning(0)).toBeNull();
    expect(arrangeResetWarning(-2)).toBeNull();
  });
});

// ── Hallazgos de la revisión independiente (2026-09-28) ─────────────────────

describe('anclajes en píxeles enteros', () => {
  it('wireEnds redondea el borde del bloque y la fila, igual que los puntos del trazo', () => {
    const { s, t } = wireEnds({
      sBox: { x: 0.4, w: 100.2 }, sy: 50.5, sStub: 28,
      tBox: { x: 400.6, w: 100 }, ty: 199.4, tStub: 10,
      via: [{ x: 250, y: 0 }],
    });
    expect(s).toEqual({ x: 101, y: 51, dir: 1, stub: 28 });
    expect(t).toEqual({ x: 401, y: 199, dir: -1, stub: 10 });
  });

  it('una fila en .5 rutea igual que la fila entera a la que el imán llevó el punto', () => {
    // El imán deja el punto en 50.5 y `movePoint` lo redondea a 51: a medio
    // píxel exacto de la fila. Sin anclajes enteros ese medio píxel cambiaba
    // el camino entero (entraba al bloque del padre y volvía 80 px sobre sí).
    const via = [{ x: 128, y: 51 }, { x: 60, y: -80 }, { x: 300, y: 0 }, { x: 300, y: -150 }];
    const box = { sBox: { x: 0, w: 100 }, sStub: STUB_BLOCK, tBox: { x: 400, w: 100 }, ty: 200, tStub: STUB_BLOCK, via };
    const half = routedGeometry({ ...box, sy: 50.5 });
    expect(half.corners).toEqual(routedGeometry({ ...box, sy: 51 }).corners);
    expect(backtracks(half.corners)).toBe(false);
  });

  it('puntos con fracción (grabados por otro cliente) se rutean en su píxel entero', () => {
    const box = { sBox: { x: 0, w: 100 }, sy: 50, sStub: STUB_BLOCK, tBox: { x: 400, w: 100 }, ty: 200, tStub: STUB_BLOCK };
    const g = routedGeometry({ ...box, via: [{ x: 250.4, y: 119.6 }, { x: 310.5, y: 49.7 }] });
    expect(g.corners).toEqual(routedGeometry({ ...box, via: [{ x: 250, y: 120 }, { x: 311, y: 50 }] }).corners);
    for (const c of g.corners) expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true);
    // casi alineado con la fila del padre (0.4 px): recto, sin tramo inclinado
    expect(routedGeometry({ ...box, ty: 50, via: [{ x: 250, y: 50.4 }] }).corners).toEqual([{ x: 100, y: 50 }, { x: 400, y: 50 }]);
  });

  it('no muta los puntos que recibe', () => {
    const via = [{ x: 250.4, y: 119.6 }];
    routedGeometry({ sBox: { x: 0, w: 100 }, sy: 50, sStub: STUB_BLOCK, tBox: { x: 400, w: 100 }, ty: 200, tStub: STUB_BLOCK, via });
    expect(via).toEqual([{ x: 250.4, y: 119.6 }]);
  });

  it('extremos con fracción no dejan tramos inclinados', () => {
    const g = routedGeometry({
      sBox: { x: 0, w: 100 }, sy: 146.4, sStub: STUB_BLOCK,
      tBox: { x: 400, w: 100 }, ty: 145.6, tStub: STUB_BLOCK,
      via: [{ x: 250, y: 146 }],
    });
    expect(g.corners).toEqual([{ x: 100, y: 146 }, { x: 400, y: 146 }]);
  });
});

describe('puntos sobre el tramo fijo', () => {
  it.each([
    ['en medio del tramo fijo del padre', { x: 110, y: 50 }],
    ['sobre el anclaje del padre', { x: 100, y: 50 }],
    ['en el fin del tramo fijo del padre', { x: 128, y: 50 }],
  ])('%s: el wire no vuelve sobre su tramo fijo', (_, p) => {
    const r = routeWire(S, T, [p]);
    expect(r.corners).toEqual([{ x: 100, y: 50 }, { x: 128, y: 50 }, { x: 128, y: 200 }, { x: 400, y: 200 }]);
    expect(r.backtracks).toBe(0);
    expect(onPath(r.corners, p)).toBe(true);
  });

  it.each([
    ['en medio del tramo fijo del hijo', { x: 390, y: 200 }],
    ['sobre el anclaje del hijo', { x: 400, y: 200 }],
    ['en el fin del tramo fijo del hijo', { x: 372, y: 200 }],
  ])('%s: el wire no vuelve sobre su tramo fijo', (_, p) => {
    const r = routeWire(S, T, [p]);
    expect(r.corners).toEqual([{ x: 100, y: 50 }, { x: 372, y: 50 }, { x: 372, y: 200 }, { x: 400, y: 200 }]);
    expect(r.backtracks).toBe(0);
    expect(onPath(r.corners, p)).toBe(true);
  });

  it('un punto nuevo después de uno que está sobre el tramo fijo entra en SU posición', () => {
    const segs = routeWire(S, T, [{ x: 110, y: 50 }, { x: 250, y: 120 }]).segments;
    // tramo fijo (antes del punto 0) · hasta el punto 1 (entre el 0 y el 1) · del punto 1 al hijo
    expect(segs.map((g) => g.insertAt)).toEqual([0, 1, 1, 2, 2, 2]);
  });

  it('un punto DENTRO del bloque (detrás del anclaje) sí obliga a volver: se cuenta', () => {
    expect(routeWire(S, T, [{ x: 40, y: 50 }]).backtracks).toBeGreaterThan(0);
  });
});

describe('routeWire — cuenta los retrocesos', () => {
  it('un camino limpio no tiene retrocesos', () => {
    expect(routeWire(S, T, [{ x: 250, y: 120 }]).backtracks).toBe(0);
    expect(routeWire(S, T, [{ x: 200, y: 0 }, { x: 300, y: 0 }]).backtracks).toBe(0);
  });

  it('un vaivén sobre la misma recta es un retroceso que el usuario dibujó', () => {
    const r = routeWire(S, T, [{ x: 200, y: 0 }, { x: 320, y: 0 }, { x: 260, y: 0 }]);
    expect(r.backtracks).toBe(1);
    expect(backtracks(r.corners)).toBe(true);
  });
});

describe('handleSegments — sin tiradores sobre los tramos fijos', () => {
  it('el primer y el último tramo quedan marcados como fijos', () => {
    const segs = routeWire(S, T, [{ x: 250, y: 120 }]).segments;
    expect(segs.map((g) => !!g.fixed)).toEqual([true, false, false, false, false, true]);
  });

  it('con zoom alto (largo mínimo menor que el tramo fijo) tampoco se ofrecen', () => {
    const segs = routeWire(S, T, [{ x: 250, y: 120 }]).segments;
    // zoom 1.3 ⇒ 36 / 1.3 = 27.7 < 28: antes aparecía un tirador en cada tramo fijo
    expect(handleSegments(segs, 36 / 1.3)).toEqual([
      { x: 189, y: 50, insertAt: 0 },
      { x: 250, y: 85, insertAt: 0 },
      { x: 250, y: 160, insertAt: 1 },
      { x: 311, y: 200, insertAt: 1 },
    ]);
    expect(handleSegments(segs, 1).some((h) => h.y === 50 && h.x < 128)).toBe(false);
  });

  it('un largo mínimo que no es un número no ofrece tiradores', () => {
    const segs = routeWire(S, T, [{ x: 250, y: 120 }]).segments;
    expect(handleSegments(segs, Number.NaN)).toEqual([]);
  });
});

describe('routedGeometry — el lado cambia si por el suyo el wire vuelve sobre sí', () => {
  const stacked = { sBox: { x: 100, w: 240 }, sy: 50, sStub: STUB_BLOCK, tBox: { x: 100, w: 240 }, tStub: STUB_BLOCK };

  it('bloques APILADOS con un punto entre los dos: forma de S, sin muñón suelto', () => {
    const g = routedGeometry({ ...stacked, ty: 400, via: [{ x: 220, y: 225 }] });
    expect(g.corners).toEqual([
      { x: 340, y: 50 }, { x: 368, y: 50 }, { x: 368, y: 225 },
      { x: 72, y: 225 }, { x: 72, y: 400 }, { x: 100, y: 400 },
    ]);
    expect(g.s.dir).toBe(1);                       // el padre conserva el lado que decide el punto
    expect(g.t.dir).toBe(-1);
    expect(g.backtracks).toBe(0);
    expect(g.sOut).toEqual({ x: 368, y: 50 });
    expect(g.tOut).toEqual({ x: 72, y: 400 });
  });

  it('el punto del otro lado del centro da la S espejada', () => {
    const g = routedGeometry({ ...stacked, ty: 400, via: [{ x: 219, y: 225 }] });
    expect(g.corners).toEqual([
      { x: 100, y: 50 }, { x: 72, y: 50 }, { x: 72, y: 225 },
      { x: 368, y: 225 }, { x: 368, y: 400 }, { x: 340, y: 400 },
    ]);
    expect(g.backtracks).toBe(0);
  });

  it('relación RECURSIVA con un punto bajo el bloque: lo rodea', () => {
    const g = routedGeometry({ ...stacked, ty: 90, via: [{ x: 220, y: 300 }] });
    expect(g.corners).toEqual([
      { x: 340, y: 50 }, { x: 368, y: 50 }, { x: 368, y: 300 },
      { x: 72, y: 300 }, { x: 72, y: 90 }, { x: 100, y: 90 },
    ]);
    expect(g.backtracks).toBe(0);
  });

  it('un punto encima del hijo, en la fila del padre: pasa por arriba y entra por el otro lado', () => {
    const g = routedGeometry({
      sBox: { x: 0, w: 240 }, sy: 50, sStub: STUB_BLOCK,
      tBox: { x: 400, w: 240 }, ty: 200, tStub: STUB_BLOCK,
      via: [{ x: 450, y: 50 }],
    });
    expect(g.corners).toEqual([{ x: 240, y: 50 }, { x: 668, y: 50 }, { x: 668, y: 200 }, { x: 640, y: 200 }]);
    expect(g.t.dir).toBe(1);
  });

  it('entre dos combinaciones limpias gana la más corta', () => {
    // Bloques apilados con 100 px de desfase: salir por la izquierda y entrar
    // por la derecha también sirve, pero cruza 200 px más de canvas.
    const g = routedGeometry({
      sBox: { x: 100, w: 240 }, sy: 50, sStub: STUB_BLOCK,
      tBox: { x: 200, w: 240 }, ty: 400, tStub: STUB_BLOCK,
      via: [{ x: 200, y: 225 }],
    });
    expect(g.corners).toEqual([
      { x: 340, y: 50 }, { x: 368, y: 50 }, { x: 368, y: 225 },
      { x: 172, y: 225 }, { x: 172, y: 400 }, { x: 200, y: 400 },
    ]);
  });

  it('sin retroceso manda el punto, aunque otro lado diera un camino más corto', () => {
    const input = {
      sBox: { x: 0, w: 240 }, sy: 50, sStub: STUB_BLOCK,
      tBox: { x: 400, w: 240 }, ty: 200, tStub: STUB_BLOCK,
      via: [{ x: 130, y: -100 }],
    };
    const g = routedGeometry(input);
    expect(g.s).toEqual(wireEnds(input).s);
    expect(g.t).toEqual(wireEnds(input).t);
    expect(g.backtracks).toBe(0);
  });

  it('si TODA combinación vuelve sobre sí (punto dentro del bloque) se quedan los lados del punto', () => {
    const input = {
      sBox: { x: 0, w: 240 }, sy: 50, sStub: STUB_BLOCK,
      tBox: { x: 400, w: 240 }, ty: 200, tStub: STUB_BLOCK,
      via: [{ x: 100, y: 50 }],
    };
    const g = routedGeometry(input);
    expect(g.s.dir).toBe(-1);
    expect(g.t.dir).toBe(-1);
    expect(g.backtracks).toBeGreaterThan(0);
  });

  it('con UN punto fuera de los bloques y de sus filas nunca hay retroceso (barrido)', () => {
    const layouts = [
      { sBox: { x: 0, w: 240 }, sy: 50, tBox: { x: 400, w: 240 }, ty: 200 },      // lado a lado
      { sBox: { x: 100, w: 240 }, sy: 50, tBox: { x: 100, w: 240 }, ty: 400 },    // apilados
      { sBox: { x: 100, w: 240 }, sy: 50, tBox: { x: 200, w: 240 }, ty: 400 },    // apilados con desfase
      { sBox: { x: 100, w: 240 }, sy: 50, tBox: { x: 100, w: 240 }, ty: 90 },     // recursiva
      { sBox: { x: 0, w: 240 }, sy: 50, tBox: { x: 270, w: 240 }, ty: 200 },      // pegados (30 px)
      { sBox: { x: 400, w: 240 }, sy: 300, tBox: { x: 0, w: 240 }, ty: 20 },      // hijo a la izquierda y arriba
    ];
    for (const [n, box] of layouts.entries()) {
      for (let x = -200; x <= 900; x += 7) {
        for (let y = -200; y <= 600; y += 9) {
          if (y === box.sy || y === box.ty) continue;
          const g = routedGeometry({ ...box, sStub: STUB_BLOCK, tStub: STUB_BLOCK, via: [{ x, y }] });
          expect(g.backtracks, `disposición ${n}, punto (${x}, ${y})`).toBe(0);
          expect(backtracks(g.corners), `disposición ${n}, punto (${x}, ${y})`).toBe(false);
          expect(orthogonal(g.corners)).toBe(true);
          expect(onPath(g.corners, { x, y })).toBe(true);
        }
      }
    }
  });
});

describe('routeOf — el trazo de un wire', () => {
  it('devuelve el trazo guardado, o nada', () => {
    const routes = { 'rel-1': [{ x: 1, y: 2 }] };
    expect(routeOf(routes, 'rel-1')).toEqual([{ x: 1, y: 2 }]);
    expect(routeOf(routes, 'rel-2')).toBeUndefined();
  });

  it.each([['constructor'], ['toString'], ['hasOwnProperty'], ['__proto__'], ['valueOf']])(
    'un wire llamado «%s» no recibe una propiedad heredada del objeto', (id) => {
      expect(routeOf({}, id)).toBeUndefined();
      expect(routeOf({ 'rel-1': [{ x: 1, y: 2 }] }, id)).toBeUndefined();
    });
});
