// Los pasos del historial que arman los componentes (pegar columnas, crear una
// relación o una subcategoría, editar una columna o su orden en el Object
// Inspector) escriben varias veces: el lote y después, best-effort, las vistas.
// Los servicios toman la versión al llamarlos: si entre medio se abrió otra
// versión (o la revalidación la degradó), lo que falta no se escribe, ni se
// traga el corte como un error cualquiera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/governance.service', async (orig) => ({
  ...(await orig<typeof import('@/services/governance.service')>()),
  recordChangesBulk: vi.fn(), listColumns: vi.fn(), updateRelationship: vi.fn(),
}));
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(), updateView: vi.fn() }));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { SessionChangedError, pinSession } from './sessionGuard';
import { bestEffort, columnsBatchStep, pinned, pinnedDebouncer, pinnedViewDeps, relationshipTypeStep } from './pinnedWrites';

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

  it('escribe lo último de cada clave pasado el debounce', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'a');
    d.schedule('description', 'ab');
    d.schedule('types', 'STRING');
    vi.advanceTimersByTime(400);
    expect(write.mock.calls).toEqual([['ab'], ['STRING']]);
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
    expect(write.mock.calls).toEqual([['sigue']]);
  });

  it('flush (cerrar el panel) escribe ya lo pendiente de la sesión vigente, y solo eso', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'de cs1');
    open('cs2');
    d.schedule('types', 'de cs2');
    d.flush();
    expect(write.mock.calls).toEqual([['de cs2']]);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);   // lo ya escrito no se repite
  });
});
