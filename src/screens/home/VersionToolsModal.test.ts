// Version tools (Home) sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil).
//  · Con `refreshMe` los permisos cambian sin recargar: leer
//    `useAuthStore((s) => s.has)` no basta (es siempre la misma función, zustand
//    no re-renderizaría y los botones se quedarían con los permisos anteriores).
//  · El motivo de un botón deshabilitado (Transfer / Delete / Open in canvas) va
//    en `title` y también en su nombre accesible.
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
/** Store de auth simulado con la misma forma que el real: `has` se crea una
 *  vez y lee el estado vigente; `setState` mezcla (como `set` de zustand).
 *  Anota los selectores del último render: zustand re-renderiza un componente
 *  solo si alguno devuelve otra cosa (Object.is). */
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
    versions: [{ ...ROW, status: detail.status }], users: [], projects: [{ id: 'p1', name: 'MODELO VENTAS' } as never],
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

describe('Version tools: permisos al día sin recargar', () => {
  it('refreshMe le da admin a carla: el popup se re-renderiza y ofrece Transfer/Delete', async () => {
    let tree = await openDetails();
    expect(labels(tree)).not.toContain('Transfer');                 // draft ajeno, sin permisos
    const before = auth.api.getState();
    asUser('carla', { 'admin.manage': true });                      // lo que hace refreshMe: set({ user })
    const after = auth.api.getState();
    // zustand re-renderiza solo si algún selector devuelve otra cosa: con `s.has`, nunca.
    expect([...auth.selectors].some((pick) => !Object.is(pick(before), pick(after)))).toBe(true);
    tree = render(true);
    expect(labels(tree)).toEqual(expect.arrayContaining(['Transfer', 'Delete']));
    expect(byText(tree, 'button', 'Open in canvas').props.disabled).toBe(false);
  });
});

describe('Version tools: el motivo de un botón deshabilitado es accesible', () => {
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

  it('Open in canvas deshabilitado también; habilitados, el nombre es solo su texto', async () => {
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

describe('Version tools: los combos muestran el código con el correo de su dueño', () => {
  const V = (o: Partial<VersionRow>): VersionRow => ({ ...ROW, ...o });
  const ROWS: VersionRow[] = [
    V({ id: 'b', versionLabel: 'v20261020090000', title: 'v20261020090000', owner: 'system', status: 'approved',
      appliedAt: '2026-10-20T14:00:00Z', createdAt: '2026-10-20T14:00:00Z' }),
    V({ id: 'c', versionLabel: 'v20261021101500', title: 'Nuevas tablas', owner: 'ana@bcp.com.pe', status: 'approved',
      appliedAt: '2026-10-22T15:00:00Z', createdAt: '2026-10-21T15:15:00Z' }),
    V({ id: 'd', versionLabel: 'v20261026143005', title: 'v20261026143005', owner: 'beto@bcp.com.pe', status: 'draft',
      createdAt: '2026-10-26T19:30:05Z' }),
    V({ id: 'e', versionLabel: 'v20261025080000', title: null, owner: null, status: 'submitted',
      createdAt: '2026-10-25T13:00:00Z' }),
  ];
  const options = (tree: unknown, id: string) => {
    const select = [...walk(tree)].find((e) => e.type === 'select' && e.props.id === id);
    return [...walk(select)].filter((e) => e.type === 'option').map((e) => textOf(e));
  };
  const open = (initialTab: 'compare' | 'details') => {
    vi.mocked(getChangeset).mockResolvedValue({ ...DETAIL, id: 'c' });
    props = {
      versions: ROWS, users: [{ id: 'ana@bcp.com.pe', name: 'Ana Gómez', initials: 'AG' }],
      projects: [{ id: 'p1', name: 'MODELO VENTAS' } as never], initialTab, initialVersionId: null,
      initialProjectId: 'p1', onClose: vi.fn(), onChanged: vi.fn(),
    };
    return render(false);
  };

  it('Version details: código (correo) — título · estado; el título solo si no repite el código', () => {
    expect(options(open('details'), 'dmh-vt-version')).toEqual([
      'v20261026143005 (beto@bcp.com.pe) · Editing (draft)',
      'v20261025080000 · In review',
      'v20261021101500 (ana@bcp.com.pe) — Nuevas tablas · Production',
      'v20261020090000 (system) · Published',
    ]);
  });

  it('sin dueño, sin código o con título en blanco: ni paréntesis vacíos ni títulos en blanco', () => {
    vi.mocked(getChangeset).mockResolvedValue(DETAIL);
    props = {
      versions: [
        V({ id: 'g', versionLabel: 'v20261020100000', title: '   ', owner: 'ana@bcp.com.pe', status: 'rejected',
          createdAt: '2026-10-20T15:00:00Z' }),
        V({ id: 'h', versionLabel: 'v20261019100000', title: 'Ajustes', owner: '', status: 'draft',
          createdAt: '2026-10-19T15:00:00Z' }),
        V({ id: 'i', versionLabel: null, title: 'Sin código', owner: 'beto@bcp.com.pe', status: 'draft',
          createdAt: '2026-10-18T15:00:00Z' }),
      ],
      users: [], projects: [{ id: 'p1', name: 'MODELO VENTAS' } as never], initialTab: 'details',
      initialVersionId: null, initialProjectId: 'p1', onClose: vi.fn(), onChanged: vi.fn(),
    };
    expect(options(render(false), 'dmh-vt-version')).toEqual([
      'v20261020100000 (ana@bcp.com.pe) · Rejected',
      'v20261019100000 — Ajustes · Editing (draft)',
      '— (beto@bcp.com.pe) — Sin código · Editing (draft)',
    ]);
  });

  it('Compare: los combos se reparten el ancho, bajan de línea si no entran y no fuerzan scroll', () => {
    const tree = open('compare');
    const select = (id: string) => [...walk(tree)].find((e) => e.type === 'select' && e.props.id === id)!;
    const picker = (id: string) => [...walk(tree)].find((e) => e.type === 'div' && e.props.className === 'dmh-vt-picker'
      && [...walk(e.props.children)].some((k) => k.type === 'select' && k.props.id === id))!;
    for (const id of ['dmh-vt-from', 'dmh-vt-to']) {
      expect(picker(id).props.style).toEqual({ flex: '1 1 250px' });
      expect(select(id).props.style).toEqual({ width: '100%', maxWidth: 'none', minWidth: 0 });
    }
    const compare = [...walk(tree)].find((e) => e.type === 'button' && textOf(e).trim() === 'Compare')!;
    expect(String(compare.props.className)).toContain('dmh-vt-compare');      // mismo ancho al pasar a «Comparing…»
  });

  it('Compare (From/To): código (correo) — título · fecha de publicación', () => {
    const tree = open('compare');
    const day = (iso: string) => new Date(iso).toLocaleDateString();
    const expected = [
      `v20261020090000 (system) · ${day('2026-10-20T14:00:00Z')}`,
      `v20261021101500 (ana@bcp.com.pe) — Nuevas tablas · ${day('2026-10-22T15:00:00Z')}`,
    ];
    expect(options(tree, 'dmh-vt-from')).toEqual(expected);
    expect(options(tree, 'dmh-vt-to')).toEqual(expected);
  });
});
