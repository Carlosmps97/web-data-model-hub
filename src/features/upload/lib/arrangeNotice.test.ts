// Doc 105 (ronda 4) — los canvases donde la carga no pudo ubicar lo nuevo se
// avisan con un toast cuando el popup ya no los muestra: se cerró (cambiar
// Logical/Physical, salir por el TopNav) o se abrió otra versión a mitad.
// Doc 113 §1.3: ya no se sugiere Autoarrange (reordenaría todo el canvas): lo
// nuevo quedó en la posición provisional, debajo de lo existente.
import { describe, expect, it } from 'vitest';
import { notPlacedNotice } from './arrangeNotice';

const names = new Map([['a', 'Clientes'], ['b', 'Cuentas'], ['c', 'Tarjetas'], ['d', 'Pagos']]);
const nameOf = (id: string) => names.get(id);

describe('aviso de los canvases donde no se ubicó lo nuevo (doc 105 → doc 113)', () => {
  it('con el popup cerrado (misma versión): cuántos y cuáles', () => {
    expect(notPlacedNotice(['a'], nameOf)).toBe("Couldn't place the new objects on 1 canvas: “Clientes” — they were left below the existing blocks.");
    expect(notPlacedNotice(['a', 'b'], nameOf)).toBe("Couldn't place the new objects on 2 canvases: “Clientes”, “Cuentas” — they were left below the existing blocks.");
  });

  it('más de 3, o alguno sin nombre conocido: sólo cuántos', () => {
    expect(notPlacedNotice(['a', 'b', 'c', 'd'], nameOf)).toBe("Couldn't place the new objects on 4 canvases — they were left below the existing blocks.");
    expect(notPlacedNotice(['a', 'zz'], nameOf)).toBe("Couldn't place the new objects on 2 canvases — they were left below the existing blocks.");
  });

  it('si se abrió otra versión: dice que la carga quedó en la suya', () => {
    expect(notPlacedNotice(['a'], nameOf, { version: 'Draft 3' }))
      .toBe("The upload to “Draft 3” was applied, but the new objects couldn't be placed on 1 canvas: “Clientes” — they were left below the existing blocks.");
    expect(notPlacedNotice(['a', 'zz'], nameOf, { version: null }))
      .toBe("The upload was applied to its version, but the new objects couldn't be placed on 2 canvases — they were left below the existing blocks.");
  });
});
