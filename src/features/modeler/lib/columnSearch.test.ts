// Buscador de columnas de Properties · Columns (doc 42): mismo paradigma que
// los combobox del doc 41 — "empieza por", sin distinción de mayúsculas —
// matcheando por nombre LÓGICO o FÍSICO. Con el filtro activo el drag&drop se
// desactiva (reordenar una lista parcial corrompería el orden físico).
import { describe, it, expect } from 'vitest';
import { matchesColumn } from './columnSearch';

const col = (logical: string, physical: string) => ({ logicalName: logical, physicalName: physical });

describe('matchesColumn', () => {
  it('matchea por el inicio del nombre lógico O del físico (case-insensitive)', () => {
    const c = col('monto deuda dólares', 'MTO_DEU_USD');
    expect(matchesColumn(c, 'monto')).toBe(true);
    expect(matchesColumn(c, 'MON')).toBe(true);
    expect(matchesColumn(c, 'mto_')).toBe(true);
    expect(matchesColumn(c, 'MTO_DEU')).toBe(true);
  });

  it('NO matchea por "contiene" (paradigma empieza-por del doc 41)', () => {
    const c = col('monto deuda dólares', 'MTO_DEU_USD');
    expect(matchesColumn(c, 'deuda')).toBe(false);
    expect(matchesColumn(c, 'USD')).toBe(false);
  });

  it('query vacía o de espacios matchea todo (lista completa)', () => {
    const c = col('cualquiera', 'CUALQUIERA');
    expect(matchesColumn(c, '')).toBe(true);
    expect(matchesColumn(c, '   ')).toBe(true);
  });

  it('tolera nombres ausentes sin explotar', () => {
    expect(matchesColumn({ logicalName: '', physicalName: 'FIS' }, 'fi')).toBe(true);
    expect(matchesColumn({ logicalName: 'lóg', physicalName: '' }, 'ló')).toBe(true);
    expect(matchesColumn({ logicalName: '', physicalName: '' }, 'x')).toBe(false);
  });
});
