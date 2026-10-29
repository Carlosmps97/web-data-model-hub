// Borrar una columna (o la cascada de FK de borrar una tabla): todas las
// lecturas van antes de la primera escritura, como en `deleteTable`. Si las
// relaciones de la hija se leyeran después de borrar las relaciones elegidas y
// esa lectura fallara, quedarían relaciones borradas con la columna viva y sin
// Undo; y si una lectura caída contara como lista vacía, se apagaría el
// `isForeignKey` de una hija que sigue siendo FK de otra relación. Si una
// lectura falla no se escribe nada (`NothingDoneError`, reintentable).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const log: string[] = [];
/** Cada envío único (`canvasLot`): `colección:op:id`. */
const sentLots: string[][] = [];
let rels: Record<string, unknown[]> = {};
let cols: Record<string, unknown[]> = {};

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(async (tid: string) => { log.push(`read-rels:${tid}`); return rels[tid] ?? []; }),
    listColumns: vi.fn(async (tid: string) => { log.push(`read-cols:${tid}`); return cols[tid] ?? []; }),
    currentColumns: vi.fn(async (ids: string[]) => {
      log.push(`read-cols-by-id:${ids.join(',')}`);
      return Object.values(cols).flat().filter((c) => ids.includes((c as { id: string }).id));
    }),
    tableUsage: vi.fn(async () => { log.push('read-usage'); return { usage: [], total: 0 }; }),
    updateColumn: vi.fn(async (c: { id: string }) => { log.push(`w-col:${c.id}`); return {}; }),
    updateRelationship: vi.fn(async (r: { id: string }) => { log.push(`w-rel-upd:${r.id}`); return {}; }),
    deleteRelationship: vi.fn(async (id: string) => { log.push(`w-rel-del:${id}`); return {}; }),
    recordChangesBulk: vi.fn(async () => { log.push('w-bulk'); return {}; }),
    deleteTable: vi.fn(async (id: string) => { log.push(`w-table:${id}`); return {}; }),
    deleteColumn: vi.fn(async (id: string) => { log.push(`w-del-col:${id}`); return {}; }),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(async () => { log.push('read-views'); return []; }),
  updateView: vi.fn(async () => ({})),
  deleteView: vi.fn(),
}));
vi.mock('@/features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/modeler/services/structure.service')>();
  return {
    ...actual,
    removeFromCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [], layout: {} })),
    addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
    listedViews: vi.fn(async () => ({ viewIds: [], layout: {} })),
    canvasLot: vi.fn(async (ids: string[], build: (docs: Map<string, null>) => { changes: { collection: string; op: string; entityId: string }[]; result: unknown }) => {
      const plan = build(new Map(ids.map((id) => [id, null])));
      log.push('w-lot');
      sentLots.push(plan.changes.map((c) => `${c.collection}:${c.op}:${c.entityId}`));
      return plan.result;
    }),
  };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(async () => { throw new Error('sin canvas en el test'); }),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const COL = { id: 'cA', tableId: 't1', physicalName: 'COD', logicalName: 'codigo', dataType: 'INT', typeOverridden: false, ordinal: 0, isPrimaryKey: true };
const CHILD = { id: 'cB', tableId: 'tB', physicalName: 'COD', logicalName: 'codigo', dataType: 'INT', typeOverridden: false, ordinal: 0, isForeignKey: true };
const rel = (id: string, parentTableId: string, childTableId: string, pairs: [string, string][]) => ({
  id, parentTableId, childTableId, identifying: false, parentCardinality: 'one', childCardinality: 'many',
  pairs: pairs.map(([parentColumnId, childColumnId]) => ({ parentColumnId, childColumnId })),
});
const R1 = rel('r1', 't1', 'tB', [['cA', 'cB']]);          // la que se borra con la columna
const R2 = rel('r2', 'tC', 'tB', [['cX', 'cB']]);          // otra relación donde cB también es hija
const writes = () => log.filter((l) => l.startsWith('w-'));
/** Lo que llevó el primer lote: `colección:op:id`. */
const lot = () => vi.mocked(gov.recordChangesBulk).mock.calls[0][0].map((c) => `${c.collection}:${c.op}:${c.entityId}`);
const firstWrite = () => log.findIndex((l) => l.startsWith('w-'));
/** Última lectura de la cascada (relaciones y columnas; el saneo de vistas posterior al borrado lee aparte). */
const lastRead = () => log.map((l) => /^read-(rels|cols|usage)/.test(l)).lastIndexOf(true);
const COLUMN_UNREADABLE = "Couldn't check what depends on this column: nothing was deleted. Try again.";

beforeEach(() => {
  vi.clearAllMocks();
  log.length = 0;
  sentLots.length = 0;
  rels = { t1: [R1], tB: [R1] };
  cols = { tB: [CHILD], t1: [COL] };
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewMode: 'physical', selectedColumnId: null });
});

describe('borrar una columna: primero todas las lecturas', () => {
  it('ninguna escritura antes de la última lectura; la FK huérfana de la hija se apaga', async () => {
    await useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never });
    expect(firstWrite()).toBeGreaterThan(lastRead());
    expect(log.indexOf('read-views')).toBeLessThan(firstWrite());   // la pre-imagen de las vistas también va primero
    expect(writes()).toEqual(['w-bulk']);                           // todo en un solo lote
    expect(lot()).toEqual(['relationships:delete:r1', 'canonical_columns:upsert:cB', 'canonical_columns:delete:cA']);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][0][1].payload).toEqual({ ...CHILD, isForeignKey: false });
  });

  it('de la tabla hija lee solo sus columnas hijas (por id), no la tabla entera', async () => {
    await useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never });
    expect(vi.mocked(gov.listColumns).mock.calls.map(([t]) => t)).toEqual(['t1']);
    expect(log).toContain('read-cols-by-id:cB');
  });

  it.each([
    ['las relaciones de su tabla', () => vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red'))],
    ['las vistas', () => vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('sin red'))],
    ['las columnas de su tabla', () => vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'))],
    ['la columna hija', () => vi.mocked(gov.currentColumns).mockRejectedValueOnce(new Error('sin red'))],
    ['las relaciones de la hija', () => {
      vi.mocked(gov.listRelationships)
        .mockImplementationOnce(async (tid?: string) => { log.push(`read-rels:${tid}`); return (rels[tid ?? ''] ?? []) as never; })
        .mockRejectedValueOnce(new Error('sin red'));
    }],
  ])('si no se pudo leer %s, no se escribe nada y se puede reintentar', async (_label, fail) => {
    fail();
    await expect(useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never })).rejects.toThrow(COLUMN_UNREADABLE);
    expect(writes()).toEqual([]);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('una hija que sigue siendo FK de otra relación conserva su flag', async () => {
    rels.tB = [R1, R2];
    await useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never });
    expect(lot()).toEqual(['relationships:delete:r1', 'canonical_columns:delete:cA']);
  });

  it('en el modelo lógico, «this attribute»', async () => {
    useModelerStore.setState({ viewMode: 'logical' });
    vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red'));
    await expect(useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never }))
      .rejects.toThrow("Couldn't check what depends on this attribute: nothing was deleted. Try again.");
  });
});

describe('borrar una tabla: la FK de las hijas se decide antes de escribir', () => {
  const TPRE = { id: 't1', physicalName: 'M_T1', logicalName: 't1' };

  it('si no se pudieron leer las columnas hijas, no se borra nada', async () => {
    vi.mocked(gov.currentColumns).mockRejectedValueOnce(new Error('sin red'));
    await expect(useModelerStore.getState().deleteTable('t1', { pre: TPRE as never }))
      .rejects.toThrow("Couldn't check what depends on this table: nothing was deleted. Try again.");
    expect(writes()).toEqual([]);
  });

  it('si no se pudieron leer las relaciones de una hija, no se borra nada', async () => {
    vi.mocked(gov.listRelationships)
      .mockImplementationOnce(async (tid?: string) => { log.push(`read-rels:${tid}`); return (rels[tid ?? ''] ?? []) as never; })
      .mockRejectedValueOnce(new Error('sin red'));
    await expect(useModelerStore.getState().deleteTable('t1', { pre: TPRE as never }))
      .rejects.toThrow("Couldn't check what depends on this table: nothing was deleted. Try again.");
    expect(writes()).toEqual([]);
  });

  it('una hija que sigue siendo FK de otra relación conserva su flag', async () => {
    rels.tB = [R1, R2];
    await useModelerStore.getState().deleteTable('t1', { pre: TPRE as never });
    expect(writes()).toEqual(['w-lot']);
    expect(sentLots[0]).not.toContain('canonical_columns:upsert:cB');
    expect(firstWrite()).toBeGreaterThan(lastRead());
  });

  it('sin otra relación, la FK huérfana se apaga en el mismo envío', async () => {
    await useModelerStore.getState().deleteTable('t1', { pre: TPRE as never });
    expect(writes()).toEqual(['w-lot']);
    expect(sentLots[0]).toEqual([
      'relationships:delete:r1', 'canonical_columns:delete:cA', 'canonical_columns:upsert:cB', 'canonical_tables:delete:t1',
    ]);
  });
});
