// «Export with a template» sin DOM (hooks de mentira: ver fakeReact.testutil).
// Doc 105 (B3): el Reporting no sabía que la card exportaba — los combos Project
// / Version seguían habilitados y el export bajaba el archivo de la versión
// anterior. Doc 105 (R2-B3): con la versión cerrada salían dos toasts (el error
// y el aviso «showing Production»), uno sobre la pantalla ya desmontada.
// Doc 105 (A5-o4): una versión transferida mostraba el texto del canvas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { ReportTableRow } from '@/services/reporting.service';
import type { SheetTemplate } from '../lib/sheetTemplates';
import { byText, resetFake, runEffects } from './fakeReact.testutil';

vi.mock('react', async (orig) => (await import('./fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('xlsx', () => ({
  utils: { book_new: vi.fn(() => ({})), json_to_sheet: vi.fn(() => ({})), book_append_sheet: vi.fn() }, writeFile: vi.fn(),
}));
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (pick: (s: unknown) => unknown) => pick({ user: { username: 'ana' }, has: () => false }),
}));
vi.mock('../sheetTemplates.service', () => ({ listSheetTemplates: vi.fn(async () => []) }));
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import SheetTemplateCard from './SheetTemplateCard';

const TPL: SheetTemplate = {
  id: 't1', projectId: 'p1', origin: 'user', owner: 'ana', name: 'QA', sheetName: 'QA', shared: false, fileName: null,
  columns: [{ header: 'TABLA', source: 'table.physicalName' }],
};
const TABLE = { id: 'tb1', physicalName: 'T1' } as ReportTableRow;
const FORBIDDEN = 'Only published versions and your own drafts can be opened in the canvas. Administrators can open any version.';
const tick = () => new Promise((r) => setTimeout(r, 0));

type Props = Parameters<typeof SheetTemplateCard>[0];
/** La card con la plantilla ya cargada y elegida; `busy` = estado «exportando» en pantalla. */
function render(over: Partial<Props> = {}, busy = false) {
  // useState en orden: templates, selId, busy, managing.
  resetFake((init, i) => (i === 0 ? [TPL] : i === 1 ? 't1' : i === 2 ? busy : init));
  return SheetTemplateCard({
    projectId: 'p1', selectedCount: 1, disabled: false,
    resolveTables: async () => [TABLE], fetchColumns: async () => [], ...over,
  } as Props);
}
const clickExport = async (tree: unknown) => {
  (byText(tree, null, 'Download .xlsx').props.onClick as () => Promise<void>)();
  await tick();
};

beforeEach(() => { vi.clearAllMocks(); resetFake(); });

describe('SheetTemplateCard', () => {
  it('B3: avisa al Reporting mientras exporta, y «libre» al terminar o desmontarse', () => {
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

  it('R2-B3: si la pantalla se desmontó mientras exportaba, el error no sale sobre la pantalla nueva', async () => {
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
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });

  it('un export que termina bien sigue bajando el archivo', async () => {
    const tree = render();
    runEffects();
    await clickExport(tree);
    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Exported with the QA template.');
  });
});
