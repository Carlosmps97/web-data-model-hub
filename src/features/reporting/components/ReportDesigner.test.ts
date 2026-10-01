// Report Designer sin DOM (hooks de mentira: ver fakeReact.testutil).
// Doc 105 (revisión ronda 4):
// - «Validate → builder» copiaba el spec validado con su `maxRows` (el LIMIT del
//   SQL): el Builder no lo muestra y quedaba capado en silencio (con el
//   placeholder, a 100). Tampoco cambiaba la vista: con `FROM tables` el Builder
//   seguía con el catálogo de `columns` y cada campo daba 400.
// - Tras agrupar, un orden previo por fila no se podía quitar: cada Run avisaba
//   «Sort by … was ignored».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldDef, QueryResult, ReportSpec, SavedReport } from '../query.service';
import { byText, nextStates, resetFake, runEffects, textOf, unmount, walk } from './fakeReact.testutil';

vi.mock('react', async (orig) => (await import('./fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('../query.service', async (orig) => ({
  ...(await orig<object>()),
  getCatalog: vi.fn(async () => []), listReports: vi.fn(async () => []), runQuery: vi.fn(), runSql: vi.fn(),
  validateSql: vi.fn(), exportCsv: vi.fn(), createReport: vi.fn(),
}));
import { toast } from 'sonner';
import { createReport, exportCsv, getCatalog, listReports, runQuery, runSql, validateSql } from '../query.service';
import ReportDesigner from './ReportDesigner';
import ResultsGrid from './ResultsGrid';
import SqlEditor from './SqlEditor';

const field = (key: string, over: Partial<FieldDef> = {}): FieldDef => ({
  key, label: key, type: 'string', ops: ['eq'], sortable: true, groupable: true, indexed: true,
  enumValues: null, udp: false, hydrated: false, ...over,
});
const CATALOG = [field('physicalName'), field('dataType')];
const RESULT: QueryResult = {
  rows: [{ physicalName: 'A', dataType: 'STRING' }], columns: [{ key: 'physicalName', label: 'Physical name' }],
  nextCursor: null, hasMore: false, meta: { grouped: false, warnings: [] },
};
const VALIDATED: ReportSpec = {
  projectId: 'p1', from: 'tables', select: ['physicalName'], groupBy: [], aggregations: [],
  orderBy: [], limit: 3, maxRows: 3, where: null,
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = ReportDesigner({ projectId: 'p1' });
  runEffects();
  return tree;
}
async function mount() {
  resetFake();
  ReportDesigner({ projectId: 'p1' });
  runEffects();
  await tick();
  return rerender();
}
const click = (el: { props: Record<string, unknown> }) => (el.props.onClick as () => unknown)();
/** El spec que viaja al pulsar Run. */
async function runSpec(tree: unknown): Promise<ReportSpec> {
  vi.mocked(runQuery).mockClear();
  await click(byText(tree, 'button', 'Run'));
  return vi.mocked(runQuery).mock.calls[0][0];
}
const fromSelect = (tree: unknown) => [...walk(tree)].find((e) => e.type === 'select' && typeof e.props.value === 'string' && ['columns', 'tables'].includes(e.props.value as string))!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCatalog).mockResolvedValue(CATALOG);
  vi.mocked(listReports).mockResolvedValue([]);
  vi.mocked(runQuery).mockResolvedValue(RESULT);
});

describe('«Validate → builder» (doc 105)', () => {
  it('cambia a la vista del SQL y deja el Builder sin el tope invisible del LIMIT', async () => {
    let tree = await mount();
    click(byText(tree, 'button', 'SQL'));
    tree = rerender();
    ([...walk(tree)].find((e) => e.type === SqlEditor)!.props.onValidated as (s: ReportSpec) => void)(VALIDATED);
    tree = rerender();
    expect(fromSelect(tree).props.value).toBe('tables');
    expect(getCatalog).toHaveBeenLastCalledWith('p1', 'tables');
    const sent = await runSpec(tree);
    expect(sent).toMatchObject({ from: 'tables', select: ['physicalName'], limit: 100 });
    expect(sent.maxRows).toBeUndefined();
  });

  it('abrir un reporte guardado hace lo mismo (su vista y sin tope invisible)', async () => {
    const saved: SavedReport = { id: 'r1', projectId: 'p1', name: 'Tablas', owner: 'ana', shared: false, spec: VALIDATED };
    vi.mocked(listReports).mockResolvedValue([saved]);
    let tree = await mount();
    const picker = [...walk(tree)].find((e) => e.type === 'select' && e.props.value === '')!;
    (picker.props.onChange as (e: unknown) => void)({ target: { value: 'r1' } });
    await tick();
    tree = rerender();
    expect(fromSelect(tree).props.value).toBe('tables');
    const sent = await runSpec(tree);
    expect(sent).toMatchObject({ from: 'tables', limit: 100 });
    expect(sent.maxRows).toBeUndefined();
  });
});

describe('agrupar con un orden por fila (doc 105)', () => {
  it('GRP quita el orden que el agrupado ignoraría, sin volver a correr la consulta solo', async () => {
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    ([...walk(tree)].find((e) => e.type === ResultsGrid)!.props.onSort as (k: string) => void)('physicalName');
    tree = rerender();                                        // ordenar sí re-corre (como antes)
    await tick();
    tree = rerender();
    expect(vi.mocked(runQuery).mock.calls.at(-1)?.[0].orderBy).toEqual([{ field: 'physicalName', dir: 'asc' }]);

    const calls = vi.mocked(runQuery).mock.calls.length;
    const grp = [...walk(tree)].filter((e) => e.type === 'button' && e.props.title === 'Group by')[1];   // dataType
    click(grp);
    tree = rerender();
    await tick();
    expect(vi.mocked(runQuery).mock.calls.length).toBe(calls);   // agrupar no dispara una consulta
    const sent = await runSpec(rerender());
    expect(sent).toMatchObject({ groupBy: ['dataType'], orderBy: [] });
  });
});

// Doc 105 (ronda 5): respuestas tardías y fallos sin aviso.
// - «Load more» sin catch: un fallo de red quedaba como promesa rechazada, sin aviso.
// - La página que llegaba DESPUÉS de una consulta nueva (ordenar, cambiar de vista)
//   se pegaba a su resultado: filas de otra consulta y su cursor.
// - «Validate → builder» sin catch: con la red caída no avisaba nada.
// - El catálogo de la vista anterior, si llegaba tarde, pisaba al de la vista elegida.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const PAGED: QueryResult = { ...RESULT, nextCursor: 'c1', hasMore: true };
const grid = (tree: unknown) => [...walk(tree)].find((e) => e.type === ResultsGrid)!.props;
/** Estado `result` del próximo render (el único con `rows`). */
const resultState = () => nextStates().find((v) => !!v && typeof v === 'object' && 'rows' in (v as object)) as QueryResult | undefined;

describe('respuestas tardías y fallos (doc 105, ronda 5)', () => {
  it('«Load more» que falla avisa el motivo y no deja una promesa rechazada', async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(PAGED);
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    vi.mocked(runQuery).mockRejectedValueOnce(new Error("Couldn't reach the server"));
    await expect((grid(tree).onLoadMore as () => Promise<void>)()).resolves.toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server");
  });

  it('la página de «Load more» que llega después de ordenar no se pega al resultado nuevo', async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(PAGED);
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    const late = deferred<QueryResult>();
    vi.mocked(runQuery).mockReturnValueOnce(late.promise);
    const more = (grid(tree).onLoadMore as () => Promise<void>)();
    tree = rerender();
    const SORTED: QueryResult = { ...RESULT, rows: [{ physicalName: 'Z' }] };
    vi.mocked(runQuery).mockResolvedValueOnce(SORTED);
    (grid(tree).onSort as (k: string) => void)('physicalName');   // ordenar re-corre la consulta
    tree = rerender();
    await tick();
    late.resolve({ ...RESULT, rows: [{ physicalName: 'OLD_PAGE_2' }], nextCursor: 'c2' });
    await more;
    expect(resultState()?.rows).toEqual([{ physicalName: 'Z' }]);
  });

  it('la consulta que llega después de cambiar de vista no aparece bajo la vista nueva', async () => {
    let tree = await mount();
    const late = deferred<QueryResult>();
    vi.mocked(runQuery).mockReturnValueOnce(late.promise);
    const ran = click(byText(tree, 'button', 'Run')) as Promise<void>;
    tree = rerender();
    (fromSelect(tree).props.onChange as (e: unknown) => void)({ target: { value: 'tables' } });
    tree = rerender();
    late.resolve(RESULT);
    await ran;
    expect(resultState()).toBeUndefined();                   // ningún resultado en pantalla
  });

  it('el catálogo de la vista anterior que llega tarde no pisa al de la vista elegida', async () => {
    const slow = deferred<FieldDef[]>();
    vi.mocked(getCatalog).mockImplementation(async (_p, from) => (from === 'columns' ? slow.promise : [field('tableOnly')]));
    resetFake();
    ReportDesigner({ projectId: 'p1' });
    runEffects();
    let tree = rerender();
    (fromSelect(tree).props.onChange as (e: unknown) => void)({ target: { value: 'tables' } });
    tree = rerender();
    await tick();
    slow.resolve(CATALOG);
    await tick();
    const catalogs = nextStates().filter((v) => Array.isArray(v) && v.length > 0 && (v[0] as FieldDef).key !== undefined) as FieldDef[][];
    expect(catalogs).toEqual([[field('tableOnly')]]);
  });

  it('«Load more» sigue la consulta que produjo el resultado, aunque el formulario haya cambiado', async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(PAGED);
    let tree = await mount();
    const ran = await runSpec(tree);                          // Run: select vacío
    tree = rerender();
    const box = [...walk(tree)].find((e) => e.type === 'input' && e.props.type === 'checkbox')!;
    (box.props.onChange as () => void)();                    // marca «physicalName» SIN volver a correr
    tree = rerender();
    vi.mocked(runQuery).mockClear();
    vi.mocked(runQuery).mockResolvedValueOnce({ ...RESULT, rows: [{ physicalName: 'B' }] });
    await (grid(tree).onLoadMore as () => Promise<void>)();
    expect(vi.mocked(runQuery).mock.calls[0]).toEqual([ran, 'c1']);
  });

  it('dos pedidos de «Load more» del mismo render (el scroll) traen la página UNA vez', async () => {
    vi.mocked(runQuery).mockResolvedValueOnce(PAGED);
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    vi.mocked(runQuery).mockClear();
    vi.mocked(runQuery).mockResolvedValue({ ...RESULT, rows: [{ physicalName: 'B' }] });
    const more = grid(tree).onLoadMore as () => Promise<void>;
    await Promise.all([more(), more()]);
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it('cada consulta nueva vuelve la grilla arriba SIN remontarla (conserva scroll horizontal y foco); «Load more» no', async () => {
    vi.mocked(runQuery).mockResolvedValue(PAGED);
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    const el = () => [...walk(tree)].find((e) => e.type === ResultsGrid) as unknown as { key: unknown; props: Record<string, unknown> };
    const first = el();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    expect(el().key).toBe(first.key);                          // no se remonta
    expect(el().props.resetKey).not.toBe(first.props.resetKey);
    const second = el().props.resetKey;
    await (grid(tree).onLoadMore as () => Promise<void>)();
    tree = rerender();
    expect(el().props.resetKey).toBe(second);
  });

  it('«Validate → builder» con la red caída avisa el motivo', async () => {
    vi.mocked(validateSql).mockRejectedValueOnce(new Error("Couldn't reach the server"));
    resetFake();
    const tree = SqlEditor({ projectId: 'p1', text: 'SELECT physicalName FROM columns', onText: () => {}, onValidated: () => {} });
    await expect((byText(tree, 'button', 'Validate → builder').props.onClick as () => Promise<void>)()).resolves.toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server");
  });
});

describe('textos en inglés (doc 105, ronda 5)', () => {
  it('el selector de campos dice «Show column» y «Group by»', async () => {
    const tree = await mount();
    const titles = [...walk(tree)].map((e) => e.props.title).filter(Boolean);
    expect(titles).toContain('Show column');
    expect(titles).toContain('Group by');
    expect(titles).not.toContain('Mostrar columna');
    expect(titles).not.toContain('Agrupar por');
  });
});

// Doc 105 (ronda 5, R14): ordenar, catálogo y validación.
describe('ordenar la consulta que se ve (doc 105, ronda 5)', () => {
  it('con un resultado del editor SQL la grilla no ofrece ordenar (ni flecha)', async () => {
    vi.mocked(runSql).mockResolvedValue(RESULT);
    let tree = await mount();
    click(byText(tree, 'button', 'SQL'));
    tree = rerender();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    expect(grid(tree).onSort).toBeUndefined();
    expect(grid(tree).sort ?? null).toBeNull();
  });

  it('ordenar corre la consulta que se ve (no el formulario editado desde el Run)', async () => {
    let tree = await mount();
    const ran = await runSpec(tree);                          // select vacío
    tree = rerender();
    const box = [...walk(tree)].find((e) => e.type === 'input' && e.props.type === 'checkbox')!;
    (box.props.onChange as () => void)();                    // edita el formulario sin correr
    tree = rerender();
    vi.mocked(runQuery).mockClear();
    (grid(tree).onSort as (k: string) => void)('physicalName');
    await tick();
    expect(vi.mocked(runQuery).mock.calls[0][0]).toEqual({ ...ran, orderBy: [{ field: 'physicalName', dir: 'asc' }] });
    tree = rerender();
    await tick();
    tree = rerender();
    expect(grid(tree).sort).toEqual({ field: 'physicalName', dir: 'asc' });
  });
});

describe('catálogo al cambiar de vista (doc 105, ronda 5)', () => {
  it('el de la vista anterior no queda en pantalla, tampoco si el nuevo falla', async () => {
    let tree = await mount();
    expect([...walk(tree)].filter((e) => e.type === 'input' && e.props.type === 'checkbox').length).toBe(2);
    vi.mocked(getCatalog).mockRejectedValueOnce(new Error('down'));
    (fromSelect(tree).props.onChange as (e: unknown) => void)({ target: { value: 'tables' } });
    tree = rerender();
    await tick();
    tree = rerender();
    expect([...walk(tree)].filter((e) => e.type === 'input' && e.props.type === 'checkbox').length).toBe(0);
  });
});

describe('«Validate → builder» (doc 105, ronda 5)', () => {
  const sqlProps = (text: string, onValidated = vi.fn()) => ({ projectId: 'p1', text, onText: () => {}, onValidated });
  function renderSql(p: ReturnType<typeof sqlProps>, keep = false) {
    if (keep) { const next = nextStates(); resetFake((_i, i) => next[i], { keepRefs: true }); } else resetFake();
    const tree = SqlEditor(p);
    runEffects();
    return tree;
  }

  it('la respuesta que llega después de cambiar el texto no abre el Builder con el SQL viejo', async () => {
    const late = deferred<{ spec: ReportSpec; errors: never[] }>();
    vi.mocked(validateSql).mockReturnValueOnce(late.promise);
    const p = sqlProps('SELECT physicalName FROM tables');
    const tree = renderSql(p);
    const done = (byText(tree, 'button', 'Validate → builder').props.onClick as () => Promise<void>)();
    renderSql({ ...p, text: 'SELECT physicalName FROM columns' }, true);
    late.resolve({ spec: VALIDATED, errors: [] });
    await done;
    expect(p.onValidated).not.toHaveBeenCalled();
  });

  it('ni si el editor ya se cerró (el usuario volvió al Builder)', async () => {
    const late = deferred<{ spec: ReportSpec; errors: never[] }>();
    vi.mocked(validateSql).mockReturnValueOnce(late.promise);
    const p = sqlProps('SELECT physicalName FROM tables');
    const tree = renderSql(p);
    const done = (byText(tree, 'button', 'Validate → builder').props.onClick as () => Promise<void>)();
    unmount();
    late.resolve({ spec: VALIDATED, errors: [] });
    await done;
    expect(p.onValidated).not.toHaveBeenCalled();
  });

  it('una FALLA que llega después de cambiar el texto o de cerrar el editor tampoco avisa', async () => {
    const late = deferred<{ spec: ReportSpec; errors: never[] }>();
    vi.mocked(validateSql).mockReturnValueOnce(late.promise);
    const p = sqlProps('SELECT physicalName FROM tables');
    const tree = renderSql(p);
    const done = (byText(tree, 'button', 'Validate → builder').props.onClick as () => Promise<void>)();
    renderSql({ ...p, text: 'SELECT physicalName FROM columns' }, true);
    late.reject(new Error("Couldn't reach the server"));
    await done;
    expect(toast.error).not.toHaveBeenCalled();

    const late2 = deferred<{ spec: ReportSpec; errors: never[] }>();
    vi.mocked(validateSql).mockReturnValueOnce(late2.promise);
    const tree2 = renderSql(p);
    const done2 = (byText(tree2, 'button', 'Validate → builder').props.onClick as () => Promise<void>)();
    unmount();
    late2.reject(new Error("Couldn't reach the server"));
    await done2;
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('«✓ Valid SQL» sólo para el texto que validó bien, no para cualquier texto', async () => {
    let tree = renderSql(sqlProps('basura que nunca se validó'));
    expect(textOf(tree)).not.toContain('Valid SQL');
    vi.mocked(validateSql).mockResolvedValueOnce({ spec: null, errors: [] });
    const p = sqlProps('SELECT physicalName FROM tables');
    tree = renderSql(p);
    await (byText(tree, 'button', 'Validate → builder').props.onClick as () => Promise<void>)();
    tree = renderSql(p, true);
    expect(textOf(tree)).toContain('Valid SQL');
    tree = renderSql({ ...p, text: 'SELECT physicalName FROM tables WHERE' }, true);
    expect(textOf(tree)).not.toContain('Valid SQL');
  });
});

describe('ordenar sólo por campos ordenables (doc 105, ronda 5)', () => {
  it('la grilla sólo ofrece ordenar los campos que el catálogo marca como ordenables', async () => {
    vi.mocked(getCatalog).mockResolvedValue([field('physicalName'), field('dataType', { sortable: false })]);
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    const canSort = grid(tree).canSort as (k: string) => boolean;
    expect(canSort('physicalName')).toBe(true);
    expect(canSort('dataType')).toBe(false);          // el backend daría 422 «it has no index»
  });
});

// Doc 105 (ronda 6, R17b): (1) ordenar mientras vuela un Run nuevo lo
// descartaba y dejaba en pantalla la consulta vieja ordenada; (2) un reporte
// guardado con un orden por un campo sin índice daba 422 en cada Run, sin
// salida (el Builder no muestra el orden).
describe('ordenar y correr (doc 105, ronda 6)', () => {
  it('con un Run en vuelo no se ordena (ni se ofrece): la consulta nueva no se pierde', async () => {
    let tree = await mount();
    await click(byText(tree, 'button', 'Run'));             // Q1 en pantalla
    tree = rerender();
    const sortArmed = grid(tree).onSort as (k: string) => void;   // un clic que quedó armado antes del Run
    const q2 = deferred<QueryResult>();
    vi.mocked(runQuery).mockReturnValueOnce(q2.promise);
    const running = click(byText(tree, 'button', 'Run')) as Promise<void>;   // Q2 lenta
    tree = rerender();
    // Ronda 7 (R18b): el encabezado sigue siendo el mismo botón (el foco del
    // teclado no se pierde), deshabilitado; la guarda `running` bloquea.
    expect(grid(tree).sortDisabled).toBe(true);
    vi.mocked(runQuery).mockClear();
    sortArmed('physicalName');
    (grid(tree).onSort as (k: string) => void)('physicalName');
    q2.resolve({ ...RESULT, rows: [{ physicalName: 'Q2' }] });
    await running;
    expect(runQuery).not.toHaveBeenCalled();
    expect(resultState()?.rows).toEqual([{ physicalName: 'Q2' }]);
  });

  it('el orden de un reporte guardado por un campo que no se puede ordenar se quita al correr, con aviso', async () => {
    vi.mocked(getCatalog).mockResolvedValue([field('physicalName'), field('logicalName', { sortable: false })]);
    const saved: SavedReport = { id: 'r1', projectId: 'p1', name: 'Viejo', owner: 'ana', shared: false,
      spec: { ...VALIDATED, from: 'columns', maxRows: null, orderBy: [{ field: 'logicalName', dir: 'asc' }] } };
    vi.mocked(listReports).mockResolvedValue([saved]);
    let tree = await mount();
    ([...walk(tree)].find((e) => e.type === 'select' && e.props.value === '')!.props.onChange as (e: unknown) => void)({ target: { value: 'r1' } });
    await tick();
    tree = rerender();
    runEffects();
    await tick();
    tree = rerender();
    const sent = await runSpec(tree);
    expect(sent.orderBy).toEqual([]);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('logicalName'));
  });
});

describe('ordenar tras cambiar de vista a mitad de un Run (doc 105, ronda 6)', () => {
  it('el Run invalidado no deja el orden bloqueado', async () => {
    let tree = await mount();
    const late = deferred<QueryResult>();
    vi.mocked(runQuery).mockReturnValueOnce(late.promise);
    const ran = click(byText(tree, 'button', 'Run')) as Promise<void>;
    tree = rerender();
    (fromSelect(tree).props.onChange as (e: unknown) => void)({ target: { value: 'tables' } });
    tree = rerender();
    late.resolve(RESULT);
    await ran;
    vi.mocked(runQuery).mockResolvedValue(RESULT);
    await click(byText(tree, 'button', 'Run'));
    tree = rerender();
    vi.mocked(runQuery).mockClear();
    (grid(tree).onSort as (k: string) => void)('physicalName');
    await tick();
    expect(runQuery).toHaveBeenCalledTimes(1);
  });
});

describe('export y guardado con un orden no ordenable (doc 105, ronda 7)', () => {
  it('el CSV se pide sin ese orden (antes: 422 «it has no index» si no se corrió antes)', async () => {
    vi.mocked(getCatalog).mockResolvedValue([field('physicalName'), field('logicalName', { sortable: false })]);
    const saved: SavedReport = { id: 'r1', projectId: 'p1', name: 'Viejo', owner: 'ana', shared: false,
      spec: { ...VALIDATED, from: 'columns', maxRows: null, orderBy: [{ field: 'logicalName', dir: 'asc' }] } };
    vi.mocked(listReports).mockResolvedValue([saved]);
    let tree = await mount();
    ([...walk(tree)].find((e) => e.type === 'select' && e.props.value === '')!.props.onChange as (e: unknown) => void)({ target: { value: 'r1' } });
    await tick();
    tree = rerender();
    runEffects();
    await tick();
    tree = rerender();
    await click(byText(tree, 'button', 'CSV'));
    await tick();
    expect(vi.mocked(exportCsv).mock.calls[0][0].orderBy).toEqual([]);
    // y al guardarlo de nuevo, sin ese orden
    vi.stubGlobal('window', { prompt: () => 'Viejo 2' });
    vi.mocked(createReport).mockResolvedValue({} as never);
    await click(byText(tree, 'button', 'Save'));
    vi.unstubAllGlobals();
    expect(vi.mocked(createReport).mock.calls[0][0].spec.orderBy).toEqual([]);
  });
});
