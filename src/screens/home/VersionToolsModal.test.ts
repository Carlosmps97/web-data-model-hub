// Version tools (Home) sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil).
// Doc 105:
//  · F5 — con `refreshMe` los permisos cambian sin recargar, pero el popup leía
//    `useAuthStore((s) => s.has)`: la MISMA función siempre, así que zustand no
//    lo re-renderizaba y los botones seguían con los permisos viejos.
//  · A5-o5 — el motivo de un botón deshabilitado (Transfer / Delete / Open in
//    canvas) estaba sólo en `title`; ahora también en su nombre accesible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangesetDetail, VersionRow } from '@/types/versioning';
import { byText, nextStates, resetFake, runEffects, walk, textOf } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/dialogs', () => ({ confirmDialog: vi.fn() }));
vi.mock('@/screens/review/DiffExplorer', () => ({ default: () => null }));
vi.mock('@/services/versioning.service', async (orig) => ({
  ...(await orig<object>()),
  getChangeset: vi.fn(), compareVersions: vi.fn(), compareVersionDetails: vi.fn(), deleteVersion: vi.fn(),
}));
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: (pick: (s: unknown) => unknown) => pick({ openModel: vi.fn() }),
}));
/** Store de auth de mentira con la MISMA forma que el real: `has` se crea una
 *  vez y lee el estado vigente; `setState` mezcla (como `set` de zustand).
 *  Anota los selectores del último render: zustand re-renderiza un componente
 *  sólo si alguno devuelve otra cosa (Object.is). */
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

import { getChangeset, OPEN_VERSION_DENIED } from '@/services/versioning.service';
import { versionActionBlock } from '@/lib/versionAdmin';
import VersionToolsModal from './VersionToolsModal';

const ROW: VersionRow = {
  id: 'v1', versionLabel: 'v7', title: 'Nuevas tablas', owner: 'ana', status: 'draft', projectId: 'p1',
  deletesProject: false, reviewers: [], createdAt: '2026-09-29T10:00:00Z',
};
const DETAIL: ChangesetDetail = {
  id: 'v1', title: 'Nuevas tablas', owner: 'ana', status: 'draft', versionLabel: 'v7', projectId: 'p1',
  reviewers: [], approvals: {}, comments: [], changeCount: 3,
};

let props: Parameters<typeof VersionToolsModal>[0];
function render(keepRefs: boolean) {
  const next = keepRefs ? nextStates() : null;
  resetFake(next ? (_init, i) => next[i] : null, { keepRefs });
  auth.selectors.clear();
  const tree = VersionToolsModal(props);
  runEffects();
  return tree;
}
/** Abre «Version details» de v7 (un draft de ana) y espera la lectura. */
async function openDetails(detail: ChangesetDetail = DETAIL) {
  vi.mocked(getChangeset).mockResolvedValue(detail);
  props = {
    versions: [{ ...ROW, status: detail.status }], users: [], projects: [{ id: 'p1', name: 'MODELO DDV' } as never],
    initialTab: 'details', initialVersionId: 'v1', initialProjectId: 'p1', onClose: vi.fn(), onChanged: vi.fn(),
  };
  render(false);
  await vi.waitFor(() => expect(getChangeset).toHaveBeenCalled());
  await Promise.resolve(); await Promise.resolve();
  return render(true);
}
const labels = (tree: unknown) => [...walk(tree)].filter((e) => e.type === 'button').map((e) => textOf(e).trim());
const asUser = (username: string, permissions: Record<string, boolean>) =>
  auth.api.setState({ user: { username, permissions } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { activeElement: null, body: {}, querySelectorAll: () => [] });
  asUser('carla', {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Version tools: permisos al día sin recargar (doc 105, F5)', () => {
  it('refreshMe le da admin a carla: el popup se re-renderiza y ofrece Transfer/Delete', async () => {
    let tree = await openDetails();
    expect(labels(tree)).not.toContain('Transfer');                 // draft ajeno, sin permisos
    const before = auth.api.getState();
    asUser('carla', { 'admin.manage': true });                      // lo que hace refreshMe: set({ user })
    const after = auth.api.getState();
    // zustand re-renderiza sólo si algún selector devuelve otra cosa: con `s.has`, nunca.
    expect([...auth.selectors].some((pick) => !Object.is(pick(before), pick(after)))).toBe(true);
    tree = render(true);
    expect(labels(tree)).toEqual(expect.arrayContaining(['Transfer', 'Delete']));
    expect(byText(tree, 'button', 'Open in canvas').props.disabled).toBe(false);
  });
});

describe('Version tools: el motivo de un botón deshabilitado es accesible (doc 105, A5-o5)', () => {
  it('Transfer y Delete bloqueados (versión en revisión) llevan el motivo en su nombre accesible', async () => {
    asUser('carla', { 'admin.manage': true });
    const submitted = { ...DETAIL, status: 'submitted' as const, reviewers: ['beto'] };
    const tree = await openDetails(submitted);
    const transfer = byText(tree, 'button', 'Transfer');
    const del = byText(tree, 'button', 'Delete');
    expect(transfer.props.disabled).toBe(true);
    expect(transfer.props['aria-label']).toBe(`Transfer: ${versionActionBlock(submitted, 'transfer')}`);
    expect(del.props.disabled).toBe(true);
    expect(del.props['aria-label']).toBe(`Delete: ${versionActionBlock(submitted, 'delete')}`);
  });

  it('Open in canvas deshabilitado también; habilitados, el nombre es sólo su texto', async () => {
    let tree = await openDetails();                                  // carla sin permisos: no puede abrir el draft de ana
    const open = byText(tree, 'button', 'Open in canvas');
    expect(open.props.disabled).toBe(true);
    expect(open.props['aria-label']).toBe(`Open in canvas: ${OPEN_VERSION_DENIED}`);
    asUser('ana', { 'model.edit': true });                           // su dueña: todo habilitado
    tree = await openDetails();
    for (const name of ['Transfer', 'Delete', 'Open in canvas']) {
      expect(byText(tree, 'button', name).props.disabled).toBe(false);
      expect(byText(tree, 'button', name).props['aria-label']).toBeUndefined();
    }
  });
});
