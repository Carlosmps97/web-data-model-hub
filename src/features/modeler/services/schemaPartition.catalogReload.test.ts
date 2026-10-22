// El filtro de esquemas de CTAS y New table · Import existing sale del mismo
// catálogo que los combos: cuando `loadSchemas` trae un catálogo distinto del
// que tenía el store (un alta desde un combo, un pegado que crea su esquema,
// una carga Excel) lo vuelve a consultar dentro de la misma versión; si el
// catálogo es el mismo, la foto cacheada sigue sirviendo. Una versión distinta
// por caso: el cache es module-level.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ rows: [] as { id: string; name: string; kind: string }[] }));
vi.mock('./modeler.service', () => ({}));
vi.mock('./schemas.service', () => ({
  listSchemas: vi.fn(async () => catalog.rows.map((r) => ({ ...r }))),
}));
vi.mock('@/services/governance.service', async (orig) => ({
  ...(await orig<object>()),
  listTables: vi.fn(async () => [{ id: 't1', physicalName: 'X', logicalName: 'x', schema: 'STG' }]),
}));

import * as gov from '@/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { tableSchemasCached } from './schemaPartition';

describe('loadSchemas · el filtro de esquemas de CTAS sigue al catálogo', () => {
  let n = 0;
  beforeEach(() => {
    n += 1;
    vi.mocked(gov.listTables).mockClear();
    useSessionStore.setState({ activeProjectId: 'p1', activeChangesetId: `cs${n}` });
    catalog.rows = [{ id: 's1', name: 'STG', kind: 'tables' }];
    useModelerStore.setState({ schemas: catalog.rows.map((r) => ({ ...r })) as never });
  });

  it('un esquema nuevo aparece en el filtro al recargar el catálogo', async () => {
    expect(await tableSchemasCached()).toEqual(['STG']);
    catalog.rows = [...catalog.rows, { id: 's2', name: 'NUEVO', kind: 'tables' }];
    expect(await tableSchemasCached()).toEqual(['STG']);   // misma versión: sale de la caché
    await useModelerStore.getState().loadSchemas();
    expect(useModelerStore.getState().schemas.map((s) => s.name)).toEqual(['STG', 'NUEVO']);
    expect(await tableSchemasCached()).toEqual(['STG', 'NUEVO']);
  });

  it('una recarga que trae el mismo catálogo no vuelve a bajar el pool de tablas', async () => {
    // Sin catálogo el filtro cae al pool completo de tablas; un combo que se
    // monta con el store vacío recarga el catálogo mientras esa bajada está en vuelo.
    catalog.rows = [];
    useModelerStore.setState({ schemas: [] });
    const first = tableSchemasCached();
    await useModelerStore.getState().loadSchemas();
    expect(await first).toEqual(['STG']);
    expect(await tableSchemasCached()).toEqual(['STG']);
    expect(gov.listTables).toHaveBeenCalledTimes(1);
  });
});
