// Vista previa de la ficha del canvas: mientras está abierta, sus colores
// pendientes (sin grabar) se ven en las cajas; Save los graba, Cancel
// los descarta. `boxHex` los aplica encima de los colores grabados del canvas.
import { describe, expect, it } from 'vitest';
import { boxHex } from './boxColor';

const themes = new Map([['pri', { id: 'pri', name: 'Entidad Principal', color: '#FFFF80' }]]);
const canvas = { t1: 'theme:pri', t2: 'none' };

describe('boxHex con la vista previa de la ficha', () => {
  it('sin vista previa: excepción del canvas → color de la tabla → sin color', () => {
    expect(boxHex('t1', '#92D050', canvas, themes)).toBe('#FFFF80');
    expect(boxHex('t2', '#92D050', canvas, themes)).toBeNull();
    expect(boxHex('t3', '#92D050', canvas, themes)).toBe('#92D050');
  });

  it('pintada en la vista previa: se ve ese color', () => {
    expect(boxHex('t3', '#92D050', canvas, themes, { t3: '#FF0000' })).toBe('#FF0000');
    expect(boxHex('t1', null, canvas, themes, { t1: 'none' })).toBeNull();
  });

  it('«Reset» en la vista previa (null): vuelve al color de su tabla aunque el canvas la pinte', () => {
    expect(boxHex('t1', '#92D050', canvas, themes, { t1: null })).toBe('#92D050');
    expect(boxHex('t1', null, canvas, themes, { t1: null })).toBeNull();
  });

  it('una caja que no está en la vista previa se ve con sus colores grabados', () => {
    expect(boxHex('t1', '#92D050', canvas, themes, { t3: '#FF0000' })).toBe('#FFFF80');
  });
});
