// Doc 105 (ronda 3, R7-A) — al abrir OTRA versión (o cambiar de modo o de
// proyecto), el canvas de la anterior seguía vivo y editable hasta que el
// refresco lo reabría (varias idas y vueltas): `updateTable`/`updateColumn`
// hacían upsert del documento COMPLETO de A en B, Save grababa el layout y los
// dibujos de A en B. Ahora, en TODO cambio de la sesión de canvas, el store
// limpia de forma síncrona el diagrama, los dibujos, la selección y los popups
// (conserva `activeSaId`: el refresco reabre ese canvas si existe en la nueva),
// descarta las cargas en vuelo de la anterior y — como defensa — no escribe con
// un diagrama cargado en otra sesión.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(async () => []), recordChange: vi.fn(async () => ({})), recordChangesBulk: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return {
    ...actual,
    listProjects: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(),
    projectDeletionPending: vi.fn(async () => false),
  };
});
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import * as struct from '../features/modeler/services/structure.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const st = () => useModelerStore.getState();
const P1 = { id: 'p1', name: 'Uno' };
const SA = { id: 'sa1', projectId: 'p1', name: 'Canvas', folderId: null, tableIds: ['t1'], layout: {} };
const T_A = { id: 't1', logicalName: 'Cliente A', physicalName: 'CLIENTE_A' };
const C_A = { id: 'c1', tableId: 't1', logicalName: 'Cod A', physicalName: 'COD_A', dataType: 'STRING', ordinal: 0 };
const dia = (t: typeof T_A, tag = 'A') => ({
  subjectArea: { ...SA, drawings: [{ id: `d-${tag}`, type: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
  tables: [t], columns: [C_A], relationships: [], views: [],
});
const T_B = { id: 't1', logicalName: 'Cliente B', physicalName: 'CLIENTE_B' };
const writes = () => vi.mocked(csvc.recordChange).mock.calls.map(([cs, coll, id]) => `${cs}:${coll}:${id}`);
const openCs2 = () => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(struct.listProjects).mockResolvedValue([P1] as never);
  vi.mocked(struct.listSubjectAreas).mockResolvedValue([SA] as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  // El canvas de la versión A se abre por el camino normal (carga del diagrama).
  vi.mocked(mod.loadDiagram).mockResolvedValue(dia(T_A) as never);
  useModelerStore.setState({
    projects: [P1 as never], activeProjectId: 'p1', activeSaId: null, diagram: null, trees: {}, folders: [],
    subjectAreas: [SA as never], schemas: [], openingSaId: null, inspect: null, searchOpen: false,
  });
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({
    selectedTableId: 't1', selectedColumnId: 'c1', columnTarget: 't1', subcatArmed: true,
    inspect: { kind: 'table', id: 't1' }, searchOpen: true,
  });
  vi.mocked(mod.loadDiagram).mockResolvedValue(dia(T_B, 'B') as never);   // lo que tiene la versión B
  vi.mocked(csvc.recordChange).mockClear();
});
afterEach(async () => { await sleep(5); });

describe('cambiar de sesión limpia el canvas de la anterior al instante (doc 105, R7-A)', () => {
  it('diagrama, dibujos, selección y popups se van en el acto; activeSaId queda para reabrir', () => {
    openCs2();
    const s = st();
    expect({
      diagram: s.diagram, drawings: s.drawings, selectedTableId: s.selectedTableId, selectedColumnId: s.selectedColumnId,
      columnTarget: s.columnTarget, subcatArmed: s.subcatArmed, inspect: s.inspect, searchOpen: s.searchOpen,
      openingSaId: s.openingSaId, activeSaId: s.activeSaId,
    }).toEqual({
      diagram: null, drawings: [], selectedTableId: null, selectedColumnId: null, columnTarget: null,
      subcatArmed: false, inspect: null, searchOpen: false, openingSaId: null, activeSaId: 'sa1',
    });
  });

  it('en la ventana hasta que el refresco reabre, las escrituras del canvas no escriben el doc de A en B', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listProjects).mockImplementationOnce(() => late.promise as never);
    openCs2();
    const r = st().refreshExplorer();
    await st().updateTable('t1', { description: 'nota' });   // blur de la definición en PropertiesPanel
    await st().updateColumn('c1', { description: 'x' });     // un campo de columna
    await st().saveAll();                                    // Save: layout y dibujos
    expect(writes()).toEqual([]);                            // antes: el doc de cs1 escrito en cs2
    late.resolve([P1]);
    await r;
    expect(st().diagram?.tables[0]?.physicalName).toBe('CLIENTE_B');   // el refresco reabrió con B
    expect(st().drawings.map((d) => d.id)).toEqual(['d-B']);
  });

  it('una carga del canvas pedida en la sesión anterior no reinstala su diagrama', async () => {
    const late = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => late.promise as never);
    const click = st().selectSubjectArea('sa1');             // clic en el Explorer (cs1)
    openCs2();                                               // …y se abre otra versión antes de la respuesta
    late.resolve(dia(T_A));
    await click;
    expect(st().diagram).toBeNull();
    expect(st().openingSaId).toBeNull();
  });

  it('defensa: con un diagrama cargado en OTRA sesión (reinstalado por error) no se escribe — y se avisa (ronda 4)', async () => {
    const stale = st().diagram;                              // cargado en cs1
    openCs2();
    useModelerStore.setState({ diagram: stale });            // p. ej. un set optimista tardío
    await expect(st().updateTable('t1', { description: 'nota' })).rejects.toThrow(/version that is no longer open/);
    await expect(st().updateColumn('c1', { description: 'x' })).rejects.toThrow(/version that is no longer open/);
    expect(writes()).toEqual([]);
  });
});
