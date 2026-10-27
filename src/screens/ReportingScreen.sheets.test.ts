// Reporting por hojas, sin DOM (hooks simulados de `fakeReact.testutil`): una
// pestaña por hoja del Excel —el nombre la muestra, la casilla la incluye en el
// libro— y la búsqueda con alcance (Tables / entities · Columns / attributes ·
// Definitions · Views). Con Columns, Definitions o Views el servidor dice qué
// tablas entran y las hojas de columnas y vistas muestran solo lo que coincide,
// en pantalla y en el Excel.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportColumnRow, ReportTableRow, ReportViewRow } from '@/services/reporting.service';
import {
  nextStates, resetFake, runEffects, textOf, walk, type El,
} from '../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), dismiss: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/reporting.service', () => ({
  listReportTables: vi.fn(), countReportTables: vi.fn(), listReportFilters: vi.fn(), listReportColumns: vi.fn(),
  queryReportColumns: vi.fn(), queryReportViews: vi.fn(), queryRelationshipsReport: vi.fn(), searchReportTables: vi.fn(),
}));
vi.mock('@/features/reporting/lib/xlsxWriter', () => ({ buildXlsx: vi.fn(async () => new Blob()), saveXlsx: vi.fn() }));
import {
  countReportTables, listReportFilters, listReportTables, queryReportColumns, queryReportViews, searchReportTables,
} from '@/services/reporting.service';
import { ApiError } from '@/services/http';
import { buildXlsx, saveXlsx, type WorkbookSheet } from '@/features/reporting/lib/xlsxWriter';
import { ReportingScreen } from './ReportingScreen';

const table = (id: string, physicalName: string): ReportTableRow => ({
  id, physicalName, logicalName: '', schema: 's', subjectAreas: [], columnCount: 1, relationshipCount: 0,
  projects: ['P'], description: '',
});
const TABLES = [table('t1', 'CLIENTE'), table('t2', 'CUENTA')];
const column = (id: string, tableId: string, physicalName: string): ReportColumnRow => ({
  id, tableId, physicalName, logicalName: '', dataType: 'INT', isPrimaryKey: false, isForeignKey: false,
  isNullable: true, isPartition: false, description: '', ordinal: 1,
});
const view = (id: string, name: string): ReportViewRow => ({
  id, name, schema: 's_vu', sourceTableIds: ['t1'], sourceTables: ['s.CLIENTE'], showOnCanvas: true, columns: [],
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let props: Parameters<typeof ReportingScreen>[0];
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = ReportingScreen(props);
  runEffects();
  return tree;
}
/** Deja que corran pedidos, debounces y re-renders encadenados. */
async function settle(tree: unknown, rounds = 6, ms = 0): Promise<unknown> {
  let t = tree;
  for (let i = 0; i < rounds; i += 1) { await tick(ms); t = rerender(); }
  return t;
}
async function mount() {
  props = {
    projectId: 'p1', projectName: 'P', changesetId: null, versionLabel: null, onVersionError: vi.fn(),
    onExportBusy: vi.fn(), projectPicker: null, versionPicker: null, canExport: true,
  };
  resetFake();
  ReportingScreen(props);
  runEffects();
  return settle(null, 2);
}

const all = (tree: unknown) => [...walk(tree)];
const sheetsGroup = (tree: unknown) => all(tree).find((e) => e.props.role === 'group' && e.props['aria-label'] === 'Sheets')!;
const sheetTabs = (tree: unknown) => all(sheetsGroup(tree)).filter((e) => e.type === 'button' && e.props.role !== 'checkbox');
const includeBox = (tree: unknown, label: string) =>
  all(tree).find((e) => e.props.role === 'checkbox' && e.props['aria-label'] === `Include ${label} in the Excel`)!;
const tabNamed = (tree: unknown, label: string) => sheetTabs(tree).find((e) => textOf(e) === label)!;
const scopeTab = (tree: unknown, label: string) =>
  all(tree).find((e) => e.props.role === 'tab' && textOf(e) === label)!;
const searchInput = (tree: unknown) => all(tree).find((e) => e.type === 'input' && e.props['aria-label'] === 'Search the report')!;
const click = (el: El) => (el.props.onClick as (e?: unknown) => void)({ stopPropagation: vi.fn() });
const type = (el: El, value: string) => (el.props.onChange as (e: unknown) => void)({ target: { value } });
const bar = (tree: unknown) => textOf(all(tree).find((e) => e.props.className === 'dmh-rep-selcount'));
const grid = (tree: unknown) => all(tree).find((e) => Array.isArray(e.props.rows))!;
const download = (tree: unknown) => all(tree).find((e) => textOf(e) === 'Download .xlsx' && typeof e.props.onClick === 'function')!;
const writtenSheets = () => (vi.mocked(buildXlsx).mock.calls.at(-1)![0] as WorkbookSheet[]);
const rowsOf = (s: WorkbookSheet) => Array.from({ length: s.count }, (_, i) => s.rowAt(i));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listReportFilters).mockResolvedValue({ schemas: [], subjectAreas: [] });
  vi.mocked(countReportTables).mockResolvedValue(TABLES.length);
  vi.mocked(listReportTables).mockResolvedValue(TABLES);
  vi.mocked(queryReportColumns).mockResolvedValue([column('c1', 't1', 'CODCLIENTE'), column('c2', 't1', 'NOMBRE')]);
  vi.mocked(queryReportViews).mockResolvedValue([view('v1', 'VW_CLIENTE'), view('v2', 'VW_OTRA')]);
  vi.mocked(searchReportTables).mockResolvedValue(['t1']);
});

describe('pestañas = hojas del Excel', () => {
  it('una pestaña por hoja, en el orden del libro; por defecto se incluyen Tables y Columns', async () => {
    const tree = await mount();
    expect(sheetTabs(tree).map(textOf)).toEqual(
      ['Tables', 'Columns', 'Tables + Columns', 'Relationships', 'Views', 'View columns', 'Definitions']);
    expect(sheetTabs(tree).map((e) => textOf(e) + (includeBox(tree, textOf(e)).props['aria-checked'] ? ' ✓' : '')))
      .toEqual(['Tables ✓', 'Columns ✓', 'Tables + Columns', 'Relationships', 'Views', 'View columns', 'Definitions']);
    expect(tabNamed(tree, 'Tables').props['aria-current']).toBe('true');
  });

  it('la casilla incluye o quita la hoja sin cambiar de pestaña; el nombre cambia la pestaña', async () => {
    let tree = await mount();
    click(includeBox(tree, 'Views'));
    tree = rerender();
    expect(includeBox(tree, 'Views').props['aria-checked']).toBe(true);
    expect(tabNamed(tree, 'Tables').props['aria-current']).toBe('true');
    click(tabNamed(tree, 'Views'));
    tree = rerender();
    expect(tabNamed(tree, 'Views').props['aria-current']).toBe('true');
    expect(includeBox(tree, 'Views').props['aria-checked']).toBe(true);
  });

  it('sin hojas incluidas, Download .xlsx queda deshabilitado', async () => {
    let tree = await mount();
    click(includeBox(tree, 'Tables'));
    click(includeBox(tree, 'Columns'));
    tree = rerender();
    expect(download(tree).props.disabled).toBe(true);
  });
});

describe('búsqueda con alcance', () => {
  it('cuatro alcances; Columns busca en el servidor, muestra la hoja Columns y solo las columnas que coinciden', async () => {
    let tree = await mount();
    expect(all(tree).filter((e) => e.props.role === 'tab').map(textOf))
      .toEqual(['Tables / entities', 'Columns / attributes', 'Definitions', 'Views']);
    click(scopeTab(tree, 'Columns / attributes'));
    tree = rerender();
    expect(tabNamed(tree, 'Columns').props['aria-current']).toBe('true');
    expect(searchInput(tree).props.placeholder).toBe('Search columns by name…');
    type(searchInput(tree), 'cod');
    tree = await settle(rerender(), 8, 110);
    expect(searchReportTables).toHaveBeenLastCalledWith('p1', 'cod', 'columns', null);
    expect(bar(tree)).toContain('1 table');                    // solo t1
    expect((grid(tree).props.rows as Record<string, unknown>[]).map((r) => r.Column)).toEqual(['CODCLIENTE']);
  });

  it('Tables busca por nombre en el navegador, sin ir al servidor', async () => {
    let tree = await mount();
    type(searchInput(tree), 'cuen');
    tree = await settle(rerender(), 6, 110);
    expect(searchReportTables).not.toHaveBeenCalled();
    expect(bar(tree)).toContain('1 table');
  });
});

describe('búsqueda en el servidor: espera, error y tope', () => {
  it('mientras busca, las otras pestañas dicen Loading… (no «No tables in scope») y la barra, searching…', async () => {
    let tree = await mount();
    let answer: (ids: string[]) => void = () => {};
    vi.mocked(searchReportTables).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    click(scopeTab(tree, 'Columns / attributes'));
    tree = rerender();
    type(searchInput(tree), 'cod');
    tree = await settle(rerender(), 6, 110);
    expect(grid(tree).props.loading).toBe(true);
    expect(grid(tree).props.notice).toBeNull();
    expect(bar(tree)).toContain('searching…');
    answer(['t1']);
    tree = await settle(tree, 4);
    expect(bar(tree)).toContain('1 table');
  });

  it('si la búsqueda falla, la grilla lo dice y Retry vuelve a buscar', async () => {
    let tree = await mount();
    vi.mocked(searchReportTables).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    click(scopeTab(tree, 'Views'));
    click(tabNamed(rerender(), 'Tables'));
    tree = rerender();
    type(searchInput(tree), 'vw');
    tree = await settle(rerender(), 8, 110);
    expect(textOf(all(tree).find((e) => e.props.className === 'dmh-rep-tablewrap'))).toContain("Couldn't run the search");
    const retry = all(tree).find((e) => textOf(e) === 'Retry' && typeof e.props.onClick === 'function')!;
    click(retry);
    tree = await settle(rerender(), 8, 110);
    expect(searchReportTables).toHaveBeenCalledTimes(2);
    expect(bar(tree)).toContain('1 table');
  });

  it('volver a una búsqueda que falló la reintenta mostrando searching…, no el error viejo', async () => {
    let tree = await mount();
    vi.mocked(searchReportTables).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    click(scopeTab(tree, 'Columns / attributes'));
    tree = rerender();
    type(searchInput(tree), 'cod');
    tree = await settle(rerender(), 8, 110);
    expect(grid(tree).props.errorTitle).toBe("Couldn't run the search");
    let answer: (ids: string[]) => void = () => {};
    vi.mocked(searchReportTables).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    click(scopeTab(tree, 'Tables / entities'));
    tree = rerender();
    click(scopeTab(tree, 'Columns / attributes'));
    tree = await settle(rerender(), 6, 110);
    expect(grid(tree).props.onRetry).toBeUndefined();
    expect(grid(tree).props.loading).toBe(true);
    expect(bar(tree)).toContain('searching…');
    answer(['t1']);
    tree = await settle(tree, 4);
    expect(bar(tree)).toContain('1 table');
  });

  it('las tarjetas de resumen esperan a la búsqueda (no dicen «vacío»)', async () => {
    let tree = await mount();
    vi.mocked(searchReportTables).mockImplementationOnce(() => new Promise(() => {}));
    click(scopeTab(tree, 'Columns / attributes'));
    tree = rerender();
    type(searchInput(tree), 'cod');
    tree = await settle(rerender(), 6, 110);
    const text = all(tree).filter((e) => e.props.className === 'dmh-rep-sumcard-empty').map(textOf);
    expect(text).toEqual(['Loading…', 'Loading…']);
  });

  it('el texto de búsqueda tiene el tope del servidor (120)', async () => {
    const tree = await mount();
    expect(searchInput(tree).props.maxLength).toBe(120);
  });

  it('por nombre de tabla filtra desde el primer carácter, como siempre (sin cargar todo)', async () => {
    let tree = await mount();
    type(searchInput(tree), 'n');                          // CLIENTE y CUENTA tienen «n»
    tree = await settle(rerender(), 2);
    expect(bar(tree)).toContain('2 tables');
    type(searchInput(tree), 'x');
    tree = await settle(rerender(), 2);
    expect(bar(tree)).toContain('0 tables');
  });

  it('la card de plantillas espera a la búsqueda', async () => {
    let tree = await mount();
    vi.mocked(searchReportTables).mockImplementationOnce(() => new Promise(() => {}));
    click(scopeTab(tree, 'Columns / attributes'));
    tree = rerender();
    type(searchInput(tree), 'cod');
    tree = await settle(rerender(), 6, 110);
    expect(all(tree).find((e) => typeof e.props.fetchColumns === 'function')!.props.disabled).toBe(true);
  });

  it('un export a la vez: la card espera al de hojas y Download espera al de la plantilla', async () => {
    let tree = await mount();
    const card = () => all(tree).find((e) => typeof e.props.fetchColumns === 'function')!;
    click(all(tree).find((e) => e.props['aria-label'] === 'Select all rows')!);
    tree = rerender();
    expect(card().props.disabled).toBe(false);
    vi.mocked(queryReportColumns).mockImplementationOnce(() => new Promise(() => {}));
    void (download(tree).props.onClick as () => Promise<void>)();
    tree = await settle(rerender(), 2);
    expect(card().props.disabled).toBe(true);                         // el export de hojas sigue leyendo
    resetFake();                                                       // pantalla nueva, sin export en curso
    ReportingScreen(props);
    runEffects();
    tree = await settle(null, 2);
    click(all(tree).find((e) => e.props['aria-label'] === 'Select all rows')!);
    tree = rerender();
    (card().props.onBusyChange as (busy: boolean) => void)(true);     // la plantilla empieza a exportar
    tree = rerender();
    expect(download(tree).props.disabled).toBe(true);
  });
});

describe('detalle de las pestañas', () => {
  it('cambiar de pestaña con la lectura en vuelo no la repite al volver', async () => {
    let tree = await mount();
    let answer: (rows: ReportColumnRow[]) => void = () => {};
    vi.mocked(queryReportColumns).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 2);
    click(tabNamed(tree, 'Definitions'));
    tree = await settle(rerender(), 2);
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 2);
    expect(queryReportColumns).toHaveBeenCalledTimes(1);
    answer([column('c1', 't1', 'CODCLIENTE')]);
    tree = await settle(tree, 3);
    expect((grid(tree).props.rows as Record<string, unknown>[]).map((r) => r.Column)).toEqual(['CODCLIENTE']);
  });

  it('una respuesta de otras tablas en foco no se aplica; al volver a ellas se leen de nuevo', async () => {
    let tree = await mount();
    let answerAll: (rows: ReportColumnRow[]) => void = () => {};
    vi.mocked(queryReportColumns).mockImplementationOnce(() => new Promise((r) => { answerAll = r; }));
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 2);                                // lectura de t1+t2 en vuelo
    click(tabNamed(tree, 'Tables'));
    tree = rerender();
    click(all(tree).find((e) => e.props['aria-label'] === 'Select CLIENTE')!);
    tree = rerender();
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 3);                                // en foco solo t1: otra lectura
    answerAll([column('cx', 't2', 'DE_OTRA_LECTURA')]);
    tree = await settle(tree, 3);
    const cols = (grid(tree).props.rows as Record<string, unknown>[]).map((r) => r.Column);
    expect(cols).not.toContain('DE_OTRA_LECTURA');
    expect(queryReportColumns).toHaveBeenCalledTimes(2);               // la vieja no pisa la caché ni fuerza otra lectura
  });

  it('al volver a una pestaña cuya lectura falló, la relee mostrando Loading…, no el error', async () => {
    let tree = await mount();
    vi.mocked(queryReportColumns).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 3);
    expect(grid(tree).props.onRetry).toBeTypeOf('function');
    click(tabNamed(tree, 'Views'));
    tree = await settle(rerender(), 3);
    vi.mocked(queryReportColumns).mockImplementationOnce(() => new Promise(() => {}));
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 3);
    expect(grid(tree).props.onRetry).toBeUndefined();
    expect(grid(tree).props.loading).toBe(true);
  });

  it('Retry con la lectura nueva en vuelo muestra Loading…, no el error', async () => {
    let tree = await mount();
    vi.mocked(queryReportColumns).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 3);
    vi.mocked(queryReportColumns).mockImplementationOnce(() => new Promise(() => {}));
    (grid(tree).props.onRetry as () => void)();
    tree = await settle(rerender(), 3);
    expect(grid(tree).props.onRetry).toBeUndefined();
    expect(grid(tree).props.loading).toBe(true);
  });

  it('tras un error, si la lectura siguiente sale bien no queda el aviso de error', async () => {
    let tree = await mount();
    vi.mocked(queryReportColumns).mockRejectedValueOnce(new ApiError('Bad gateway', 502));
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 3);
    expect(grid(tree).props.onRetry).toBeTypeOf('function');
    click(tabNamed(tree, 'Views'));
    tree = await settle(rerender(), 3);
    click(tabNamed(tree, 'Columns'));
    tree = await settle(rerender(), 3);
    expect(grid(tree).props.onRetry).toBeUndefined();
    expect((grid(tree).props.rows as unknown[]).length).toBe(2);
  });
});

describe('plantilla', () => {
  it('la card lee todas las columnas (la posición se cuenta sobre todas) y recibe el recorte de la búsqueda', async () => {
    let tree = await mount();
    const idle = all(tree).find((e) => typeof e.props.fetchColumns === 'function')!;
    expect(idle.props.keepColumn).toBeUndefined();                    // sin búsqueda, sin recorte
    click(scopeTab(tree, 'Columns / attributes'));
    tree = rerender();
    type(searchInput(tree), 'cod');
    tree = await settle(rerender(), 8, 110);
    const card = all(tree).find((e) => typeof e.props.fetchColumns === 'function')!;
    const cols = await (card.props.fetchColumns as (ids: string[]) => Promise<ReportColumnRow[]>)(['t1']);
    expect(cols.map((c) => c.physicalName)).toEqual(['CODCLIENTE', 'NOMBRE']);
    const keep = card.props.keepColumn as (c: ReportColumnRow) => boolean;
    expect(cols.filter(keep).map((c) => c.physicalName)).toEqual(['CODCLIENTE']);
  });
});

describe('export por hojas', () => {
  it('baja las hojas incluidas, en el orden del libro, con la búsqueda aplicada', async () => {
    let tree = await mount();
    click(includeBox(tree, 'Views'));
    tree = rerender();
    click(includeBox(tree, 'Columns'));                     // se marcan en otro orden: Views antes que Columns
    tree = rerender();
    click(includeBox(tree, 'Columns'));
    click(scopeTab(tree, 'Views'));
    tree = rerender();
    type(searchInput(tree), 'vw_cli');
    tree = await settle(rerender(), 8, 110);
    expect(searchReportTables).toHaveBeenLastCalledWith('p1', 'vw_cli', 'views', null);
    expect(tabNamed(tree, 'Views').props['aria-current']).toBe('true');            // el alcance muestra su hoja
    click(tabNamed(tree, 'Tables'));                                            // las filas se eligen en Tables
    tree = rerender();
    const selectAll = all(tree).find((e) => e.props['aria-label'] === 'Select all rows')!;
    click(selectAll);
    tree = rerender();
    await (download(tree).props.onClick as () => Promise<void>)();
    const sheets = writtenSheets();
    expect(sheets.map((s) => s.name)).toEqual(['Tables', 'Columns', 'Views']);
    expect(rowsOf(sheets[0]).map((r) => r.Table)).toEqual(['CLIENTE']);
    expect(rowsOf(sheets[2]).map((r) => r.View)).toEqual(['VW_CLIENTE']);         // VW_OTRA no coincide
    expect(rowsOf(sheets[1]).map((r) => r.Column)).toEqual(['CODCLIENTE', 'NOMBRE']); // Views no recorta columnas
    expect(vi.mocked(saveXlsx).mock.calls[0][1]).toMatch(/^data-model-hub-report-P-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
