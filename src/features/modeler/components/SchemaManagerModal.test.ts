// Structure · Schemas sin DOM (hooks simulados: ver
// features/reporting/components/fakeReact.testutil): el badge muestra el kind
// guardado («tables + views» para `both`), «Both» se ofrece al crear y el cambio
// de kind de una fila queda pendiente y se guarda en la versión.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, nextStates, resetFake, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const { STATE, svc } = vi.hoisted(() => ({
  STATE: {
    schemas: [
      { id: 's1', name: 'core_ventas_vu', description: null, kind: 'tables' },
      { id: 's2', name: 'core_base', description: 'core', kind: 'both' },
      { id: 's3', name: 'Not_defined', description: null, kind: 'both' },
    ],
    loadSchemas: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    markDirty: vi.fn(),
  },
  svc: {
    createSchema: vi.fn(async () => ({})),
    renameSchema: vi.fn(async () => ({ tables: 0, views: 0 })),
    deleteSchema: vi.fn(async () => undefined),
    setSchemaKind: vi.fn(async () => undefined),
    schemaImpact: vi.fn(async () => ({ name: '', tables: 0, views: 0, canvases: 0 })),
  },
}));
vi.mock('@/store/useModelerStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick(STATE);
  hook.getState = () => STATE;
  return { useModelerStore: hook };
});
vi.mock('@/store/useSessionStore', () => ({ useSessionStore: (pick: (s: unknown) => unknown) => pick({ activeVersionLabel: 'v3' }) }));
vi.mock('@/store/useBusyStore', () => ({ runBlocking: async (_label: string, fn: () => Promise<void>) => fn() }));
vi.mock('@/components/ui/dialogs', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('../services/schemas.service', () => svc);
const { clear, historyRunning } = vi.hoisted(() => ({ clear: vi.fn(), historyRunning: vi.fn((): string | null => null) }));
vi.mock('@/store/useUndoStore', () => ({ useUndoStore: { getState: () => ({ clear }) }, historyRunning }));
const { invalidateTableSchemas } = vi.hoisted(() => ({ invalidateTableSchemas: vi.fn() }));
vi.mock('../services/schemaPartition', () => ({ invalidateTableSchemas }));
const { errGate } = vi.hoisted(() => ({ errGate: { wait: null as Promise<void> | null } }));
vi.mock('../lib/sessionGuard', () => ({
  pinSession: () => ({ check: () => undefined, holds: () => true }),
  // Un error de la versión espera la revalidación antes de mostrarse (`errGate`).
  reportWriteError: (r: (e: unknown) => void) => async (e: unknown) => { if (errGate.wait) await errGate.wait; r(e); },
}));
import SchemaManagerModal from './SchemaManagerModal';

const SET_KIND = { kind: 'setKind', key: 'kind:s1', id: 's1', name: 'core_ventas_vu', from: 'tables', to: 'views' };
/** `staged` es el 1.er useState y `kindEdit` el 7.º. */
const mount = (staged: unknown[] = [], kindEdit: string | null = null) => {
  resetFake((init, i) => (i === 0 ? staged : i === 6 ? kindEdit : init));
  return SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
};
const byTitle = (tree: unknown, title: string): El => {
  const hit = [...walk(tree)].find((e) => e.type === 'button' && e.props.title === title);
  if (!hit) throw new Error(`no button «${title}»`);
  return hit;
};

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockClear());
  STATE.markDirty.mockClear(); clear.mockClear(); invalidateTableSchemas.mockClear();
});

describe('SchemaManagerModal', () => {
  it('el badge muestra el kind guardado: «tables + views» para both', () => {
    const text = textOf(mount());
    expect(text).toContain('core_ventas_vutables');
    expect(text).toContain('core_basetables + views');
  });

  it('el esquema por defecto es del sistema: su fila no ofrece acciones', () => {
    const tree = mount();
    const row = [...walk(tree)].find((e) => (e as unknown as { key?: string | null }).key === 's3');
    if (!row) throw new Error('no row s3');
    expect(textOf(row)).toContain('system default');
    expect([...walk(row)].some((e) => e.type === 'button')).toBe(false);
    expect([...walk(tree)].filter((e) => e.type === 'button' && e.props.title === 'Delete (only if empty)')).toHaveLength(2);
  });

  it('crear ofrece Tables, Views y Both', () => {
    const tree = mount();
    expect(['Tables', 'Views', 'Both'].map((l) => byText(tree, 'button', l).type)).toEqual(['button', 'button', 'button']);
  });

  it('abrir el selector de la fila y elegir Views deja un setKind pendiente', () => {
    const tree = mount([], 's1');
    // Dos «Views»: el del alta (arriba) y el del selector de la fila abierta.
    const views = [...walk(tree)].filter((e) => e.type === 'button' && textOf(e) === 'Views');
    expect(views).toHaveLength(2);
    // preselecciona el kind actual del esquema (tables)
    const seg = (label: string) => [...walk(tree)].filter((e) => e.type === 'button' && textOf(e) === label)[1];
    expect([seg('Tables').props.className, seg('Views').props.className, seg('Both').props.className]).toEqual(['active', '', '']);
    (views[1].props.onClick as () => void)();
    expect(nextStates()[0]).toEqual([expect.objectContaining({ kind: 'setKind', id: 's1', from: 'tables', to: 'views' })]);
    expect(nextStates()[6]).toBeNull();
  });

  it('el botón de la fila abre el selector (y no hay selector sin abrirlo)', () => {
    const closed = mount();
    expect([...walk(closed)].filter((e) => e.type === 'button' && textOf(e) === 'Both')).toHaveLength(1);   // solo el de crear
    (byTitle(closed, 'Change what it holds: tables, views or both').props.onClick as () => void)();
    expect(nextStates()[6]).toBe('s1');
  });

  it('con el cambio pendiente, Save lo registra en la versión con el esquema y el kind elegido', async () => {
    const onCloseSpy = vi.fn();
    const pushToast = vi.fn();
    resetFake((init, i) => (i === 0 ? [SET_KIND] : init));
    const tree = SchemaManagerModal({ onClose: onCloseSpy, pushToast });
    expect(textOf(tree)).toContain('views · pending');
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await vi.waitFor(() => expect(svc.setSchemaKind).toHaveBeenCalledTimes(1));
    expect(svc.setSchemaKind).toHaveBeenCalledWith('s1', 'views');
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalledTimes(1));   // el filtro de CTAS re-consulta
    expect(STATE.markDirty).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('1 schema change(s) recorded in your version v3'));
    expect(svc.renameSchema).not.toHaveBeenCalled();
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  // Renombrar, cambiar el tipo o borrar un esquema cambia tablas y vistas que el
  // historial guarda por valor (cada una lleva el nombre de su esquema): deshacer
  // o rehacer algo anterior devolvería el esquema viejo. El historial se vacía
  // (doc 133). Crear uno nuevo no toca nada de lo anterior.
  it.each([
    ['cambiar el tipo', SET_KIND, 'setSchemaKind'],
    ['renombrar', { kind: 'rename', key: 'ren:s1', id: 's1', from: 'core_ventas_vu', to: 'core_ventas_vu2' }, 'renameSchema'],
    ['borrar', { kind: 'delete', key: 'del:s1', id: 's1', name: 'core_ventas_vu' }, 'deleteSchema'],
  ] as const)('%s un esquema vacía el historial; si no se aplicó, no', async (_label, op, write) => {
    resetFake((init, i) => (i === 0 ? [op] : init));
    let tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await vi.waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    clear.mockClear();
    svc[write].mockRejectedValueOnce(new Error('409'));
    resetFake((init, i) => (i === 0 ? [op] : init));
    tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();
  });

  it('guardado parcial: crear y un renombre que falla no vacía; un renombre aplicado y algo después que falla, sí', async () => {
    const create = { kind: 'create', key: 'new:stg_x', name: 'STG_X', schemaKind: 'tables' };
    const rename = { kind: 'rename', key: 'ren:s1', id: 's1', from: 'core_ventas_vu', to: 'core_ventas_vu2' };
    const del = { kind: 'delete', key: 'del:s2', id: 's2', name: 'core_base' };
    svc.renameSchema.mockRejectedValueOnce(new Error('409'));
    resetFake((init, i) => (i === 0 ? [create, rename] : init));
    let tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 2 changes').props.onClick as () => void)();
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalledTimes(1));
    expect(svc.createSchema).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    svc.deleteSchema.mockRejectedValueOnce(new Error('409'));
    resetFake((init, i) => (i === 0 ? [rename, del] : init));
    tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 2 changes').props.onClick as () => void)();
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalledTimes(2));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('si algo ya aplicado obliga a vaciar y después algo falla, vacía antes de esperar la revalidación', async () => {
    const rename = { kind: 'rename', key: 'ren:s1', id: 's1', from: 'core_ventas_vu', to: 'core_ventas_vu2' };
    const del = { kind: 'delete', key: 'del:s2', id: 's2', name: 'core_base' };
    let release!: () => void;
    errGate.wait = new Promise((r) => { release = r; });
    try {
      svc.deleteSchema.mockRejectedValueOnce(new Error('409'));
      resetFake((init, i) => (i === 0 ? [rename, del] : init));
      const tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
      (byText(tree.props.footer, 'button', 'Save 2 changes').props.onClick as () => void)();
      await vi.waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    } finally {
      release();
      errGate.wait = null;
    }
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalled());
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('con un Undo o Redo corriendo, no guarda nada y lo dice', async () => {
    historyRunning.mockReturnValueOnce('Undo or redo is still running — save when it finishes.');
    resetFake((init, i) => (i === 0 ? [SET_KIND] : init));
    const tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await new Promise((r) => setTimeout(r, 5));
    expect(svc.setSchemaKind).not.toHaveBeenCalled();
    expect(nextStates()).toContain('Undo or redo is still running — save when it finishes.');
  });

  it('crear un esquema no vacía el historial', async () => {
    resetFake((init, i) => (i === 0 ? [{ kind: 'create', key: 'new:stg_x', name: 'STG_X', schemaKind: 'tables' }] : init));
    const tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await vi.waitFor(() => expect(svc.createSchema).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();
  });
});
