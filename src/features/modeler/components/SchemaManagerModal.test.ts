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
const { dropRedo } = vi.hoisted(() => ({ dropRedo: vi.fn() }));
vi.mock('@/store/useUndoStore', () => ({ useUndoStore: { getState: () => ({ dropRedo }) } }));
const { invalidateTableSchemas } = vi.hoisted(() => ({ invalidateTableSchemas: vi.fn() }));
vi.mock('../services/schemaPartition', () => ({ invalidateTableSchemas }));
vi.mock('../lib/sessionGuard', () => ({
  pinSession: () => ({ check: () => undefined, holds: () => true }),
  reportWriteError: (r: (e: unknown) => void) => async (e: unknown) => r(e),
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
  STATE.markDirty.mockClear(); dropRedo.mockClear(); invalidateTableSchemas.mockClear();
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

  // Renombrar, cambiar el tipo o borrar un esquema graba en la versión por su
  // propio endpoint (sin aviso de escritura): lo pendiente de rehacer ya no calza.
  it('aplicar un cambio vacía lo pendiente de rehacer; si no se aplicó nada, no', async () => {
    resetFake((init, i) => (i === 0 ? [SET_KIND] : init));
    let tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await vi.waitFor(() => expect(dropRedo).toHaveBeenCalledTimes(1));
    dropRedo.mockClear();
    svc.setSchemaKind.mockRejectedValueOnce(new Error('409'));
    resetFake((init, i) => (i === 0 ? [SET_KIND] : init));
    tree = SchemaManagerModal({ onClose: vi.fn(), pushToast: vi.fn() });
    (byText(tree.props.footer, 'button', 'Save 1 change').props.onClick as () => void)();
    await vi.waitFor(() => expect(invalidateTableSchemas).toHaveBeenCalled());
    expect(dropRedo).not.toHaveBeenCalled();
  });
});
