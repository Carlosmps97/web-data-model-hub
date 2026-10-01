// Forma canónica de un número de UDP (doc 105, ronda 6). Los UDP se guardan como
// TEXTO y el Reporting busca `= 10.5` por el literal y su forma canónica: un
// «10.50» tipeado en el panel no aparecía. La misma forma que el backend
// (`app/core/udp_values.canonical_number`) donde las dos coinciden; si no, tal cual.
import { describe, expect, it } from 'vitest';
import { canonicalNumberText } from './udpNumber';

describe('canonicalNumberText', () => {
  it.each([
    ['10.50', '10.5'], ['1e3', '1000'], ['10.0', '10'], ['+007', '7'], ['-0', '0'], [' 12 ', '12'],
    ['12345678901234567890', '12345678901234567890'], ['-3.25', '-3.25'], ['.5', '0.5'], ['1E-2', '0.01'],
  ])('%s → %s', (typed, canonical) => {
    expect(canonicalNumberText(typed)).toBe(canonical);
  });

  it.each([
    ['0.00001'],                  // Python la escribe «1e-05» y JS «0.00001»: se deja tal cual
    ['9007199254740993.5'],       // ≥ 2^53: Python «…4.0», JS sin «.0»
    ['1e21'], ['abc'], [''], ['1_000'], ['0x10'], ['nan'],
  ])('%s queda tal cual', (typed) => {
    expect(canonicalNumberText(typed)).toBe(typed);
  });
});
