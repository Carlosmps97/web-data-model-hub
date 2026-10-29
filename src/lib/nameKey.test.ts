// Clave de un nombre para comparar sin mayúsculas, tildes ni espacios de más
// (la misma regla que `norm_name` de la carga Excel).
import { describe, expect, it } from 'vitest';
import { nameKey } from './nameKey';

describe('nameKey', () => {
  it('quita tildes, bordes y mayúsculas, y colapsa los espacios de adentro', () => {
    expect(nameKey('  Ámbito   de Riesgo ')).toBe('ambito de riesgo');
    expect(nameKey('ÑANDÚ')).toBe('nandu');
  });
  it('dos grafías del mismo nombre dan la misma clave', () => {
    expect(nameKey('Clientes')).toBe(nameKey(' clientes '));
    expect(nameKey('Clientes')).not.toBe(nameKey('Cliente'));
  });
});
