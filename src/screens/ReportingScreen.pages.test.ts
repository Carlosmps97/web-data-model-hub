// Scroll infinito de la grilla del Reporting, sin DOM: la pantalla se llama como
// función con los hooks simulados de `fakeReact.testutil` (montar, correr efectos,
// re-renderizar con el estado encolado, como React).
//
// Si falla la página siguiente, el fallo no marca el fin de la lista: la barra no
// la presenta como completa, el error se indica al pie de la grilla y Retry pide
// la misma página, sin pisar la carga completa ni avisar sobre una pantalla
// desmontada.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { ReportTableRow } from '@/services/reporting.service';
import {
  fake, nextStates, resetFake, runEffects, textOf, unmount, walk,
} from '../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/services/reporting.service', () => ({
  listReportTables: vi.fn(), countReportTables: vi.fn(), listReportFilters: vi.fn(),
  listReportColumns: vi.fn(), queryReportColumns: vi.fn(), queryReportViews: vi.fn(),
}));
import { toast } from 'sonner';
import { countReportTables, listReportFilters, listReportTables } from '@/services/reporting.service';
import { MoreTablesError, ReportingScreen } from './ReportingScreen';

const TOTAL = 120;
const row = (i: number) => ({
  id: `t${i}`, physicalName: `T${String(i).padStart(3, '0')}`, logicalName: '', schema: 's', subjectAreas: [],
  columnCount: 1, relationshipCount: 0, projects: ['P'], description: '',
}) as ReportTableRow;
const rows = (from: number, n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => row(from + i));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let props: Parameters<typeof ReportingScreen>[0];
/** Re-render del componente montado con el estado encolado; corre los efectos que cambiaron. */
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = ReportingScreen(props);
  runEffects();
  return tree;
}
/** Monta la pantalla (producción) y deja cargada la primera página: 50 de 120. */
async function mount() {
  props = {
    projectId: 'p1', projectName: 'P', changesetId: null, versionLabel: null, onVersionError: vi.fn(),
    onExportBusy: vi.fn(), projectPicker: null, versionPicker: null,
  };
  resetFake();
  ReportingScreen(props);
  runEffects();
  await tick();
  return rerender();
}
/** Lo que hace el centinela al asomar: `loadMoreRef.current()`. */
const scrollToEnd = () => (fake.refs.find((r) => typeof r.current === 'function')!.current as () => void)();
const bar = (tree: unknown) => textOf([...walk(tree)].find((e) => e.props.className === 'dmh-rep-selcount'));
const footerError = (tree: unknown) => [...walk(tree)].find((e) => e.type === MoreTablesError);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listReportFilters).mockResolvedValue({ schemas: [], subjectAreas: [] });
  vi.mocked(countReportTables).mockResolvedValue(TOTAL);
  vi.mocked(listReportTables).mockImplementation(async (_pid, f = {}) =>
    (f.limit ? rows(f.offset ?? 0, Math.min(f.limit, TOTAL - (f.offset ?? 0))) : rows(0, TOTAL)));
});

describe('scroll infinito: la página siguiente que falla', () => {
  it('no marca el fin: sigue parcial, lo dice al pie y Retry pide la misma página (el scroll no reintenta solo)', async () => {
    let tree = await mount();
    expect(bar(tree)).toContain('50 of 120 tables');

    vi.mocked(listReportTables).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    scrollToEnd();
    await tick();
    expect(vi.mocked(listReportTables)).toHaveBeenLastCalledWith('p1', { limit: 50, offset: 50 });
    expect(toast.error).toHaveBeenCalledTimes(1);
    tree = rerender();
    expect(bar(tree)).toContain('50 of 120 tables');       // no «50 tables», como si estuviera completo
    expect(bar(tree)).toContain("couldn't load more (Retry below)");   // el scroll no carga: solo Retry
    expect(bar(tree)).not.toContain('scroll to load more');
    const footer = footerError(tree);
    expect(footer).toBeDefined();

    const before = vi.mocked(listReportTables).mock.calls.length;
    scrollToEnd();                                           // el centinela vuelve a asomar: no reintenta solo
    await tick();
    expect(vi.mocked(listReportTables).mock.calls.length).toBe(before);

    (footer!.props.onRetry as () => void)();
    await tick();
    expect(vi.mocked(listReportTables)).toHaveBeenLastCalledWith('p1', { limit: 50, offset: 50 });
    tree = rerender();
    expect(bar(tree)).toContain('100 of 120 tables');
    expect(bar(tree)).toContain('scroll to load more');
    expect(footerError(tree)).toBeUndefined();
  });

  it('una página que falla después de empezar la carga completa no avisa ni toca la grilla', async () => {
    let tree = await mount();
    let failPage: (e: unknown) => void = () => {};
    vi.mocked(listReportTables).mockImplementationOnce(() => new Promise((_, reject) => { failPage = reject; }));
    scrollToEnd();                                           // página 2 en vuelo
    const search = [...walk(tree)].find((e) => e.type === 'input' && e.props['aria-label'] === 'Search tables by name')!;
    (search.props.onChange as (e: unknown) => void)({ target: { value: 'T1' } });
    rerender();
    await tick(320);                                         // debounce: arranca la carga completa
    rerender();
    await tick();
    tree = rerender();
    expect(vi.mocked(listReportTables)).toHaveBeenLastCalledWith('p1', {}, null);
    expect(bar(tree)).toContain('20 tables');                // T100–T119, del set completo

    failPage(new ApiError('Bad gateway', 502));
    await tick();
    expect(toast.error).not.toHaveBeenCalled();
    tree = rerender();
    expect(footerError(tree)).toBeUndefined();
    expect(bar(tree)).toContain('20 tables');
  });

  it('si la pantalla se desmonta con la página en vuelo, su error no avisa sobre la pantalla nueva', async () => {
    await mount();
    let failPage: (e: unknown) => void = () => {};
    vi.mocked(listReportTables).mockImplementationOnce(() => new Promise((_, reject) => { failPage = reject; }));
    scrollToEnd();
    unmount();
    failPage(new ApiError('Bad gateway', 502));
    await tick();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
