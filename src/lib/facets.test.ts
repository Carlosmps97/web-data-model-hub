import { describe, expect, it } from 'vitest';
import { countFacetUdpValues, facetNoun, facetNouns, facetUdpDefs, MODEL_MODE_CAPTION, normalizeUdpView, PHYSICAL_ONLY_TOOL_TIP, toolAvailableIn, UDP_CLASS_SEGMENTS, udpDisplayName, facetName, distinctNames } from './facets';

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
  it('toolAvailableIn (doc 86 → doc 113): Views, CTAS, Schemas y Upload from Excel solo en físico; New table en ambos', () => {
    expect(['view', 'ctas', 'schema', 'upload'].every((t) => !toolAvailableIn(t as 'view', 'logical') && toolAvailableIn(t as 'view', 'physical'))).toBe(true);
    expect(toolAvailableIn('new-table', 'logical') && toolAvailableIn('new-table', 'physical')).toBe(true);
    expect(PHYSICAL_ONLY_TOOL_TIP.view).toMatch(/physical model/);
    // Doc 113 §1.2: la carga crea vistas (físicas) — en Logical, deshabilitada con el motivo.
    expect(PHYSICAL_ONLY_TOOL_TIP.upload).toBe('Upload from Excel belongs to the physical model — switch to Physical');
    expect(MODEL_MODE_CAPTION.logical).toMatch(/^Logical model/);
    expect(MODEL_MODE_CAPTION.physical).toMatch(/^Physical model/);
  });
  it('facetNouns (doc 85): Entity/Attribute en lógico, Table/Column en físico', () => {
    expect(facetNouns('logical')).toEqual({ one: 'entity', many: 'entities', One: 'Entity', Many: 'Entities', a: 'an entity', member: 'attribute', members: 'attributes', Member: 'Attribute', Members: 'Attributes', aMember: 'an attribute' });
    expect(facetNouns('physical')).toEqual({ one: 'table', many: 'tables', One: 'Table', Many: 'Tables', a: 'a table', member: 'column', members: 'columns', Member: 'Column', Members: 'Columns', aMember: 'a column' });
  });
});

// Doc 114 (piloto): el popup de relación (alta, edición y Sync) mostraba SIEMPRE
// los nombres físicos; en el modelo lógico van los lógicos (entidad/atributo).
describe('facetName (doc 114)', () => {
  it('el nombre del modelo activo, con el otro de respaldo si falta', () => {
    const c = { logicalName: 'Codigo Cliente', physicalName: 'COD_CLI' };
    expect(facetName(c, 'logical')).toBe('Codigo Cliente');
    expect(facetName(c, 'physical')).toBe('COD_CLI');
    expect(facetName({ logicalName: '', physicalName: 'COD_CLI' }, 'logical')).toBe('COD_CLI');
    expect(facetName({ logicalName: 'Codigo', physicalName: '' }, 'physical')).toBe('Codigo');
    expect(facetName(undefined, 'logical')).toBe('');
  });
});

// Revisión doc 114 (H1): en el lógico dos atributos de una misma tabla pueden
// llamarse igual (el físico es el único) — el selector del popup de relación los
// mostraba idénticos y la FK podía ir a la columna equivocada sin notarse.
describe('distinctNames (revisión doc 114)', () => {
  const cols = [
    { id: 'a', logicalName: 'Codigo Cliente', physicalName: 'COD_CLI' },
    { id: 'b', logicalName: 'codigo cliente ', physicalName: 'COD_CLIENTE_ANT' },
    { id: 'c', logicalName: 'Nombre', physicalName: 'NOMBRE' },
    { id: 'd', logicalName: '', physicalName: 'FECHA' },
  ];
  it('lógico: los repetidos (sin mirar mayúsculas ni bordes) llevan el físico entre paréntesis; el resto, tal cual', () => {
    const m = distinctNames(cols, 'logical');
    expect(m.get('a')).toBe('Codigo Cliente (COD_CLI)');
    expect(m.get('b')).toBe('codigo cliente (COD_CLIENTE_ANT)');
    expect(m.get('c')).toBe('Nombre');
    expect(m.get('d')).toBe('FECHA');
  });
  it('físico: los físicos son únicos por tabla — tal cual', () => {
    expect([...distinctNames(cols, 'physical').values()]).toEqual(['COD_CLI', 'COD_CLIENTE_ANT', 'NOMBRE', 'FECHA']);
  });
  // Ronda 2: la lista del combo colapsa los espacios y dibuja igual una tilde
  // compuesta que una combinante — también ésos son repetidos.
  it('también los que sólo difieren en espacios internos o en la forma Unicode (NFC / NFD)', () => {
    const nfd = 'Código'.normalize('NFD'), nfc = 'Código'.normalize('NFC');
    const m = distinctNames([
      { id: 'a', logicalName: 'Codigo  Cliente', physicalName: 'COD_CLI' },
      { id: 'b', logicalName: 'Codigo Cliente', physicalName: 'COD_CLI2' },
      { id: 'c', logicalName: nfd, physicalName: 'COD' },
      { id: 'd', logicalName: nfc, physicalName: 'COD2' },
    ], 'logical');
    expect(m.get('a')).toBe('Codigo  Cliente (COD_CLI)');
    expect(m.get('b')).toBe('Codigo Cliente (COD_CLI2)');
    expect(m.get('c')).toBe(`${nfd} (COD)`);
    expect(m.get('d')).toBe(`${nfc} (COD2)`);
  });
});
