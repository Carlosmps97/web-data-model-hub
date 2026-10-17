// Doc 113 §5: la barra de formato de un dibujo va arriba del dibujo; si arriba
// no entra (el dibujo está pegado al borde superior del canvas), va abajo.
import { describe, expect, it } from 'vitest';
import { DRAWING_TOOLBAR_ROOM, drawingToolbarSide, nodeTopOnScreen } from './toolbarSide';

describe('drawingToolbarSide (top, bottom del dibujo; alto del canvas)', () => {
  it('con aire arriba, la barra va arriba', () => {
    expect(drawingToolbarSide(200, 300, 800)).toBe('top');
    expect(drawingToolbarSide(DRAWING_TOOLBAR_ROOM, 300, 800)).toBe('top');
  });

  it('pegado al borde superior (o asomando por arriba) y con lugar abajo, la barra pasa abajo', () => {
    expect(drawingToolbarSide(DRAWING_TOOLBAR_ROOM - 1, 200, 800)).toBe('bottom');
    expect(drawingToolbarSide(10, 120, 800)).toBe('bottom');
    expect(drawingToolbarSide(-80, 40, 800)).toBe('bottom');
  });

  it('revisión: si ABAJO tampoco entra (dibujo grande que se sale del canvas), se queda arriba', () => {
    expect(drawingToolbarSide(20, 790, 800)).toBe('top');
    expect(drawingToolbarSide(-300, 1200, 800)).toBe('top');
  });
});

describe('nodeTopOnScreen', () => {
  it('posición del flujo → píxeles del canvas con el zoom y el desplazamiento del viewport', () => {
    expect(nodeTopOnScreen(100, [0, 0, 1])).toBe(100);
    expect(nodeTopOnScreen(100, [30, -40, 0.5])).toBe(10);
  });
});
