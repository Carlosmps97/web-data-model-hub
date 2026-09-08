// Doc 72 §1: inventario del proyecto en UNA request + columnas perezosas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(),
  LONG_TIMEOUT_MS: 120_000,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  setDevUser: vi.fn(),
  setAuthToken: vi.fn(),
  setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; },
  apiErrorMessage: vi.fn(),
  isConflictError: vi.fn(),
}));
vi.mock('@/services/changeset.service', () => ({
  effective: vi.fn(),
}));
vi.mock('@/services/reporting.service', () => ({
  listReportColumns: vi.fn(),
}));
import { apiGet } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { listReportColumns } from '@/services/reporting.service';
import { useSessionStore } from '@/store/useSessionStore';
import { explorerColumns, mapInventory, mapView, projectInventory, type RawInventory } from './explorer.service';

const RAW: RawInventory = {
  tables: [
    { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core', columnCount: 12 },
    { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta', schema: null, columnCount: 0 },
  ],
  views: [
    { id: 'v1', name: 'V_CLI', schema: 'core_vu', sourceTableIds: ['t1', 't9'],
      sources: [{ tableId: 't1', column: 'COD', outputAlias: 'CODIGO', castType: 'STRING' }, { tableId: 't9', column: 'X' }] },
    { id: 'v2', name: 'V_CUSTOM', tableId: 't2', customSql: 'SELECT 1 AS uno', customColumns: [{ name: 'uno', expression: '1' }],
      sources: [{ tableId: 't2', column: 'IGNORADA' }] },
  ],
  canvases: 3,
  total: { tables: 2, views: 2 },
};

describe('mapView / mapInventory (doc 72)', () => {
  it('resuelve nombres de fuentes desde el inventario y mapea columnas Regular', () => {
    const inv = mapInventory(RAW);
    expect(inv.canvases).toBe(3);
    expect(inv.tables[1].schema).toBeNull();
    const v1 = inv.views[0];
    expect(v1.sourceTables).toEqual(['M_CLIENTE', 't9']);            // t9 no está en el inventario → id
    expect(v1.columns).toEqual([
      { outputAlias: 'CODIGO', sourceColumn: 'COD', sourceTable: 'M_CLIENTE', castType: 'STRING', expression: null },
      { outputAlias: null, sourceColumn: 'X', sourceTable: 't9', castType: null, expression: null },
    ]);
    expect(v1.custom).toBe(false);
  });

  it('vista Personalizada: columnas del parse, fuente legacy tableId', () => {
    const v2 = mapView(RAW.views[1], (id) => (id === 't2' ? 'M_CUENTA' : undefined));
    expect(v2.custom).toBe(true);
    expect(v2.sourceTableIds).toEqual(['t2']);
    expect(v2.sourceTables).toEqual(['M_CUENTA']);
    expect(v2.columns).toEqual([{ outputAlias: 'uno', expression: '1', sourceTable: null, sourceColumn: null, castType: null }]);
  });
});

describe('projectInventory / explorerColumns conmutan por la versión activa', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(csvc.effective).mockReset();
    vi.mocked(listReportColumns).mockReset();
    useSessionStore.setState({ activeProjectId: 'p1' });
  });

  it('producción: sin changesetId y columnas por reporting', async () => {
    useSessionStore.setState({ activeChangesetId: null });
    vi.mocked(apiGet).mockResolvedValueOnce(RAW);
    const inv = await projectInventory('p 1');
    expect(vi.mocked(apiGet).mock.calls[0][0]).toMatch(/\/api\/projects\/p%201\/catalog\/inventory$/);
    expect(inv.tables).toHaveLength(2);

    vi.mocked(listReportColumns).mockResolvedValueOnce([
      { id: 'c1', physicalName: 'A', logicalName: 'a', dataType: 'INT', ordinal: 1 } as never,
    ]);
    const cols = await explorerColumns('t1');
    expect(listReportColumns).toHaveBeenCalledWith('p1', 't1');     // doc 75: columnas del proyecto
    expect(cols[0]).toMatchObject({ id: 'c1', physicalName: 'A', ordinal: 1 });
    expect(csvc.effective).not.toHaveBeenCalled();
  });

  it('draft: changesetId en la URL y columnas efectivas ordenadas por ordinal', async () => {
    useSessionStore.setState({ activeChangesetId: 'cs1' });
    vi.mocked(apiGet).mockResolvedValueOnce(RAW);
    await projectInventory('p1');
    expect(vi.mocked(apiGet).mock.calls[0][0]).toMatch(/\/inventory\?changesetId=cs1$/);

    vi.mocked(csvc.effective).mockResolvedValueOnce([
      { id: 'c2', tableId: 't1', physicalName: 'B', dataType: 'INT', ordinal: 2, isPrimaryKey: null },
      { id: 'c1', tableId: 't1', physicalName: 'A', dataType: 'INT', ordinal: 1, isPrimaryKey: true },
    ]);
    const cols = await explorerColumns('t1');
    expect(csvc.effective).toHaveBeenCalledWith('cs1', 'canonical_columns', { tableId: 't1' });
    expect(cols.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(cols[0].isPrimaryKey).toBe(true);
    expect(listReportColumns).not.toHaveBeenCalled();
    useSessionStore.setState({ activeChangesetId: null });
  });
});
