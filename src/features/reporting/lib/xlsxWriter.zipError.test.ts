// Un error de la compresión (fflate) corta el libro en ese momento y con su
// mensaje: no sigue leyendo filas ni descarga nada.
import { describe, expect, it, vi } from 'vitest';

vi.mock('fflate', async (orig) => {
  const actual = await orig<typeof import('fflate')>();
  class FailingZip extends actual.Zip {
    constructor(cb: ConstructorParameters<typeof actual.Zip>[0]) {
      // Falla el primer bloque grande de datos comprimidos: a mitad de la hoja.
      let failed = 0;
      super((err, data, final) => {
        if (failed < 2 && data && data.length > 20_000) {
          failed += 1;
          cb!(new Error(failed === 1 ? 'deflate failed' : 'second failure') as never, data, final);
        } else cb!(err, data, final);
      });
    }
  }
  return { ...actual, Zip: FailingZip };
});
import { buildXlsx } from './xlsxWriter';

describe('error de la compresión', () => {
  it('rechaza con el PRIMER error, sin escribir el resto de las filas', async () => {
    let reads = 0;
    const n = 200_000;
    await expect(buildXlsx([{ name: 'Columns', count: n, rowAt: (i) => { reads += 1; return { Column: `C${i}`, Text: 'x'.repeat(40) }; } }]))
      .rejects.toThrow('deflate failed');
    expect(reads).toBeGreaterThan(n);        // la pasada de planeo leyó todo y la escritura empezó…
    expect(reads).toBeLessThan(2 * n);       // …pero se cortó antes del final
  });
});
