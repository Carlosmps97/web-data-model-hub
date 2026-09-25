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
import { explorerColumns, explorerViewColumns, mapInventory, mapView, mapViewCols, projectInventory, type RawInventory } from './explorer.service';

const RAW: RawInventory = {
  tables: [
    { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core', columnCount: 12 },
    { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta', schema: null, columnCount: 0 },
  ],
  // Filas SLIM: conteo, nunca columnas (perf 2026-09-08).
  views: [
    { id: 'v1', name: 'V_CLI', schema: 'core_vu', sourceTableIds: ['t1', 't9'], columnCount: 2, custom: false },
    { id: 'v2', name: 'V_CUSTOM', sourceTableIds: ['t2'], columnCount: 1, custom: true },
  ],
  canvases: 3,
  total: { tables: 2, views: 2 },
};

describe('mapView / mapInventory (doc 72)', () => {
  it('resuelve nombres de fuentes desde el inventario; el badge es el CONTEO', () => {
    const inv = mapInventory(RAW);
    expect(inv.canvases).toBe(3);
    expect(inv.tables[1].schema).toBeNull();
    const v1 = inv.views[0];
    expect(v1.sourceTables).toEqual(['M_CLIENTE', 't9']);            // t9 no está en el inventario → id
    expect(v1.columnCount).toBe(2);                                  // las columnas NO viajan en el inventario
    expect(v1.custom).toBe(false);
    expect('columns' in v1).toBe(false);
  });

  it('vista Personalizada y defaults tolerantes', () => {
    const v2 = mapView(RAW.views[1], (id) => (id === 't2' ? 'M_CUENTA' : undefined));
    expect(v2.custom).toBe(true);
    expect(v2.sourceTableIds).toEqual(['t2']);
    expect(v2.sourceTables).toEqual(['M_CUENTA']);
    expect(v2.columnCount).toBe(1);
    const vacia = mapView({ id: 'v3', name: 'V3' }, () => undefined);
    expect(vacia).toMatchObject({ sourceTables: [], sourceTableIds: [], columnCount: 0, custom: false });
  });
});

describe('mapViewCols — columnas de la vista al expandir', () => {
  it('resuelve la tabla fuente por id y normaliza Regular + Personalizada', () => {
    const cols = mapViewCols(
      [
        { outputAlias: 'CODIGO', column: 'COD', tableId: 't1', castType: 'STRING' },
        { outputAlias: null, column: 'X', tableId: 't9' },              // fuente fuera del inventario → id
        { outputAlias: 'uno', expression: '1' },                        // Personalizada: sin fuente
      ],
      (id) => (id === 't1' ? 'M_CLIENTE' : undefined),
    );
    expect(cols).toEqual([
      { outputAlias: 'CODIGO', sourceColumn: 'COD', sourceTable: 'M_CLIENTE', castType: 'STRING', expression: null },
      { outputAlias: null, sourceColumn: 'X', sourceTable: 't9', castType: null, expression: null },
      { outputAlias: 'uno', sourceColumn: null, sourceTable: null, castType: null, expression: '1' },
    ]);
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

    // Columnas de una VISTA: endpoint propio, acotado al proyecto de la sesión.
    vi.mocked(apiGet).mockResolvedValueOnce([{ outputAlias: 'a', column: 'A', tableId: 't1' }]);
    await explorerViewColumns('v 1');
    expect(vi.mocked(apiGet).mock.calls[1][0]).toMatch(/\/api\/projects\/p1\/catalog\/views\/v%201\/columns$/);
  });

  it('producción: las columnas salen en el orden único — PK primero (final review #6)', async () => {
    useSessionStore.setState({ activeChangesetId: null });
    vi.mocked(listReportColumns).mockResolvedValueOnce([
      { id: 'x', physicalName: 'X', logicalName: 'x', dataType: 'INT', ordinal: 0, isPrimaryKey: false } as never,
      { id: 'k', physicalName: 'K', logicalName: 'k', dataType: 'INT', ordinal: 5, isPrimaryKey: true } as never,
    ]);
    expect((await explorerColumns('t1')).map((c) => c.id)).toEqual(['k', 'x']);
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

    vi.mocked(apiGet).mockResolvedValueOnce([]);
    await explorerViewColumns('v1');
    expect(vi.mocked(apiGet).mock.calls[1][0]).toMatch(/\/views\/v1\/columns\?changesetId=cs1$/);
    useSessionStore.setState({ activeChangesetId: null });
  });
});
