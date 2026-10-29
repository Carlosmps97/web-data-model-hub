// Los pasos del historial que arman los componentes (pegar columnas, crear una
// relación o una subcategoría, editar una columna o su orden en el Object
// Inspector) escriben varias veces: el lote y después, best-effort, las vistas.
// Los servicios toman la versión al llamarlos: si entre medio se abrió otra
// versión (o la revalidación la degradó), lo que falta no se escribe, ni se
// traga el corte como un error cualquiera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/governance.service', async (orig) => ({
  ...(await orig<typeof import('@/services/governance.service')>()),
  recordChangesBulk: vi.fn(), listColumns: vi.fn(), updateRelationship: vi.fn(), currentColumns: vi.fn(), updateColumn: vi.fn(),
}));
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(), updateView: vi.fn(), viewWriteDoc: (id: string, body: object) => ({ ...body, id }) }));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { flushPendingWrites, hasPendingWrites } from '@/services/draftWork';
import { useSessionStore } from '@/store/useSessionStore';
import { SessionChangedError, pinSession, setCanvasSource } from './sessionGuard';
import { bestEffort, columnBase, columnStep, columnsBatchStep, pinned, pinnedDebouncer, pinnedViewDeps, relationshipTypeStep, writeColumn } from './pinnedWrites';
import { NothingDoneError } from '@/store/useUndoStore';
import { ApiError } from '@/services/http';

const open = (changesetId: string) => useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId });
const csNow = () => useSessionStore.getState().activeChangesetId;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Vista espejo de T1 con la columna `NUEVA` y la renombrada (`NOMBRE_NUEVO`). */
const VIEW = { id: 'v1', name: 'V', tableId: 't1', sources: [{ tableId: 't1', column: 'NUEVA' }, { tableId: 't1', column: 'NOMBRE_NUEVO' }] };
/** La tabla antes del lote: la vista la reflejaba entera (una columna, `NOMBRE`). */
const BASELINE = [{ id: 'n', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0 }];
let writes: string[] = [];
let lots: string[][] = [];
let view = structuredClone(VIEW);

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  lots = [];
  view = structuredClone(VIEW);
  open('cs1');
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    writes.push(`${csNow()}:bulk`); lots.push(changes.map((c) => `${c.op}:${c.entityId}`)); await sleep(10); return undefined;
  });
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [structuredClone(view)] as never);
  vi.mocked(gov.listColumns).mockResolvedValue([] as never);   // ninguna homónima en la tabla
  vi.mocked(viewsSvc.updateView).mockImplementation(async (id, body) => {
    writes.push(`${csNow()}:view:${id}`); view = structuredClone({ ...body, id }) as typeof view; return {} as never;
  });
});

const FORWARD = [{ collection: 'canonical_columns', entityId: 'nueva', op: 'upsert' as const, payload: {} }];
const INVERSE = [{ collection: 'canonical_columns', entityId: 'nueva', op: 'delete' as const }];
const undo = (after = vi.fn(async () => {})) => ({
  run: columnsBatchStep({
    forward: FORWARD, inverse: INVERSE, tableId: 't1', created: [{ physicalName: 'NUEVA' }], baseline: BASELINE,
    renames: [{ from: 'NOMBRE', to: 'NOMBRE_NUEVO' }], after,
  }),
  after,
});
const columnsOf = () => view.sources.map((x) => x.column);

describe('columnsBatchStep', () => {
  it('deshacer: el lote inverso, las vistas (creadas fuera, renames de vuelta) y la recarga', async () => {
    const { run, after } = undo();
    await run(pinSession());
    expect(writes).toEqual(['cs1:bulk', 'cs1:view:v1', 'cs1:view:v1']);
    expect(lots).toEqual([['delete:nueva']]);
    expect(columnsOf()).toEqual(['NOMBRE']);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('rehacer: el lote original, las creadas a la vista espejo y los renames al nombre nuevo; y vuelta a deshacer', async () => {
    const { run, after } = undo();
    const redo = (await run(pinSession()))!;
    writes = [];
    const again = (await redo(pinSession()))!;
    expect(writes).toEqual(['cs1:bulk', 'cs1:view:v1', 'cs1:view:v1']);
    expect(lots[1]).toEqual(['upsert:nueva']);
    expect([...columnsOf()].sort()).toEqual(['NOMBRE_NUEVO', 'NUEVA']);
    await again(pinSession());
    expect(lots[2]).toEqual(['delete:nueva']);
    expect(columnsOf()).toEqual(['NOMBRE']);
    expect(after).toHaveBeenCalledTimes(3);
  });

  it('si mientras graba el lote se abre otra versión, las vistas no se escriben en ella y corta', async () => {
    const { run, after } = undo();
    const going = run(pinSession());
    await sleep(3);
    open('cs2');
    await expect(going).rejects.toBeInstanceOf(SessionChangedError);
    expect(writes).toEqual(['cs1:bulk']);
    expect(after).not.toHaveBeenCalled();
  });

  it('un error cualquiera de una vista es best-effort: sigue con el resto', async () => {
    vi.mocked(viewsSvc.updateView).mockRejectedValueOnce(new Error('sin red'));
    const { run, after } = undo();
    await run(pinSession());
    expect(writes).toEqual(['cs1:bulk', 'cs1:view:v1']);   // el primer sync falló; el segundo escribió
    expect(after).toHaveBeenCalledTimes(1);
  });
});

// Cambiar el tipo de una relación: deshacer en un lote (relación y columnas
// como estaban); rehacer como la acción — la relación y después el lote de la
// llave: en una relación recursiva la llave del padre es la del hijo y el N=N
// se valida contra ella (en un solo lote el backend lo rechaza).
describe('relationshipTypeStep', () => {
  const REL = { id: 'r1', parentTableId: 't1', childTableId: 't1', identifying: true, pairs: [{ parentColumnId: 'k', childColumnId: 'p' }] };
  const back = [{ collection: 'canonical_columns', entityId: 'p', op: 'upsert' as const, payload: {} },
    { collection: 'relationships', entityId: 'r1', op: 'upsert' as const, payload: {} }];
  const keys = [{ collection: 'canonical_columns', entityId: 'p', op: 'upsert' as const, payload: { isPrimaryKey: true } }];
  beforeEach(() => {
    vi.mocked(gov.updateRelationship).mockImplementation(async () => { writes.push(`${csNow()}:relationship`); await sleep(10); return undefined as never; });
  });

  it('deshacer graba un lote; rehacer, la relación y después la llave; y vuelta a deshacer', async () => {
    const after = vi.fn(async () => {});
    const undo = relationshipTypeStep(back, REL as never, keys, after);
    const redo = (await undo(pinSession()))!;
    expect(lots).toEqual([['upsert:p', 'upsert:r1']]);
    const again = (await redo(pinSession()))!;
    expect(writes).toEqual(['cs1:bulk', 'cs1:relationship', 'cs1:bulk']);
    expect(gov.updateRelationship).toHaveBeenCalledWith(REL);
    expect(lots).toEqual([['upsert:p', 'upsert:r1'], ['upsert:p']]);
    expect(after).toHaveBeenCalledTimes(2);
    await again(pinSession());
    expect(lots.at(-1)).toEqual(['upsert:p', 'upsert:r1']);
  });

  it('en una relación no recursiva, rehacer graba la relación y la llave en un lote (todo o nada)', async () => {
    const redo = (await relationshipTypeStep(back, { ...REL, childTableId: 't2' } as never, keys, async () => {})(pinSession()))!;
    writes = [];
    lots = [];
    await redo(pinSession());
    expect(writes).toEqual(['cs1:bulk']);
    expect(lots).toEqual([['upsert:r1', 'upsert:p']]);
    expect(gov.updateRelationship).not.toHaveBeenCalled();
  });

  it('rehacer sin cambios de llave graba solo la relación', async () => {
    const redo = (await relationshipTypeStep(back, REL as never, [], async () => {})(pinSession()))!;
    writes = [];
    await redo(pinSession());
    expect(writes).toEqual(['cs1:relationship']);
  });

  it('si entre la relación y la llave se abre otra versión, la llave no se escribe en ella y corta', async () => {
    const redo = (await relationshipTypeStep(back, REL as never, keys, async () => {})(pinSession()))!;
    writes = [];
    const run = redo(pinSession());
    await sleep(1);
    open('cs2');
    await expect(run).rejects.toBeInstanceOf(SessionChangedError);
    expect(writes).toEqual(['cs1:relationship']);
  });
});

describe('piezas', () => {
  it('pinned: escribe mientras sigue la sesión; si cambia, corta antes de escribir', async () => {
    const write = vi.fn(async (x: string) => x);
    const pin = pinSession();
    expect(await pinned(pin, write)('a')).toBe('a');
    open('cs2');
    expect(() => pinned(pin, write)('b')).toThrow(SessionChangedError);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('pinnedViewDeps: lee igual, pero `updateView` corta si la sesión cambia', async () => {
    const deps = pinnedViewDeps(pinSession());
    open('cs2');
    await expect(deps.listViews('t1')).resolves.toHaveLength(1);
    expect(() => deps.updateView('v1', VIEW as never)).toThrow(SessionChangedError);
    expect(viewsSvc.updateView).not.toHaveBeenCalled();
  });

  it('bestEffort: traga los errores, salvo el corte por cambio de sesión', async () => {
    await expect(bestEffort(async () => { throw new Error('sin red'); })).resolves.toBeUndefined();
    await expect(bestEffort(async () => { throw new SessionChangedError(); })).rejects.toBeInstanceOf(SessionChangedError);
  });
});

// El panel de columna guarda con debounce lo tipeado (definición, tipos) y, al
// cerrarse, escribe lo pendiente. Al cambiar de versión el panel se cierra (la
// sesión limpia `selectedColumnId`) y ese flush escribiría lo tipeado en la
// versión recién abierta. Por eso cada escritura diferida va con el pin tomado
// al editar: si al dispararse la sesión es otra, se descarta.
describe('pinnedDebouncer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lo tipeado cuenta como agendado hasta escribirse o descartarse; Undo/Redo lo escriben ya', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'a');
    d.schedule('types', 'STRING');
    expect(hasPendingWrites()).toBe(true);
    flushPendingWrites();
    expect(write.mock.calls.map(([v]) => v)).toEqual(['a', 'STRING']);
    expect(hasPendingWrites()).toBe(false);
    d.schedule('description', 'b');
    d.cancel('description');
    expect(hasPendingWrites()).toBe(false);
    d.schedule('description', 'c');
    vi.advanceTimersByTime(400);
    expect(hasPendingWrites()).toBe(false);
    d.schedule('description', 'd');
    d.flush();
    expect(hasPendingWrites()).toBe(false);
    expect(write.mock.calls.map(([v]) => v)).toEqual(['a', 'STRING', 'c', 'd']);
  });

  it('escribe lo último de cada clave pasado el debounce', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'a');
    d.schedule('description', 'ab');
    d.schedule('types', 'STRING');
    vi.advanceTimersByTime(400);
    expect(write.mock.calls.map(([v]) => v)).toEqual(['ab', 'STRING']);
  });

  it('si la sesión cambia antes de dispararse, no escribe (ni en la nueva ni en ninguna)', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'tipeado en cs1');
    open('cs2');
    vi.advanceTimersByTime(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancel descarta lo pendiente de una clave (el dominio re-aplica el tipo: el tipeo anterior no vuela)', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('types', 'viejo');
    d.schedule('description', 'sigue');
    d.cancel('types');
    vi.advanceTimersByTime(400);
    d.flush();
    expect(write.mock.calls.map(([v]) => v)).toEqual(['sigue']);
  });

  it('cada escritura lleva el pin de cuando se editó (su sesión y su canvas), aunque salga con otro canvas abierto', () => {
    let canvas = 'A';
    setCanvasSource(() => canvas);
    try {
      const write = vi.fn();
      const d = pinnedDebouncer(write, 400);
      d.schedule('description', 'tipeado en A');
      canvas = 'B';
      d.flush();
      const [[value, pin]] = write.mock.calls;
      expect(value).toBe('tipeado en A');
      expect(pin.canvasId).toBe('A');
      expect(pin.holds()).toBe(true);
      open('cs2');
      expect(pin.holds()).toBe(false);
    } finally { setCanvasSource(() => null); }
  });

  it('flush (cerrar el panel) escribe ya lo pendiente de la sesión vigente, y solo eso', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'de cs1');
    open('cs2');
    d.schedule('types', 'de cs2');
    d.flush();
    expect(write.mock.calls.map(([v]) => v)).toEqual(['de cs2']);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);   // lo ya escrito no se repite
  });
});

// La base de un guardado de columna (doc 133 §13, P2): la que se ve o, sin ella
// o con `fromServer` (lo que el panel manda al cerrarse), la vigente; si ya no
// está en la versión, ninguna (no se graba: un guardado no revive una columna).
describe('columnBase', () => {
  const SHOWN = { ...BASELINE[0], description: 'en pantalla' } as gov.CanonicalColumn;
  const CURRENT = { ...BASELINE[0], description: 'vigente' } as gov.CanonicalColumn;

  it('la que se ve, sin leer el servidor', async () => {
    await expect(columnBase('n', SHOWN)).resolves.toBe(SHOWN);
    expect(gov.currentColumns).not.toHaveBeenCalled();
  });
  it('sin ella, o con `fromServer`, la vigente de la versión', async () => {
    vi.mocked(gov.currentColumns).mockResolvedValue([CURRENT]);
    await expect(columnBase('n', undefined)).resolves.toEqual(CURRENT);
    await expect(columnBase('n', SHOWN, true)).resolves.toEqual(CURRENT);
    expect(gov.currentColumns).toHaveBeenCalledWith(['n']);
  });
  it('borrada en la versión: ninguna, aunque todavía se vea', async () => {
    vi.mocked(gov.currentColumns).mockResolvedValue([]);
    await expect(columnBase('n', SHOWN, true)).resolves.toBeUndefined();
    await expect(columnBase('n', undefined)).resolves.toBeUndefined();
  });
});

// El guardado de una columna que cambia su físico (doc 133 §14, P9): la columna y
// las vistas que usaban el nombre anterior van en UN lote, todo o nada; así dos
// renombres seguidos (en la fila de la columna) nunca dejan una vista en el
// nombre intermedio. Deshacer y rehacer, igual.
describe('writeColumn y columnStep: renombre y vistas en un solo lote', () => {
  const N = { id: 'n', tableId: 't1', physicalName: 'NOMBRE_X', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0 } as gov.CanonicalColumn;
  const usesNombre = () => [{ ...structuredClone(VIEW), sources: [{ tableId: 't1', column: 'NOMBRE' }] }];
  beforeEach(() => {
    vi.mocked(gov.updateColumn).mockImplementation(async (c) => { writes.push(`${csNow()}:col:${c.id}`); return {} as never; });
    vi.mocked(viewsSvc.listViews).mockImplementation(async () => usesNombre() as never);
  });

  it('sin cambio de físico: la columna sola, sin leer vistas', async () => {
    await expect(writeColumn({ ...N, physicalName: 'NOMBRE' }, 'NOMBRE', pinSession())).resolves.toBe(0);
    expect(writes).toEqual(['cs1:col:n']);
    expect(viewsSvc.listViews).not.toHaveBeenCalled();
  });

  it('con un físico nuevo: la columna y las vistas que usaban el anterior en UN lote', async () => {
    await expect(writeColumn(N, 'NOMBRE', pinSession())).resolves.toBe(1);
    expect(lots).toEqual([['upsert:n', 'upsert:v1']]);
    const [[changes]] = vi.mocked(gov.recordChangesBulk).mock.calls;
    expect((changes[1].payload as unknown as typeof VIEW).sources.map((x) => x.column)).toEqual(['NOMBRE_X']);
    expect(gov.updateColumn).not.toHaveBeenCalled();
  });

  it('sin vistas que lo usen: la columna sola', async () => {
    vi.mocked(viewsSvc.listViews).mockResolvedValue([] as never);
    await expect(writeColumn(N, 'NOMBRE', pinSession())).resolves.toBe(0);
    expect(writes).toEqual(['cs1:col:n']);
    expect(lots).toEqual([]);
  });

  it('el nombre anterior es el que la columna tiene HOY en la versión (un guardado sin respuesta pudo grabarse y mover la vista)', async () => {
    vi.mocked(gov.listColumns).mockResolvedValue([{ ...N, physicalName: 'NOMBRE_1' }] as never);
    vi.mocked(viewsSvc.listViews).mockResolvedValue([{ ...structuredClone(VIEW), sources: [{ tableId: 't1', column: 'NOMBRE_1' }] }] as never);
    await expect(writeColumn({ ...N, physicalName: 'NOMBRE_2' }, 'NOMBRE', pinSession())).resolves.toBe(1);
    const [[changes]] = vi.mocked(gov.recordChangesBulk).mock.calls;
    expect((changes[1].payload as unknown as typeof VIEW).sources.map((x) => x.column)).toEqual(['NOMBRE_2']);
  });

  it('el lote va en un solo request (todo o nada)', async () => {
    await writeColumn(N, 'NOMBRE', pinSession());
    const [[changes, chunk]] = vi.mocked(gov.recordChangesBulk).mock.calls;
    expect(chunk).toBe(changes.length);
  });

  it('un error de lectura que no es de la versión (p. ej. un 403 del proxy) no graba nada y se puede reintentar', async () => {
    vi.mocked(viewsSvc.listViews).mockRejectedValue(new ApiError('Forbidden', 403, null, '/api/otro'));
    await expect(writeColumn(N, 'NOMBRE', pinSession())).rejects.toBeInstanceOf(NothingDoneError);
    expect(writes).toEqual([]);
  });

  it('un error de la versión: si la sesión sigue, se puede reintentar; si ya es otra, el error tal cual (calla quien lo pidió)', async () => {
    const gone = new ApiError('Not found', 404, null, '/api/changesets/cs1/effective/views');
    vi.mocked(viewsSvc.listViews).mockRejectedValue(gone);
    await expect(writeColumn(N, 'NOMBRE', pinSession())).rejects.toBeInstanceOf(NothingDoneError);
    vi.mocked(viewsSvc.listViews).mockImplementation(async () => { open('cs2'); throw gone; });
    await expect(writeColumn(N, 'NOMBRE', pinSession())).rejects.toBe(gone);
    expect(writes).toEqual([]);
  });

  it('si no se pueden leer las vistas, no graba nada y se puede reintentar', async () => {
    vi.mocked(viewsSvc.listViews).mockRejectedValue(new Error('caída'));
    await expect(writeColumn(N, 'NOMBRE', pinSession())).rejects.toBeInstanceOf(NothingDoneError);
    expect(writes).toEqual([]);
  });

  it('si mientras lee se abre otra versión, no graba en ninguna', async () => {
    vi.mocked(viewsSvc.listViews).mockImplementation(async () => { open('cs2'); return usesNombre() as never; });
    await expect(writeColumn(N, 'NOMBRE', pinSession())).rejects.toBeInstanceOf(SessionChangedError);
    expect(writes).toEqual([]);
  });

  it('deshacer el renombre devuelve la columna y sus vistas en un solo lote', async () => {
    const after = vi.fn(async () => undefined);
    vi.mocked(viewsSvc.listViews).mockResolvedValue([{ ...structuredClone(VIEW), sources: [{ tableId: 't1', column: 'NOMBRE_X' }] }] as never);
    const undo = columnStep({ ...N, physicalName: 'NOMBRE' }, N, after);
    await undo(pinSession());
    expect(lots).toEqual([['upsert:n', 'upsert:v1']]);
    const [[changes]] = vi.mocked(gov.recordChangesBulk).mock.calls;
    expect((changes[1].payload as unknown as typeof VIEW).sources.map((x) => x.column)).toEqual(['NOMBRE']);
    expect(after).toHaveBeenCalled();
  });
});
