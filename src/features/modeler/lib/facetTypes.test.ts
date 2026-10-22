import { describe, expect, it } from 'vitest';
import { isCompleteSimpleType, mirrorComplex, syncedOtherFacet, typeFacetPatch } from './facetTypes';

describe('isCompleteSimpleType', () => {
  it('simples del catálogo y alias sí; estados intermedios y complejos no', () => {
    expect(isCompleteSimpleType('STRING')).toBe(true);
    expect(isCompleteSimpleType('varchar(20)')).toBe(true);
    expect(isCompleteSimpleType('INT')).toBe(true);
    expect(isCompleteSimpleType('S')).toBe(false);
    expect(isCompleteSimpleType('ARRAY')).toBe(false);
    expect(isCompleteSimpleType('VARCHAR(')).toBe(false);
    expect(isCompleteSimpleType('ARRAY<STRING>')).toBe(false);
  });
});

describe('tipos complejos por faceta', () => {
  const full = 'ARRAY<STRUCT<a:VARCHAR(30)>>';
  it('mirrorComplex: el complejo con estructura manda (espejo del kit)', () => {
    expect(mirrorComplex(full, 'ARRAY<>')).toBe(full);
    expect(mirrorComplex(full, '')).toBe(full);
    expect(mirrorComplex(full, 'VARCHAR(256)')).toBe(full);
    expect(mirrorComplex(full, 'ARRAY<STRING>')).toBe('ARRAY<STRING>');
    expect(mirrorComplex('VARCHAR(20)', 'CHAR(18)')).toBe('CHAR(18)');
  });
  it('syncedOtherFacet: poner un complejo iguala la otra faceta', () => {
    expect(syncedOtherFacet(full, 'STRING', 'VARCHAR(20)')).toBe(full);
    expect(syncedOtherFacet('ARRAY<>', 'STRING', 'STRING')).toBe('ARRAY<>');
  });
  it('syncedOtherFacet: salir de un complejo compartido arrastra a la otra; los simples no se tocan', () => {
    expect(syncedOtherFacet('STRING', full, full)).toBe('STRING');
    expect(syncedOtherFacet('BIGINT', 'INT', 'NUMBER')).toBe('NUMBER');
    expect(syncedOtherFacet('STRING', full, 'CHAR(18)')).toBe('CHAR(18)');
  });
});

describe('syncedOtherFacet — secuencias de tecleo en Code', () => {
  const full = 'ARRAY<STRING>';
  // Aplica las ediciones de una faceta tecla a tecla, como el panel.
  const edit = (start: { phys: string; logi: string }, values: string[], facet: 'phys' | 'logi') => {
    let { phys, logi } = start;
    for (const v of values) {
      if (facet === 'phys') { logi = syncedOtherFacet(v, phys, logi); phys = v; } else { phys = syncedOtherFacet(v, logi, phys); logi = v; }
    }
    return { phys, logi };
  };
  it('Backspace hasta el complejo pelado y luego STRING: las dos quedan STRING', () => {
    expect(edit({ phys: full, logi: full }, ['ARRAY<STRIN', 'ARRAY<', 'ARRAY', 'STRING'], 'phys'))
      .toEqual({ phys: 'STRING', logi: 'STRING' });
  });
  it('seleccionar todo, tipear y luego elegir STRING: las dos quedan STRING', () => {
    expect(edit({ phys: full, logi: full }, ['S', 'STRING'], 'logi')).toEqual({ phys: 'STRING', logi: 'STRING' });
  });
  it('simples iguales siguen independientes tecla a tecla (y con alias como INT)', () => {
    expect(edit({ phys: 'VARCHAR(20)', logi: 'VARCHAR(20)' }, ['VARCHAR(2', 'VARCHAR(', 'VARCHAR(3', 'VARCHAR(30)'], 'phys'))
      .toEqual({ phys: 'VARCHAR(30)', logi: 'VARCHAR(20)' });
    expect(edit({ phys: 'INT', logi: 'INT' }, ['BIGINT'], 'phys')).toEqual({ phys: 'BIGINT', logi: 'INT' });
  });
});

describe('typeFacetPatch (el flag se recalcula solo en la faceta que cambia)', () => {
  const dom = { defaultDataType: 'INTEGER', logicalDataType: 'NUMBER' };
  const stored = { dataType: 'INT', logicalDataType: 'NUMBER', typeOverridden: false, logicalTypeOverridden: false };
  it('editar solo el lógico conserva typeOverridden aunque el físico crudo difiera del dominio', () => {
    expect(typeFacetPatch('INT', 'DECIMAL(10,2)', stored, dom)).toEqual({
      dataType: 'INT', typeOverridden: false, logicalDataType: 'DECIMAL(10,2)', logicalTypeOverridden: true,
    });
  });
  it('editar el físico recalcula su flag y conserva el del lógico', () => {
    expect(typeFacetPatch('BIGINT', 'NUMBER', { ...stored, logicalTypeOverridden: true }, dom)).toEqual({
      dataType: 'BIGINT', typeOverridden: true, logicalDataType: 'NUMBER', logicalTypeOverridden: true,
    });
  });
  it('un complejo en las dos facetas recalcula ambos; sin dominio no hay override', () => {
    expect(typeFacetPatch('ARRAY<STRING>', 'ARRAY<STRING>', stored, dom))
      .toMatchObject({ typeOverridden: true, logicalTypeOverridden: true });
    expect(typeFacetPatch('BIGINT', '', stored, undefined))
      .toEqual({ dataType: 'BIGINT', typeOverridden: false, logicalDataType: undefined, logicalTypeOverridden: false });
  });
});
