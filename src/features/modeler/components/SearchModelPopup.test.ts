// «Search the model» sin DOM (hooks simulados: ver features/reporting/components/fakeReact.testutil).
// Enter = Locate del primer hit cierra el popup en su keydown; sin preventDefault,
// el keypress de ese mismo Enter «clicaría» al botón que lo abrió: el popup se
// reabriría (o, abierto con ⌘K tras un clic en Undo, se ejecutaría Undo y se
// perdería un cambio del modelo).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, resetFake, runEffects, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const store = vi.hoisted(() => ({
  activeSaId: 'sa1', viewMode: 'physical', activeProjectId: 'p1', projects: [],
  diagram: { subjectArea: { id: 'sa1', name: 'Clientes', projectId: 'p1', folderId: null } },
  openCanvasAndFocus: vi.fn(async () => undefined), openInspector: vi.fn(),
}));
vi.mock('@/store/useModelerStore', () => ({ useModelerStore: (pick: (s: unknown) => unknown) => pick(store) }));
vi.mock('@/store/useSessionStore', () => ({ useSessionStore: (pick: (s: unknown) => unknown) => pick({ activeProjectId: 'p1' }) }));
vi.mock('@/services/governance.service', () => ({ searchModel: vi.fn(async () => RESULT) }));
vi.mock('../services/structure.service', () => ({ listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []) }));
import { searchModel } from '@/services/governance.service';
import SearchModelPopup from './SearchModelPopup';

/** Un resultado con una sola tabla en el canvas abierto: Enter la ubica. */
const RESULT = vi.hoisted(() => ({
  tables: [{ id: 't1', physicalName: 'CLIENTE', logicalName: 'cliente', canvases: [{ id: 'sa1', name: 'Clientes', projectId: 'p1' }] }],
  columns: [], definitions: [], views: [], limit: 20, offset: 0,
  next: { tables: null, columns: null, definitions: null, views: null },
}));
/** Solo una vista, en otro canvas del proyecto. */
const VIEW_RESULT = {
  ...RESULT, tables: [],
  views: [{ id: 'v1', name: 'VW_CLIENTE', schema: 'core_vu', sourceTables: ['core.CLIENTE', 'core.CUENTA'], columnCount: 4,
    custom: false, canvases: [{ id: 'sa2', name: 'Ventas', projectId: 'p1' }] }],
};

beforeEach(() => { vi.clearAllMocks(); store.viewMode = 'physical'; });

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const scopeTabs = (tree: unknown) => [...walk(tree)].filter((e) => e.props.role === 'tab').map((e) => textOf(e));
/** Render con estados iniciales a medida (`at[i]` = valor del useState número i). */
const render = (at: Record<number, unknown> = {}, onClose = vi.fn()) => {
  resetFake((init, i) => (i in at ? at[i] : init));
  return SearchModelPopup({ onClose, pushToast: vi.fn() });
};

describe('Search the model: el Enter que ubica el primer hit no reactiva a quien lo abrió', () => {
  it('Enter con un hit: preventDefault, cierra y centra', () => {
    resetFake((init, i) => (i === 2 ? RESULT : init));          // `res` = 3.er useState
    const onClose = vi.fn();
    const tree = SearchModelPopup({ onClose, pushToast: vi.fn() });
    const input = [...walk(tree)].find((e: El) => e.type === 'input' && e.props['aria-label'] === 'Search the model')!;
    const enter = { key: 'Enter', preventDefault: vi.fn() };
    (input.props.onKeyDown as (e: unknown) => void)(enter);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(store.openCanvasAndFocus).toHaveBeenCalledWith('sa1', 'p1', 't1', undefined, 'CLIENTE');
    expect(enter.preventDefault).toHaveBeenCalled();
  });
});

describe('Search the model: vistas (solo modelo físico)', () => {
  it('en físico el alcance Views existe; en lógico no', () => {
    expect(scopeTabs(render())).toEqual(['All', 'Tables / entities', 'Columns / attributes', 'Definitions', 'Views']);
    store.viewMode = 'logical';
    expect(scopeTabs(render())).toEqual(['All', 'Tables / entities', 'Columns / attributes', 'Definitions']);
  });

  it('«All» pide el grupo de vistas solo en físico', async () => {
    render({ 0: 'cliente' });
    runEffects();
    await tick(320);
    expect(searchModel).toHaveBeenLastCalledWith('cliente', expect.objectContaining({ scope: 'all', views: true }));
    store.viewMode = 'logical';
    render({ 0: 'cliente' });
    runEffects();
    await tick(320);
    expect(searchModel).toHaveBeenLastCalledWith('cliente', expect.objectContaining({ scope: 'all', views: false }));
  });

  it('en lógico, un alcance Views que quedó elegido vuelve a All', () => {
    store.viewMode = 'logical';
    render({ 1: 'views' });
    runEffects();
    expect(fake.states[1].calls).toContain('all');
  });

  it('la fila de una vista: esquema.nombre, fuentes y columnas; Locate la centra en su canvas e Inspect abre su ficha', () => {
    const onClose = vi.fn();
    const tree = render({ 2: VIEW_RESULT }, onClose);
    // `Hl` (el resaltado) es un componente: su texto va en la prop `text`.
    const row = [...walk(tree)].find((e) => e.props.className === 'wk-srch-row' && (e as unknown as { key: string }).key === 'v:v1')!;
    expect([...walk(row)].some((e) => e.props.text === 'core_vu.VW_CLIENTE')).toBe(true);
    expect(textOf(row)).toContain('view of core.CLIENTE, core.CUENTA · 4 columns');
    const locate = [...walk(row)].find((e) => e.type === 'button' && textOf(e).includes('Locate'))!;
    (locate.props.onClick as (e: unknown) => void)({ stopPropagation: vi.fn() });
    expect(store.openCanvasAndFocus).toHaveBeenCalledWith('sa2', 'p1', 'v1', undefined, 'VW_CLIENTE');
    const inspect = [...walk(row)].find((e) => e.type === 'button' && textOf(e).includes('Inspect'))!;
    (inspect.props.onClick as (e: unknown) => void)({ stopPropagation: vi.fn() });
    expect(store.openInspector).toHaveBeenCalledWith({ kind: 'view', id: 'v1' });
  });

  it('Enter con solo una vista la ubica', () => {
    const onClose = vi.fn();
    const tree = render({ 2: VIEW_RESULT }, onClose);
    const input = [...walk(tree)].find((e: El) => e.type === 'input' && e.props['aria-label'] === 'Search the model')!;
    (input.props.onKeyDown as (e: unknown) => void)({ key: 'Enter', preventDefault: vi.fn() });
    expect(store.openCanvasAndFocus).toHaveBeenCalledWith('sa2', 'p1', 'v1', undefined, 'VW_CLIENTE');
  });
});
