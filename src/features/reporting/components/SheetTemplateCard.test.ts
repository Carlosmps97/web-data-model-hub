// «Export with a template» sin DOM (hooks de mentira: ver fakeReact.testutil).
// La card avisa al Reporting mientras exporta: los combos Project / Version se
// deshabilitan y el export no baja el archivo de otra versión. Con la versión
// cerrada sale un solo toast (compartido con el aviso «showing Production»),
// nunca sobre una pantalla ya desmontada. Si la versión se transfirió, el
// mensaje lo dice.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import type { SheetTemplate } from '../lib/sheetTemplates';
import { byText, fake, resetFake, runEffects, textOf, walk } from './fakeReact.testutil';

vi.mock('react', async (orig) => (await import('./fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/xlsxWriter', () => ({ buildXlsx: vi.fn(async () => new Blob()), saveXlsx: vi.fn() }));
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (pick: (s: unknown) => unknown) => pick({ user: { username: 'ana' }, has: () => false }),
}));
vi.mock('../sheetTemplates.service', () => ({ listSheetTemplates: vi.fn(async () => []) }));
import { toast } from 'sonner';
import { buildXlsx, saveXlsx, type WorkbookSheet } from '../lib/xlsxWriter';
import SheetTemplateCard from './SheetTemplateCard';
import SheetTemplateEditor from './SheetTemplateEditor';

const TPL: SheetTemplate = {
  id: 't1', projectId: 'p1', origin: 'user', owner: 'ana', name: 'QA', sheetName: 'QA', shared: false, fileName: null,
  columns: [{ header: 'TABLA', source: 'table.physicalName' }],
};
const TABLE = { id: 'tb1', physicalName: 'T1' } as ReportTableRow;
const FORBIDDEN = 'Only published versions and your own drafts can be opened in the canvas. Administrators can open any version.';
const tick = () => new Promise((r) => setTimeout(r, 0));

type Props = Parameters<typeof SheetTemplateCard>[0];
/** La card con la plantilla ya cargada y elegida; `busy` = estado «exportando» en pantalla. */
function render(over: Partial<Props> = {}, busy = false, tpl: SheetTemplate = TPL) {
  // useState en orden: templates, selId, busy, managing.
  resetFake((init, i) => (i === 0 ? [tpl] : i === 1 ? 't1' : i === 2 ? busy : init));
  return SheetTemplateCard({
    projectId: 'p1', selectedCount: 1, disabled: false,
    resolveTables: async () => [TABLE], fetchColumns: async () => [], ...over,
  } as Props);
}
/** Filas de la hoja que recibió el escritor (la única del libro). */
const writtenRows = () => {
  const [[sheets]] = vi.mocked(buildXlsx).mock.calls as unknown as [[WorkbookSheet[]]];
  return Array.from({ length: sheets[0].count }, (_, i) => sheets[0].rowAt(i));
};
const clickExport = async (tree: unknown) => {
  (byText(tree, null, 'Download .xlsx').props.onClick as () => Promise<void>)();
  await tick();
};

beforeEach(() => { vi.clearAllMocks(); resetFake(); });

describe('SheetTemplateCard', () => {
  it('avisa al Reporting mientras exporta, y «libre» al terminar o desmontarse', () => {
    const onBusyChange = vi.fn();
    render({ onBusyChange }, true);
    const unmount = runEffects();
    expect(onBusyChange.mock.calls).toEqual([[true]]);
    unmount.forEach((c) => c());
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);

    onBusyChange.mockClear();
    render({ onBusyChange }, false);
    runEffects();
    expect(onBusyChange.mock.calls).toEqual([[false]]);
  });

  it('modo versión: el error sale con el id compartido y, si la versión se transfirió, lo dice', async () => {
    const tree = render({ versionToastId: 'dmh-rep-version', fetchColumns: async () => { throw new ApiError(FORBIDDEN, 403, FORBIDDEN); } });
    runEffects();
    await clickExport(tree);
    expect(vi.mocked(toast.error).mock.calls).toEqual([
      ['This version is no longer available to you — showing Production.', { id: 'dmh-rep-version' }],
    ]);
  });

  it('producción: el error del backend tal cual y sin id', async () => {
    const tree = render({ fetchColumns: async () => { throw new ApiError(FORBIDDEN, 403, FORBIDDEN); } });
    runEffects();
    await clickExport(tree);
    expect(vi.mocked(toast.error).mock.calls).toHaveLength(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(FORBIDDEN);
    expect(vi.mocked(toast.error).mock.calls[0][1]?.id).toBeUndefined();
  });

  it('si la pantalla se desmontó mientras exportaba, el error no sale sobre la pantalla nueva', async () => {
    let fail: (e: unknown) => void = () => {};
    const tree = render({
      versionToastId: 'dmh-rep-version',
      fetchColumns: () => new Promise((_, reject) => { fail = reject; }),
    });
    const unmount = runEffects();
    const done = (byText(tree, null, 'Download .xlsx').props.onClick as () => Promise<void>)();
    await tick();
    unmount.forEach((c) => c());          // el wrapper volvió a Production: la card se desmontó
    fail(new ApiError('That version is no longer open.', 409));
    await done;
    expect(toast.error).not.toHaveBeenCalled();
    expect(saveXlsx).not.toHaveBeenCalled();
  });

  it('un export que termina bien sigue bajando el archivo', async () => {
    const tree = render();
    runEffects();
    await clickExport(tree);
    expect(saveXlsx).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Exported with the QA template.');
  });

  it('escribe una hoja con el nombre y las columnas fijas de la plantilla, sin límite de tamaño', async () => {
    const tree = render();
    runEffects();
    await clickExport(tree);
    const [[sheets]] = vi.mocked(buildXlsx).mock.calls as unknown as [[WorkbookSheet[]]];
    expect(sheets.map((x) => [x.name, x.header])).toEqual([['QA', ['TABLA']]]);
    expect(writtenRows()).toEqual([]);                 // la tabla no tiene columnas
    expect(vi.mocked(saveXlsx).mock.calls[0][1]).toMatch(/^QA-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  describe('con filtros', () => {
    const PK_ONLY: SheetTemplate = { ...TPL, columns: [{ header: 'CAMPO', source: 'column.physicalName' }],
      filters: [{ source: 'column.isPrimaryKey', op: 'isNotEmpty' }] };
    const column = (physicalName: string, isPrimaryKey: boolean) =>
      ({ tableId: 'tb1', physicalName, isPrimaryKey, ordinal: 0 }) as ReportColumnRow;

    it('la card dice cuántos filtros tiene la plantilla elegida', () => {
      expect(textOf(render({}, false, PK_ONLY))).toContain('1 filter · only matching rows are exported');
      expect(textOf(render())).not.toContain('only matching rows');
    });

    it('baja solo las filas que cumplen y el aviso dice cuántas', async () => {
      const tree = render({ fetchColumns: async () => [column('ID', true), column('NOMBRE', false)] }, false, PK_ONLY);
      runEffects();
      await clickExport(tree);
      expect(writtenRows()).toEqual([{ CAMPO: 'ID' }]);
      expect(saveXlsx).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith('Exported 1 row with the QA template.');
    });

    it('sin columnas en las tablas elegidas no culpa a los filtros: baja la hoja como sin filtros', async () => {
      const tree = render({ fetchColumns: async () => [] }, false, PK_ONLY);
      runEffects();
      await clickExport(tree);
      expect(toast.info).not.toHaveBeenCalled();
      expect(saveXlsx).toHaveBeenCalledTimes(1);
    });

    it('la búsqueda del Reporting recorta sin renumerar la posición de la columna', async () => {
      const POS: SheetTemplate = { ...TPL, columns: [{ header: 'CAMPO', source: 'column.physicalName' }, { header: 'ORDEN', source: 'column.position' }] };
      const cols = [{ ...column('ID', true), ordinal: 1 }, { ...column('NOMBRE', false), ordinal: 2 }, { ...column('CODCLIENTE', false), ordinal: 3 }];
      const tree = render({ fetchColumns: async () => cols, keepColumn: (c) => c.physicalName.includes('COD') }, false, POS);
      runEffects();
      await clickExport(tree);
      expect(writtenRows()).toEqual([{ CAMPO: 'CODCLIENTE', ORDEN: 3 }]);
      expect(toast.success).toHaveBeenCalledWith('Exported 1 row with the QA template.');
    });

    it('con filtros que sí dejan filas y una búsqueda que las vacía, el aviso culpa a la búsqueda', async () => {
      const tree = render({ fetchColumns: async () => [column('ID', true)], keepColumn: () => false }, false, PK_ONLY);
      runEffects();
      await clickExport(tree);
      expect(saveXlsx).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith('No columns match the search — nothing was exported.');
    });

    it('si los filtros solos ya no dejan filas, el aviso culpa a los filtros (haya o no búsqueda)', async () => {
      const tree = render({ fetchColumns: async () => [column('NOMBRE', false)], keepColumn: () => true }, false, PK_ONLY);
      runEffects();
      await clickExport(tree);
      expect(toast.info).toHaveBeenCalledWith('No rows match the template filters — nothing was exported.');
    });

    it('si la búsqueda no deja filas, avisa y no baja un libro vacío', async () => {
      const tree = render({ fetchColumns: async () => [column('NOMBRE', false)], keepColumn: () => false });
      runEffects();
      await clickExport(tree);
      expect(saveXlsx).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith('No columns match the search — nothing was exported.');
    });

    it('si ninguna fila cumple, avisa y no baja nada', async () => {
      const tree = render({ fetchColumns: async () => [column('NOMBRE', false)] }, false, PK_ONLY);
      runEffects();
      await clickExport(tree);
      expect(saveXlsx).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith('No rows match the template filters — nothing was exported.');
    });
  });
});

describe('SheetTemplateCard · bloqueo', () => {
  it('reemplaza en su lista la plantilla que el editor bloqueó, sin recargar las demás', () => {
    const otra: SheetTemplate = { ...TPL, id: 't2', name: 'Otra' };
    // useState en orden: templates, selId, busy, managing (el editor abierto).
    resetFake((init, i) => (i === 0 ? [TPL, otra] : i === 1 ? 't1' : i === 3 ? true : init));
    const tree = SheetTemplateCard({
      projectId: 'p1', selectedCount: 1, disabled: false, resolveTables: async () => [TABLE], fetchColumns: async () => [],
    } as Props);
    const editor = [...walk(tree)].find((e) => e.type === SheetTemplateEditor);
    (editor?.props.onLockChanged as (t: SheetTemplate) => void)({ ...TPL, locked: true });
    const [update] = fake.states[0].calls as ((l: SheetTemplate[]) => SheetTemplate[])[];
    const list = [TPL, otra];
    const next = update(list);
    expect(next).toEqual([{ ...TPL, locked: true }, otra]);
    expect(next[1]).toBe(otra);                            // la otra, el mismo objeto: su borrador no se re-sincroniza
  });
});
