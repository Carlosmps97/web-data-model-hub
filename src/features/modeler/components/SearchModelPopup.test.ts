// «Search the model» sin DOM (hooks de mentira: ver features/reporting/components/fakeReact.testutil).
// Doc 105 (R11): Enter = Locate del primer hit CIERRA el popup en su keydown; sin
// preventDefault, el keypress de ese mismo Enter «clicaba» al botón que lo había
// abierto — el popup se reabría (o, abierto con ⌘K tras un clic en Undo, se
// ejecutaba Undo: se perdía un cambio del modelo).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const store = vi.hoisted(() => ({
  activeSaId: 'sa1', viewMode: 'physical', activeProjectId: 'p1', projects: [],
  diagram: { subjectArea: { id: 'sa1', name: 'Clientes', projectId: 'p1', folderId: null } },
  openCanvasAndFocus: vi.fn(async () => undefined), openInspector: vi.fn(),
}));
vi.mock('@/store/useModelerStore', () => ({ useModelerStore: (pick: (s: unknown) => unknown) => pick(store) }));
vi.mock('@/store/useSessionStore', () => ({ useSessionStore: (pick: (s: unknown) => unknown) => pick({ activeProjectId: 'p1' }) }));
vi.mock('@/services/governance.service', () => ({ searchModel: vi.fn(async () => null) }));
vi.mock('../services/structure.service', () => ({ listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []) }));
import SearchModelPopup from './SearchModelPopup';

/** Un resultado con UNA tabla en el canvas abierto: Enter la ubica. */
const RESULT = {
  tables: [{ id: 't1', physicalName: 'CLIENTE', logicalName: 'cliente', canvases: [{ id: 'sa1', name: 'Clientes', projectId: 'p1' }] }],
  columns: [], definitions: [], limit: 20, offset: 0, next: { tables: null, columns: null, definitions: null },
};

beforeEach(() => { vi.clearAllMocks(); });

describe('Search the model: el Enter que ubica el primer hit no reactiva a quien lo abrió (doc 105, R11)', () => {
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
