// F5 T7 review — los campos derived (calculados post-fetch, ops=[]) no deben
// ofrecerse como filtro ni disparar facets. isFilterableField/shouldFetchFacets
// son la lógica que usa el FilterBuilder para excluirlos.
import { describe, expect, it } from 'vitest';
import { isFilterableField, shouldFetchFacets, type FieldDef } from './query.service';

const fd = (over: Partial<FieldDef>): FieldDef => ({
  key: 'x', label: 'X', type: 'string', ops: ['eq'], sortable: false,
  groupable: true, indexed: false, enumValues: null, udp: false, hydrated: false,
  ...over,
});

const tableCount = fd({ key: 'tableCount', type: 'number', ops: [], derived: true, groupable: false });
const name = fd({ key: 'name', ops: ['eq', 'ne', 'in', 'contains'] });
const parentDomain = fd({ key: 'parentDomainId', hydrated: true, ops: ['eq', 'ne', 'in'] });
const schema = fd({ key: 'schema', indexed: true });
const enumField = fd({ key: 'card', type: 'enum', enumValues: ['one', 'many'], hydrated: false, ops: ['eq', 'in'] });

describe('isFilterableField', () => {
  it('excludes derived fields (ops empty)', () => {
    expect(isFilterableField(tableCount)).toBe(false);
  });
  it('excludes any field with empty ops even without the derived flag', () => {
    expect(isFilterableField(fd({ ops: [] }))).toBe(false);
  });
  it('keeps normal fields', () => {
    expect(isFilterableField(name)).toBe(true);
    expect(isFilterableField(schema)).toBe(true);
    expect(isFilterableField(parentDomain)).toBe(true);
  });
});

describe('shouldFetchFacets', () => {
  it('never fires for derived fields', () => {
    expect(shouldFetchFacets(tableCount)).toBe(false);
  });
  it('fires for hydrated fields', () => {
    expect(shouldFetchFacets(parentDomain)).toBe(true);
  });
  it('fires for known facetable keys (schema/dataType)', () => {
    expect(shouldFetchFacets(schema)).toBe(true);
    expect(shouldFetchFacets(fd({ key: 'dataType' }))).toBe(true);
  });
  it('does not fire for plain string fields nor enum (enum has its own values)', () => {
    expect(shouldFetchFacets(name)).toBe(false);
    expect(shouldFetchFacets(enumField)).toBe(false);
  });
});
