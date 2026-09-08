import { describe, expect, it } from 'vitest';
import { applyDomainDefaults, suggestedName } from './domainDefaults';

const FEC = { id: 'd-fec', name: 'FecRutina', description: 'Fecha de la rutina.' };
const COD = { id: 'd-cod', name: 'Codigo', namingTerm: 'CodigoGenerico', description: 'Codigo de referencia.' };
const CODMES = { id: 'd-codmes', name: 'CodMes', description: 'Codigo del mes.' };

describe('applyDomainDefaults · dominio → nombre + definición (doc 69 §4.7, ajuste owner)', () => {
  it('primer dominio: rellena nombre y definición', () => {
    expect(applyDomainDefaults({ prevDomain: undefined, nextDomain: FEC, current: { logicalName: '', description: '' } }))
      .toEqual({ logicalName: 'FecRutina', description: 'Fecha de la rutina.' });
  });
  it('namingTerm manda sobre el nombre del dominio', () => {
    expect(suggestedName(COD)).toBe('CodigoGenerico');
    expect(applyDomainDefaults({ prevDomain: undefined, nextDomain: COD, current: { logicalName: '', description: '' } }))
      .toEqual({ logicalName: 'CodigoGenerico', description: 'Codigo de referencia.' });
  });
  it('cambiar de dominio RE-APLICA aunque la columna tuviera nombre y definición propios (caso owner CodMes → FecRutina)', () => {
    expect(applyDomainDefaults({ prevDomain: CODMES, nextDomain: FEC, current: { logicalName: 'Codigo Mes Proceso', description: 'Mes del proceso.' } }))
      .toEqual({ logicalName: 'FecRutina', description: 'Fecha de la rutina.' });
  });
  it('re-elegir el MISMO dominio respeta lo manual', () => {
    expect(applyDomainDefaults({ prevDomain: FEC, nextDomain: FEC, current: { logicalName: 'mi fecha', description: 'mi texto' } }))
      .toEqual({});
    // mismo dominio identificado por nombre cuando no hay ids
    expect(applyDomainDefaults({ prevDomain: { name: 'FecRutina' }, nextDomain: { name: 'fecrutina' }, current: { logicalName: 'x', description: 'y' } }))
      .toEqual({});
  });
  it('quitar el dominio conserva todo', () => {
    expect(applyDomainDefaults({ prevDomain: FEC, nextDomain: undefined, current: { logicalName: 'FecRutina', description: 'x' } }))
      .toEqual({});
  });
  it('dominio sin definición no toca la definición', () => {
    expect(applyDomainDefaults({ prevDomain: CODMES, nextDomain: { id: 'd-big', name: 'BigInt' }, current: { logicalName: 'Codigo Mes', description: 'Mes.' } }))
      .toEqual({ logicalName: 'BigInt' });
  });
  it('no emite cambios redundantes cuando ya coincide', () => {
    expect(applyDomainDefaults({ prevDomain: CODMES, nextDomain: FEC, current: { logicalName: 'FecRutina', description: 'Fecha de la rutina.' } }))
      .toEqual({});
  });
});
