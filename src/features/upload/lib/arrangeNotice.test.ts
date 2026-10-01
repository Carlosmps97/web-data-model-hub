// Doc 105 (ronda 4) — los canvases que la carga no pudo arreglar se avisan con
// un toast cuando el popup ya no los muestra: se cerró (cambiar Logical/
// Physical, salir por el TopNav) o se abrió otra versión a mitad del arrange.
import { describe, expect, it } from 'vitest';
import { notArrangedNotice } from './arrangeNotice';

const names = new Map([['a', 'Clientes'], ['b', 'Cuentas'], ['c', 'Tarjetas'], ['d', 'Pagos']]);
const nameOf = (id: string) => names.get(id);

describe('aviso de los canvases que la carga no arregló (doc 105, ronda 4)', () => {
  it('con el popup cerrado (misma versión): cuántos y cuáles', () => {
    expect(notArrangedNotice(['a'], nameOf)).toBe("Couldn't auto-arrange 1 canvas: “Clientes” — open it and use Autoarrange.");
    expect(notArrangedNotice(['a', 'b'], nameOf)).toBe("Couldn't auto-arrange 2 canvases: “Clientes”, “Cuentas” — open them and use Autoarrange.");
  });

  it('más de 3, o alguno sin nombre conocido: sólo cuántos', () => {
    expect(notArrangedNotice(['a', 'b', 'c', 'd'], nameOf)).toBe("Couldn't auto-arrange 4 canvases — open them and use Autoarrange.");
    expect(notArrangedNotice(['a', 'zz'], nameOf)).toBe("Couldn't auto-arrange 2 canvases — open them and use Autoarrange.");
  });

  it('si se abrió otra versión: dice que la carga quedó en la suya', () => {
    expect(notArrangedNotice(['a'], nameOf, { version: 'Draft 3' }))
      .toBe("The upload to “Draft 3” was applied, but 1 canvas wasn't auto-arranged: “Clientes” — open it in that version and use Autoarrange.");
    expect(notArrangedNotice(['a', 'zz'], nameOf, { version: null }))
      .toBe("The upload was applied to its version, but 2 canvases weren't auto-arranged — open them in that version and use Autoarrange.");
  });
});
