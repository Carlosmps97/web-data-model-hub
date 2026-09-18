import { describe, expect, it } from 'vitest';
import { hasSpecialChars, sanitizeLogicalName } from './logicalName';

describe('sanitizeLogicalName (doc 92 D8)', () => {
  it('conserva letras (con tildes y ñ), dígitos, espacios y guion bajo', () => {
    expect(sanitizeLogicalName('Código Único Cliente 2 _x')).toBe('Código Único Cliente 2 _x');
    expect(sanitizeLogicalName('Año Ñandú')).toBe('Año Ñandú');
  });
  it('quita puntuación y símbolos', () => {
    expect(sanitizeLogicalName('Cuenta (activa)')).toBe('Cuenta activa');
    expect(sanitizeLogicalName('E/3360')).toBe('E3360');
    expect(sanitizeLogicalName('%AttDomain')).toBe('AttDomain');
    expect(sanitizeLogicalName('a-b.c,d|e;f:g"h\'i')).toBe('abcdefghi');
    expect(sanitizeLogicalName('x@y#z$w')).toBe('xyzw');
  });
  it('tolera vacío', () => {
    expect(sanitizeLogicalName('')).toBe('');
  });
  it('hasSpecialChars detecta sin dejar estado en la regex global', () => {
    expect(hasSpecialChars('Cuenta (activa)')).toBe(true);
    expect(hasSpecialChars('Cuenta activa')).toBe(false);
    expect(hasSpecialChars('Cuenta (activa)')).toBe(true);
  });
});
