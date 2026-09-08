// Cache de esquemas-con-tablas (doc 43): una sola bajada del pool por sesión
// y versión, compartida entre CTAS y New table. Los tests usan una versión
// DISTINTA por caso porque el cache es module-level (persiste entre tests).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const csState = vi.hoisted(() => ({ activeId: null as string | null }));

vi.mock('@/services/governance.service', () => ({
  listTables: vi.fn(),
}));
vi.mock('./schemas.service', () => ({
  listSchemas: vi.fn(),
}));
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: { getState: () => ({ activeChangesetId: csState.activeId, activeProjectId: 'p1' }) },
}));

import * as gov from '@/services/governance.service';
import * as schemasSvc from './schemas.service';
import { tableSchemasCached } from './schemaPartition';

const listTables = vi.mocked(gov.listTables);
const listSchemas = vi.mocked(schemasSvc.listSchemas);
const T = (schema?: string) => ({ id: crypto.randomUUID(), physicalName: 'X', logicalName: 'x', schema });

describe('tableSchemasCached · esquemas con tablas, cacheados por versión', () => {
  beforeEach(() => {
    listTables.mockReset();
    // catálogo por defecto SIN kind → fuerza el camino del pool (pre-doc-44)
    listSchemas.mockReset();
    listSchemas.mockResolvedValue([{ id: 'x', name: 'X' }]);
  });

  it('deriva los esquemas del pool y cachea: la segunda llamada no re-consulta', async () => {
    csState.activeId = 'v1';
    listTables.mockResolvedValue([T('DDV'), T('core'), T('DDV'), T(undefined)]);
    expect(await tableSchemasCached()).toEqual(['core', 'DDV']);
    expect(await tableSchemasCached()).toEqual(['core', 'DDV']);
    expect(listTables).toHaveBeenCalledTimes(1);
  });

  it('dos llamadas EN VUELO comparten un solo fetch (montaje doble de StrictMode)', async () => {
    csState.activeId = 'v2';
    let release!: (v: ReturnType<typeof T>[]) => void;
    listTables.mockReturnValue(new Promise((res) => { release = res; }) as never);
    const p1 = tableSchemasCached();
    const p2 = tableSchemasCached();
    release([T('A')]);
    expect(await p1).toEqual(['A']);
    expect(await p2).toEqual(['A']);
    expect(listTables).toHaveBeenCalledTimes(1);
  });

  it('cambiar de versión re-consulta (el cache es por versión activa)', async () => {
    csState.activeId = 'v3';
    listTables.mockResolvedValue([T('B')]);
    expect(await tableSchemasCached()).toEqual(['B']);
    expect(listTables).toHaveBeenCalledTimes(1);
  });

  it('un fallo no queda cacheado: el siguiente intento re-consulta', async () => {
    csState.activeId = 'v4';
    listTables.mockRejectedValueOnce(new Error('red caída'));
    await expect(tableSchemasCached()).rejects.toThrow('red caída');
    listTables.mockResolvedValue([T('C')]);
    expect(await tableSchemasCached()).toEqual(['C']);
    expect(listTables).toHaveBeenCalledTimes(2);
  });

  it('catálogo totalmente clasificado (doc 44): usa el kind y NO baja el pool', async () => {
    csState.activeId = 'v5';
    listSchemas.mockResolvedValue([
      { id: '1', name: 'bcp_ddv_alm', kind: 'tables' },
      { id: '2', name: 'bcp_ddv_alm_vu', kind: 'views' },
    ]);
    expect(await tableSchemasCached()).toEqual(['bcp_ddv_alm']);
    expect(listTables).not.toHaveBeenCalled();
  });

  it('catálogo con esquemas sin clasificar: cae al distinct del pool', async () => {
    csState.activeId = 'v6';
    listSchemas.mockResolvedValue([{ id: '1', name: 'A', kind: 'tables' }, { id: '2', name: 'B' }]);
    listTables.mockResolvedValue([T('B')]);
    expect(await tableSchemasCached()).toEqual(['B']);
    expect(listTables).toHaveBeenCalledTimes(1);
  });

  it('si el catálogo falla, cae al pool sin rechazar', async () => {
    csState.activeId = 'v7';
    listSchemas.mockRejectedValue(new Error('x'));
    listTables.mockResolvedValue([T('C')]);
    expect(await tableSchemasCached()).toEqual(['C']);
  });
});
