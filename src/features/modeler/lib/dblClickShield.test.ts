// Revisión 2 doc 114 (punto 3): el 2.º clic de un doble clic sobre una tabla —
// rápido o lento — caía donde la tabla ya no estaba (el canvas se mueve para
// encuadrarla): deseleccionaba, elegía otra tabla, abría el popup de un wire,
// hacía el zoom del fondo o cortaba el encuadre a medio camino. El escudo lo ataja
// en la captura: sólo el 2.º clic (el navegador lo marca con `detail` ≥ 2) en el
// mismo lugar que un clic que encuadró, poco después.
import { describe, expect, it, vi } from 'vitest';
import { createDblClickShield } from './dblClickShield';

type Ev = { type: string; detail: number; button: number; clientX: number; clientY: number; stopPropagation: () => void; preventDefault: () => void };
const ev = (type: string, detail: number, x = 100, y = 100, button = 0): Ev =>
  ({ type, detail, button, clientX: x, clientY: y, stopPropagation: vi.fn(), preventDefault: vi.fn() });

/** Un escudo con reloj manual. */
function shield() {
  let now = 1000;
  const s = createDblClickShield(() => now);
  return { s, tick: (ms: number) => { now += ms; } };
}
const swallowed = (e: Ev) => vi.mocked(e.stopPropagation).mock.calls.length > 0;

describe('escudo del doble clic (revisión 2 doc 114)', () => {
  it('el 2.º clic de un doble clic sobre una tabla que se encuadró no llega a nadie', () => {
    const { s, tick } = shield();
    s.handle(ev('click', 1));   // 1.er clic (captura)…
    s.arm();                    // …que selecciona y encuadra la tabla
    tick(380);                  // doble clic LENTO: el canvas ya se mueve
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
      const e = ev(type, 2, 103, 98);
      s.handle(e);
      expect(swallowed(e), type).toBe(true);
    }
  });

  it('el 1.er clic, un clic suelto después y los de otro botón pasan', () => {
    const { s, tick } = shield();
    const first = ev('click', 1);
    s.handle(first);
    s.arm();
    expect(swallowed(first)).toBe(false);
    tick(200);
    const right = ev('mousedown', 2, 100, 100, 2);
    s.handle(right);
    expect(swallowed(right)).toBe(false);
    tick(900);   // ya no es un doble clic (pasó el tiempo del sistema): otro clic, que vale
    const late = ev('mousedown', 1);
    s.handle(late);
    expect(swallowed(late)).toBe(false);
  });

  it('sin encuadre (la tabla ya estaba seleccionada, un clic en el fondo, un wire) el doble clic hace lo suyo', () => {
    const { s, tick } = shield();
    s.handle(ev('click', 1));
    tick(150);
    const second = ev('dblclick', 2);
    s.handle(second);
    expect(swallowed(second)).toBe(false);
  });

  it('un encuadre de ANTES (otro clic) no ataja el doble clic de ahora', () => {
    const { s, tick } = shield();
    s.handle(ev('click', 1, 400, 400));
    s.arm();
    tick(2000);
    s.handle(ev('click', 1, 100, 100));   // otro clic, sin encuadre (p. ej. en el fondo)
    tick(150);
    const second = ev('dblclick', 2, 100, 100);
    s.handle(second);
    expect(swallowed(second)).toBe(false);
  });

  it('un doble clic en OTRO lugar (más de unos píxeles) o pasado el tiempo no se ataja', () => {
    const { s, tick } = shield();
    s.handle(ev('click', 1, 100, 100));
    s.arm();
    tick(150);
    const far = ev('mousedown', 2, 140, 100);
    s.handle(far);
    expect(swallowed(far)).toBe(false);
    tick(700);
    const slow = ev('mousedown', 2, 100, 100);
    s.handle(slow);
    expect(swallowed(slow)).toBe(false);
  });

  it('un 3.er clic en el mismo lugar también se ataja (sigue siendo el mismo gesto)', () => {
    const { s, tick } = shield();
    s.handle(ev('click', 1));
    s.arm();
    tick(150);
    s.handle(ev('click', 2));
    tick(150);
    const third = ev('click', 3);
    s.handle(third);
    expect(swallowed(third)).toBe(true);
  });

  it('el atajado no deja seleccionar texto ni mover el foco (preventDefault), salvo en el mouseup', () => {
    const { s, tick } = shield();
    s.handle(ev('click', 1));
    s.arm();
    tick(100);
    const down = ev('mousedown', 2), up = ev('mouseup', 2);
    s.handle(down);
    s.handle(up);
    expect(vi.mocked(down.preventDefault)).toHaveBeenCalled();
    expect(vi.mocked(up.preventDefault)).not.toHaveBeenCalled();
  });
});
