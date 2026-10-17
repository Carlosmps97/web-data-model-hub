// Doc 113 §5 (revisión, ALTO): mientras el cuadro flotante se mide NO puede
// quedar con `visibility: hidden` — un `autoFocus` o el `focus()` del montaje no
// entran a un elemento oculto (el buscador del filtro de Reporting perdía lo
// tipeado; el selector de color de Model properties no recibía el foco).
import { describe, expect, it } from 'vitest';
import { floatingStyle, nextPlaced, samePlaced } from './useFloating';

describe('floatingStyle', () => {
  it('antes de medir: transparente y sin eventos, pero NO oculto (el foco tiene que poder entrar)', () => {
    const s = floatingStyle(null);
    expect(s.visibility).toBeUndefined();
    expect(s).toMatchObject({ position: 'fixed', opacity: 0, pointerEvents: 'none' });
  });

  it('medido: su lugar, el ancho impuesto y el alto máximo con scroll si hace falta', () => {
    expect(floatingStyle({ left: 10, top: 20, side: 'bottom', maxHeight: null, width: null }))
      .toEqual({ position: 'fixed', left: 10, top: 20 });
    expect(floatingStyle({ left: 10, top: 20, side: 'top', maxHeight: 300, width: 480 }))
      .toEqual({ position: 'fixed', left: 10, top: 20, width: 480, maxHeight: 300, overflowY: 'auto' });
  });
});

// Ronda 2 de la revisión: oculto (el ancla salió de la vista) conserva el ANCHO
// impuesto — sin él React lo borraba, el cuadro cambiaba de tamaño y el
// ResizeObserver lo volvía a escribir dentro de su propio aviso («ResizeObserver
// loop completed with undelivered notifications») — y el lado de antes, para
// volver del mismo lado cuando el ancla reaparece.
describe('nextPlaced / samePlaced', () => {
  const last = { left: 10, top: 20, side: 'top' as const, maxHeight: null, width: 480 };
  it('con lugar: la ubicación con el ancho impuesto', () => {
    expect(nextPlaced({ left: 1, top: 2, side: 'bottom', maxHeight: 90 }, 480, last))
      .toEqual({ left: 1, top: 2, side: 'bottom', maxHeight: 90, width: 480 });
  });
  it('sin lugar: oculto, con el ancho impuesto y el lado de antes', () => {
    const hidden = nextPlaced(null, 480, last)!;
    expect(hidden).toMatchObject({ hidden: true, width: 480, side: 'top' });
    expect(floatingStyle(hidden)).toMatchObject({ position: 'fixed', opacity: 0, pointerEvents: 'none', width: 480 });
    expect(floatingStyle(hidden).visibility).toBeUndefined();
  });
  it('oculto y a la vista en (0, 0) no son lo mismo', () => {
    const shown = nextPlaced({ left: 0, top: 0, side: 'top', maxHeight: null }, 480, null)!;
    expect(samePlaced(nextPlaced(null, 480, last), shown)).toBe(false);
    expect(samePlaced(shown, { ...shown })).toBe(true);
  });
});
