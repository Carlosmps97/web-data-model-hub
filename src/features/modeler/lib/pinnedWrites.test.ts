// Doc 105 (H1, cierre): las inversas del Undo que arman los COMPONENTES (pegar
// columnas, crear una relación o una subcategoría, editar una columna o su
// orden desde el Object Inspector) escriben varias veces: el lote inverso y
// después, best-effort, las vistas. Los servicios toman la versión al llamarlos:
// si entre medio se abrió otra versión (o la revalidación la degradó), lo que
// falta NO se escribe — ni se traga el corte como un error cualquiera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/governance.service', () => ({ recordChangesBulk: vi.fn() }));
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(), updateView: vi.fn() }));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { SessionChangedError, pinSession } from './sessionGuard';
import { bestEffort, pinned, pinnedDebouncer, pinnedViewDeps, undoColumnsBatch } from './pinnedWrites';

const open = (changesetId: string) => useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId });
const csNow = () => useSessionStore.getState().activeChangesetId;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Vista espejo de T1 con las columnas NUEVA y RENOMBRADA. */
const VIEW = { id: 'v1', name: 'V', tableId: 't1', sources: [{ tableId: 't1', column: 'NUEVA' }, { tableId: 't1', column: 'NOMBRE_NUEVO' }] };
let writes: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  open('cs1');
  vi.mocked(gov.recordChangesBulk).mockImplementation(async () => { writes.push(`${csNow()}:bulk`); await sleep(10); return undefined; });
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [structuredClone(VIEW)] as never);
  vi.mocked(viewsSvc.updateView).mockImplementation(async (id) => { writes.push(`${csNow()}:view:${id}`); return {} as never; });
});

const undo = (after = vi.fn(async () => {})) => ({
  run: undoColumnsBatch({
    inverse: [], tableId: 't1', created: ['NUEVA'], renamesBack: [{ from: 'NOMBRE_NUEVO', to: 'NOMBRE' }], after,
  }),
  after,
});

describe('undoColumnsBatch (doc 105, H1)', () => {
  it('sin cambio de sesión: el lote, las vistas (creadas fuera, renames de vuelta) y la recarga', async () => {
    const { run, after } = undo();
    await run(pinSession());
    expect(writes).toEqual(['cs1:bulk', 'cs1:view:v1', 'cs1:view:v1']);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('si mientras graba el lote se abre otra versión, las vistas NO se escriben en ella y corta', async () => {
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

describe('piezas (doc 105, H1)', () => {
  it('pinned: escribe mientras sigue la sesión; si cambió, corta ANTES de escribir', async () => {
    const write = vi.fn(async (x: string) => x);
    const pin = pinSession();
    expect(await pinned(pin, write)('a')).toBe('a');
    open('cs2');
    expect(() => pinned(pin, write)('b')).toThrow(SessionChangedError);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('pinnedViewDeps: lee igual, pero `updateView` corta si la sesión cambió', async () => {
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

// Doc 105 (H1, barrido): el panel de columna guarda con DEBOUNCE lo tipeado
// (definición, tipos) y, al cerrarse, escribe lo pendiente. Al cambiar de
// versión el panel se cierra (la sesión limpia `selectedColumnId`) y ese flush
// escribía lo tipeado en la versión NUEVA. Cada escritura diferida va con el
// pin tomado al EDITAR: si al dispararse la sesión es otra, se descarta.
describe('pinnedDebouncer (doc 105, H1)', () => {
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

  it('si la sesión cambió antes de dispararse, NO escribe (ni en la nueva ni en ninguna)', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('description', 'tipeado en cs1');
    open('cs2');
    vi.advanceTimersByTime(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancel descarta lo pendiente de una clave (el dominio re-aplica el tipo: el tipeo viejo no vuela)', () => {
    const write = vi.fn();
    const d = pinnedDebouncer(write, 400);
    d.schedule('types', 'viejo');
    d.schedule('description', 'sigue');
    d.cancel('types');
    vi.advanceTimersByTime(400);
    d.flush();
    expect(write.mock.calls).toEqual([['sigue']]);
  });

  it('flush (cerrar el panel) escribe ya lo pendiente de la sesión vigente, y sólo eso', () => {
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
