// Menú de clic derecho sin DOM (hooks simulados: ver
// features/reporting/components/fakeReact.testutil): dibuja los ítems de
// `lib/canvasMenu.ts` —lo que no aplica, deshabilitado con su motivo; borrar en
// rojo tras un separador— y cada ítem llama a su acción: copiar y pegar como
// Ctrl/Cmd+C/V, los borrados por los flujos compartidos con Properties, que se
// cortan si el menú se cerró mientras leían.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const { STATE, SESSION, flows } = vi.hoisted(() => ({
  STATE: {} as Record<string, unknown>,
  SESSION: {} as Record<string, unknown>,
  flows: {
    askDeleteColumns: vi.fn<(o: unknown) => Promise<void>>(async () => {}),
    askDeleteTable: vi.fn<(o: unknown) => Promise<void>>(async () => {}),
    askRemoveFromCanvas: vi.fn<(o: unknown) => Promise<void>>(async () => {}),
  },
}));
vi.mock('@/store/useModelerStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick(STATE);
  hook.getState = () => STATE;
  return { useModelerStore: hook };
});
vi.mock('@/store/useSessionStore', () => ({ useSessionStore: (pick: (s: unknown) => unknown) => pick(SESSION) }));
vi.mock('./deleteFlows', () => flows);
import ColumnContextMenu from './ColumnContextMenu';

const col = (id: string, ordinal: number, extra: object = {}) =>
  ({ id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: `log_${id}`, dataType: 'INT', typeOverridden: false, ordinal, ...extra });
const TABLE = { id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' };
const ROW_MENU = { x: 10, y: 20, tableId: 't1', colId: 'c2' };
const TABLE_MENU = { x: 10, y: 20, tableId: 't1', colId: null, kind: 'table' };
const pushToast = vi.fn();

const render = (pending: unknown = null) => {
  resetFake((init, i) => (i === 0 ? pending : init));
  return ColumnContextMenu({ pushToast });
};
const buttons = (tree: unknown) => [...walk(tree)].filter((el) => el.type === 'button');
const item = (tree: unknown, label: string): El => {
  const hit = buttons(tree).find((b) => textOf(b).startsWith(label));
  if (!hit) throw new Error(`no item «${label}»`);
  return hit;
};
const click = (el: El) => (el.props.onClick as () => void)();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(SESSION, { openMode: 'editing', activeChangesetId: 'cs1' });
  Object.assign(STATE, {
    colMenu: ROW_MENU, viewMode: 'physical',
    colSel: { tableId: 't1', ids: ['c2', 'c1'], anchor: 'c2' },
    colClipboard: null, tblClipboard: null,
    diagram: { tables: [TABLE], columns: [col('c2', 5), col('c1', 9), col('pk', 7, { isPrimaryKey: true }), col('c3', 1)] },
    closeColMenu: vi.fn(() => { STATE.colMenu = null; }),
    copySelectedColumns: vi.fn(() => 2), copyTable: vi.fn(() => 'CLIENTE'),
    setSelectedTable: vi.fn(), setPasteTarget: vi.fn(), setTablePasteOpen: vi.fn(),
    deleteColumns: vi.fn(), deleteTable: vi.fn(), removeTableFromArea: vi.fn(),
  });
});

describe('qué dibuja', () => {
  it('sin menú abierto, nada', () => {
    STATE.colMenu = null;
    expect(render()).toBeNull();
  });

  it('en una fila sin nada copiado: Paste deshabilitado con su motivo; Delete en rojo tras un separador', () => {
    const tree = render();
    expect(buttons(tree).map((b) => [textOf(b).replace(/(⌘|Ctrl\+)[CV]$/, ''), !b.props.disabled]))
      .toEqual([['Copy 2 columns', true], ['Paste', false], ['Delete 2 columns…', true]]);
    expect(item(tree, 'Paste').props.title).toBe('Nothing copied');
    expect(item(tree, 'Delete 2 columns…').props.className).toBe('danger');
    const flat = [...walk(tree)];
    const sep = flat.findIndex((el) => el.props.className === 'wk-ctxmenu-sep');
    expect(sep).toBeGreaterThan(-1);
    expect(flat.indexOf(item(tree, 'Delete 2 columns…'))).toBeGreaterThan(sep);
  });

  it('en la tabla, en solo lectura: Copy table habilitado; Paste, Remove y Delete deshabilitados con el motivo', () => {
    Object.assign(SESSION, { openMode: 'readonly' });
    STATE.colMenu = TABLE_MENU;
    const tree = render();
    expect(item(tree, 'Copy table').props.disabled).toBe(false);
    for (const label of ['Paste', 'Remove from this canvas', 'Delete table…']) expect(item(tree, label).props.disabled).toBe(true);
    expect(item(tree, 'Delete table…').props.title).toBe('Open the model in edit mode to delete');
  });

  it('mientras un borrado lee su impacto: spinner en ese ítem y todo deshabilitado', () => {
    const tree = render({ menu: ROW_MENU, action: 'delete-columns' });
    expect(buttons(tree).every((b) => b.props.disabled === true)).toBe(true);
    expect([...walk(item(tree, 'Delete 2 columns…'))].some((el) => el.props.className === 'rd-spin')).toBe(true);
  });

  it('el spinner de otro menú (ya cerrado) no cuenta', () => {
    const tree = render({ menu: { ...ROW_MENU }, action: 'delete-columns' });
    expect(item(tree, 'Copy 2 columns').props.disabled).toBe(false);
  });
});

describe('qué hace cada ítem', () => {
  it('Copy copia la selección y avisa', () => {
    click(item(render(), 'Copy 2 columns'));
    expect(STATE.copySelectedColumns).toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/^2 columns copied/));
    expect(STATE.closeColMenu).toHaveBeenCalled();
  });

  it('Paste con columnas copiadas abre su confirmación sobre esta tabla; con una tabla copiada, la revisión de pegar tabla', () => {
    STATE.colClipboard = { cols: [col('x', 0)] };
    click(item(render(), 'Paste 1 column'));
    expect(STATE.setPasteTarget).toHaveBeenCalledWith('t1');
    expect(STATE.setTablePasteOpen).not.toHaveBeenCalled();
    Object.assign(STATE, { colMenu: ROW_MENU, colClipboard: null, tblClipboard: { table: TABLE, cols: [] } });
    click(item(render(), 'Paste table CLIENTE…'));
    expect(STATE.setTablePasteOpen).toHaveBeenCalledWith(true);
  });

  it('Delete N columns… llama al flujo con las columnas en el orden de la tabla y se corta si el menú se cerró', () => {
    click(item(render(), 'Delete 2 columns…'));
    expect(nextStates()[0]).toEqual({ menu: ROW_MENU, action: 'delete-columns' });
    const o = flows.askDeleteColumns.mock.calls[0][0] as Record<string, unknown> & { cols: { id: string }[]; stillWanted: () => boolean; beforeDialog: () => void };
    expect(o).toMatchObject({ tableId: 't1', tableName: 'CLIENTE', viewMode: 'physical', deleteColumns: STATE.deleteColumns });
    expect(o.cols.map((c) => c.id)).toEqual(['c2', 'c1']);   // ordinal 5 y 9
    expect(o.stillWanted()).toBe(true);
    o.beforeDialog();
    expect(STATE.closeColMenu).toHaveBeenCalled();
    expect(o.stillWanted()).toBe(false);
  });

  it('un borrado que termina tarde (su menú ya se cerró) no le quita el spinner al de otro menú', async () => {
    let finishA!: () => void;
    flows.askDeleteColumns.mockImplementationOnce(() => new Promise<void>((r) => { finishA = r; }));
    click(item(render(), 'Delete 2 columns…'));          // A: menú de la fila, lee su impacto
    const MENU_B = { ...ROW_MENU, x: 50 };
    STATE.colMenu = MENU_B;                              // A se cerró; B empezó su propio borrado
    resetFake((init, i) => (i === 0 ? { menu: MENU_B, action: 'delete-columns' } : init), { keepRefs: true });
    ColumnContextMenu({ pushToast });
    finishA();
    await new Promise((r) => setTimeout(r, 0));
    expect(nextStates()[0]).toEqual({ menu: MENU_B, action: 'delete-columns' });
  });

  it('en lógico, el nombre de la tabla es el lógico', () => {
    STATE.viewMode = 'logical';
    click(item(render(), 'Delete 2 attributes…'));
    expect(flows.askDeleteColumns.mock.calls[0][0]).toMatchObject({ tableName: 'Cliente', viewMode: 'logical' });
  });

  it('Remove from this canvas cierra el menú y usa el flujo de Properties', () => {
    STATE.colMenu = TABLE_MENU;
    click(item(render(), 'Remove from this canvas'));
    expect(STATE.closeColMenu).toHaveBeenCalled();
    expect(flows.askRemoveFromCanvas).toHaveBeenCalledWith(expect.objectContaining({ table: TABLE, remove: STATE.removeTableFromArea }));
  });

  it('Delete table… usa el flujo de Properties y se corta si el menú se cerró', () => {
    STATE.colMenu = TABLE_MENU;
    click(item(render(), 'Delete table…'));
    const o = flows.askDeleteTable.mock.calls[0][0] as unknown as { table: unknown; deleteTable: unknown; stillWanted: () => boolean };
    expect(o).toMatchObject({ table: TABLE, deleteTable: STATE.deleteTable });
    expect(o.stillWanted()).toBe(true);
    STATE.colMenu = null;
    expect(o.stillWanted()).toBe(false);
  });
});
