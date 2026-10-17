// Doc 114 (piloto): la barra del canvas se adapta al ancho SIN scroll horizontal
// ni filas desparejas — en una sola fila, compacta por pasos en un orden fijo
// (como la cinta de Office: primero lo que menos se usa) y vuelve atrás al
// ensancharse. Nada se quita: lo compactado queda en un menú de su grupo.
import { describe, expect, it } from 'vitest';
import { TOOLBAR_STEPS, fitLevel, stepOn } from './toolbarFit';

describe('fitLevel', () => {
  it('no entra: sube un paso y anota cuánto medía el contenido en ese nivel', () => {
    const need: Record<number, number> = {};
    expect(fitLevel(0, { available: 1536, content: 1720 }, need, 9)).toBe(1);
    expect(need).toEqual({ 0: 1720 });
  });

  it('entra: se queda (y en el nivel 0 no hay nada que deshacer)', () => {
    expect(fitLevel(0, { available: 1920, content: 1700 }, {}, 9)).toBe(0);
    expect(fitLevel(3, { available: 1500, content: 1400 }, { 2: 1520 }, 9)).toBe(3);
  });

  it('al ensancharse vuelve un paso sólo si el nivel anterior ENTRA (con un margen, sin rebotar)', () => {
    expect(fitLevel(3, { available: 1525, content: 1400 }, { 2: 1520 }, 9)).toBe(3);   // 1525 < 1520 + 8
    expect(fitLevel(3, { available: 1528, content: 1400 }, { 2: 1520 }, 9)).toBe(2);
  });

  it('en el último nivel no sube más', () => {
    expect(fitLevel(9, { available: 600, content: 800 }, {}, 9)).toBe(9);
  });

  it('secuencia: angostar y volver a ensanchar recorre los mismos niveles', () => {
    const need: Record<number, number> = {};
    const widths = [1720, 1600, 1490, 1380, 1250];          // contenido medido en cada nivel
    let lv = 0;
    const settle = (available: number) => {
      for (let i = 0; i < 20; i++) {
        const next = fitLevel(lv, { available, content: widths[Math.min(lv, widths.length - 1)] }, need, 4);
        if (next === lv) return lv;
        lv = next;
      }
      return lv;
    };
    expect(settle(1400)).toBe(3);
    expect(settle(1300)).toBe(4);
    expect(settle(1500)).toBe(2);
    expect(settle(1920)).toBe(0);
  });
});

describe('TOOLBAR_STEPS', () => {
  it('orden: Open model y Drawing primero; Save y Publish sin texto casi al final; el resto de Relationships al último', () => {
    expect(TOOLBAR_STEPS[0]).toBe('open');
    expect(TOOLBAR_STEPS[1]).toBe('drawing');
    expect(TOOLBAR_STEPS.indexOf('primary')).toBeGreaterThan(TOOLBAR_STEPS.indexOf('structure'));
    expect(TOOLBAR_STEPS.at(-1)).toBe('rel');
  });

  it('stepOn: un paso está activo desde su nivel en adelante', () => {
    expect(stepOn(0, 'open')).toBe(false);
    expect(stepOn(1, 'open')).toBe(true);
    expect(stepOn(1, 'drawing')).toBe(false);
    expect(stepOn(TOOLBAR_STEPS.length, 'rel')).toBe(true);
  });
});
