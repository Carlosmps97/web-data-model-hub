// Doc 74: el drag&drop de Properties → Columns, el grip del canvas y las
// flechas del inspector reordenan el ÚNICO orden de la tabla (`ordinal`, el
// mismo en lógico y físico): se persiste sólo lo que cambió, con Undo.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', () => ({
  updateColumn: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import * as gov from '@/services/governance.service';
import { useModelerStore } from './useModelerStore';
import { useUndoStore } from './useUndoStore';

const col = (id: string, ordinal: number) =>
  ({ id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: id, dataType: 'INT', typeOverridden: false, ordinal });
const DIAGRAM = {
  subjectArea: { id: 'sa1', projectId: 'p', name: 's', tableIds: ['t1'], layout: {} },
  tables: [{ id: 't1', physicalName: 'T', logicalName: 't' }],
  columns: [col('a', 0), col('b', 1), col('c', 2)],
  relationships: [], views: [],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Sin canvas activo el reload() interno es no-op (no pega al backend).
  useModelerStore.setState({ activeSaId: null, diagram: JSON.parse(JSON.stringify(DIAGRAM)), dirty: false });
  useUndoStore.setState({ stack: [], busy: false });
});

const calls = () => vi.mocked(gov.updateColumn).mock.calls.map(([c]) => ({ id: c.id, ordinal: c.ordinal }));

describe('useModelerStore.reorderColumns (doc 74)', () => {
  it('escribe ordinal sólo en las columnas que se movieron y deja Undo', async () => {
    await useModelerStore.getState().reorderColumns('t1', ['b', 'a', 'c']);
    expect(calls()).toEqual([{ id: 'b', ordinal: 0 }, { id: 'a', ordinal: 1 }]);
    const byId = new Map(useModelerStore.getState().diagram!.columns.map((c) => [c.id, c]));
    expect([byId.get('a')!.ordinal, byId.get('b')!.ordinal, byId.get('c')!.ordinal]).toEqual([1, 0, 2]);
    expect(useUndoStore.getState().stack.at(-1)?.label).toBe('Reorder columns');
  });

  it('sin cambios efectivos no persiste nada', async () => {
    await useModelerStore.getState().reorderColumns('t1', ['a', 'b', 'c']);
    expect(gov.updateColumn).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('Undo devuelve el orden previo', async () => {
    await useModelerStore.getState().reorderColumns('t1', ['c', 'a', 'b']);
    vi.mocked(gov.updateColumn).mockClear();
    await useUndoStore.getState().undoLast();
    expect(calls()).toEqual([{ id: 'a', ordinal: 0 }, { id: 'b', ordinal: 1 }, { id: 'c', ordinal: 2 }]);
  });

  it('applyCanvasDrop: cambios de llave por gov.updateColumn + reorden de columnas (PK primero)', async () => {
    await useModelerStore.getState().applyCanvasDrop('t1', {
      order: ['c', 'a', 'b'],
      key: [{ id: 'c', isPrimaryKey: true }],
    });
    const all = vi.mocked(gov.updateColumn).mock.calls.map(([c]) => c);
    expect(all[0]).toMatchObject({ id: 'c', isPrimaryKey: true });
    expect(all.slice(1).map((c) => ({ id: c.id, ordinal: c.ordinal }))).toEqual([{ id: 'c', ordinal: 0 }, { id: 'a', ordinal: 1 }, { id: 'b', ordinal: 2 }]);
    expect(useUndoStore.getState().stack.map((u) => u.label)).toEqual(['Edit key', 'Reorder columns']);
  });
});
