import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { buildCandidates, distinctTableSchemas, filterColumns, tableSchemasFromCatalog } from './ctasPick';

const T = (id: string, physicalName: string, logicalName: string, schema?: string): CanonicalTable =>
  ({ id, physicalName, logicalName, schema });

const C = (id: string, tableId: string, physicalName: string, over: Partial<CanonicalColumn> = {}): CanonicalColumn =>
  ({ id, tableId, physicalName, logicalName: physicalName, dataType: 'INTEGER', typeOverridden: false, ordinal: 0, ...over });

describe('distinctTableSchemas', () => {
  it('dedup-ea, descarta vacíos y ordena', () => {
    const pool = [T('a', 'X', 'x', 'STG'), T('b', 'Y', 'y', 'core'), T('c', 'Z', 'z', 'STG'), T('d', 'W', 'w')];
    expect(distinctTableSchemas(pool)).toEqual(['core', 'STG']);
  });
});

describe('buildCandidates · columnas a heredar', () => {
  it('concatena en orden de selección, ordenando por ordinal dentro de cada tabla', () => {
    const cols = new Map<string, CanonicalColumn[]>([
      ['t2', [C('c4', 't2', 'FEC_ALTA')]],
      ['t1', [C('c2', 't1', 'NOM_CLI', { ordinal: 1 }), C('c1', 't1', 'COD_CLI', { ordinal: 0 })]],
    ]);
    expect(buildCandidates(['t1', 't2'], cols).map((c) => c.id)).toEqual(['c1', 'c2', 'c4']);
  });

  it('dedup por physicalName: la primera fuente seleccionada gana', () => {
    const cols = new Map<string, CanonicalColumn[]>([
      ['t1', [C('c1', 't1', 'COD_CLI')]],
      ['t2', [C('c9', 't2', 'COD_CLI'), C('c5', 't2', 'SAL_DIS', { ordinal: 1 })]],
    ]);
    expect(buildCandidates(['t1', 't2'], cols).map((c) => c.id)).toEqual(['c1', 'c5']);
  });

  it('ignora fuentes cuyas columnas aún no cargaron', () => {
    const cols = new Map<string, CanonicalColumn[]>([['t1', [C('c1', 't1', 'COD_CLI')]]]);
    expect(buildCandidates(['t2', 't1'], cols).map((c) => c.id)).toEqual(['c1']);
  });
});

describe('filterColumns · buscador de candidatas', () => {
  const cands = [C('c1', 't1', 'COD_CLI', { logicalName: 'Código Cliente' }), C('c2', 't1', 'FEC_ALTA', { logicalName: 'Fecha Alta' })];

  it('query vacía devuelve todas', () => {
    expect(filterColumns(cands, '  ')).toEqual(cands);
  });

  it('contiene CI sobre lógico o físico', () => {
    expect(filterColumns(cands, 'fec').map((c) => c.id)).toEqual(['c2']);
    expect(filterColumns(cands, 'código').map((c) => c.id)).toEqual(['c1']);
    expect(filterColumns(cands, 'ALTA').map((c) => c.id)).toEqual(['c2']);
    expect(filterColumns(cands, 'cliente').map((c) => c.id)).toEqual(['c1']);
    expect(filterColumns(cands, 'saldo')).toHaveLength(0);
  });
});

describe('tableSchemasFromCatalog · fast-path del kind', () => {
  const S = (name: string, kind?: 'tables' | 'views' | 'both' | null) => ({ id: `s-${name}`, name, kind });

  it('con todo el catálogo clasificado devuelve solo los esquemas de tablas', () => {
    const cat = [S('core_alm', 'tables'), S('core_alm_vu', 'views'), S('No_Definido', 'tables')];
    expect(tableSchemasFromCatalog(cat)).toEqual(['core_alm', 'No_Definido']);
  });

  it('un esquema con tablas y vistas (both) cuenta como clasificado y como de tablas', () => {
    const cat = [S('core_cum', 'tables'), S('core_cum_vu', 'both'), S('core_cum_vu2', 'views')];
    expect(tableSchemasFromCatalog(cat)).toEqual(['core_cum', 'core_cum_vu']);
  });

  it('con algún esquema sin clasificar devuelve null (fallback al pool)', () => {
    expect(tableSchemasFromCatalog([S('a', 'tables'), S('b', null)])).toBeNull();
    expect(tableSchemasFromCatalog([S('a', 'tables'), S('b')])).toBeNull();
  });

  it('con catálogo vacío devuelve null (las tablas pueden usar esquemas fuera del catálogo)', () => {
    expect(tableSchemasFromCatalog([])).toBeNull();
  });
});
