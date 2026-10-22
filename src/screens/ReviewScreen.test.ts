// Review sin DOM (hooks simulados: ver features/reporting/components/fakeReact.testutil).
// El contenido de un request ajeno (detalle, diff, comentarios) solo lo ven su
// dueño, sus revisores asignados y quien tenga `versions.view_all` o
// `admin.manage`. Con `refreshMe` los permisos cambian sin recargar: leer
// `useAuthStore((s) => s.has)` no basta (devuelve siempre la misma función y
// zustand no re-renderizaría).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangesetDetail, ChangesetDiff, VersionRow } from '@/types/versioning';
import { byText, nextStates, resetFake, runEffects } from '../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams('id=v1'), vi.fn()],
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/dialogs', () => ({ confirmDialog: vi.fn() }));
vi.mock('@/store/useBusyStore', () => ({ runBlocking: vi.fn() }));
vi.mock('@/services/projects.service', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'Modelo Ventas' }]) }));
vi.mock('@/services/versioning.service', async (orig) => ({
  ...(await orig<object>()),
  listVersions: vi.fn(), listUserNames: vi.fn(async () => []), getChangeset: vi.fn(), getDiff: vi.fn(),
}));
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: (pick: (s: unknown) => unknown) =>
    pick({ user: { id: 'carla', name: 'Carla', initials: 'CA' }, openModel: vi.fn() }),
}));
/** Store de auth simulado con la forma del real (`has` estable que lee el
 *  estado vigente); anota los selectores del último render. */
const auth = vi.hoisted(() => {
  type State = { user: { username: string; permissions: Record<string, boolean> } | null; has: (p: string) => boolean };
  const selectors = new Set<(s: State) => unknown>();
  let state: State;
  const api = {
    getState: () => state,
    setState: (patch: Partial<State>) => { state = { ...state, ...patch }; },
  };
  state = { user: null, has: (p) => Boolean(api.getState().user?.permissions?.[p]) };
  return { selectors, api };
});
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (pick: (s: unknown) => unknown) => { auth.selectors.add(pick); return pick(auth.api.getState()); },
}));

import { getChangeset, getDiff, listVersions } from '@/services/versioning.service';
import ReviewScreen from './ReviewScreen';

// Un request en revisión de ana con beto de revisor; mira carla (ni dueña ni revisora).
const ROW: VersionRow = {
  id: 'v1', versionLabel: 'v7', title: 'Nuevas tablas', owner: 'ana', status: 'submitted', projectId: 'p1',
  deletesProject: false, reviewers: ['beto'], submittedAt: '2026-09-29T10:00:00Z',
};
const DETAIL: ChangesetDetail = {
  id: 'v1', title: 'Nuevas tablas', owner: 'ana', status: 'submitted', versionLabel: 'v7', projectId: 'p1',
  reviewers: ['beto'], approvals: {}, comments: [], submittedAt: '2026-09-29T10:00:00Z',
};
const DIFF = { collections: {}, impact: { deletesProject: null } } as unknown as ChangesetDiff;

function render(keepRefs: boolean) {
  const next = keepRefs ? nextStates() : null;
  resetFake(next ? (_init, i) => next[i] : null, { keepRefs });
  auth.selectors.clear();
  const tree = ReviewScreen();
  runEffects();
  return tree;
}
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}
/** Monta Review con `?id=v1` y espera las listas. */
async function open() {
  render(false);
  await vi.waitFor(() => expect(listVersions).toHaveBeenCalled());
  await settle();
  return render(true);
}
const canvasBtn = (tree: unknown) => byText(tree, 'button', 'View in canvas');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVersions).mockResolvedValue([ROW]);
  vi.mocked(getChangeset).mockResolvedValue(DETAIL);
  vi.mocked(getDiff).mockResolvedValue(DIFF);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  auth.api.setState({ user: { username: 'carla', permissions: {} } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Review: contenido de requests ajenos', () => {
  it('sin permiso muestra la fila con el aviso y no pide el detalle', async () => {
    const tree = await open();
    expect(byText(tree, null, 'Nuevas tablas')).toBeTruthy();
    expect(() => canvasBtn(tree)).toThrow();
    expect(getChangeset).not.toHaveBeenCalled();
    expect(getDiff).not.toHaveBeenCalled();
  });

  it('el revisor asignado ve el detalle', async () => {
    vi.mocked(listVersions).mockResolvedValue([{ ...ROW, reviewers: ['beto', 'carla'] }]);
    vi.mocked(getChangeset).mockResolvedValue({ ...DETAIL, reviewers: ['beto', 'carla'] });
    await open();
    await vi.waitFor(() => expect(getDiff).toHaveBeenCalledWith('v1'));
  });

  it('refreshMe le da versions.view_all a carla: Review se re-renderiza, pide el detalle y habilita «View in canvas»', async () => {
    await open();
    const before = auth.api.getState();
    auth.api.setState({ user: { username: 'carla', permissions: { 'versions.view_all': true } } });   // refreshMe
    const after = auth.api.getState();
    // zustand re-renderiza solo si algún selector devuelve otra cosa: con `s.has`, nunca.
    expect([...auth.selectors].some((pick) => !Object.is(pick(before), pick(after)))).toBe(true);
    render(true);
    await vi.waitFor(() => expect(getDiff).toHaveBeenCalledWith('v1'));
    await settle();
    const tree = render(true);
    expect(canvasBtn(tree).props.disabled).toBe(false);
    expect(canvasBtn(tree).props['aria-label']).toBeUndefined();
  });
});
