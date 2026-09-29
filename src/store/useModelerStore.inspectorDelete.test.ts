// Doc 89 §3.1: borrar desde el Object Inspector SIN canvas reusa las cascadas
// del store. Las dos firmas ganan un `opts` opcional con la pre-imagen del
// dossier (estado efectivo) — sin `diagram` el Undo y la cascada de columna
// deben funcionar igual que desde el canvas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(),
    listColumns: vi.fn(),
    tableUsage: vi.fn(async () => ({ usage: [], total: 0 })),
    updateColumn: vi.fn(async (c: { id: string }) => { order.push(`fk:${c.id}`); return {}; }),
    updateRelationship: vi.fn(async (r: { id: string }) => { order.push(`rel-upd:${r.id}`); return {}; }),
    deleteRelationship: vi.fn(async (id: string) => { order.push(`rel-del:${id}`); return {}; }),
    recordChangesBulk: vi.fn(async () => { order.push('bulk'); return {}; }),
    deleteTable: vi.fn(async (id: string) => { order.push(`table:${id}`); return {}; }),
    deleteColumn: vi.fn(async (id: string) => { order.push(`col:${id}`); return {}; }),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(async () => []),
  updateView: vi.fn(async () => ({})),
  deleteView: vi.fn(),
}));
vi.mock('@/features/modeler/services/structure.service', () => ({
  removeFromCanvas: vi.fn(async () => {}),
  addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(async () => { throw new Error('sin canvas en el test'); }),
}));
vi.mock('@/services/naming.service', () => ({
  getNamingConfig: vi.fn(async () => ({ table: { case: 'upper' }, column: { case: 'lower' } })),
}));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useUndoStore } from './useUndoStore';
import { useModelerStore } from './useModelerStore';

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, selectedTableId: null, selectedColumnId: null, naming: null, activeProjectId: null, explorerTick: 0 });
});

const tPre = { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core' };

describe('deleteTable(id, { pre }) sin diagrama (inspector)', () => {
  it('apila el Undo con la pre-imagen del dossier y su inversa re-crea la tabla en lote', async () => {
    vi.mocked(gov.listRelationships).mockResolvedValue([]);
    vi.mocked(gov.listColumns).mockResolvedValue([{ id: 'c1', tableId: 't1' } as never]);

    await useModelerStore.getState().deleteTable('t1', { pre: tPre });

    expect(order).toEqual(['bulk', 'table:t1']);
    // Doc 89 §3.6: sin canvas activo nadie sube el tick por firma → lo sube el borrado.
    expect(useModelerStore.getState().explorerTick).toBe(1);
    const stack = useUndoStore.getState().stack;
    expect(stack.map((e) => e.label)).toEqual(['Delete table M_CLIENTE']);
    order.length = 0;
    await useUndoStore.getState().undoLast();
    const items = vi.mocked(gov.recordChangesBulk).mock.calls.at(-1)![0];
    expect(items[0]).toMatchObject({ collection: 'canonical_tables', entityId: 't1', op: 'upsert', payload: tPre });
    expect(items[1]).toMatchObject({ collection: 'canonical_columns', entityId: 'c1', op: 'upsert' });
    // La inversa también refresca el Explorer (la tabla vuelve al inventario).
    expect(useModelerStore.getState().explorerTick).toBe(2);
  });

  it('sin pre-imagen ni diagrama: borra igual y no apila Undo (comportamiento actual)', async () => {
    vi.mocked(gov.listRelationships).mockResolvedValue([]);
    vi.mocked(gov.listColumns).mockResolvedValue([]);

    await useModelerStore.getState().deleteTable('t1');

    expect(gov.deleteTable).toHaveBeenCalledWith('t1');
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

describe('deleteColumn(id, relIds, { col }) sin diagrama (inspector)', () => {
  const col = { id: 'cA', tableId: 't1', physicalName: 'COD', logicalName: 'codigo', dataType: 'INT', typeOverridden: false, ordinal: 0, isPrimaryKey: true };

  it('recorta la relación, limpia la FK hija por API (fallback sin diagrama) y apila el Undo', async () => {
    vi.mocked(gov.listRelationships).mockImplementation(async (tid?: string) => (
      tid === 't1' || tid === 'tB'
        ? [{ id: 'r1', parentTableId: 't1', childTableId: 'tB', identifying: false, parentCardinality: 'one', childCardinality: 'many',
             pairs: [{ parentColumnId: 'cA', childColumnId: 'cB' }] } as never]
        : []));
    vi.mocked(gov.listColumns).mockImplementation(async (tid: string) => (
      tid === 'tB' ? [{ id: 'cB', tableId: 'tB', isForeignKey: true, physicalName: 'COD', logicalName: 'codigo', dataType: 'INT', typeOverridden: false, ordinal: 0 } as never] : []));
    // Tras borrar la relación, la hija ya no participa en ninguna → FK huérfana.
    vi.mocked(gov.listRelationships).mockImplementationOnce(async () => [{ id: 'r1', parentTableId: 't1', childTableId: 'tB', identifying: false, parentCardinality: 'one', childCardinality: 'many', pairs: [{ parentColumnId: 'cA', childColumnId: 'cB' }] } as never])
      .mockImplementation(async () => []);

    await useModelerStore.getState().deleteColumn('cA', ['r1'], { col: col as never });

    expect(order).toEqual(['rel-del:r1', 'fk:cB', 'col:cA']);
    expect(gov.updateColumn).toHaveBeenCalledWith(expect.objectContaining({ id: 'cB', isForeignKey: false }));
    // Las vistas que la referenciaban se sanean (best-effort) con la tabla de la columna.
    expect(viewsSvc.listViews).toHaveBeenCalledWith('t1');
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete column COD']);
    expect(useModelerStore.getState().explorerTick).toBe(1);
    await useUndoStore.getState().undoLast();
    expect(useModelerStore.getState().explorerTick).toBe(2);
  });

  it('sin `col` ni diagrama: borra la columna «pelada» (comportamiento actual, sin Undo)', async () => {
    await useModelerStore.getState().deleteColumn('cZ');
    expect(order).toEqual(['col:cZ']);
    expect(gov.listRelationships).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

describe('loadNaming sin canvas abierto (doc 89 §3.1)', () => {
  it('con activeProjectId null cachea igual la config (el inspector la necesita para la regla de case)', async () => {
    await useModelerStore.getState().loadNaming('p1');
    expect(useModelerStore.getState().naming).toEqual({ table: { case: 'upper' }, column: { case: 'lower' } });
  });

  it('con OTRO proyecto activo descarta la respuesta (cambio rápido de canvas)', async () => {
    useModelerStore.setState({ activeProjectId: 'p2' });
    await useModelerStore.getState().loadNaming('p1');
    expect(useModelerStore.getState().naming).toBeNull();
  });
});
