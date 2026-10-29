// La base del guardado de una columna (doc 133 §13, P2): lo que el panel manda
// al cerrarse (o cambiar de columna o de canvas) puede salir con otro canvas
// abierto, sin la columna. Sin ella en el canvas abierto —o si se pide
// (`fromServer`)— el documento se arma con la columna vigente de la versión; si
// ya no está (borrada), no se graba: un guardado no revive una columna. El paso
// queda en el canvas donde se tipeó (el `pin` de ese momento). Devuelve la
// columna sobre la que grabó (null si no grabó).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) =>
  (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/views.service', async (orig) => ({
  ...(await orig<object>()), listViews: vi.fn(async () => []),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, updateColumn: vi.fn(), recordChangesBulk: vi.fn(), currentColumns: vi.fn(), listColumns: vi.fn() };
});

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { pinSession } from '../features/modeler/lib/sessionGuard';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const COL = { id: 'c1', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0 } as gov.CanonicalColumn;
/** La working copy: lo grabado. */
let saved: Map<string, gov.CanonicalColumn>;
let reload: ReturnType<typeof vi.fn>;

/** El canvas A muestra la tabla de la columna (con lo que se pase); el B, otra. */
function openA(columns: gov.CanonicalColumn[]) {
  useModelerStore.setState({
    activeSaId: 'saA',
    diagram: {
      subjectArea: { id: 'saA', projectId: 'p', name: 'A', tableIds: ['t1'], viewIds: [], layout: {}, routes: {} },
      tables: [{ id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' }], columns, relationships: [], views: [],
    } as never,
  });
}
function openB() {
  useModelerStore.setState({
    activeSaId: 'saB',
    diagram: {
      subjectArea: { id: 'saB', projectId: 'p', name: 'B', tableIds: ['t2'], viewIds: [], layout: {}, routes: {} },
      tables: [{ id: 't2', physicalName: 'PEDIDO', logicalName: 'Pedido' }], columns: [], relationships: [], views: [],
    } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(viewsSvc.listViews).mockResolvedValue([] as never);
  useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs1' });
  useUndoStore.getState().clear();
  saved = new Map([['c1', { ...COL }]]);
  reload = vi.fn(async () => {});
  useModelerStore.setState({ reload } as never);
  vi.mocked(gov.updateColumn).mockImplementation(async (c) => { saved.set(c.id, { ...c }); return {} as never; });
  vi.mocked(gov.currentColumns).mockImplementation(async (ids) => ids.flatMap((id) => (saved.has(id) ? [{ ...saved.get(id)! }] : [])));
  vi.mocked(gov.listColumns).mockImplementation(async (tableId) => [...saved.values()].filter((c) => c.tableId === tableId).map((c) => ({ ...c })));
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    for (const ch of changes) if (ch.collection === 'canonical_columns') saved.set(ch.entityId, { ...(ch.payload as unknown as gov.CanonicalColumn) });
    return undefined as never;
  });
});

describe('guardado de una columna que no está en el canvas abierto', () => {
  it('graba sobre su documento vigente, con un Undo, y no recarga el canvas abierto', async () => {
    saved.set('c1', { ...COL, description: 'grabada' });
    openB();
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' })).resolves.toEqual({ views: 0 });
    expect(saved.get('c1')).toMatchObject({ logicalName: 'nuevo', description: 'grabada', physicalName: 'NOMBRE' });
    expect(gov.currentColumns).toHaveBeenCalledWith(['c1']);
    expect(reload).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Edit column NOMBRE']);
  });

  it('si ya no está en la versión (borrada), no graba ni apila: no la revive', async () => {
    saved.clear();
    openB();
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' })).resolves.toBeNull();
    expect(gov.updateColumn).not.toHaveBeenCalled();
    expect(saved.size).toBe(0);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('entrar a la llave: el lugar en el bloque de PK sale de las columnas vigentes de su tabla', async () => {
    saved = new Map([
      ['k', { ...COL, id: 'k', physicalName: 'K', logicalName: 'k', isPrimaryKey: true, ordinal: 0 }],
      ['a', { ...COL, id: 'a', physicalName: 'A', logicalName: 'a', ordinal: 1 }],
      ['c1', { ...COL, ordinal: 2 }],
    ]);
    openB();
    await expect(useModelerStore.getState().updateColumn('c1', { isPrimaryKey: true })).resolves.toEqual({ views: 0 });
    expect(gov.listColumns).toHaveBeenCalledWith('t1');
    expect(saved.get('c1')).toMatchObject({ isPrimaryKey: true, ordinal: 1 });
    expect(saved.get('a')).toMatchObject({ ordinal: 2 });
    expect(reload).not.toHaveBeenCalled();
  });

  it('si la sesión cambia mientras lee la vigente, no graba', async () => {
    openB();
    vi.mocked(gov.currentColumns).mockImplementationOnce(async () => {
      useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs2' });
      return [{ ...COL }];
    });
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' })).resolves.toBeNull();
    expect(gov.updateColumn).not.toHaveBeenCalled();
  });
});

describe('lo que el panel manda al cerrarse (`fromServer`)', () => {
  it('aunque esté en el canvas abierto, la base es la vigente (el diagrama puede no traer lo último) y recarga', async () => {
    openA([{ ...COL }]);
    saved.set('c1', { ...COL, description: 'grabada después' });
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' }, { fromServer: true })).resolves.toEqual({ views: 0 });
    expect(saved.get('c1')).toMatchObject({ logicalName: 'nuevo', description: 'grabada después' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('borrada en la versión aunque el diagrama todavía la muestre: no la revive', async () => {
    openA([{ ...COL }]);
    saved.clear();
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' }, { fromServer: true })).resolves.toBeNull();
    expect(gov.updateColumn).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('el paso queda en el canvas donde se tipeó (su `pin`), no en el abierto al grabar', async () => {
    openA([{ ...COL }]);
    const pin = pinSession();
    openB();
    await useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' }, { fromServer: true, pin });
    expect(useUndoStore.getState().stack.map((e) => [e.label, e.canvasId])).toEqual([['Edit column NOMBRE', 'saA']]);
  });

  it('con la sesión del `pin` ya cambiada, no graba', async () => {
    openA([{ ...COL }]);
    const pin = pinSession();
    useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs2' });
    openA([{ ...COL }]);
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' }, { pin })).resolves.toBeNull();
    expect(gov.updateColumn).not.toHaveBeenCalled();
  });
});

describe('sin canvas abierto (p. ej. lo cerró un reload fallido)', () => {
  it('nada que editar: no graba', async () => {
    useModelerStore.setState({ activeSaId: null, diagram: null });
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' })).resolves.toBeNull();
    expect(gov.currentColumns).not.toHaveBeenCalled();
    expect(gov.updateColumn).not.toHaveBeenCalled();
  });

  it('salvo lo que el panel manda al cerrarse: sobre la vigente, sin recargar', async () => {
    openA([{ ...COL }]);
    const pin = pinSession();
    useModelerStore.setState({ activeSaId: null, diagram: null });
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' }, { fromServer: true, pin })).resolves.toEqual({ views: 0 });
    expect(saved.get('c1')).toMatchObject({ logicalName: 'nuevo' });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('renombres en la fila (doc 133 §14, P9)', () => {
  it('el segundo re-apunta las vistas desde el nombre que dejó el primero, aunque su recarga no haya llegado', async () => {
    openA([{ ...COL }]);                             // la recarga no trae lo grabado: el diagrama sigue con NOMBRE
    let view = { id: 'v1', name: 'V', tableId: 't1', sources: [{ tableId: 't1', column: 'NOMBRE' }] };
    vi.mocked(viewsSvc.listViews).mockImplementation(async () => [structuredClone(view)] as never);
    vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
      for (const ch of changes) {
        if (ch.collection === 'views') view = structuredClone(ch.payload) as typeof view;
        else saved.set(ch.entityId, { ...(ch.payload as unknown as gov.CanonicalColumn) });
      }
      return undefined as never;
    });
    const [first, second] = await Promise.all([
      useModelerStore.getState().updateColumn('c1', { physicalName: 'NOMBRE_1' }),
      useModelerStore.getState().updateColumn('c1', { physicalName: 'NOMBRE_2' }),
    ]);
    expect([first, second]).toEqual([{ views: 1 }, { views: 1 }]);
    expect(saved.get('c1')?.physicalName).toBe('NOMBRE_2');
    expect(view.sources.map((x) => x.column)).toEqual(['NOMBRE_2']);
  });
});

describe('en el canvas abierto (lo de siempre)', () => {
  it('arma el documento con el diagrama, sin leer el servidor (sin latencia extra), y recarga', async () => {
    openA([{ ...COL, description: 'en pantalla' }]);
    await expect(useModelerStore.getState().updateColumn('c1', { logicalName: 'nuevo' })).resolves.toEqual({ views: 0 });
    expect(gov.currentColumns).not.toHaveBeenCalled();
    expect(saved.get('c1')).toMatchObject({ logicalName: 'nuevo', description: 'en pantalla' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().stack.map((e) => [e.label, e.canvasId])).toEqual([['Edit column NOMBRE', 'saA']]);
  });
});
