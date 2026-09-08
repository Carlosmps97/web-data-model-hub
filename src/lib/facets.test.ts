import { describe, expect, it } from 'vitest';
import { countFacetUdpValues, facetNoun, facetUdpDefs, normalizeUdpView, UDP_CLASS_SEGMENTS, udpDisplayName } from './facets';

const DEFS = [
  { id: 'p', name: 'Clasificacion del Dato', level: 'column' as const },
  { id: 'l', name: 'Clasificacion del Dato', level: 'column' as const, view: 'logical' as const },
  { id: 'v', name: 'Tipo de Vista', level: 'view' as const, view: 'logical' as const },
];

describe('facets (doc 69)', () => {
  it('normalizeUdpView: view/canvas siempre physical; ausente = physical', () => {
    expect(normalizeUdpView('view', 'logical')).toBe('physical');
    expect(normalizeUdpView('canvas', undefined)).toBe('physical');
    expect(normalizeUdpView('table', 'logical')).toBe('logical');
    expect(normalizeUdpView('column', null)).toBe('physical');
  });
  it('facetUdpDefs filtra por nivel y faceta', () => {
    expect(facetUdpDefs(DEFS, 'column', 'logical').map((d) => d.id)).toEqual(['l']);
    expect(facetUdpDefs(DEFS, 'column', 'physical').map((d) => d.id)).toEqual(['p']);
    expect(facetUdpDefs(DEFS, 'view', 'physical').map((d) => d.id)).toEqual(['v']);
  });
  it('countFacetUdpValues cuenta solo valores no vacíos de la faceta', () => {
    expect(countFacetUdpValues({ p: 'DAC', l: 'No DAC', x: 'zz' }, DEFS, 'column', 'physical')).toBe(1);
    expect(countFacetUdpValues({ p: '', l: 'No DAC' }, DEFS, 'column', 'logical')).toBe(1);
    expect(countFacetUdpValues(undefined, DEFS, 'column', 'logical')).toBe(0);
  });
  it('udpDisplayName marca la lógica', () => {
    expect(udpDisplayName(DEFS[0])).toBe('Clasificacion del Dato');
    expect(udpDisplayName(DEFS[1])).toBe('Clasificacion del Dato (Logical)');
  });
  it('facetNoun y segmentos de Data Standards', () => {
    expect([facetNoun('table', 'logical'), facetNoun('table', 'physical'), facetNoun('column', 'logical'), facetNoun('column', 'physical')])
      .toEqual(['entity', 'table', 'attribute', 'column']);
    expect(UDP_CLASS_SEGMENTS.map((s) => s.label)).toEqual(['Entity (Logical)', 'Table (Physical)', 'Attribute (Logical)', 'Column (Physical)', 'View', 'Model']);
    expect(UDP_CLASS_SEGMENTS.filter((s) => s.level === 'view' || s.level === 'canvas').every((s) => s.view === 'physical')).toBe(true);
  });
});
