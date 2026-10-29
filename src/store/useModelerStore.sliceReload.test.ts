// La recarga tras una edición pide solo las tablas que tocó lo escrito en el
// draft (`GET /diagram?tableIds=`) y funde ese recorte en el diagrama abierto;
// lo que no se puede acotar, un canvas que cambió fuera del recorte o una carga
// completa en vuelo siguen con el diagrama completo. Si otra versión cambió lo
// publicado (sello de producción), también el completo, después.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/http')>();
  return { ...actual, apiPut: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return { ...actual, listProjects: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), projectDeletionPending: vi.fn(async () => false) };
});
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('@/services/changeset.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/changeset.service')>()),
  writeSeqOf: vi.fn(async () => ({ writeSeq: 0 })),
}));
vi.mock('@/services/themes.service', () => ({ listThemes: vi.fn(async () => []) }));

import { toast } from 'sonner';
import * as csvc from '@/services/changeset.service';
import * as http from '@/services/http';
import * as mod from '../features/modeler/services/modeler.service';
import { forgetDraftSeqs, markDraft } from '@/services/draftSeqs';
import { pinSession } from '../features/modeler/lib/sessionGuard';
import { useModelerStore, watchReturns } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const st = () => useModelerStore.getState();
const load = () => vi.mocked(mod.loadDiagram);
const SA = { id: 'sa1', projectId: 'p1', name: 'C', folderId: null, tableIds: ['t1', 't2'], viewIds: [], layout: {} };
const full = (stamp = '1:a') => ({
  subjectArea: { ...SA },
  tables: [{ id: 't1', physicalName: 'A' }, { id: 't2', physicalName: 'B' }],
  columns: [{ id: 'c1', tableId: 't1', ordinal: 0, physicalName: 'X' }, { id: 'c2', tableId: 't2', ordinal: 0, physicalName: 'Y' }],
  relationships: [], views: [], productionStamp: stamp,
});
const slice = (tableIds: string[], extra: object = {}) => ({
  subjectArea: { ...SA }, tables: [{ id: 't2', physicalName: 'B' }],
  columns: [{ id: 'c2', tableId: 't2', ordinal: 0, physicalName: 'Y2' }],
  relationships: [], views: [], productionStamp: '1:a', slice: { tableIds }, ...extra,
});
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
const editColumn = (cs = 'cs1') => csvc.recordChange(cs, 'canonical_columns', 'c2', 'upsert', { tableId: 't2', physicalName: 'Y2' });

beforeEach(async () => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, trees: {}, folders: [], subjectAreas: [SA] as never, openingSaId: null });
  load().mockImplementation(async () => full() as never);
  await st().selectSubjectArea('sa1');
  load().mockClear();
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('recarga por tablas', () => {
  it('una escritura de columna recarga solo su tabla y funde el recorte; lo demás conserva su objeto', async () => {
    const before = st().diagram!;
    await editColumn();
    load().mockResolvedValueOnce(slice(['t2']) as never);
    await st().reload();
    expect(load()).toHaveBeenCalledTimes(1);
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
    const now = st().diagram!;
    expect(now.columns.map((c) => c.physicalName)).toEqual(['X', 'Y2']);
    expect(now.columns[0]).toBe(before.columns[0]);
    expect(now.tables[0]).toBe(before.tables[0]);
  });

  it('sin nada escrito, con una baja de tabla o con `full`: el diagrama completo', async () => {
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    await csvc.recordChange('cs1', 'canonical_tables', 't2', 'delete');
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    await editColumn();
    await st().reload({ full: true });
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    await st().reload();                                       // lo escrito ya lo cubrió el completo
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
  });

  it('lo escrito en otra versión no cuenta; cambiar de sesión lo olvida', async () => {
    await editColumn('cs-otra');
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    await editColumn();
    useSessionStore.setState({ activeChangesetId: 'cs2' });
    useSessionStore.setState({ activeChangesetId: 'cs1' });
    useModelerStore.setState({ activeSaId: null });
    load().mockImplementation(async () => full() as never);
    await st().selectSubjectArea('sa1');
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
  });

  it('si el canvas cambió fuera del recorte (membresía), va el completo', async () => {
    await editColumn();
    load().mockResolvedValueOnce(slice(['t2'], { subjectArea: { ...SA, tableIds: ['t1', 't2', 't3'] } }) as never);
    await st().reload();
    expect(load().mock.calls).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
  });

  it('si otra versión cambió lo publicado (sello), funde el recorte y después pide el completo', async () => {
    await editColumn();
    const later = deferred<unknown>();
    load().mockResolvedValueOnce(slice(['t2'], { productionStamp: '2:b' }) as never).mockReturnValueOnce(later.promise as never);
    await st().reload();
    expect(st().diagram!.columns[1].physicalName).toBe('Y2');   // el recorte ya está
    expect(load().mock.calls).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
    later.resolve(full('2:b'));
    await tick();
    expect(st().diagram!.productionStamp).toBe('2:b');
  });

  it('un recorte en vuelo: la recarga siguiente pide también sus tablas y la primera respuesta se descarta', async () => {
    await editColumn();
    const first = deferred<unknown>();
    load().mockReturnValueOnce(first.promise as never);
    const a = st().reload();
    await tick();
    await csvc.recordChange('cs1', 'canonical_columns', 'c1', 'upsert', { tableId: 't1', physicalName: 'X2' });
    load().mockResolvedValueOnce(slice(['t1', 't2'], {
      tables: [{ id: 't1', physicalName: 'A' }, { id: 't2', physicalName: 'B' }],
      columns: [{ id: 'c1', tableId: 't1', ordinal: 0, physicalName: 'X2' }, { id: 'c2', tableId: 't2', ordinal: 0, physicalName: 'Y2' }],
    }) as never);
    await st().reload();
    expect(new Set(load().mock.calls[1][1]!.tableIds)).toEqual(new Set(['t1', 't2']));
    first.resolve(slice(['t2'], { columns: [{ id: 'c2', tableId: 't2', ordinal: 0, physicalName: 'VIEJO' }] }));
    await a;
    expect(st().diagram!.columns.map((c) => c.physicalName)).toEqual(['X2', 'Y2']);
  });

  it('con un diagrama completo en vuelo, la recarga siguiente también es completa', async () => {
    const first = deferred<unknown>();
    load().mockReturnValueOnce(first.promise as never);
    const a = st().reload();                                   // completa: nada escrito
    await tick();
    await editColumn();
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    first.resolve(full());
    await a;
  });

  it('si el recorte falla, el canvas se cierra y lo dice (como la recarga completa)', async () => {
    await editColumn();
    load().mockRejectedValueOnce(new http.ApiError('boom', 500));
    await st().reload();
    expect(st().diagram).toBeNull();
    expect(vi.mocked(toast.error).mock.calls.map((c) => String(c[0]))[0]).toMatch(/Couldn't reload the canvas/);
  });

  it('un servidor sin recortes responde el diagrama completo: se usa como tal', async () => {
    await editColumn();
    load().mockResolvedValueOnce({ ...full(), tables: [{ id: 't1', physicalName: 'A' }] } as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
    expect(st().diagram!.tables.map((t) => t.id)).toEqual(['t1']);
  });

  it('lo escrito se anota al terminar la escritura (también si falla): una recarga anterior no lo da por visto', async () => {
    const put = deferred<unknown>();
    vi.mocked(http.apiPut).mockReturnValueOnce(put.promise as never);
    const writing = editColumn();
    await st().reload();                                       // empezó antes de que terminara
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    put.reject(new Error('red'));
    await writing.catch(() => undefined);
    load().mockResolvedValueOnce(slice(['t2']) as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
  });
});

describe('escrituras de otro en el mismo draft (contador de la cabecera)', () => {
  const opened = (seq: number) => ({ ...full(), draftSeq: seq });

  it('las de esta pestaña no cuentan; una que no hizo (otra pestaña, otro equipo, carga Excel) pide el completo', async () => {
    load().mockResolvedValueOnce(opened(5) as never);
    await st().reload({ full: true });                          // el canvas vio el draft en 5
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 6 } as never);
    await editColumn();                                        // la 6 es nuestra
    load().mockResolvedValueOnce(slice(['t2'], { draftSeq: 6 }) as never);
    await st().reload();
    expect(load()).toHaveBeenCalledTimes(2);                   // solo el recorte
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 8 } as never);
    await editColumn();                                        // la 7 la hizo otro
    load().mockResolvedValueOnce(slice(['t2'], { draftSeq: 8 }) as never);
    await st().reload();
    expect(load().mock.calls.slice(2)).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
  });

  it('cambiar de versión olvida los números propios: uno igual en la otra no tapa uno ajeno', async () => {
    load().mockResolvedValueOnce(opened(5) as never);
    await st().reload({ full: true });
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 7 } as never);
    await editColumn();                                        // la 7 de cs1 es nuestra
    useSessionStore.setState({ activeChangesetId: 'cs2' });
    useModelerStore.setState({ activeSaId: null });
    load().mockImplementation(async () => opened(5) as never);
    await st().selectSubjectArea('sa1');                       // cs2 va en 5
    load().mockReset();
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 6 } as never);
    await editColumn('cs2');                                   // la 6 de cs2 es nuestra; la 7, de otro
    load().mockResolvedValueOnce(slice(['t2'], { draftSeq: 7 }) as never).mockResolvedValueOnce(opened(7) as never);
    await st().reload();
    expect(load().mock.calls).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
  });

  it('un servidor sin contador no se da por escrito por otro', async () => {
    vi.mocked(http.apiPut).mockResolvedValueOnce({} as never);
    await editColumn();
    load().mockResolvedValueOnce(slice(['t2']) as never);
    await st().reload();
    expect(load()).toHaveBeenCalledTimes(1);
  });
});

describe('lo pendiente se salda al instalarse una carga', () => {
  it('si una carga más nueva descarta el recorte y falla, sus tablas siguen pendientes', async () => {
    useModelerStore.setState({ subjectAreas: [SA, { ...SA, id: 'sa2' }] as never });
    await editColumn();
    const first = deferred<unknown>();
    load().mockReturnValueOnce(first.promise as never);
    const a = st().reload();                                   // recorte de t2 en vuelo
    await tick();
    load().mockRejectedValueOnce(new http.ApiError('red', 0));
    await st().selectSubjectArea('sa2').catch(() => undefined);   // la apertura lo descarta y falla
    first.resolve(slice(['t2']));
    await a;
    expect(st().activeSaId).toBe('sa1');                       // el canvas sigue abierto con lo de antes
    await csvc.recordChange('cs1', 'canonical_columns', 'c1', 'upsert', { tableId: 't1', physicalName: 'X2' });
    load().mockResolvedValueOnce(slice(['t1', 't2']) as never);
    await st().reload();                                       // la edición siguiente trae también t2
    expect(new Set(load().mock.calls.at(-1)![1]!.tableIds)).toEqual(new Set(['t1', 't2']));
  });

  it('lo escrito mientras un recorte viaja queda para el siguiente', async () => {
    await editColumn();
    const first = deferred<unknown>();
    load().mockReturnValueOnce(first.promise as never);
    const a = st().reload();
    await tick();
    await csvc.recordChange('cs1', 'canonical_columns', 'c1', 'upsert', { tableId: 't1', physicalName: 'X2' });
    first.resolve(slice(['t2']));
    await a;                                                   // se instaló: saldó t2, no t1
    load().mockResolvedValueOnce(slice(['t1'], { tables: [{ id: 't1', physicalName: 'A' }],
      columns: [{ id: 'c1', tableId: 't1', ordinal: 0, physicalName: 'X2' }] }) as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t1'] });
  });

  it('una tabla escrita otra vez mientras su recorte viaja se vuelve a pedir', async () => {
    await editColumn();
    const first = deferred<unknown>();
    load().mockReturnValueOnce(first.promise as never);
    const a = st().reload();
    await tick();
    await editColumn();                                        // otra escritura en t2, después del pedido
    first.resolve(slice(['t2']));
    await a;
    load().mockResolvedValueOnce(slice(['t2']) as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
  });

  it('se salda lo que el recorte trajo: una tabla que no vino sigue pendiente', async () => {
    await editColumn();
    await csvc.recordChange('cs1', 'canonical_columns', 'c1', 'upsert', { tableId: 't1', physicalName: 'X2' });
    load().mockResolvedValueOnce(slice(['t2']) as never);      // pidió t1 y t2; vino t2
    await st().reload();
    load().mockResolvedValueOnce(slice(['t1']) as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t1'] });
  });

  it('abrir el canvas salda todo lo pendiente: la recarga siguiente, sin nada nuevo, es completa', async () => {
    await editColumn();
    load().mockImplementation(async () => full() as never);
    useModelerStore.setState({ activeSaId: null });
    await st().selectSubjectArea('sa1');
    load().mockClear();
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
  });

  it('hasta 30 tablas van por recorte; más, por el completo', async () => {
    const write = (n: number, from: number) => csvc.recordChangesBulk('cs1', Array.from({ length: n }, (_, i) => (
      { collection: 'canonical_columns', entityId: `x${from + i}`, op: 'upsert' as const, payload: { tableId: `t${from + i}` } })));
    vi.mocked(http.apiPut).mockResolvedValue({} as never);
    await write(30, 0);
    load().mockImplementationOnce(async (_id, opts) => ({ ...full(), slice: { tableIds: opts!.tableIds } }) as never);
    await st().reload();
    expect(load().mock.calls[0][1]!.tableIds).toHaveLength(30);
    await write(31, 100);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
  });
});

describe('notas de completo, línea base del contador y aperturas', () => {
  const owedSlice = (t: string, seq?: number) => ({
    subjectArea: { ...SA }, tables: [{ id: t, physicalName: t === 't1' ? 'A' : 'B' }],
    columns: [{ id: t === 't1' ? 'c1' : 'c2', tableId: t, ordinal: 0, physicalName: 'N' }], relationships: [], views: [],
    productionStamp: '1:a', slice: { tableIds: [t] }, ...(seq != null ? { draftSeq: seq } : {}),
  });

  it('la recarga completa instalada salda la nota de completo: la edición siguiente va por recorte', async () => {
    await csvc.recordChange('cs1', 'views', 'vx', 'delete');
    await editColumn();
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    await editColumn();
    load().mockResolvedValueOnce(owedSlice('t2') as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
  });

  it('una nota de completo hecha con un completo en vuelo sobrevive a esa carga', async () => {
    const first = deferred<unknown>();
    load().mockReturnValueOnce(first.promise as never);
    const a = st().reload({ full: true });
    await tick();
    await csvc.recordChange('cs1', 'views', 'vx', 'delete');           // después del pedido
    first.resolve(full());
    await a;
    await editColumn();
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
  });

  it('una nota de completo junto a una de tabla: completo', async () => {
    await editColumn();
    await csvc.recordChange('cs1', 'schemas', 's1', 'upsert', { name: 'X' });
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
  });

  it('la apertura fija la línea base del contador', async () => {
    load().mockImplementation(async () => ({ ...full(), draftSeq: 5 }) as never);
    useModelerStore.setState({ activeSaId: null });
    await st().selectSubjectArea('sa1');
    load().mockReset();
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 7 } as never);
    await editColumn();                                                 // la 6 la hizo otro
    load().mockResolvedValueOnce(owedSlice('t2', 7) as never).mockResolvedValueOnce({ ...full(), draftSeq: 7 } as never);
    await st().reload();
    expect(load().mock.calls).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
  });

  it('una escritura ajena en el último número también va completa', async () => {
    load().mockResolvedValueOnce({ ...full(), draftSeq: 5 } as never);
    await st().reload({ full: true });
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 6 } as never);
    await editColumn();
    load().mockResolvedValueOnce(owedSlice('t2', 7) as never).mockResolvedValueOnce({ ...full(), draftSeq: 7 } as never);
    await st().reload();
    expect(load().mock.calls.slice(1)).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
  });

  it('sin número de la última carga completa, un recorte que trae el suyo pide el completo', async () => {
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 6 } as never);
    await editColumn();                                                 // la apertura no trajo número
    load().mockResolvedValueOnce(owedSlice('t2', 6) as never).mockResolvedValueOnce({ ...full(), draftSeq: 6 } as never);
    await st().reload();
    expect(load().mock.calls).toEqual([['sa1', { tableIds: ['t2'] }], ['sa1', undefined]]);
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 7 } as never);
    await editColumn();
    load().mockResolvedValueOnce(owedSlice('t2', 7) as never);
    await st().reload();
    expect(load().mock.calls.slice(2)).toEqual([['sa1', { tableIds: ['t2'] }]]);
  });

  it('lo escrito mientras se reabre el mismo canvas queda pendiente y se recorta al terminar', async () => {
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa1');
    await tick();
    await editColumn();
    await st().reload();                                                // espera a la apertura
    load().mockResolvedValueOnce(owedSlice('t2') as never);
    opening.resolve(full());
    await o;
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
  });

  it('al reabrir el mismo canvas, una baja se ubica con el diagrama en pantalla', async () => {
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa1');
    await tick();
    await csvc.recordChange('cs1', 'canonical_columns', 'c2', 'delete');
    await st().reload();                                                // espera a la apertura
    load().mockResolvedValueOnce(owedSlice('t2') as never);
    opening.resolve(full());
    await o;
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
  });

  it('sin apertura, una baja de columna que el diagrama ubica recarga solo su tabla', async () => {
    await csvc.recordChange('cs1', 'canonical_columns', 'c2', 'delete');
    load().mockResolvedValueOnce(owedSlice('t2') as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa1', { tableIds: ['t2'] });
  });

  it('al reabrir el mismo canvas, una baja de lo que el de pantalla todavía no tiene pide el completo', async () => {
    await csvc.recordChange('cs1', 'canonical_columns', 'c9', 'upsert', { tableId: 't2', physicalName: 'NEW', ordinal: 1 });
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa1');                                // Refresh: al instalarse salda t2
    await tick();
    await csvc.recordChange('cs1', 'canonical_columns', 'c9', 'delete');    // el Undo del alta: en pantalla no está
    await csvc.recordChange('cs1', 'canonical_columns', 'c1', 'upsert', { tableId: 't1', physicalName: 'X2', ordinal: 0 });
    await st().reload();                                                    // espera a la apertura
    load().mockResolvedValueOnce(full() as never);
    opening.resolve({ ...full(), columns: [...full().columns, { id: 'c9', tableId: 't2', ordinal: 1, physicalName: 'NEW' }] });
    await o;                                                                // su foto es previa a la baja
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    expect(st().diagram!.columns.map((c) => c.id)).not.toContain('c9');
  });

  it('mientras se abre otro canvas, lo escrito pide el completo aunque traiga payload (una vista re-apuntada fuera de él)', async () => {
    const SA2 = { ...SA, id: 'sa2', tableIds: ['t3', 't4'], viewIds: null };
    useModelerStore.setState({ subjectAreas: [SA, SA2] as never });
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa2');
    await tick();
    await csvc.recordChange('cs1', 'views', 'v3', 'upsert', { id: 'v3', name: 'V3', sourceTableIds: ['t9'], showOnCanvas: true });
    opening.resolve({ subjectArea: { ...SA2, viewIds: ['v3'] }, tables: [{ id: 't3', physicalName: 'C' }, { id: 't4', physicalName: 'D' }],
      columns: [], relationships: [], views: [{ id: 'v3', name: 'V3', sourceTableIds: ['t3'], showOnCanvas: true }], productionStamp: '1:a' });
    await o;                                                                // su foto es previa a la escritura
    await csvc.recordChange('cs1', 'canonical_columns', 'c4', 'upsert', { tableId: 't4', physicalName: 'W2', ordinal: 0 });
    load().mockResolvedValueOnce({ subjectArea: { ...SA2, viewIds: [] }, tables: [], columns: [], relationships: [], views: [],
      productionStamp: '1:a' } as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa2', undefined);
    expect(st().diagram!.views).toEqual([]);
  });

  it('mientras se abre otro canvas, el guardado del anterior (su dibujo) no pide el completo', async () => {
    const SA2 = { ...SA, id: 'sa2', tableIds: ['t3'] };
    useModelerStore.setState({ subjectAreas: [SA, SA2] as never });
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa2');
    await tick();
    await csvc.recordChange('cs1', 'subject_areas', 'sa1', 'upsert', { ...SA, drawings: [{ id: 'd1' }] });
    await csvc.recordChange('cs1', 'folders', 'f1', 'upsert', { name: 'F' });
    opening.resolve({ subjectArea: { ...SA2 }, tables: [{ id: 't3', physicalName: 'C' }], columns: [], relationships: [], views: [], productionStamp: '1:a' });
    await o;
    expect(load()).toHaveBeenCalledTimes(1);                                // nada que recargar al instalarse
    await csvc.recordChange('cs1', 'canonical_tables', 't3', 'upsert', { physicalName: 'C2' });
    load().mockResolvedValueOnce({ subjectArea: { ...SA2 }, tables: [{ id: 't3', physicalName: 'C2' }], columns: [], relationships: [],
      views: [], productionStamp: '1:a', slice: { tableIds: ['t3'] } } as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa2', { tableIds: ['t3'] });
  });

  it('lo escrito mientras se abre otro canvas se recarga apenas la apertura se instala', async () => {
    const SA2 = { ...SA, id: 'sa2', tableIds: ['t3'] };
    useModelerStore.setState({ subjectAreas: [SA, SA2] as never });
    const B = { subjectArea: { ...SA2 }, tables: [{ id: 't3', physicalName: 'C' }],
      columns: [{ id: 'c3', tableId: 't3', ordinal: 0, physicalName: 'Z' }], relationships: [], views: [], productionStamp: '1:a' };
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa2');
    await tick();
    await csvc.recordChange('cs1', 'canonical_columns', 'c3', 'delete');    // p. ej. desde el Inspector
    load().mockResolvedValueOnce({ ...B, columns: [] } as never);
    opening.resolve(B);                                                      // su foto es previa a la baja
    await o;
    expect(load()).toHaveBeenLastCalledWith('sa2', undefined);
    expect(st().diagram!.columns).toEqual([]);
  });

  it('una baja sin payload que termina mientras se abre otro canvas: la recarga siguiente es completa', async () => {
    const SA2 = { ...SA, id: 'sa2', tableIds: ['t3', 't4'] };
    const other = (seq: number) => ({
      subjectArea: { ...SA2 }, tables: [{ id: 't3', physicalName: 'C' }, { id: 't4', physicalName: 'D' }],
      columns: [{ id: 'c3', tableId: 't3', ordinal: 0, physicalName: 'Z' }, { id: 'c4', tableId: 't4', ordinal: 0, physicalName: 'W' }],
      relationships: [], views: [], productionStamp: '1:a', draftSeq: seq,
    });
    useModelerStore.setState({ subjectAreas: [SA, SA2] as never });
    const opening = deferred<unknown>();
    load().mockReturnValueOnce(opening.promise as never);
    const o = st().selectSubjectArea('sa2');
    await tick();
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 6 } as never);
    await csvc.recordChange('cs1', 'canonical_columns', 'c3', 'delete');   // p. ej. desde el Inspector
    opening.resolve(other(5));                                             // su foto es previa a la baja
    await o;
    expect(st().activeSaId).toBe('sa2');
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 7 } as never);
    await csvc.recordChange('cs1', 'canonical_columns', 'c4', 'upsert', { tableId: 't4', physicalName: 'W2' });
    load().mockResolvedValueOnce(other(7) as never);
    await st().reload();
    expect(load()).toHaveBeenLastCalledWith('sa2', undefined);
  });
});

// El candado del Undo (doc 133) sabe del canvas abierto y de lo visto de la
// versión por este store: cada carga deja visto su número, el pin de una acción
// toma el canvas abierto, y cambiar de sesión lo olvida. Borrar un canvas vacía
// el historial si algo de él quedaba por deshacer o rehacer.
describe('lo que el historial sabe por el canvas', () => {
  it('una carga completa deja visto el contador de la versión', async () => {
    load().mockImplementation(async () => ({ ...full(), draftSeq: 9 }) as never);
    await st().reload({ full: true });
    expect(markDraft('cs1')?.seen).toBe(9);
  });

  it('el pin de una acción toma el canvas abierto', () => {
    expect(pinSession().canvasId).toBe('sa1');
    useModelerStore.setState({ activeSaId: null });
    expect(pinSession().canvasId).toBeNull();
  });

  it('cambiar de sesión olvida lo visto', async () => {
    load().mockImplementation(async () => ({ ...full(), draftSeq: 9 }) as never);
    await st().reload({ full: true });
    useSessionStore.setState({ activeChangesetId: 'cs2' });
    expect(markDraft('cs1')?.seen).toBeNull();
  });

  it('borrar un canvas vacía el historial si había algo suyo; si no, lo deja', async () => {
    const run = async () => null;
    useUndoStore.setState({ stack: [{ label: 'A', run, canvasId: 'sa-otro' }], redoStack: [] });
    await st().deleteCanvas('sa-vacio', 'p1');
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['A']);
    useUndoStore.setState({ stack: [{ label: 'A', run, canvasId: 'sa-otro' }], redoStack: [{ label: 'B', run, canvasId: 'sa-borrado' }] });
    await st().deleteCanvas('sa-borrado', 'p1');
    expect([useUndoStore.getState().stack, useUndoStore.getState().redoStack]).toEqual([[], []]);
  });
});

// Al volver a la pestaña se mira el contador de la versión: si otra pestaña
// escribió, el diagrama se recarga completo — así lo de la otra pestaña queda en
// pantalla y queda «visto» para el candado del Undo (doc 133).
describe('al volver a la pestaña', () => {
  // Lo visto de la versión no se arrastra de otra prueba (misma sesión).
  beforeEach(() => forgetDraftSeqs());
  const base5 = async () => {
    load().mockImplementation(async () => ({ ...full(), draftSeq: 5 }) as never);
    await st().reload({ full: true });
    load().mockClear();
  };

  it('si otra pestaña escribió, recarga el diagrama completo y eso deja vistos sus números', async () => {
    await base5();
    vi.mocked(csvc.writeSeqOf).mockResolvedValueOnce({ writeSeq: 6 });   // la 6 la hizo otra pestaña
    load().mockImplementation(async () => ({ ...full(), draftSeq: 6 }) as never);
    await st().syncOtherTabs();
    expect(load()).toHaveBeenCalledTimes(1);
    expect(load()).toHaveBeenLastCalledWith('sa1', undefined);
    expect(markDraft('cs1')?.seen).toBe(6);
  });

  it('si todo lo escrito es de esta pestaña, no recarga', async () => {
    await base5();
    vi.mocked(http.apiPut).mockResolvedValueOnce({ writeSeq: 6 } as never);
    await editColumn();
    vi.mocked(csvc.writeSeqOf).mockResolvedValueOnce({ writeSeq: 6 });
    await st().syncOtherTabs();
    expect(load()).not.toHaveBeenCalled();
  });

  it('sin canvas abierto o fuera de edición, no lee nada', async () => {
    vi.mocked(csvc.writeSeqOf).mockClear();
    useModelerStore.setState({ activeSaId: null, diagram: null });
    await st().syncOtherTabs();
    useModelerStore.setState({ activeSaId: 'sa1' });
    useSessionStore.setState({ openMode: 'readonly' });
    await st().syncOtherTabs();
    expect(csvc.writeSeqOf).not.toHaveBeenCalled();
  });

  it('si mientras lee el contador se abre otra versión, no recarga nada', async () => {
    await base5();
    vi.mocked(csvc.writeSeqOf).mockImplementationOnce(async () => {
      useSessionStore.setState({ activeChangesetId: 'cs2' });
      return { writeSeq: 6 };
    });
    await st().syncOtherTabs();
    expect(load()).not.toHaveBeenCalled();
  });

  it('una escritura propia todavía sin respuesta no se toma por ajena: no recarga', async () => {
    await base5();
    let answer!: (v: unknown) => void;
    vi.mocked(http.apiPut).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const writing = editColumn();                                   // la 6: propia, sin respuesta todavía
    vi.mocked(csvc.writeSeqOf).mockImplementationOnce(async () => {
      setTimeout(() => answer({ writeSeq: 6 }), 5);                 // responde después de la lectura
      return { writeSeq: 6 };
    });
    await st().syncOtherTabs();
    await writing;
    expect(load()).not.toHaveBeenCalled();
  });

  // «Visto» es solo lo que trajo una carga instalada: si la recarga queda diferida
  // (se está abriendo un canvas) o falla, la lectura del contador no cuenta.
  it('si la recarga queda diferida o falla, no da nada por visto', async () => {
    await base5();
    useModelerStore.setState({ openingSaId: 'sa1' });
    vi.mocked(csvc.writeSeqOf).mockResolvedValueOnce({ writeSeq: 6 });
    await st().syncOtherTabs();
    expect(markDraft('cs1')?.seen).toBe(5);
    useModelerStore.setState({ openingSaId: null });
    vi.mocked(csvc.writeSeqOf).mockResolvedValueOnce({ writeSeq: 6 });
    load().mockRejectedValueOnce(new Error('offline'));
    await st().syncOtherTabs();
    expect(markDraft('cs1')?.seen).toBe(5);
  });

  it('foco y pestaña visible en la misma vuelta: una sola lectura', async () => {
    await base5();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' as DocumentVisibilityState });
    watchReturns(win, doc);
    vi.mocked(csvc.writeSeqOf).mockClear();
    let answer!: (v: { writeSeq: number }) => void;
    vi.mocked(csvc.writeSeqOf).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    win.dispatchEvent(new Event('focus'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(csvc.writeSeqOf).toHaveBeenCalledTimes(1);
    answer({ writeSeq: 5 });
    await tick();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));     // se ocultó: nada
    expect(csvc.writeSeqOf).toHaveBeenCalledTimes(1);
  });
});
