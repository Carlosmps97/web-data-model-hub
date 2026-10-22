// Los paneles de propiedades arman el documento completo desde el diagrama y
// escriben directo al servicio. Tras un reload fallido el canvas se cierra y se
// avisa una vez: sin diagrama no hay panel desde el cual volver a grabar un
// documento desactualizado (la edición siguiente revertiría en silencio el UDP
// recién grabado).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
// Los hooks de zustand leen el estado real de los stores (sin React de verdad).
vi.mock('@/store/useModelerStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useModelerStore')>();
  const real = actual.useModelerStore;
  return { ...actual, useModelerStore: Object.assign((sel: (s: unknown) => unknown) => sel(real.getState()), real) };
});
vi.mock('@/store/useSessionStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useSessionStore')>();
  const real = actual.useSessionStore;
  return { ...actual, useSessionStore: Object.assign((sel: (s: unknown) => unknown) => sel(real.getState()), real) };
});
type Doc = Record<string, unknown> & { id: string };
let server: Record<string, Doc> = {};
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    // Los paneles leen el documento vigente por id antes de grabar; como en el
    // backend: de su colección, y sin `ids` la colección entera.
    ...actual, recordChangesBulk: vi.fn(async () => ({})),
    effective: vi.fn(async (_cs: string, coll: string, opts?: { ids?: string[] }) =>
      Object.values(server)
        .filter((d) => (coll === 'views') === ('sources' in d) && (!opts?.ids || opts.ids.includes(d.id)))
        .map((d) => ({ ...d }))),
    recordChange: vi.fn(async (_cs: string, _coll: string, id: string, op: string, payload: Doc) => {
      if (op === 'delete') delete server[id]; else server[id] = { ...payload };
      return {};
    }),
  };
});
vi.mock('@/services/views.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/views.service')>();
  return { ...actual, listViews: vi.fn(async () => []), tableViews: vi.fn(async () => ({ views: [] })) };
});
vi.mock('../services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('../../standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));

import { toast } from 'sonner';
import { ApiError } from '@/services/http';
import * as mod from '../services/modeler.service';
import PropertiesPanel from './PropertiesPanel';
import UdpAssign from './UdpAssign';
import ViewPropertiesPanel from './ViewPropertiesPanel';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';

const st = () => useModelerStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const dia = () => ({
  subjectArea: { id: 'sa1', projectId: 'p1', name: 'A', folderId: null, tableIds: ['t1'], viewIds: ['v1'], layout: {} },
  tables: [{ ...(server.t1 as object) }], columns: [], relationships: [], views: [{ ...(server.v1 as object) }],
});
const flaky = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/subject-areas/sa1/diagram?changesetId=cs1');
const CLOSED = "Couldn't reload the canvas: The server didn't respond within 30s. Open it again from the explorer.";
const udpOf = (tree: unknown) => [...walk(tree)].find((el) => el.type === UdpAssign);

/** El panel con la pestaña indicada (useState por valor inicial). */
function renderTable(tab: string) {
  resetFake((init) => (init === 'definition' ? tab : init));
  return PropertiesPanel({ pushToast: vi.fn() });
}
function renderView(tab: string) {
  resetFake((init) => (init === 'definition' ? tab : init));
  return ViewPropertiesPanel({ pushToast: vi.fn() });
}

beforeEach(async () => {
  vi.clearAllMocks();
  server = {
    t1: { id: 't1', logicalName: 'cliente', physicalName: 'T_CLIENTE', description: 'old', udpValues: { U1: 'A' } },
    v1: { id: 'v1', name: 'VW_CLIENTE', tableId: 't1', sourceTableIds: ['t1'], sources: [], description: 'old', udpValues: { U1: 'A' } },
  };
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, viewMode: 'physical' });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => dia() as never);
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('tras un reload fallido no queda panel que edite el documento desactualizado', () => {
  it('PropertiesPanel: el UDP queda grabado; el canvas se cierra con un aviso y el panel deja de pintarse', async () => {
    useModelerStore.setState({ selectedTableId: 't1' });
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    (udpOf(renderTable('udps'))!.props.onChange as (v: Record<string, string>) => void)({ U1: 'B' });
    await ticks();
    expect((server.t1.udpValues as Record<string, string>).U1).toBe('B');
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([CLOSED]);
    expect(renderTable('definition')).toBeNull();          // nada desde donde volver a grabar la tabla desactualizada
    expect((server.t1.udpValues as Record<string, string>).U1).toBe('B');
  });

  it('ViewPropertiesPanel: ídem con la vista', async () => {
    useModelerStore.setState({ selectedViewId: 'v1' });
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    (udpOf(renderView('udps'))!.props.onChange as (v: Record<string, string>) => void)({ U1: 'B' });
    await ticks();
    expect((server.v1.udpValues as Record<string, string>).U1).toBe('B');
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual([CLOSED]);
    expect(renderView('definition')).toBeNull();
  });
});
