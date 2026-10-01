// F5 T7 review — los campos derived (calculados post-fetch, ops=[]) no deben
// ofrecerse como filtro ni disparar facets. isFilterableField/shouldFetchFacets
// son la lógica que usa el FilterBuilder para excluirlos.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_ERROR_TEXT } from '@/services/http';
import { emptySpec, exportCsv, isFilterableField, shouldFetchFacets, type FieldDef } from './query.service';

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

describe('exportCsv: errores legibles (doc 105)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const noStorage = { getItem: () => null };

  it('sin respuesta del servidor avisa lo mismo que el resto de la app (no «Failed to fetch»)', async () => {
    vi.stubGlobal('localStorage', noStorage);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(exportCsv(emptySpec('p1', 'tables'))).rejects.toThrow(NETWORK_ERROR_TEXT);
  });

  it('un rechazo del backend muestra su motivo (detail), no sólo el código', async () => {
    vi.stubGlobal('localStorage', noStorage);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Unknown field: foo' }), { status: 422, headers: { 'Content-Type': 'application/json' } })));
    await expect(exportCsv(emptySpec('p1', 'tables'))).rejects.toThrow('Unknown field: foo');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { message: 'Too many rows', limit: 5 } }), { status: 422 })));
    await expect(exportCsv(emptySpec('p1', 'tables'))).rejects.toThrow('Too many rows');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'No access' }), { status: 403 })));
    await expect(exportCsv(emptySpec('p1', 'tables'))).rejects.toThrow('No access');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: () => Promise.reject(new TypeError('network error')) })));
    await expect(exportCsv(emptySpec('p1', 'tables'))).rejects.toThrow(NETWORK_ERROR_TEXT);   // corte a mitad de la descarga
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(exportCsv(emptySpec('p1', 'tables'))).rejects.toThrow('Export failed (500)');
  });
});
