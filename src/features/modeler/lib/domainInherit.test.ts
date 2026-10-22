import { describe, expect, it } from 'vitest';
import type { UdpDefinition } from '@/features/standards/standards.service';
import { domainUdpOffer, mergeInheritedUdps } from './domainInherit';

const DEFS = [
  { id: 'u-ac', name: 'Atributo Cross', level: 'column', view: 'logical', dataType: 'list', allowedValues: ['No Definido', 'Si', 'No'] },
  { id: 'u-cc', name: 'Campo Cross', level: 'column', view: 'physical', dataType: 'list', allowedValues: ['No Definido', 'Si', 'No'] },
  { id: 'u-cd', name: 'Clasificacion del Dato', level: 'column', dataType: 'list', allowedValues: [] },
  { id: 'u-t', name: 'Tipo de Carga', level: 'table', dataType: 'list', allowedValues: [] },
] as UdpDefinition[];

describe('domainInherit', () => {
  it('agrupa por faceta, ordena por nombre e ignora vacíos, defs de tabla e ids huérfanos', () => {
    const offer = domainUdpOffer({ udpValues: { 'u-cc': 'No', 'u-ac': 'No', 'u-cd': '  ', 'u-t': 'Full', gone: 'x' } }, DEFS);
    expect(offer.logical.map((i) => [i.def.id, i.value, i.facet])).toEqual([['u-ac', 'No', 'logical']]);
    expect(offer.physical.map((i) => [i.def.id, i.value, i.facet])).toEqual([['u-cc', 'No', 'physical']]);
    expect(offer.total).toBe(2);
  });
  it('sin dominio o sin valores: oferta vacía', () => {
    expect(domainUdpOffer(undefined, DEFS).total).toBe(0);
    expect(domainUdpOffer({ udpValues: null }, DEFS).total).toBe(0);
    expect(domainUdpOffer({ udpValues: { 'u-ac': 'No' } }, []).total).toBe(0);
  });
  it('mergeInheritedUdps copia los elegidos, pisa la clave existente y no toca lo demás', () => {
    const offer = domainUdpOffer({ udpValues: { 'u-ac': 'No', 'u-cc': 'Si' } }, DEFS);
    expect(mergeInheritedUdps({ 'u-cc': 'No', 'u-cd': 'DAC' }, [...offer.logical, ...offer.physical]))
      .toEqual({ 'u-cc': 'Si', 'u-cd': 'DAC', 'u-ac': 'No' });
    expect(mergeInheritedUdps(undefined, offer.logical)).toEqual({ 'u-ac': 'No' });
    const cur = { 'u-cd': 'DAC' };
    expect(mergeInheritedUdps(cur, [])).toBe(cur);   // sin elegidos: misma referencia
  });
});
