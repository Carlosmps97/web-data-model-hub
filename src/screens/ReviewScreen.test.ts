// Review sin DOM (hooks de mentira: ver features/reporting/components/fakeReact.testutil).
// Doc 105 (F5): con `refreshMe` los permisos cambian sin recargar, pero Review
// leía `useAuthStore((s) => s.has)` — la MISMA función siempre—, así que zustand
// no la re-renderizaba: «View in canvas» seguía con los permisos viejos.
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
vi.mock('@/services/projects.service', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'MODELO DDV' }]) }));
vi.mock('@/services/versioning.service', async (orig) => ({
  ...(await orig<object>()),
  listVersions: vi.fn(), listUserNames: vi.fn(async () => []), getChangeset: vi.fn(), getDiff: vi.fn(),
}));
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: (pick: (s: unknown) => unknown) =>
    pick({ user: { id: 'carla', name: 'Carla', initials: 'CA' }, openModel: vi.fn() }),
}));
/** Store de auth de mentira con la forma del real (`has` estable que lee el
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
import { REVIEW_CANVAS_DENIED } from '@/screens/review/requestState';
import ReviewScreen from './ReviewScreen';

// Un request EN REVISIÓN de ana con beto de revisor; mira carla (ni dueña ni revisora).
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
/** Monta Review con `?id=v1` y espera las listas y el detalle. */
async function open() {
  render(false);
  await vi.waitFor(() => expect(getDiff).toHaveBeenCalled());
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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

describe('Review: permisos al día sin recargar (doc 105, F5)', () => {
  it('refreshMe le da versions.view_all a carla: Review se re-renderiza y «View in canvas» se habilita', async () => {
    let tree = await open();
    expect(canvasBtn(tree).props.disabled).toBe(true);
    expect(canvasBtn(tree).props['aria-label']).toBe(`View in canvas: ${REVIEW_CANVAS_DENIED}`);
    const before = auth.api.getState();
    auth.api.setState({ user: { username: 'carla', permissions: { 'versions.view_all': true } } });   // refreshMe
    const after = auth.api.getState();
    // zustand re-renderiza sólo si algún selector devuelve otra cosa: con `s.has`, nunca.
    expect([...auth.selectors].some((pick) => !Object.is(pick(before), pick(after)))).toBe(true);
    tree = render(true);
    expect(canvasBtn(tree).props.disabled).toBe(false);
    expect(canvasBtn(tree).props['aria-label']).toBeUndefined();
  });
});
