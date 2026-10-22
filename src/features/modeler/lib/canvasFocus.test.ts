// Lo nuevo nace en el centro de lo que el usuario ve del canvas, descontando
// el panel de Properties que se abre al seleccionar la tabla nueva
// (achica el canvas por la derecha).
import { describe, expect, it } from 'vitest';
import { avoidStacking, blockSpot, cascade, centeredAt, focusViewport, insideRect, propsPanelWidth, usableArea, visibleCenter } from './canvasFocus';

describe('visibleCenter', () => {
  const pane = { left: 264, top: 136, width: 1176, height: 700 };

  it('sin panel que se abra: el centro del área del canvas', () => {
    expect(visibleCenter(pane)).toEqual({ x: 264 + 588, y: 136 + 350 });
  });

  it('si al seleccionar se abrirá el panel de Properties, el centro de lo que quedará visible', () => {
    expect(visibleCenter(pane, 472)).toEqual({ x: 264 + (1176 - 472) / 2, y: 486 });
  });

  it('si el panel se cerrará (la carga Excel recarga el canvas sin selección), el centro de lo que quedará visible', () => {
    // pane con el panel abierto (704 px): al cerrarse se ensancha 472 px.
    expect(visibleCenter({ left: 264, top: 136, width: 704, height: 700 }, -472)).toEqual({ x: 264 + (704 + 472) / 2, y: 486 });
  });

  it('un panel más ancho que el canvas no da un centro fuera de él', () => {
    expect(visibleCenter({ left: 0, top: 0, width: 300, height: 200 }, 500)).toEqual({ x: 0, y: 100 });
  });
});

describe('centeredAt', () => {
  it('esquina para que el bloque quede centrado, en píxeles enteros', () => {
    expect(centeredAt({ x: 500.4, y: 300.6 }, { w: 240, h: 60 })).toEqual({ x: 380, y: 271 });
  });
});

describe('propsPanelWidth', () => {
  it('el ancho que dejó el usuario al redimensionar el panel', () => {
    expect(propsPanelWidth('520px', 1440)).toBe(520);
    expect(propsPanelWidth(' 400px ', 1440)).toBe(400);
  });

  it('sin ancho propio: el default del CSS, min(472px, 38vw)', () => {
    expect(propsPanelWidth('', 1440)).toBe(472);
    expect(propsPanelWidth('', 1000)).toBe(380);
  });
});

describe('blockSpot — dónde nace un bloque nuevo', () => {
  const view = { center: { x: 1000, y: 2000 }, rect: { left: 400, top: 1700, right: 1600, bottom: 2300 } };

  it('un bloque chico queda centrado en lo que se ve', () => {
    expect(blockSpot(view, { w: 240, h: 60 })).toEqual({ x: 880, y: 1970 });
  });

  it('un bloque más alto que lo visible no esconde su cabecera: el borde superior queda a la vista', () => {
    expect(blockSpot(view, { w: 300, h: 1400 })).toEqual({ x: 850, y: 1700 + 24 });
  });
});

describe('insideRect', () => {
  const r = { left: 0, top: 0, right: 100, bottom: 50 };
  it('dentro, en el borde y fuera', () => {
    expect(insideRect({ x: 10, y: 10 }, r)).toBe(true);
    expect(insideRect({ x: 100, y: 50 }, r)).toBe(true);
    expect(insideRect({ x: 101, y: 10 }, r)).toBe(false);
    expect(insideRect({ x: 10, y: -1 }, r)).toBe(false);
  });
});

describe('avoidStacking — altas seguidas en el mismo centro', () => {
  const size = { w: 240, h: 60 };
  it('sin otro bloque que arranque a esa altura y se cruce, se queda en su lugar', () => {
    expect(avoidStacking({ x: 880, y: 1970 }, size, [{ x: 0, y: 0, w: 240 }, { x: 880, y: 1500, w: 240 }])).toEqual({ x: 880, y: 1970 });
  });
  it('si ya hay uno que arranca ahí (misma altura, se cruza en horizontal), baja en cascada de 36 px', () => {
    expect(avoidStacking({ x: 880, y: 1970 }, size, [{ x: 880, y: 1970, w: 240 }])).toEqual({ x: 916, y: 2006 });
    expect(avoidStacking({ x: 808, y: 1970 }, { w: 384, h: 60 }, [{ x: 880, y: 1972, w: 240 }])).toEqual({ x: 844, y: 2006 });
  });
  it('varios ya apilados: sigue la cascada hasta encontrar lugar', () => {
    const others = [{ x: 880, y: 1970, w: 240 }, { x: 916, y: 2006, w: 240 }, { x: 952, y: 2042, w: 240 }];
    expect(avoidStacking({ x: 880, y: 1970 }, size, others)).toEqual({ x: 988, y: 2078 });
  });
});

// Lo reciente (lo creado en esta sesión, también lo pendiente de pintar) no
// queda tapado hasta su nombre: una CTAS más alta, centrada más arriba, no tapa
// entera a la tabla en blanco recién creada. Y la cascada no saca la
// cabecera del bloque nuevo de lo que se ve.
describe('avoidStacking — lo reciente asoma', () => {
  const view = { left: 400, top: 1700, right: 1600, bottom: 2300 };
  it('si taparía la esquina con el nombre (36 × 32) de un bloque reciente, baja en diagonal hasta que asome', () => {
    // A (240×60) en (880, 1970); una CTAS de 240×312 centrada → (880, 1844).
    expect(avoidStacking({ x: 880, y: 1844 }, { w: 240, h: 312 }, [], [{ x: 880, y: 1970, w: 240 }], view)).toEqual({ x: 916, y: 1880 });
  });
  it('un bloque existente (no reciente) a otra altura puede quedar detrás, a propósito', () => {
    expect(avoidStacking({ x: 880, y: 1844 }, { w: 240, h: 312 }, [{ x: 880, y: 1970, w: 240 }], [], view)).toEqual({ x: 880, y: 1844 });
  });
  it('si la cascada sacaría su cabecera de lo visible, nace en el lugar libre más cercano a la vista', () => {
    const recent = Array.from({ length: 12 }, (_, i) => ({ x: 880 + 36 * i, y: 1970 + 36 * i, w: 240 }));
    const size = { w: 240, h: 60 };
    const p = avoidStacking({ x: 880, y: 1970 }, size, recent, recent, view)!;
    expect(p).not.toBeNull();
    // a la vista, sin tapar la esquina con el nombre de ninguno ni arrancar a su altura
    expect(p.x >= view.left && p.y >= view.top && p.x + 240 <= view.right && p.y + 32 <= view.bottom).toBe(true);
    for (const r of recent) {
      expect(r.x < p.x + 240 && p.x < r.x + 36 && r.y < p.y + 60 && p.y < r.y + 32).toBe(false);
      expect(Math.abs(r.y - p.y) <= 4 && r.x < p.x + 240 && p.x < r.x + 240).toBe(false);
    }
    // el más cercano al punto de partida: 36 px arriba y a la derecha de la primera
    expect(p).toEqual({ x: 916, y: 1934 });
  });
  it('null solo si no queda ningún lugar libre a la vista', () => {
    const recent: { x: number; y: number; w: number }[] = [];
    for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) recent.push({ x: 880 + 36 * i, y: 1970 + 36 * j, w: 240 });
    expect(avoidStacking({ x: 880, y: 1970 }, { w: 240, h: 60 }, [], recent, view)).toBeNull();
  });
  it('sin límite de lo visible la cascada termina siempre (200 pasos como mucho)', () => {
    const recent = Array.from({ length: 5000 }, (_, i) => ({ x: 880 + 36 * i, y: 1970 + 36 * i, w: 240 }));
    expect(avoidStacking({ x: 880, y: 1970 }, { w: 240, h: 60 }, [], recent)).toEqual({ x: 880 + 36 * 200, y: 1970 + 36 * 200 });
  });
});

// Un bloque más ancho que lo visible (zoom alto, nombres largos en una laptop)
// nunca tiene la cabecera entera a la vista: exigirla haría que la cascada
// devolviera null y las altas cayeran exactamente encima de la primera.
describe('bloques más anchos que lo visible y vista saturada', () => {
  const narrow = { left: 843, top: 1864, right: 1158, bottom: 2136 };        // 315 × 272 (zoom 2)
  const wide = { w: 432, h: 60 };
  const grip = (r: { x: number; y: number }, p: { x: number; y: number }, w = 432, h = 60) =>
    r.x < p.x + w && p.x < r.x + 36 && r.y < p.y + h && p.y < r.y + 32;

  it('blockSpot: el bloque más ancho que lo visible nace con su nombre a la vista (borde izquierdo + margen)', () => {
    expect(blockSpot({ center: { x: 1000, y: 2000 }, rect: narrow }, wide)).toEqual({ x: 867, y: 1970 });
    expect(blockSpot({ center: { x: 1000, y: 2000 }, rect: narrow }, { w: 240, h: 60 })).toEqual({ x: 880, y: 1970 });
  });

  it('su cascada exige a la vista solo la esquina con el nombre: la segunda no cae encima de la primera', () => {
    const first = { x: 867, y: 1970 };
    const p = avoidStacking(first, wide, [{ ...first, w: 432 }], [{ ...first, w: 432 }], narrow)!;
    expect(p).toEqual({ x: 903, y: 2006 });
  });

  it('si la cabecera entera no entra en ningún lugar libre, basta la esquina con el nombre', () => {
    // Bloque de 280 en una vista de 300: con la cabecera entera solo cabe en x = left;
    // esa columna está tomada a toda altura por bloques recientes.
    const view = { left: 0, top: 0, right: 300, bottom: 400 };
    const recent = Array.from({ length: 13 }, (_, k) => ({ x: 0, y: k * 36 - 36, w: 280 }));
    const p = avoidStacking({ x: 0, y: 160 }, { w: 280, h: 60 }, recent, recent, view)!;
    expect(p).not.toBeNull();
    expect(p.x).toBeGreaterThan(0);
    expect(p.x + 36 <= view.right && p.y >= 0 && p.y + 32 <= view.bottom).toBe(true);
    for (const r of recent) expect(grip(r, p, 280)).toBe(false);
  });

  it('cascade (último recurso, sin lugar libre a la vista): sigue la diagonal y no tapa a ninguno', () => {
    const recent = Array.from({ length: 30 }, (_, k) => ({ x: 867 + 36 * k, y: 1970 + 36 * k, w: 432 }));
    const p = cascade({ x: 867, y: 1970 }, wide, recent, recent);
    for (const r of recent) expect(grip(r, p)).toBe(false);
    expect(p).toEqual({ x: 867 + 36 * 30, y: 1970 + 36 * 30 });
  });
});

// Al seleccionar una tabla (se abre el panel de Properties), el canvas se
// acerca y centra la tabla con sus vistas en el área que queda libre (el
// canvas ya descuenta el panel). Hasta 100 % (sin alejar si el usuario
// ya estaba más cerca y entra); si el grupo no entra legible (60 %), la tabla
// sola; y una tabla más alta que el área, desde su cabecera.
describe('focusViewport — acercar y centrar la tabla con sus vistas', () => {
  type B = { x: number; y: number; w: number; h: number };
  const T: B = { x: 1000, y: 2000, w: 240, h: 312 };
  const V: B = { x: 1280, y: 2000, w: 240, h: 312 };
  const screen = (b: B, vp: { x: number; y: number; zoom: number }) =>
    ({ l: b.x * vp.zoom + vp.x, r: (b.x + b.w) * vp.zoom + vp.x, t: b.y * vp.zoom + vp.y, b: (b.y + b.h) * vp.zoom + vp.y });
  const union = (bs: B[]): B => {
    const l = Math.min(...bs.map((b) => b.x)), t = Math.min(...bs.map((b) => b.y));
    return { x: l, y: t, w: Math.max(...bs.map((b) => b.x + b.w)) - l, h: Math.max(...bs.map((b) => b.y + b.h)) - t };
  };

  it('desde lejos: se acerca hasta 100 % y el grupo queda en el centro del área libre', () => {
    const area = { width: 704, height: 730 };
    const vp = focusViewport(T, [V], area, 0.3);
    expect(vp.zoom).toBe(1);
    const s = screen(union([T, V]), vp);
    expect((s.l + s.r) / 2).toBeCloseTo(352, 5);
    expect((s.t + s.b) / 2).toBeCloseTo(365, 5);
  });

  it('si el usuario ya estaba más cerca y el grupo entra, no aleja: solo centra', () => {
    const vp = focusViewport(T, [V], { width: 1184, height: 910 }, 1.5);
    expect(vp.zoom).toBe(1.5);
    const s = screen(union([T, V]), vp);
    expect((s.l + s.r) / 2).toBeCloseTo(592, 5);
  });

  it('área chica (laptop al 125 %): el zoom que hace entrar al grupo, con margen', () => {
    const area = { width: 414, height: 458 };
    const vp = focusViewport(T, [V], area, 0.3);
    expect(vp.zoom).toBeGreaterThanOrEqual(0.6);
    expect(vp.zoom).toBeLessThan(1);
    const s = screen(union([T, V]), vp);
    expect(s.l).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(s.r).toBeLessThanOrEqual(414 - 16 + 1e-6);
    expect((s.l + s.r) / 2).toBeCloseTo(207, 5);
    expect((s.t + s.b) / 2).toBeCloseTo(229, 5);
  });

  it('una vista lejos (el grupo no entra legible): centra la tabla sola', () => {
    const far: B = { x: 7000, y: 2000, w: 240, h: 312 };
    const vp = focusViewport(T, [far], { width: 704, height: 730 }, 0.3);
    expect(vp.zoom).toBe(1);
    const s = screen(T, vp);
    expect((s.l + s.r) / 2).toBeCloseTo(352, 5);
    expect((s.t + s.b) / 2).toBeCloseTo(365, 5);
  });

  it('una tabla más alta que el área: desde su cabecera, con su vista al lado si entra a lo ancho', () => {
    const tall: B = { x: 0, y: 0, w: 240, h: 1152 };
    const tallView: B = { x: 280, y: 0, w: 240, h: 1152 };
    const area = { width: 414, height: 458 };
    const vp = focusViewport(tall, [tallView], area, 0.3);
    expect(vp.zoom).toBeGreaterThanOrEqual(0.6);
    const s = screen(union([tall, tallView]), vp);
    expect(s.t).toBeGreaterThanOrEqual(16 - 1e-6);       // la cabecera a la vista
    expect(s.t).toBeLessThanOrEqual(48 + 1e-6);
    expect((s.l + s.r) / 2).toBeCloseTo(207, 5);
  });

  it('una tabla alta con vistas lejos: la tabla, desde su cabecera y centrada', () => {
    const tall: B = { x: 0, y: 0, w: 240, h: 1152 };
    const vp = focusViewport(tall, [{ x: 9000, y: 0, w: 240, h: 300 }], { width: 414, height: 458 }, 0.3);
    const s = screen(tall, vp);
    expect(vp.zoom).toBe(1);
    expect((s.l + s.r) / 2).toBeCloseTo(207, 5);
    expect(s.t).toBeGreaterThanOrEqual(16 - 1e-6);
  });
});

// En una laptop el minimapa (abajo a la derecha, 200×150) taparía parte de la
// vista encuadrada: el encuadre usa lo que queda por encima del minimapa (nunca
// menos de la mitad del canvas).
describe('usableArea — lo que se ve del canvas sin el minimapa', () => {
  const pane = { left: 264, top: 120, width: 414, height: 446, right: 678, bottom: 566 };
  it('sin minimapa: todo el canvas', () => {
    expect(usableArea(pane, null)).toEqual({ width: 414, height: 446 });
  });
  it('con minimapa: hasta su borde superior, con aire', () => {
    expect(usableArea(pane, { left: 463, top: 401, right: 663, bottom: 551 })).toEqual({ width: 414, height: 401 - 120 - 8 });
  });
  it('nunca menos de la mitad del canvas', () => {
    expect(usableArea(pane, { left: 300, top: 150, right: 663, bottom: 551 })).toEqual({ width: 414, height: 223 });
  });
});

// Matemática en los bordes y propiedad sobre 20 000 casos al azar: la cabecera
// de la tabla seleccionada queda siempre dentro del área (también con una tabla
// más alta que el área y una vista encima); y una vista lejana no descarta a la
// cercana (se suman de la más cercana a la más lejana mientras el grupo entre
// legible).
describe('focusViewport — bordes y propiedad', () => {
  type B = { x: number; y: number; w: number; h: number };
  const screen = (b: B, vp: { x: number; y: number; zoom: number }) =>
    ({ l: b.x * vp.zoom + vp.x, r: (b.x + b.w) * vp.zoom + vp.x, t: b.y * vp.zoom + vp.y, b: (b.y + b.h) * vp.zoom + vp.y });
  const finite = (vp: { x: number; y: number; zoom: number }) => [vp.x, vp.y, vp.zoom].every(Number.isFinite);
  const HEAD = 32;

  it('bordes: área menor que 2× el margen, 0×0, caja de 0, coordenadas negativas, zoom actual 0', () => {
    const T: B = { x: 1000, y: 2000, w: 240, h: 140 };
    expect(focusViewport(T, [], { width: 20, height: 10 }, 0.3).zoom).toBeCloseTo(0.6, 9);
    expect(finite(focusViewport(T, [], { width: 0, height: 0 }, 0.3))).toBe(true);
    const Z: B = { x: 50, y: 60, w: 0, h: 0 };
    expect(focusViewport(Z, [], { width: 700, height: 500 }, 0.3)).toEqual({ x: 300, y: 190, zoom: 1 });
    const N: B = { x: -5000, y: -3000, w: 240, h: 140 };
    const s = screen(N, focusViewport(N, [], { width: 700, height: 500 }, 0.3));
    expect((s.l + s.r) / 2).toBeCloseTo(350, 6);
    expect(focusViewport(T, [], { width: 700, height: 500 }, 0).zoom).toBe(1);
  });

  it('tabla más alta que el área con su vista encima: la cabecera de la tabla queda arriba, a la vista', () => {
    const t5: B = { x: 2400, y: 0, w: 233, h: 1380 };
    const above: B = { x: 2400, y: -1000, w: 240, h: 100 };
    const area = { width: 704, height: 573 };
    const head = screen({ ...t5, h: HEAD }, focusViewport(t5, [above], area, 0.208));
    expect(head.t).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(head.t).toBeLessThanOrEqual(48 + 1e-6);
    const t: B = { x: 0, y: 0, w: 240, h: 32 + 15 * 28 };
    const laptop = screen({ ...t, h: HEAD }, focusViewport(t, [{ x: 0, y: -400, w: 240, h: 100 }], { width: 414, height: 273 }, 0.23));
    expect(laptop.t).toBeGreaterThanOrEqual(0);
    expect(laptop.b).toBeLessThanOrEqual(273);
  });

  it('una vista lejana no descarta a la cercana: T0 + V0 al lado se ven enteras', () => {
    const t0: B = { x: 0, y: 0, w: 220, h: 116 };
    const v0: B = { x: 260, y: 200, w: 240, h: 92 };
    const vdup: B = { x: 4800, y: 0, w: 240, h: 92 };
    const area = { width: 704, height: 573 };
    const vp = focusViewport(t0, [vdup, v0], area, 0.2);
    expect(vp.zoom).toBe(1);
    const s = screen(v0, vp), t = screen(t0, vp);
    expect(s.r).toBeLessThanOrEqual(area.width);
    expect(t.l).toBeGreaterThanOrEqual(0);
    expect(screen(vdup, vp).l).toBeGreaterThan(area.width);   // la lejana queda fuera
  });

  // Con una tabla alta, una vista que igual no se vería (encima de la cabecera, o
  // muy abajo) no cuenta: si contara, bajaría el zoom y correría la tabla.
  it('tabla alta con una vista encima (o muy abajo) y corrida: no cuenta — 100 % y la tabla centrada', () => {
    const t5: B = { x: 2400, y: 0, w: 233, h: 1380 };
    const area = { width: 704, height: 573 };
    for (const view of [{ x: 3000, y: -400, w: 240, h: 200 }, { x: 3000, y: 1300, w: 240, h: 200 }]) {
      const vp = focusViewport(t5, [view], area, 0.208);
      expect(vp.zoom, JSON.stringify(view)).toBe(1);
      const s = screen(t5, vp);
      expect((s.l + s.r) / 2).toBeCloseTo(352, 5);
      expect(s.t).toBeCloseTo(46, 5);   // la cabecera, arriba con el margen
    }
  });

  it('una tabla ancha y baja: desde su borde izquierdo, pero centrada en vertical', () => {
    const wide: B = { x: 0, y: 0, w: 1500, h: 200 };
    const vp = focusViewport(wide, [], { width: 704, height: 573 }, 0.3);
    const s = screen(wide, vp);
    expect(s.l).toBeCloseTo(46, 5);
    expect((s.t + s.b) / 2).toBeCloseTo(573 / 2, 5);
  });

  it('propiedad (20 000 casos): finito, zoom en [0.6, max(1, actual)] y la cabecera de la tabla dentro del área', () => {
    let seed = 114;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (a: number, b: number) => a + (b - a) * rnd();
    const bad: unknown[] = [];
    for (let i = 0; i < 20000; i += 1) {
      const table: B = { x: pick(-20000, 20000), y: pick(-20000, 20000), w: pick(220, 880), h: pick(60, 2400) };
      const views: B[] = Array.from({ length: Math.floor(pick(0, 4)) }, () => ({
        x: table.x + pick(-3000, 3000), y: table.y + pick(-3000, 3000), w: pick(200, 600), h: pick(60, 800) }));
      const area = { width: pick(200, 2000), height: pick(150, 1200) };
      const z = pick(0.02, 2);
      const vp = focusViewport(table, views, area, z);
      const head = screen({ ...table, h: Math.min(HEAD, table.h) }, vp);
      const ok = finite(vp) && vp.zoom >= 0.6 - 1e-9 && vp.zoom <= Math.max(1, z) + 1e-9
        && head.t >= -0.5 && head.b <= area.height + 0.5
        && head.l <= area.width - 20 && head.l + Math.min(table.w * vp.zoom, area.width) >= 20;
      if (!ok && bad.length < 3) bad.push({ table, views, area, z, vp, head });
    }
    expect(bad).toEqual([]);
  });
});
