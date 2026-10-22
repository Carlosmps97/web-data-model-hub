// Auto-arrange en modo visor: las posiciones que ELK calcula sobre el diagrama
// del visor se aplican a los nodos vivos al terminar solo si siguen la sesión y
// el canvas donde empezó. Si mientras calcula se abre el draft del mismo canvas,
// sus bloques no deben moverse (un Save los grabaría); si en la misma sesión se
// abre otro canvas, sus tablas homónimas tampoco.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(async () => []), recordChange: vi.fn(async () => ({})), recordChangesBulk: vi.fn(async () => ({})) };
});
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
let elk = deferred<Record<string, { x: number; y: number }>>();
vi.mock('../features/modeler/lib/arrangeGraph', () => ({ arrangeDiagram: vi.fn(() => elk.promise) }));
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return { ...actual, setSubjectAreaLayout: vi.fn(async () => ({})), setSubjectAreaDrawings: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as struct from '../features/modeler/services/structure.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const st = () => useModelerStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const sa = (id: string) => ({ id, projectId: 'p1', name: id, folderId: null, tableIds: ['t1'], layout: { t1: { x: 10, y: 10 } } });
const dia = (id: string) => ({ subjectArea: sa(id), tables: [{ id: 't1', logicalName: 'c', physicalName: 'C' }], columns: [], relationships: [], views: [] });
let nodes: { id: string; type: string; position: { x: number; y: number } }[] = [];
const flow = {
  getNodes: () => nodes,
  setNodes: (f: (n: typeof nodes) => typeof nodes) => { nodes = f(nodes); },
  getNode: (id: string) => nodes.find((n) => n.id === id),
};
const liveT1 = () => nodes.find((n) => n.id === 't1')?.position;

beforeEach(async () => {
  vi.clearAllMocks();
  elk = deferred();
  nodes = [{ id: 't1', type: 'table', position: { x: 10, y: 10 } }];
  vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => dia(id) as never);
  useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null, activeProjectId: 'p1' });
  useModelerStore.setState({
    projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null,
    flow: flow as never, viewerLayout: {}, viewerRoutesOff: {},
  });
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('el arrange del visor aplica solo en su sesión y su canvas', () => {
  it('se abre el draft del mismo canvas mientras ELK calcula: sus bloques no se mueven y Save no graba el arrange', async () => {
    const arrange = st().autoOrganize();
    await tick();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    await st().selectSubjectArea('sa1');
    nodes = [{ id: 't1', type: 'table', position: { x: 10, y: 10 } }];   // nodos vivos del draft
    elk.resolve({ t1: { x: 999, y: 999 } });
    await arrange;
    expect(liveT1()).toEqual({ x: 10, y: 10 });
    await st().saveAll();
    const saved = vi.mocked(struct.setSubjectAreaLayout).mock.calls.map(([, layout]) => layout);
    expect(saved).toEqual([{ t1: { x: 10, y: 10 } }]);
  });

  it('misma sesión, se abre otro canvas mientras ELK calcula: su tabla homónima no se mueve', async () => {
    const arrange = st().autoOrganize();
    await tick();
    await st().selectSubjectArea('sa2');
    nodes = [{ id: 't1', type: 'table', position: { x: 10, y: 10 } }];   // t1 de sa2
    elk.resolve({ t1: { x: 999, y: 999 } });
    await arrange;
    expect(liveT1()).toEqual({ x: 10, y: 10 });
    expect(st().viewerLayout.sa2).toBeUndefined();
  });

  it('sin cambios, mueve los bloques y lo recuerda por canvas', async () => {
    const arrange = st().autoOrganize();
    elk.resolve({ t1: { x: 999, y: 999 } });
    await arrange;
    expect(liveT1()).toEqual({ x: 999, y: 999 });
    expect(st().viewerLayout.sa1).toEqual({ t1: { x: 999, y: 999 } });
    expect(st().viewerRoutesOff.sa1).toBe(true);
  });
});
