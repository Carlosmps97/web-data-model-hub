import { describe, expect, it } from 'vitest';
import { applyNamingCase } from './physicalCase';

// Espejo de `app/core/naming/engine.apply_case`: la regla de case del scope se
// aplica al físico tipeado (popup en modo Physical, panel Properties), no solo
// al derivado del lógico.
describe('applyNamingCase', () => {
  it('upper: lo tipeado en minúscula sale en mayúscula (regla del scope column)', () => {
    expect(applyNamingCase('monto_deuda', 'upper')).toBe('MONTO_DEUDA');
  });

  it('lower', () => {
    expect(applyNamingCase('MTO_DEU', 'lower')).toBe('mto_deu');
  });

  it('es idempotente', () => {
    expect(applyNamingCase('MTO_DEU', 'upper')).toBe('MTO_DEU');
    expect(applyNamingCase('mtoDeuUsd', 'camel')).toBe('mtoDeuUsd');
  });

  it('camel re-segmenta por separadores (mismo armado que el motor)', () => {
    expect(applyNamingCase('MTO_DEU_USD', 'camel')).toBe('mtoDeuUsd');
    expect(applyNamingCase('mto-deu usd', 'camel')).toBe('mtoDeuUsd');
  });

  it('camel sin separadores respeta lo tipeado (no hay cómo re-segmentar)', () => {
    expect(applyNamingCase('mtoDeu', 'camel')).toBe('mtoDeu');
  });

  it('vacío pasa', () => {
    expect(applyNamingCase('', 'upper')).toBe('');
  });

  it('regla ausente o desconocida ⇒ upper (= default sembrado por el backend)', () => {
    expect(applyNamingCase('abc', null)).toBe('ABC');
    expect(applyNamingCase('abc', undefined)).toBe('ABC');
    expect(applyNamingCase('abc', 'title')).toBe('ABC');
  });
});
