// Pegar una tabla termina recargando el canvas; si mientras recarga se abre otra
// versión, `pasteTable` devuelve null para que el llamador (menú de la columna,
// Ctrl+V) no avise «… pasted as …» sobre la versión que se abrió.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const st = () => useModelerStore.getState();
const T1 = { id: 't1', logicalName: 'cliente', physicalName: 'M_CLIENTE' };
const C1 = { id: 'c1', tableId: 't1', logicalName: 'cod', physicalName: 'COD', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
const DIA = { subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', tableIds: ['t1'], layout: {} }, tables: [T1], columns: [C1], relationships: [], views: [] };

beforeEach(async () => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  // La faceta la cambian algunos tests (los nombres siguen la faceta): cada uno arranca en Physical.
  useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical' });
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ tblClipboard: { table: T1 as never, cols: [C1 as never] } });
});
afterEach(async () => { await sleep(5); });

describe('pegar una tabla no avisa en otra versión', () => {
  it('si mientras recargaba se abrió otra versión, no devuelve el nombre', async () => {
    const late = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => late.promise as never);
    const paste = st().pasteTable();
    await sleep(5);                                    // grabó; recarga
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    late.resolve(structuredClone(DIA));
    await expect(paste).resolves.toBeNull();
  });

  it('sin cambio de sesión, devuelve el nombre de la copia', async () => {
    await expect(st().pasteTable()).resolves.toMatch(/^M_CLIENTE/);
  });
});

// El nombre que se muestra al copiar y pegar una tabla es el de la faceta
// abierta (en Lógico, «Entity pasted as» lleva el nombre lógico de la copia, no
// el físico).
describe('copiar y pegar dan el nombre según la faceta', () => {
  it('en Lógico: el lógico del original y el de la copia', async () => {
    useModelerStore.setState({ viewMode: 'logical' });
    expect(st().copyTable('t1')).toBe('cliente');
    await expect(st().pasteTable()).resolves.toMatch(/^cliente/);
  });

  // La etiqueta del Undo también sigue la faceta.
  it('en Lógico, el Undo dice «Paste entity <lógico>»', async () => {
    const { useUndoStore } = await import('./useUndoStore');
    useUndoStore.setState({ stack: [], busy: false });
    useModelerStore.setState({ viewMode: 'logical' });
    st().copyTable('t1');
    const name = await st().pasteTable();
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual([`Paste entity ${name}`]);
  });

  it('en Físico: los físicos', async () => {
    useModelerStore.setState({ viewMode: 'physical' });
    expect(st().copyTable('t1')).toBe('M_CLIENTE');
    await expect(st().pasteTable()).resolves.toMatch(/^M_CLIENTE_copy/);
  });
});
