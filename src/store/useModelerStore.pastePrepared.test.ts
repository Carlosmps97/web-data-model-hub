// El pegado de tabla graba exactamente lo que mostró el popup
// (`pasteTable(prepared)`): el esquema que no existe nace en el mismo lote, el
// nombre se conserva si está libre y, si otro lo tomó en el medio, pasa a copy n.
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
vi.mock('../features/modeler/services/structure.service', () => ({ addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('../features/modeler/services/schemas.service', () => ({
  deleteSchema: vi.fn(async () => undefined), listSchemas: vi.fn(async () => []),
  schemaImpact: vi.fn(async () => ({ name: 's', tables: 0, views: 0, canvases: 0 })),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as gov from '@/services/governance.service';
import * as mod from '../features/modeler/services/modeler.service';
import * as schemas from '../features/modeler/services/schemas.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const T1 = { id: 't1', logicalName: 'cliente', physicalName: 'M_CLIENTE', schema: 'core' };
const C1 = { id: 'c1', tableId: 't1', logicalName: 'cod', physicalName: 'COD', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
const DIA = { subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', tableIds: ['t1'], layout: {} }, tables: [T1], columns: [C1], relationships: [], views: [] };
const written = () => vi.mocked(gov.recordChangesBulk).mock.calls.map((c) => c[0]);

beforeEach(async () => {
  vi.clearAllMocks();
  useUndoStore.setState({ stack: [], busy: false });
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical' });
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ tblClipboard: { table: T1 as never, cols: [C1 as never] } });
});
afterEach(async () => { await sleep(5); });

describe('pasteTable(prepared)', () => {
  it('graba la tabla y las columnas del popup, con el esquema nuevo primero en el mismo lote', async () => {
    const prepared = {
      table: { ...T1, schema: 'stg_nuevo', udpValues: { u: 'v' } } as never,
      cols: [{ ...C1, physicalName: 'COD_X', udpValues: { k: '1' } } as never],
      createSchema: { name: 'stg_nuevo' },
    };
    await st().pasteTable(prepared);
    const [lot] = written();
    expect(lot[0]).toMatchObject({ collection: 'schemas', op: 'upsert', payload: { name: 'stg_nuevo', kind: 'tables', description: null } });
    expect(lot[1]).toMatchObject({ collection: 'canonical_tables', payload: { physicalName: 'M_CLIENTE_copy_1', schema: 'stg_nuevo', udpValues: { u: 'v' } } });
    expect(lot[2]).toMatchObject({ collection: 'canonical_columns', payload: { physicalName: 'COD_X', udpValues: { k: '1' } } });
  });

  it('la procedencia nombra la tabla y las columnas de la fuente, no las de la copia', async () => {
    await st().pasteTable({ table: { ...T1, physicalName: 'M_CLIENTE_copy_1' } as never, cols: [{ ...C1, physicalName: 'COD_X' } as never] });
    const [lot] = written();
    expect(lot[0].origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE' });
    expect(lot[1].origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'COD' });
  });

  it('el nombre se conserva si está libre en el proyecto (la fuente fue borrada)', async () => {
    useModelerStore.setState({ diagram: { ...structuredClone(DIA), tables: [] } as never });
    await expect(st().pasteTable({ table: T1 as never, cols: [C1 as never] })).resolves.toBe('M_CLIENTE');
    expect(written()[0][0]).toMatchObject({ collection: 'canonical_tables', payload: { physicalName: 'M_CLIENTE' } });
  });

  it('si otro tomó el nombre en el medio (409), ese cuenta como tomado y se usa el siguiente', async () => {
    vi.mocked(gov.recordChangesBulk)
      .mockRejectedValueOnce(new Error('Table M_CLIENTE_copy_1 already exists (schema core)'))
      .mockResolvedValueOnce({} as never);
    await expect(st().pasteTable({ table: T1 as never, cols: [C1 as never] })).resolves.toBe('M_CLIENTE_copy_2');
  });

  it('un 409 por otro nombre (p. ej. el esquema) no se reintenta: sube tal cual', async () => {
    vi.mocked(gov.recordChangesBulk).mockRejectedValueOnce(new Error('Schema stg_nuevo already exists'));
    await expect(st().pasteTable({ table: T1 as never, cols: [], createSchema: { name: 'stg_nuevo' } }))
      .rejects.toThrow('Schema stg_nuevo already exists');
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
  });

  it('el Undo borra la tabla y después el esquema que nació con ella', async () => {
    await st().pasteTable({ table: { ...T1, schema: 'stg_nuevo' } as never, cols: [], createSchema: { name: 'stg_nuevo' } });
    const schemaId = (written()[0][0].payload as { id: string }).id;
    vi.mocked(schemas.listSchemas).mockResolvedValueOnce([{ id: schemaId, name: 'stg_nuevo', description: null, kind: 'tables' }]);
    const deleteTable = vi.fn(async () => undefined);
    useModelerStore.setState({ deleteTable });
    await useUndoStore.getState().undoLast();
    expect(deleteTable).toHaveBeenCalledTimes(1);
    expect(schemas.deleteSchema).toHaveBeenCalledWith(schemaId);
  });

  it('si otra tabla usa el esquema (una existente que no estaba catalogada), el Undo lo deja', async () => {
    vi.mocked(schemas.schemaImpact).mockResolvedValueOnce({ name: 'stg_nuevo', tables: 1, views: 0, canvases: 1 });
    await st().pasteTable({ table: { ...T1, schema: 'stg_nuevo' } as never, cols: [], createSchema: { name: 'stg_nuevo' } });
    useModelerStore.setState({ deleteTable: vi.fn(async () => undefined) });
    await useUndoStore.getState().undoLast();
    expect(schemas.schemaImpact).toHaveBeenCalledTimes(1);
    expect(schemas.deleteSchema).not.toHaveBeenCalled();
  });

  it('sin esquema nuevo, el Undo solo borra la tabla', async () => {
    await st().pasteTable({ table: T1 as never, cols: [] });
    useModelerStore.setState({ deleteTable: vi.fn(async () => undefined) });
    await useUndoStore.getState().undoLast();
    expect(schemas.deleteSchema).not.toHaveBeenCalled();
  });

  it('un 409 que nombra el texto de la tabla pero no es «Table X already exists» no se reintenta', async () => {
    useModelerStore.setState({ diagram: { ...structuredClone(DIA), tables: [] } as never });
    vi.mocked(gov.recordChangesBulk).mockRejectedValueOnce(new Error('Schema STG_NUEVO already exists'));
    await expect(st().pasteTable({ table: { ...T1, physicalName: 'STG' } as never, cols: [], createSchema: { name: 'STG_NUEVO' } }))
      .rejects.toThrow('Schema STG_NUEVO already exists');
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
  });

  it('el catálogo de esquemas se refresca al pegar con esquema nuevo y al deshacerlo', async () => {
    await st().pasteTable({ table: { ...T1, schema: 'stg_nuevo' } as never, cols: [], createSchema: { name: 'stg_nuevo' } });
    await vi.waitFor(() => expect(schemas.listSchemas).toHaveBeenCalledTimes(1));
    const schemaId = (written()[0][0].payload as { id: string }).id;
    vi.mocked(schemas.listSchemas).mockResolvedValue([{ id: schemaId, name: 'stg_nuevo', description: null, kind: 'tables' }]);
    useModelerStore.setState({ deleteTable: vi.fn(async () => undefined) });
    const tick = st().explorerTick;
    await useUndoStore.getState().undoLast();
    // Una lectura para tomar el esquema vigente antes de borrarlo y otra del refresco.
    await vi.waitFor(() => expect(schemas.listSchemas).toHaveBeenCalledTimes(3));
    expect(st().explorerTick).toBeGreaterThan(tick);
  });

  it('cambiar de canvas cierra el popup de pegado (como el de columnas)', async () => {
    useModelerStore.setState({ tablePasteOpen: true, pasteTarget: 't1' });
    await st().selectSubjectArea('sa1');
    expect(st().tablePasteOpen).toBe(false);
    expect(st().pasteTarget).toBeNull();
  });
});
