// `applyCanvasDrop` hace su `set` optimista (la llave nueva en el diagrama
// local) después de escribir; si mientras escribe se abre otra versión y el
// refresco ya reabrió el canvas con ella, ese set tardío se corta: de lo
// contrario reinstalaría en pantalla el diagrama de la anterior (sellado con su
// sesión), las ediciones no harían nada sin avisar y Save resolvería como éxito
// («Saved»). Como defensa, con un diagrama de otra sesión en pantalla las
// ediciones avisan y Save falla con el motivo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
let keyWrite: ReturnType<typeof deferred<unknown>> | null = null;
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(async () => []),
    recordChange: vi.fn(async () => (keyWrite ? keyWrite.promise : {})),
    recordChangesBulk: vi.fn(async () => ({})),
  };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return {
    ...actual, listProjects: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(), projectDeletionPending: vi.fn(async () => false),
    setSubjectAreaLayout: vi.fn(async () => ({})), setSubjectAreaDrawings: vi.fn(async () => ({})), setWireRoute: vi.fn(async () => ({})),
  };
});
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as csvc from '@/services/changeset.service';
import * as struct from '../features/modeler/services/structure.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const st = () => useModelerStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const SA = { id: 'sa1', projectId: 'p1', name: 'A', folderId: null, tableIds: ['t1', 't2'], layout: {} };
const cols = [
  { id: 'c1', tableId: 't1', logicalName: 'a', physicalName: 'A', dataType: 'INT', typeOverridden: false, ordinal: 0 },
  { id: 'c2', tableId: 't1', logicalName: 'b', physicalName: 'B', dataType: 'INT', typeOverridden: false, ordinal: 1 },
  { id: 'c3', tableId: 't2', logicalName: 'k', physicalName: 'K', dataType: 'INT', typeOverridden: false, ordinal: 0, isPrimaryKey: true },
];
const REL = { id: 'r1', parentTableId: 't2', childTableId: 't1', identifying: false, parentCardinality: 'one', childCardinality: 'many', pairs: [{ parentColumnId: 'c3', childColumnId: 'c1' }] };
const dia = (name: string) => ({
  subjectArea: { ...SA }, tables: [{ id: 't1', logicalName: 't', physicalName: name }, { id: 't2', logicalName: 'p', physicalName: 'P' }],
  columns: structuredClone(cols), relationships: [structuredClone(REL)], views: [],
});
const STALE = /version that is no longer open/;
const openCs2 = () => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
const writes = () => vi.mocked(csvc.recordChange).mock.calls.length + vi.mocked(struct.setSubjectAreaLayout).mock.calls.length
  + vi.mocked(struct.setSubjectAreaDrawings).mock.calls.length + vi.mocked(struct.setWireRoute).mock.calls.length;

beforeEach(async () => {
  vi.clearAllMocks();
  keyWrite = null;
  vi.mocked(struct.listProjects).mockResolvedValue([{ id: 'p1', name: 'Uno' }] as never);
  vi.mocked(struct.listSubjectAreas).mockResolvedValue([SA] as never);
  vi.mocked(mod.loadDiagram).mockResolvedValue(dia('VERSION_A') as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({
    projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, trees: {}, folders: [],
    subjectAreas: [SA as never], openingSaId: null, flow: null,
  });
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

/** Soltar una fila en el bloque (TableNode) con la escritura de la llave en vuelo; se abre la versión B y el refresco reabre. */
async function dropThenSwitch(plan: object) {
  keyWrite = deferred();
  const drop = st().applyCanvasDrop('t1', plan as never);
  await tick();
  openCs2();
  vi.mocked(mod.loadDiagram).mockResolvedValue(dia('VERSION_B') as never);
  await st().refreshExplorer();
  expect(st().diagram?.tables[0].physicalName).toBe('VERSION_B');
  keyWrite.resolve({});
  keyWrite = null;
  await drop.catch(() => {});
}

describe('el set optimista tardío de applyCanvasDrop no reinstala otra sesión', () => {
  it('llave + orden: en pantalla queda la versión B', async () => {
    await dropThenSwitch({ key: [{ id: 'c2', isPrimaryKey: true }], order: ['c2', 'c1'] });
    expect(st().diagram?.tables[0].physicalName).toBe('VERSION_B');
  });

  it('solo llave: tampoco (ni recarga en la sesión nueva)', async () => {
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    await dropThenSwitch({ key: [{ id: 'c2', isPrimaryKey: true }] });
    expect(st().diagram?.tables[0].physicalName).toBe('VERSION_B');
    expect(vi.mocked(mod.loadDiagram).mock.calls.length).toBe(loads + 1);   // solo la reapertura del refresco
  });
});

describe('defensa: con un diagrama de otra sesión en pantalla se avisa, no se calla', () => {
  /** El diagrama de cs1 reinstalado por error estando en cs2. */
  function staleOnScreen() {
    const stale = st().diagram;
    openCs2();
    useModelerStore.setState({ diagram: stale, activeSaId: 'sa1' });
    vi.mocked(csvc.recordChange).mockClear();
  }

  it('las ediciones del canvas fallan con el motivo y no escriben', async () => {
    staleOnScreen();
    await expect(st().updateColumn('c1', { description: 'x' })).rejects.toThrow(STALE);
    await expect(st().updateTable('t1', { description: 'x' })).rejects.toThrow(STALE);
    await expect(st().addColumn('t1', { logicalName: 'nueva', mode: 'physical' } as never)).rejects.toThrow(STALE);
    await expect(st().reorderColumns('t1', ['c2', 'c1'])).rejects.toThrow(STALE);
    await expect(st().applyCanvasDrop('t1', { key: [{ id: 'c2', isPrimaryKey: true }] } as never)).rejects.toThrow(STALE);
    await expect(st().updateRelationship({ ...REL, identifying: true } as never)).rejects.toThrow(STALE);
    await expect(st().deleteRelationship('r1')).rejects.toThrow(STALE);
    await expect(st().autoOrganize()).rejects.toThrow(STALE);
    await expect(st().removeTableFromArea('t1')).rejects.toThrow(STALE);
    await expect(st().addExistingTables(['t9'])).rejects.toThrow(STALE);
    await expect(st().addViewsToCanvas(['v1'])).rejects.toThrow(STALE);
    await expect(st().removeViewFromCanvas('v1')).rejects.toThrow(STALE);
    expect(writes()).toBe(0);
  });

  it('Save no resuelve como éxito (el Toolbar diría «Saved»)', async () => {
    staleOnScreen();
    await expect(st().saveAll()).rejects.toThrow(STALE);
    expect(writes()).toBe(0);
  });

  it('los guardados de fondo (mover un bloque, un trazo) lo avisan en vez de callar', async () => {
    staleOnScreen();
    await st().saveNodePositions({ t1: { x: 5, y: 5 } });
    await st().setWireRoute('r1', [{ x: 1, y: 1 }]);
    const shown = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
    expect(shown).toHaveLength(2);
    expect(shown.every((m) => STALE.test(m))).toBe(true);
    expect(writes()).toBe(0);
  });

  it('sin diagrama en pantalla (recién limpiado), nada que editar: se calla', async () => {
    openCs2();
    await expect(st().updateColumn('c1', { description: 'x' })).resolves.toBeNull();
    await expect(st().saveAll()).resolves.toBeUndefined();
    await st().saveNodePositions({ t1: { x: 5, y: 5 } });
    expect(toast.error).not.toHaveBeenCalled();
    expect(writes()).toBe(0);
  });
});
