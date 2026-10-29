// «Paste columns» sin DOM (hooks simulados: ver
// features/reporting/components/fakeReact.testutil): lo copiado en otro
// proyecto nombra su origen, se revisa con los estándares de los dos y deja la
// procedencia con el proyecto; lo del mismo proyecto no lee otros estándares.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, nextStates, resetFake, runEffects, textOf, unmount, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const { STATE, HOLDS, recordChangesBulk, loadSourceStandards, markDirty, reload } = vi.hoisted(() => ({
  HOLDS: { v: true },
  markDirty: vi.fn(),
  reload: vi.fn(async () => undefined),
  STATE: {
    diagram: {
      tables: [{ id: 'tgt', physicalName: 'T_DESTINO', logicalName: 'Destino' }],
      columns: [] as unknown[],
      relationships: [] as unknown[],
    },
    colClipboard: null as unknown,
    viewMode: 'physical',
  },
  recordChangesBulk: vi.fn<(changes: unknown[]) => Promise<void>>(async () => undefined),
  loadSourceStandards: vi.fn<(projectId: string) => Promise<unknown>>(async () => null),
}));
vi.mock('@/store/useModelerStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick(STATE);
  hook.getState = () => ({ ...STATE, markDirty, reload });
  return { useModelerStore: hook };
});
vi.mock('@/store/useSessionStore', () => ({
  sessionProjectId: () => 'p1',
  useSessionStore: (pick: (s: unknown) => unknown) => pick({ activeProjectId: 'p1' }),
}));
vi.mock('@/store/useUndoStore', () => ({ pushUndo: vi.fn(), historyAction: <T,>(action: () => Promise<T>) => action() }));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('@/services/governance.service', async (importOriginal) => ({
  ...(await importOriginal<object>()), listDomains: vi.fn(async () => []), recordChangesBulk,
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => null) }));
vi.mock('../services/pasteSource.service', () => ({ loadSourceStandards }));
vi.mock('../lib/viewSync', () => ({ syncNewColumnsToMirrorViews: vi.fn(async () => undefined) }));
vi.mock('../lib/pinnedWrites', () => ({ pinnedViewDeps: vi.fn(), columnsBatchStep: vi.fn() }));
vi.mock('../lib/sessionGuard', () => ({
  pinSession: () => ({ check: () => undefined, holds: () => HOLDS.v }),
  reportWriteError: (r: (e: unknown) => void) => async (e: unknown) => r(e),
}));
import PasteColumnsPopup from './PasteColumnsPopup';

// «Owner» con otro id en cada proyecto.
const owner = (id: string) => ({ id, name: 'Owner', level: 'column', view: 'physical', dataType: 'string', allowedValues: [] });
const SRC_STD = { udpDefs: [owner('src-o')], domains: [], themes: [] };
const TARGET = { udpDefs: [owner('dst-o')], domains: [], themes: [], schemas: [], naming: null };
const clipFrom = (projectId: string, projectName: string) => ({
  source: { logicalName: 'Cliente', physicalName: 'M_CLIENTE', projectId, projectName },
  cols: [{ id: 'c1', tableId: 't1', physicalName: 'COD', logicalName: 'Cod', dataType: 'STRING', typeOverridden: false, ordinal: 0,
    udpValues: { 'src-o': 'Juan' } }],
});

const mount = () => PasteColumnsPopup({ targetId: 'tgt', onClose: vi.fn(), pushToast: vi.fn() });
/** Con la revisión ya cargada: `target` y `source` son el 3.º y 4.º useState. */
function ready(source: unknown) {
  resetFake((init, i) => (i === 2 ? TARGET : i === 3 ? source : init));
  return mount();
}
const created = () => (recordChangesBulk.mock.calls[0][0] as { payload: Record<string, unknown>; origin?: unknown }[])[0];

beforeEach(() => {
  HOLDS.v = true;
  markDirty.mockClear();
  reload.mockClear();
  recordChangesBulk.mockClear();
  loadSourceStandards.mockReset();
  loadSourceStandards.mockResolvedValue(SRC_STD);
});

describe('PasteColumnsPopup — copiado en otro proyecto', () => {
  it('el subtítulo nombra el proyecto de origen y la revisión lee sus estándares', async () => {
    STATE.colClipboard = clipFrom('p2', 'Piloto');
    resetFake();
    expect(mount()!.props.subtitle).toBe('M_CLIENTE from «Piloto» → T_DESTINO');
    runEffects();
    await vi.waitFor(() => expect(nextStates()[3]).toEqual({ same: false, standards: SRC_STD }));
    expect(loadSourceStandards).toHaveBeenCalledWith('p2');
  });

  it('confirmar graba los UDP con los ids del destino y la procedencia con el proyecto', async () => {
    STATE.colClipboard = clipFrom('p2', 'Piloto');
    (byText(ready({ same: false, standards: SRC_STD }), 'button', 'Paste 1 column').props.onClick as () => void)();
    await vi.waitFor(() => expect(recordChangesBulk).toHaveBeenCalledTimes(1));
    expect(created().payload.udpValues).toEqual({ 'dst-o': 'Juan' });
    expect(created().origin).toEqual({ kind: 'paste-columns', sourceTable: 'M_CLIENTE', sourceColumn: 'COD', sourceProject: 'Piloto' });
  });

  it('sin el nombre del proyecto de origen, la procedencia lleva su id (como el pegado de tablas)', async () => {
    STATE.colClipboard = clipFrom('p2', '');
    (byText(ready({ same: false, standards: SRC_STD }), 'button', 'Paste 1 column').props.onClick as () => void)();
    await vi.waitFor(() => expect(recordChangesBulk).toHaveBeenCalledTimes(1));
    expect(created().origin).toMatchObject({ sourceProject: 'p2' });
  });

  it('sin los estándares del origen lo avisa y deja pegar lo demás', () => {
    STATE.colClipboard = clipFrom('p2', 'Piloto');
    const tree = ready({ same: false, standards: null });
    // Los avisos los pinta PasteDetails (no se invoca): se leen de la revisión que recibe.
    const details = [...walk(tree)].find((e) => 'review' in e.props)!;
    expect((details.props.review as { warnings: string[] }).warnings)
      .toEqual(expect.arrayContaining([expect.stringContaining("The standards of «Piloto» can't be read")]));
    expect(byText(tree, 'button', 'Paste 1 column').props.disabled).toBe(false);
  });

  it('otra falla al leer los estándares del origen: el error con Retry', async () => {
    STATE.colClipboard = clipFrom('p2', 'Piloto');
    loadSourceStandards.mockRejectedValueOnce(new Error('Network error'));
    resetFake();
    mount();
    runEffects();
    await vi.waitFor(() => expect(nextStates()[4]).toBe('Network error'));
    resetFake((init, i) => (i === 4 ? 'Network error' : init));
    const tree = mount()!;
    expect(textOf(tree)).toContain("Couldn't read the standards");
    expect(byText(tree, 'button', 'Retry')).toBeTruthy();
  });

  it('un clipboard sin proyecto de origen se trata como del mismo proyecto', async () => {
    STATE.colClipboard = { ...clipFrom('p1', ''), source: { logicalName: 'Cliente', physicalName: 'M_CLIENTE' } };
    resetFake();
    expect(mount()!.props.subtitle).toBe('M_CLIENTE → T_DESTINO');
    runEffects();
    await vi.waitFor(() => expect(nextStates()[3]).toEqual({ same: true, standards: null }));
    expect(loadSourceStandards).not.toHaveBeenCalled();
  });

  it('la respuesta que llega después de cerrar el popup no escribe', async () => {
    STATE.colClipboard = clipFrom('p2', 'Piloto');
    let release!: (v: unknown) => void;
    loadSourceStandards.mockReturnValueOnce(new Promise((r) => { release = r; }));
    resetFake();
    mount();
    runEffects();
    unmount();
    release(SRC_STD);
    await new Promise((r) => setTimeout(r, 0));
    expect(nextStates()[3]).toBeNull();
  });

  it('si la sesión cambió durante el pegado, no marca cambios ni recarga ni avisa en la nueva', async () => {
    STATE.colClipboard = clipFrom('p1', 'Modelo Piloto');
    HOLDS.v = false;
    const pushToast = vi.fn();
    const onClose = vi.fn();
    resetFake((init, i) => (i === 2 ? TARGET : i === 3 ? { same: true, standards: null } : init));
    const tree = PasteColumnsPopup({ targetId: 'tgt', onClose, pushToast });
    (byText(tree, 'button', 'Paste 1 column').props.onClick as () => void)();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pushToast).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('si la sesión cambia mientras recarga, no avisa en la nueva', async () => {
    STATE.colClipboard = clipFrom('p1', 'Modelo Piloto');
    reload.mockImplementationOnce(async () => { HOLDS.v = false; });
    const pushToast = vi.fn();
    const onClose = vi.fn();
    resetFake((init, i) => (i === 2 ? TARGET : i === 3 ? { same: true, standards: null } : init));
    const tree = PasteColumnsPopup({ targetId: 'tgt', onClose, pushToast });
    (byText(tree, 'button', 'Paste 1 column').props.onClick as () => void)();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('del mismo proyecto no lee otros estándares, no nombra el origen ni lo pone en la procedencia', async () => {
    STATE.colClipboard = clipFrom('p1', 'Modelo Piloto');
    resetFake();
    expect(mount()!.props.subtitle).toBe('M_CLIENTE → T_DESTINO');
    runEffects();
    await vi.waitFor(() => expect(nextStates()[3]).toEqual({ same: true, standards: null }));
    expect(loadSourceStandards).not.toHaveBeenCalled();

    (byText(ready({ same: true, standards: null }), 'button', 'Paste 1 column').props.onClick as () => void)();
    await vi.waitFor(() => expect(recordChangesBulk).toHaveBeenCalledTimes(1));
    expect(created().origin).toEqual({ kind: 'paste-columns', sourceTable: 'M_CLIENTE', sourceColumn: 'COD' });
  });
});
