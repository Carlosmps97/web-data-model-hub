// Combo Version del Reporting (wrapper), sin DOM: hooks de mentira de
// `fakeReact.testutil` — montar, correr efectos, re-renderizar como React.
//
// Doc 105 (R2-B5): el re-listado al volver el foco aplicaba CUALQUIER respuesta:
// una lista vieja que llegaba tarde pisaba a la nueva → aviso falso «That version
// is no longer open», vuelta a Production y el draft recién elegido desaparecía
// del combo (lo mismo con la lista inicial). Ahora sólo cuenta la MÁS RECIENTE.
// Doc 105 (A5-o4 por foco): si la versión elegida desaparece al re-listar, el
// aviso dice POR QUÉ (se eliminó, se transfirió o se publicó/cerró) según su cabecera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { ChangesetDetail, VersionRow } from '@/types/versioning';
import { nextStates, resetFake, runEffects, walk } from '../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/services/projects.service', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'MODELO DDV' }]) }));
vi.mock('@/services/versioning.service', () => ({ listVersions: vi.fn(), getChangeset: vi.fn() }));
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (pick: (s: unknown) => unknown) => pick({ user: { username: 'ana' }, has: () => false }),
}));
vi.mock('@/store/useSessionStore', () => ({
  LAST_PROJECT_KEY: 'dmh:lastProject', useSessionStore: { getState: () => ({ activeProjectId: 'p1' }) },
}));
import { toast } from 'sonner';
import { getChangeset, listVersions } from '@/services/versioning.service';
import ReportingScreenWrapper, { ProjectPick, ReportingScreen, VersionPick } from './ReportingScreen';

const row = (over: Partial<VersionRow>): VersionRow => ({
  id: 'x', versionLabel: 'v1', title: null, owner: 'ana', status: 'draft', projectId: 'p1',
  deletesProject: false, reviewers: [], ...over,
});
const PROD = row({ id: 'v12', versionLabel: 'v12', status: 'approved', appliedAt: '2026-09-01', owner: 'luis' });
const DRAFT = row({ id: 'cs-new', versionLabel: 'v13', status: 'draft', owner: 'ana', updatedAt: '2026-09-30' });
const header = (over: Partial<ChangesetDetail>) =>
  ({ id: 'cs-new', title: null, owner: 'ana', status: 'draft', projectId: 'p1', reviewers: [], approvals: {}, comments: [], ...over }) as ChangesetDetail;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Listados de versiones en vuelo, en orden de pedido (0 = el inicial). */
let lists: { resolve: (v: VersionRow[]) => void; reject: (e: unknown) => void }[] = [];
let focusHandlers: (() => void)[] = [];
const focus = () => focusHandlers.at(-1)!();

function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = ReportingScreenWrapper();
  runEffects();
  return tree;
}
/** Monta el wrapper: carga los proyectos y deja en vuelo la lista inicial de versiones. */
async function mount() {
  resetFake();
  ReportingScreenWrapper();
  runEffects();
  await tick();
  return rerender();
}
const screen = (tree: unknown) => [...walk(tree)].find((e) => e.type === ReportingScreen)!;
const versionPick = (tree: unknown) => [...walk(tree)].find((e) => e.type === VersionPick)!;
const pick = (tree: unknown, id: string | null) => (versionPick(tree).props.onPick as (v: string | null) => void)(id);
const offered = (tree: unknown) => (versionPick(tree).props.own as VersionRow[]).map((r) => r.id);

beforeEach(() => {
  vi.clearAllMocks();
  lists = [];
  focusHandlers = [];
  vi.mocked(listVersions).mockImplementation(() => new Promise((resolve, reject) => { lists.push({ resolve, reject }); }));
  vi.stubGlobal('window', {
    addEventListener: (ev: string, fn: () => void) => { if (ev === 'focus') focusHandlers.push(fn); },
    removeEventListener: vi.fn(),
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('combo Version: sólo cuenta el listado más reciente (doc 105 R2-B5)', () => {
  it('un re-listado viejo que llega tarde no avisa, no vuelve a Production ni saca el draft recién elegido', async () => {
    let tree = await mount();
    lists[0].resolve([PROD]);
    await tick();
    tree = rerender();
    focus();                                          // re-listado 1: su respuesta se retrasa
    focus();                                          // re-listado 2: trae el draft creado en otra pestaña
    lists[2].resolve([PROD, DRAFT]);
    await tick();
    tree = rerender();
    pick(tree, 'cs-new');                             // ana elige el draft
    tree = rerender();
    expect(screen(tree).props.changesetId).toBe('cs-new');

    lists[1].resolve([PROD]);                          // llega la lista vieja
    await tick();
    tree = rerender();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(screen(tree).props.changesetId).toBe('cs-new');
    expect(offered(tree)).toEqual(['cs-new']);
    expect(getChangeset).not.toHaveBeenCalled();
  });

  it('la lista INICIAL que llega después de un re-listado no lo pisa', async () => {
    let tree = await mount();                          // lista inicial en vuelo
    focus();
    lists[1].resolve([PROD, DRAFT]);
    await tick();
    tree = rerender();
    lists[0].resolve([PROD]);
    await tick();
    tree = rerender();
    expect(offered(tree)).toEqual(['cs-new']);
  });
});

describe('la versión elegida desaparece al re-listar: el aviso dice por qué (doc 105 A5-o4)', () => {
  async function vanish(read: () => Promise<ChangesetDetail>) {
    let tree = await mount();
    lists[0].resolve([PROD, DRAFT]);
    await tick();
    tree = rerender();
    pick(tree, 'cs-new');
    tree = rerender();
    vi.mocked(getChangeset).mockImplementationOnce(read);
    focus();
    lists[1].resolve([PROD]);
    await tick();
    await tick();
    tree = rerender();
    expect(screen(tree).props.changesetId).toBeNull();          // vuelve a Production
    expect(getChangeset).toHaveBeenCalledWith('cs-new');
    return vi.mocked(toast.warning).mock.calls;
  }

  it('transferida (otro dueño) → «no longer available to you», con el mismo id de toast', async () => {
    expect(await vanish(async () => header({ owner: 'beto' })))
      .toEqual([['This version is no longer available to you — showing Production.', { id: 'dmh-rep-version' }]]);
  });
  it('eliminada (404) → «This version was deleted»', async () => {
    expect(await vanish(() => Promise.reject(new ApiError('Version not found.', 404, 'Version not found.'))))
      .toEqual([['This version was deleted — showing Production.', { id: 'dmh-rep-version' }]]);
  });
  it('publicada / cerrada → el texto de siempre', async () => {
    expect(await vanish(async () => header({ status: 'approved' })))
      .toEqual([['That version is no longer open — showing Production.', { id: 'dmh-rep-version' }]]);
  });
});

// Doc 105 (revisión): un 403 de INFRAESTRUCTURA (HTML del proxy, sin `detail`)
// en una lectura de la versión se anunciaba «no longer available to you» y la
// pantalla saltaba a Production.
describe('un error que no es del backend no cambia de versión (doc 105)', () => {
  it('403 del proxy: re-lista y, si la versión sigue abierta, se queda en ella sin aviso', async () => {
    let tree = await mount();
    lists[0].resolve([PROD, DRAFT]);
    await tick();
    tree = rerender();
    pick(tree, 'cs-new');
    tree = rerender();
    (screen(tree).props.onVersionError as (e: unknown) => void)(new ApiError('Invalid JSON response (HTTP 403)', 403));
    tree = rerender();
    expect(screen(tree).props.changesetId).toBe('cs-new');       // no salta a Production de inmediato
    lists[1].resolve([PROD, DRAFT]);
    await tick();
    tree = rerender();
    expect(screen(tree).props.changesetId).toBe('cs-new');
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

// Doc 105 (revisión R6, B4): con la lista inicial en vuelo, vuelve el foco y el
// RE-LISTADO falla: la inicial (buena) se descartaba por secuencia y el error se
// callaba → combo sin versiones y ningún aviso. Si falla el más reciente, vale
// la última lista buena que haya llegado desde el cambio de proyecto; sin
// ninguna, se avisa.
describe('si falla el listado más reciente (doc 105 R6)', () => {
  it('la inicial buena que llegó antes del fallo se aplica, sin avisos', async () => {
    let tree = await mount();                          // lista inicial en vuelo
    focus();                                           // re-listado
    lists[0].resolve([PROD, DRAFT]);                   // la inicial llega (ya no es la más reciente)
    await tick();
    lists[1].reject(new ApiError("Couldn't reach the server — check your connection or reload the page.", 0));
    await tick();
    tree = rerender();
    expect(offered(tree)).toEqual(['cs-new']);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('si la buena llega DESPUÉS del fallo, también se aplica (y se retira el aviso)', async () => {
    let tree = await mount();
    focus();
    lists[1].reject(new ApiError('Bad gateway', 502, 'Bad gateway'));
    await tick();
    expect(vi.mocked(toast.error).mock.calls).toEqual([
      ["Couldn't load your versions of this project — only Production is available.", { id: 'dmh-rep-versions' }],
    ]);
    lists[0].resolve([PROD, DRAFT]);
    await tick();
    tree = rerender();
    expect(offered(tree)).toEqual(['cs-new']);
    expect(toast.dismiss).toHaveBeenCalledWith('dmh-rep-versions');
  });

  it('si ninguna llegó bien, UN aviso', async () => {
    await mount();
    focus();
    lists[1].reject(new ApiError('Bad gateway', 502, 'Bad gateway'));
    lists[0].reject(new ApiError('Bad gateway', 502, 'Bad gateway'));
    await tick();
    expect(vi.mocked(toast.error).mock.calls).toEqual([
      ["Couldn't load your versions of this project — only Production is available.", { id: 'dmh-rep-versions' }],
    ]);
  });
});

// Doc 105 (regresión de navegador, s4_b4): con /api/versions caído, cada
// re-listado fallido re-emitía el aviso B4 con el mismo id — sonner lo
// reemplaza y reinicia su vencimiento: se cerraba solo aunque el mouse estuviera
// encima. El aviso sale UNA vez por proyecto o por lista buena.
describe('aviso B4 ya mostrado (doc 105)', () => {
  const B4 = "Couldn't load your versions of this project — only Production is available.";
  const fail = (i: number) => lists[i].reject(new ApiError('Bad gateway', 502, 'Bad gateway'));

  it('los re-listados que siguen fallando no lo re-emiten', async () => {
    await mount();
    fail(0);                                           // la inicial falla: aviso
    await tick();
    focus();
    focus();
    fail(1);
    fail(2);                                           // dos re-listados más, también fallidos
    await tick();
    expect(vi.mocked(toast.error).mock.calls).toEqual([[B4, { id: 'dmh-rep-versions' }]]);
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it('una lista buena lo retira y lo rearma: si después todo vuelve a fallar sin lista buena… no hay aviso nuevo (vale la buena)', async () => {
    let tree = await mount();
    fail(0);
    await tick();
    focus();
    lists[1].resolve([PROD, DRAFT]);                   // vuelve la lista: se retira el aviso
    await tick();
    tree = rerender();
    expect(toast.dismiss).toHaveBeenCalledWith('dmh-rep-versions');
    focus();
    fail(2);                                           // falla de nuevo: vale la última buena, sin aviso
    await tick();
    tree = rerender();
    expect(offered(tree)).toEqual(['cs-new']);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('al cambiar de proyecto se retira y se rearma: si el otro proyecto también falla, avisa de nuevo', async () => {
    let tree = await mount();
    fail(0);
    await tick();
    const projectPick = [...walk(tree)].find((e) => e.type === ProjectPick)!;
    (projectPick.props.onPick as (id: string) => void)('p2');
    tree = rerender();                                 // proyecto nuevo: lista nueva en vuelo
    expect(toast.dismiss).toHaveBeenCalledWith('dmh-rep-versions');
    fail(1);
    await tick();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });
});
