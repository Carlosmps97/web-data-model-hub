// Minor #8a (doc 96): navegación por teclado del menú de SearchSelect. Sin
// `action` el comportamiento de los combos existentes no cambia.
import { describe, expect, it } from 'vitest';
import { enterTarget, moveHighlight } from './searchSelectNav';

describe('searchSelectNav', () => {
  it('sin acción y sin resultados, ↓ + Enter no hace nada (no cierra el menú)', () => {
    const hi = moveHighlight(0, 1, 0, false);
    expect(hi).toBe(-1);
    expect(enterTarget(hi, 0, false)).toBe('none');
  });
  it('con acción, ↓ llega a la fila de acción y Enter la corre', () => {
    expect(moveHighlight(1, 1, 2, true)).toBe(2);
    expect(moveHighlight(2, 1, 2, true)).toBe(2);
    expect(enterTarget(2, 2, true)).toBe('action');
    expect(enterTarget(1, 2, true)).toBe('option');
    expect(enterTarget(0, 0, true)).toBe('action');
  });
  it('↑ no baja de 0 y ↓ sin acción se detiene en la última opción', () => {
    expect(moveHighlight(0, -1, 3, true)).toBe(0);
    expect(moveHighlight(2, 1, 3, false)).toBe(2);
  });
});
