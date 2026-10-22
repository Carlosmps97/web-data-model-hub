import { describe, expect, it } from 'vitest';
import { columnCreateInput, tableCreateInput } from './createInputs';

const FORM = {
  name: 'monto deuda', parentDomainId: '', typeText: '', description: 'Deuda.', physicalDescription: '',
  isPrimaryKey: false, isForeignKey: false, isNullable: true, isPartition: false, udpValues: { u1: 'No' },
};
const DOM = { id: 'd1', name: 'Monto', defaultDataType: 'DECIMAL(21,4)', logicalDataType: 'DECIMAL(22,4)' };

describe('columnCreateInput', () => {
  it('físico: lo tipeado es el físico y el tipo es el físico', () => {
    expect(columnCreateInput('physical', { ...FORM, name: 'MTO_DEU', typeText: 'DECIMAL(18,2)' }, undefined))
      .toMatchObject({ logicalName: 'MTO_DEU', mode: 'physical', dataType: 'DECIMAL(18,2)', description: 'Deuda.', udpValues: { u1: 'No' } });
    expect(columnCreateInput('physical', FORM, undefined).logicalDataType).toBeUndefined();
  });
  it('lógico con dominio: el tipo tipeado es el lógico; el físico lo pone el dominio (dataType ausente)', () => {
    const i = columnCreateInput('logical', { ...FORM, parentDomainId: 'd1', typeText: 'DECIMAL(22,4)' }, DOM);
    expect(i).toMatchObject({ logicalName: 'monto deuda', mode: 'logical', parentDomainId: 'd1', logicalDataType: 'DECIMAL(22,4)' });
    expect(i.dataType).toBeUndefined();
  });
  it('lógico sin dominio: el tipo tipeado vale para ambas facetas', () => {
    const i = columnCreateInput('logical', { ...FORM, typeText: 'STRING' }, undefined);
    expect(i.dataType).toBe('STRING');
    expect(i.logicalDataType).toBe('STRING');
  });
  it('payload limpio: vacíos no viajan', () => {
    const i = columnCreateInput('logical', { ...FORM, description: '  ', udpValues: {} }, undefined);
    expect(i.description).toBeUndefined();
    expect(i.dataType).toBeUndefined();
    expect(i.parentDomainId).toBeUndefined();
  });
});

describe('tableCreateInput', () => {
  it('lógico: nombre lógico, sin schema, físico derivado por el store', () => {
    const i = tableCreateInput('logical', { name: 'cuenta cliente', schema: 'core', description: 'x', udpValues: {} }, 'upper');
    expect(i).toEqual({ logicalName: 'cuenta cliente', mode: 'logical', description: 'x' });
  });
  it('físico: lo tipeado es el físico con la regla de case del scope table; lógico = lo tipeado; schema viaja', () => {
    const i = tableCreateInput('physical', { name: 'hd_cliente', schema: 'core', description: '', udpValues: { t: 'A' } }, 'upper');
    expect(i).toEqual({ logicalName: 'hd_cliente', physicalName: 'HD_CLIENTE', mode: 'physical', schema: 'core', udpValues: { t: 'A' } });
    // regla ausente ⇒ upper (default sembrado por el backend)
    expect(tableCreateInput('physical', { name: 'Hd Cliente', schema: '', description: '', udpValues: {} }, undefined).physicalName).toBe('HD CLIENTE');
  });
});
