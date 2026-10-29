// El Object Inspector (doc 133 §13, P2): sus guardados de una misma columna van
// en fila y cada uno arma su documento con la ficha vigente cuando le toca (la
// que dejó el refresco del anterior), no con la del render en que se pidió. Dos
// guardados casi a la vez —nombre y definición, o lo que el cuerpo manda al
// cerrarse y una edición enseguida— no se pisan. Sin DOM (hooks de mentira).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, runEffects, walk, type El } from '../../reporting/components/fakeReact.testutil';

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, q: new Map<string, Promise<unknown>>() }));
vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('@/store/useModelerStore', () => ({
  useModelerStore: Object.assign((pick: (s: unknown) => unknown) => pick(h.state), { getState: () => h.state }),
  inObjectOrder: (id: string, fn: () => Promise<unknown>) => {
    const run = (h.q.get(id) ?? Promise.resolve()).then(fn, fn);
    h.q.set(id, run.then(() => undefined, () => undefined));
    return run;
  },
}));
vi.mock('@/store/useSessionStore', async (orig) => {
  const real = await orig<typeof import('@/store/useSessionStore')>();
  const hook = Object.assign((pick: (s: unknown) => unknown) => pick(real.useSessionStore.getState()), real.useSessionStore);
  return { ...real, useSessionStore: hook, sessionProjectId: () => 'p1' };
});
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []), getSnapshot: vi.fn(async () => null) }));
vi.mock('../services/inspector.service', () => ({ inspectTable: vi.fn(), inspectView: vi.fn() }));
vi.mock('@/services/governance.service', async (orig) => ({
  ...(await orig<object>()), listDomains: vi.fn(async () => []), updateColumn: vi.fn(), currentColumns: vi.fn(),
  recordChangesBulk: vi.fn(), listColumns: vi.fn(async () => []),
}));
vi.mock('@/services/views.service', async (orig) => ({ ...(await orig<object>()), listViews: vi.fn(async () => []) }));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { inspectTable } from '../services/inspector.service';
import ObjectInspector from './ObjectInspector';

const COL = { id: 'c1', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0, description: 'vieja' };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Monta el inspector de tabla con la columna c1 elegida; devuelve su guardado
 *  de columna y la working copy (`server`). */
async function mountInspector() {
  useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
  const w = { server: { ...COL }, view: { id: 'v1', name: 'V', tableId: 't1', sources: [{ tableId: 't1', column: 'NOMBRE' }] } };
  vi.mocked(gov.updateColumn).mockImplementation(async (c) => { await sleep(5); w.server = { ...(c as typeof COL) }; return {} as never; });
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    await sleep(5);
    for (const ch of changes) {
      if (ch.collection === 'views') w.view = structuredClone(ch.payload) as typeof w.view;
      else w.server = { ...(ch.payload as unknown as typeof COL) };
    }
    return undefined as never;
  });
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [structuredClone(w.view)] as never);
  vi.mocked(inspectTable).mockImplementation(async () => ({
    table: { id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' }, columns: [{ ...w.server }], links: [], views: [], usage: [],
  }) as never);
  h.state = { inspect: { kind: 'table', id: 't1', colId: 'c1' }, activeSaId: null, viewMode: 'physical', naming: {}, diagram: null,
    openInspector: vi.fn(), closeInspector: vi.fn(), openCanvasAndFocus: vi.fn(), reload: vi.fn(async () => undefined), markDirty: vi.fn(),
    bumpExplorer: vi.fn(), deleteTable: vi.fn(), deleteColumn: vi.fn(), loadNaming: vi.fn() };
  resetFake();
  const outer = ObjectInspector();
  const ti = [...walk(outer)].find((e: El) => (e.props as { target?: unknown }).target)!;
  const TableInspector = ti.type as (p: unknown) => unknown;
  resetFake();
  TableInspector(ti.props);
  runEffects();
  await sleep(10);                                   // llegó la ficha
  const states = nextStates();
  resetFake((init, i) => (i < states.length ? states[i] : init), { keepRefs: true });
  const tree = TableInspector(ti.props);
  const detail = [...walk(tree)].find((e: El) => typeof e.props.onPatch === 'function' && (e.props as { col?: { id: string } }).col?.id === 'c1')!;
  return { onPatch: detail.props.onPatch as (id: string, f: Record<string, unknown>) => Promise<void>, w };
}

describe('Object Inspector: guardados de una misma columna', () => {
  beforeEach(() => { vi.clearAllMocks(); h.q.clear(); });

  it('dos pedidos con la misma ficha: el segundo arma su documento con lo que dejó el primero', async () => {
    const { onPatch, w } = await mountInspector();
    await Promise.all([onPatch('c1', { description: 'nueva' }), onPatch('c1', { physicalName: 'NOMBRE_X' })]);
    expect(w.server).toMatchObject({ description: 'nueva', physicalName: 'NOMBRE_X' });
  });

  it('renombrar el físico re-apunta la vista en el mismo lote; dos renombres seguidos la dejan en el último (P9)', async () => {
    const { onPatch, w } = await mountInspector();
    await Promise.all([onPatch('c1', { physicalName: 'NOMBRE_1' }), onPatch('c1', { physicalName: 'NOMBRE_2' })]);
    expect(w.server.physicalName).toBe('NOMBRE_2');
    expect(w.view.sources.map((x) => x.column)).toEqual(['NOMBRE_2']);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls.map(([ch]) => ch.map((c) => c.collection)))
      .toEqual([['canonical_columns', 'views'], ['canonical_columns', 'views']]);
  });
});
