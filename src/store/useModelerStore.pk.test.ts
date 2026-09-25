// Doc 94 — orden único con PK primero en el store: marcar/desmarcar PK
// re-numera la tabla en UN lote (con un solo Undo) y ningún reorden deja una
// PK debajo de una no-PK.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, updateColumn: vi.fn(async () => ({})), recordChangesBulk: vi.fn(async () => ({})) };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';
import * as gov from '@/services/governance.service';
import { useModelerStore } from './useModelerStore';
import { useUndoStore } from './useUndoStore';

const col = (id: string, ordinal: number, pk = false) =>
  ({ id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: id, dataType: 'INT', typeOverridden: false, ordinal, isPrimaryKey: pk });
const setCols = (cols: unknown[]) => useModelerStore.setState({
  activeSaId: null, dirty: false,
  diagram: { subjectArea: { id: 'sa1', projectId: 'p', name: 's', tableIds: ['t1'], layout: {} },
    tables: [{ id: 't1', physicalName: 'T', logicalName: 't' }], columns: cols, relationships: [], views: [] } as never,
});
const bulkSent = (call = 0) => Object.fromEntries(vi.mocked(gov.recordChangesBulk).mock.calls[call][0]
  .map((ch) => [ch.entityId, ch.payload as { ordinal: number; isPrimaryKey?: boolean }]));

beforeEach(() => {
  vi.clearAllMocks();
  useUndoStore.setState({ stack: [], busy: false });
});

describe('updateColumn — cambio de llave (doc 94 D2)', () => {
  it('marcar PK: sube al final del bloque PK y corre las no-PK en UN lote', async () => {
    setCols([col('k', 0, true), col('a', 1), col('b', 2), col('c', 3)]);
    await useModelerStore.getState().updateColumn('c', { isPrimaryKey: true });
    expect(gov.updateColumn).not.toHaveBeenCalled();
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    const sent = bulkSent();
    expect([sent.c.ordinal, sent.c.isPrimaryKey, sent.a.ordinal, sent.b.ordinal]).toEqual([1, true, 2, 3]);
    expect(useUndoStore.getState().stack.map((u) => u.label)).toEqual(['Edit column C']);
  });

  it('Undo devuelve la llave y los ordinales previos en UN lote', async () => {
    setCols([col('k', 0, true), col('a', 1), col('c', 2)]);
    await useModelerStore.getState().updateColumn('c', { isPrimaryKey: true });
    await useUndoStore.getState().undoLast();
    const back = bulkSent(1);
    expect([back.c.ordinal, back.c.isPrimaryKey, back.a.ordinal]).toEqual([2, false, 1]);
  });

  it('desmarcar PK: queda primera entre las no-PK', async () => {
    setCols([col('k1', 0, true), col('k2', 1, true), col('a', 2)]);
    await useModelerStore.getState().updateColumn('k1', { isPrimaryKey: false });
    const sent = bulkSent();
    expect([sent.k2.ordinal, sent.k1.ordinal, sent.k1.isPrimaryKey]).toEqual([0, 1, false]);
  });

  it('sin cambio de llave: el upsert de siempre (una columna)', async () => {
    setCols([col('k', 0, true), col('a', 1)]);
    await useModelerStore.getState().updateColumn('a', { description: 'x' });
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    expect(vi.mocked(gov.updateColumn).mock.calls[0][0]).toMatchObject({ id: 'a', description: 'x', ordinal: 1 });
  });
});

describe('reorderColumns — validación PK primero (doc 94 D3)', () => {
  it('rechaza dejar una PK debajo de una no-PK: no escribe nada y avisa', async () => {
    setCols([col('k', 0, true), col('a', 1), col('b', 2)]);
    await useModelerStore.getState().reorderColumns('t1', ['a', 'k', 'b']);
    expect(gov.updateColumn).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("A primary key column can't go below a column that isn't part of the key.");
  });

  it('reordenar dentro del bloque de PK es un reorden normal', async () => {
    setCols([col('k1', 0, true), col('k2', 1, true), col('a', 2)]);
    await useModelerStore.getState().reorderColumns('t1', ['k2', 'k1', 'a']);
    expect(vi.mocked(gov.updateColumn).mock.calls.map(([c]) => [c.id, c.ordinal])).toEqual([['k2', 0], ['k1', 1]]);
  });
});

describe('applyCanvasDrop — la llave nueva vale para el reorden (doc 94)', () => {
  it('soltar en la zona de llave: marca la PK y reordena PK primero', async () => {
    setCols([col('k', 0, true), col('a', 1), col('b', 2)]);
    await useModelerStore.getState().applyCanvasDrop('t1', { order: ['k', 'b', 'a'], key: [{ id: 'b', isPrimaryKey: true }] });
    const all = vi.mocked(gov.updateColumn).mock.calls.map(([c]) => c);
    expect(all[0]).toMatchObject({ id: 'b', isPrimaryKey: true });
    expect('pkPosition' in all[0]).toBe(false);
    expect(all.slice(1).map((c) => [c.id, c.ordinal])).toEqual([['b', 1], ['a', 2]]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('Undo del reorden (final review #1)', () => {
  const lastWrite = () => {
    const out = new Map<string, { ordinal: number; isPrimaryKey?: boolean }>();
    for (const [c] of vi.mocked(gov.updateColumn).mock.calls) out.set(c.id, { ordinal: c.ordinal, isPrimaryKey: c.isPrimaryKey });
    return out;
  };

  it('Undo de un reorden que normalizó un ordinal viejo: restaura por valor, sin chocar con la guarda', async () => {
    setCols([col('a', 0), col('k', 1, true), col('b', 2)]);           // dato viejo: PK con ordinal 1
    await useModelerStore.getState().reorderColumns('t1', ['k', 'a', 'b']);
    vi.mocked(gov.updateColumn).mockClear();
    await useUndoStore.getState().undoLast();
    expect(toast.error).not.toHaveBeenCalled();
    expect(Object.fromEntries([...lastWrite()].map(([id, w]) => [id, w.ordinal]))).toEqual({ a: 0, k: 1 });
  });

  it('canvas drop hacia la llave + 2 Undo: vuelve al estado original sin ordinales duplicados', async () => {
    setCols([col('k', 0, true), col('a', 1), col('b', 2)]);
    await useModelerStore.getState().applyCanvasDrop('t1', { order: ['k', 'b', 'a'], key: [{ id: 'b', isPrimaryKey: true }] });
    await useUndoStore.getState().undoLast();
    await useUndoStore.getState().undoLast();
    expect(toast.error).not.toHaveBeenCalled();
    const w = lastWrite();
    expect([w.get('a')?.ordinal, w.get('b')?.ordinal, w.get('b')?.isPrimaryKey]).toEqual([1, 2, false]);
  });
});
