import { describe, expect, it } from 'vitest';
import { applyDomainDefaults, suggestedName } from './domainDefaults';

// Dominios "atributo estándar" (Erwin: tienen Attribute_Definition ⇒ heredan
// nombre + definición al atributo). Marca en el doc: inheritsName === true.
const FEC = { id: 'd-fec', name: 'FecRutina', description: 'Fecha de la rutina.', inheritsName: true };
const COD = { id: 'd-cod', name: 'Codigo', namingTerm: 'CodigoGenerico', description: 'Codigo de referencia.', inheritsName: true };
const CODMES = { id: 'd-codmes', name: 'CodMes', description: 'Codigo del mes.', inheritsName: true };
// Dominios GENÉRICOS de tipo (Codigo, Fecha, Number…): NO tienen la marca ⇒
// jamás pisan el nombre ni la definición propios de la columna.
const GEN = { id: 'd-gen', name: 'Codigo', description: 'Se asigna a atributos que contienen codificacion.' };

describe('applyDomainDefaults · dominio → nombre + definición SOLO si es atributo estándar (doc 79)', () => {
  it('dominio estándar, primer dominio: rellena nombre y definición', () => {
    expect(applyDomainDefaults({ prevDomain: undefined, nextDomain: FEC, current: { logicalName: '', description: '' } }))
      .toEqual({ logicalName: 'FecRutina', description: 'Fecha de la rutina.' });
  });
  it('namingTerm manda sobre el nombre del dominio', () => {
    expect(suggestedName(COD)).toBe('CodigoGenerico');
    expect(applyDomainDefaults({ prevDomain: undefined, nextDomain: COD, current: { logicalName: '', description: '' } }))
      .toEqual({ logicalName: 'CodigoGenerico', description: 'Codigo de referencia.' });
  });
  it('cambiar entre dominios ESTÁNDAR RE-APLICA aunque la columna tuviera lo suyo (CodMes → FecRutina)', () => {
    expect(applyDomainDefaults({ prevDomain: CODMES, nextDomain: FEC, current: { logicalName: 'Codigo Mes Proceso', description: 'Mes del proceso.' } }))
      .toEqual({ logicalName: 'FecRutina', description: 'Fecha de la rutina.' });
  });

  // — El fix del bug reportado —
  it('dominio GENÉRICO (sin la marca): NO toca el nombre ni la definición propios', () => {
    expect(applyDomainDefaults({ prevDomain: undefined, nextDomain: GEN, current: { logicalName: 'Codigo Moneda', description: 'Codigo de la Moneda' } }))
      .toEqual({});
  });
  it('dominio GENÉRICO sobre una columna vacía tampoco autocompleta con el nombre del dominio', () => {
    expect(applyDomainDefaults({ prevDomain: undefined, nextDomain: GEN, current: { logicalName: '', description: '' } }))
      .toEqual({});
  });
  it('cambiar de un dominio estándar a uno GENÉRICO conserva nombre y definición propios', () => {
    expect(applyDomainDefaults({ prevDomain: FEC, nextDomain: GEN, current: { logicalName: 'Fecha Desembolso', description: 'Fecha de desembolso.' } }))
      .toEqual({});
  });

  it('re-elegir el MISMO dominio respeta lo manual', () => {
    expect(applyDomainDefaults({ prevDomain: FEC, nextDomain: FEC, current: { logicalName: 'mi fecha', description: 'mi texto' } }))
      .toEqual({});
    // mismo dominio identificado por nombre cuando no hay ids
    expect(applyDomainDefaults({ prevDomain: { name: 'FecRutina', inheritsName: true }, nextDomain: { name: 'fecrutina', inheritsName: true }, current: { logicalName: 'x', description: 'y' } }))
      .toEqual({});
  });
  it('quitar el dominio conserva todo', () => {
    expect(applyDomainDefaults({ prevDomain: FEC, nextDomain: undefined, current: { logicalName: 'FecRutina', description: 'x' } }))
      .toEqual({});
  });
  it('dominio estándar sin definición no toca la definición', () => {
    expect(applyDomainDefaults({ prevDomain: CODMES, nextDomain: { id: 'd-big', name: 'BigIntStd', inheritsName: true }, current: { logicalName: 'Codigo Mes', description: 'Mes.' } }))
      .toEqual({ logicalName: 'BigIntStd' });
  });
  it('no emite cambios redundantes cuando ya coincide', () => {
    expect(applyDomainDefaults({ prevDomain: CODMES, nextDomain: FEC, current: { logicalName: 'FecRutina', description: 'Fecha de la rutina.' } }))
      .toEqual({});
  });
});
