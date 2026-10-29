// Pegar un grupo de tablas (doc 134 §3.7): lo que mostró «Paste N tables», en un
// solo lote; dos tablas del grupo nunca reciben el mismo nombre y, si otro usuario
// toma uno en el medio (409), se recalculan; las copias quedan seleccionadas como
// grupo y un solo Undo las borra. Un grupo copiado en otro proyecto no se pega.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/changeset.service')>()),
  writeSeqOf: async () => ({ writeSeq: 0 }),   // el candado del Undo lee el contador (doc 133): nada ajeno
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, searchTables: vi.fn(async () => []), recordChangesBulk: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  const { canvasLotStub } = await import('./canvasLot.testutil');
  const gov = await import('@/services/governance.service');
  return {
    ...actual,
    addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
    // El envío único (doc 133 §4): sus cambios del modelo llegan al lote del modelo
    // de esta prueba; lo que suma al canvas, a `planCanvasAdd`.
    planCanvasAdd: vi.fn(actual.planCanvasAdd),
    canvasLot: vi.fn(canvasLotStub((changes) => gov.recordChangesBulk(changes))),
  };
});
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('../features/modeler/services/schemas.service', () => ({
  deleteSchema: vi.fn(async () => undefined), listSchemas: vi.fn(async () => []),
  schemaImpact: vi.fn(async () => ({ name: 's', tables: 0, views: 0, canvases: 0 })),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as gov from '@/services/governance.service';
import { ApiError } from '@/services/http';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const T1 = { id: 't1', logicalName: 'cliente', physicalName: 'M_CLIENTE', schema: 'core' };
const C1 = { id: 'c1', tableId: 't1', logicalName: 'cod', physicalName: 'COD', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
const DIA = { subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', tableIds: ['t1', 't2'], layout: {} }, tables: [T1, { id: 't2', logicalName: 'cliente copy 1', physicalName: 'M_CLIENTE_copy_1', schema: 'core' }], columns: [C1], relationships: [], views: [] };
const written = () => vi.mocked(gov.recordChangesBulk).mock.calls.map((c) => c[0]);
// En el canvas: M_CLIENTE y su copia M_CLIENTE_copy_1, las dos copiadas como grupo.
const T2 = { id: 't2', logicalName: 'cliente copy 1', physicalName: 'M_CLIENTE_copy_1', schema: 'core' };
const C2 = { ...C1, id: 'c2', tableId: 't2' };
const GROUP = {
  source: { projectId: 'p1', projectName: 'Uno' },
  tables: [{ table: T1, cols: [C1], pos: { x: 0, y: 0 } }, { table: T2, cols: [C2], pos: { x: 400, y: 0 } }],
};
const PREPARED = [{ table: T1 as never, cols: [C1 as never] }, { table: T2 as never, cols: [C2 as never] }];
const tablesOf = (lot: { collection: string; payload?: unknown }[]) =>
  lot.filter((c) => c.collection === 'canonical_tables').map((c) => (c.payload as { physicalName: string }).physicalName);

beforeEach(async () => {
  vi.clearAllMocks();
  useUndoStore.setState({ stack: [], busy: false });
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical' });
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ tblClipboard: null, groupClipboard: GROUP as never });
});
afterEach(async () => { await sleep(5); });

describe('pasteTables(prepared)', () => {
  it('un solo lote con las dos copias y nombres que no se repiten entre ellas', async () => {
    await expect(st().pasteTables(PREPARED)).resolves.toEqual(['M_CLIENTE_copy_2', 'M_CLIENTE_copy_3']);
    expect(written()).toHaveLength(1);
    expect(tablesOf(written()[0])).toEqual(['M_CLIENTE_copy_2', 'M_CLIENTE_copy_3']);
    expect(written()[0].filter((c) => c.collection === 'canonical_columns')).toHaveLength(2);
  });

  it('si otro usuario toma un nombre en el medio (409), se recalculan todos', async () => {
    vi.mocked(gov.recordChangesBulk)
      .mockRejectedValueOnce(new ApiError('Table M_CLIENTE_copy_2 already exists (schema core)', 409, null, '/api/x'))
      .mockResolvedValueOnce({} as never);
    await expect(st().pasteTables(PREPARED)).resolves.toEqual(['M_CLIENTE_copy_3', 'M_CLIENTE_copy_4']);
  });

  it('las copias quedan seleccionadas como grupo y el Undo es uno solo que las borra juntas', async () => {
    await st().pasteTables(PREPARED);
    const ids = written()[0].filter((c) => c.collection === 'canonical_tables').map((c) => c.entityId);
    expect(st().groupIds).toEqual(ids);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Paste 2 tables']);
    const deleteTables = vi.fn(async () => undefined);
    useModelerStore.setState({ deleteTables });
    await useUndoStore.getState().undoLast();
    expect(deleteTables).toHaveBeenCalledTimes(1);
    expect(deleteTables).toHaveBeenCalledWith(ids, expect.anything());
  });

  it('un esquema a crear que piden dos tablas nace una sola vez', async () => {
    await st().pasteTables(PREPARED.map((p) => ({ ...p, table: { ...(p.table as object), schema: 'stg_nuevo' } as never, createSchema: { name: 'stg_nuevo' } })));
    expect(written()[0].filter((c) => c.collection === 'schemas')).toHaveLength(1);
  });

  it('un grupo copiado en otro proyecto no se pega', async () => {
    useModelerStore.setState({ groupClipboard: { ...GROUP, source: { projectId: 'p2', projectName: 'Dos' } } as never });
    await expect(st().pasteTables(PREPARED)).rejects.toThrow('A group of tables can only be pasted in its own project.');
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
  });
});
