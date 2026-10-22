// Buscador de columnas de Properties · Columns: mismo paradigma que los
// combobox de dominio y tipos ("contiene", sin distinción de mayúsculas),
// buscando por nombre lógico o físico. Con el filtro activo el drag&drop se
// desactiva (reordenar una lista parcial corrompería el orden físico).
import { describe, it, expect } from 'vitest';
import { matchesColumn } from './columnSearch';

const col = (logical: string, physical: string) => ({ logicalName: logical, physicalName: physical });

describe('matchesColumn', () => {
  it('matchea por substring del nombre lógico o del físico (case-insensitive)', () => {
    const c = col('monto deuda dólares', 'MTO_DEU_USD');
    expect(matchesColumn(c, 'monto')).toBe(true);
    expect(matchesColumn(c, 'MON')).toBe(true);
    expect(matchesColumn(c, 'mto_')).toBe(true);
    expect(matchesColumn(c, 'MTO_DEU')).toBe(true);
    expect(matchesColumn(c, 'deuda')).toBe(true);
    expect(matchesColumn(c, 'USD')).toBe(true);
    expect(matchesColumn(c, 'deu_usd')).toBe(true);
  });

  it('no matchea lo que no aparece en ninguno de los dos nombres', () => {
    const c = col('monto deuda dólares', 'MTO_DEU_USD');
    expect(matchesColumn(c, 'saldo')).toBe(false);
    expect(matchesColumn(c, 'FEC')).toBe(false);
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
