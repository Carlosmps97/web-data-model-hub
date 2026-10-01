// Doc 105 (ronda 3) — borrar una COLUMNA (o la cascada de FK de borrar una
// TABLA): todas las lecturas van ANTES de la primera escritura, como en
// `deleteTable` (A3/A5). Antes `deleteColumn` leía las relaciones de la hija
// DESPUÉS de borrar las relaciones elegidas: si esa lectura fallaba, quedaban
// relaciones borradas con la columna viva y sin Undo; y `deleteTable` leía las
// de la hija con `.catch(() => [])`: una caída apagaba el `isForeignKey` de una
// hija que sigue siendo FK de otra relación. Ahora si una lectura falla no se
// escribe nada (`NothingDoneError`, reintentable).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const log: string[] = [];
let rels: Record<string, unknown[]> = {};
let cols: Record<string, unknown[]> = {};

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(async (tid: string) => { log.push(`read-rels:${tid}`); return rels[tid] ?? []; }),
    listColumns: vi.fn(async (tid: string) => { log.push(`read-cols:${tid}`); return cols[tid] ?? []; }),
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
vi.mock('@/features/modeler/services/structure.service', () => ({
  removeFromCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [], layout: {} })),
  addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
  listedViews: vi.fn(async () => ({ viewIds: [], layout: {} })),
}));
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
const R2 = rel('r2', 'tC', 'tB', [['cX', 'cB']]);          // OTRA relación donde cB también es hija
const writes = () => log.filter((l) => l.startsWith('w-'));
const firstWrite = () => log.findIndex((l) => l.startsWith('w-'));
/** Última lectura de la CASCADA (relaciones y columnas; el saneo de vistas posterior al borrado lee aparte). */
const lastRead = () => log.map((l) => /^read-(rels|cols|usage)/.test(l)).lastIndexOf(true);
const COLUMN_UNREADABLE = "Couldn't check what depends on this column: nothing was deleted. Try again.";

beforeEach(() => {
  vi.clearAllMocks();
  log.length = 0;
  rels = { t1: [R1], tB: [R1] };
  cols = { tB: [CHILD], t1: [COL] };
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewMode: 'physical', selectedColumnId: null });
});

describe('borrar una columna: primero todas las lecturas (doc 105, ronda 3)', () => {
  it('ninguna escritura antes de la última lectura; la FK huérfana de la hija se apaga', async () => {
    await useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never });
    expect(firstWrite()).toBeGreaterThan(lastRead());
    expect(log.indexOf('read-views')).toBeLessThan(firstWrite());   // pre-imagen de las vistas, también antes
    expect(writes()).toEqual(['w-rel-del:r1', 'w-col:cB', 'w-del-col:cA']);
  });

  it.each([
    ['las relaciones de su tabla', () => vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red'))],
    ['las vistas', () => vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('sin red'))],
    ['la columna hija', () => vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'))],
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

  it('una hija que sigue siendo FK de OTRA relación conserva su flag', async () => {
    rels.tB = [R1, R2];
    await useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never });
    expect(writes()).toEqual(['w-rel-del:r1', 'w-del-col:cA']);
  });

  it('en el modelo lógico, «this attribute»', async () => {
    useModelerStore.setState({ viewMode: 'logical' });
    vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red'));
    await expect(useModelerStore.getState().deleteColumn('cA', ['r1'], { col: COL as never }))
      .rejects.toThrow("Couldn't check what depends on this attribute: nothing was deleted. Try again.");
  });
});

describe('borrar una tabla: la FK de las hijas se decide ANTES de escribir (doc 105, ronda 3)', () => {
  const TPRE = { id: 't1', physicalName: 'M_T1', logicalName: 't1' };

  it('si no se pudieron leer las relaciones de una hija, no se borra nada', async () => {
    vi.mocked(gov.listRelationships)
      .mockImplementationOnce(async (tid?: string) => { log.push(`read-rels:${tid}`); return (rels[tid ?? ''] ?? []) as never; })
      .mockRejectedValueOnce(new Error('sin red'));
    await expect(useModelerStore.getState().deleteTable('t1', { pre: TPRE as never }))
      .rejects.toThrow("Couldn't check what depends on this table: nothing was deleted. Try again.");
    expect(writes()).toEqual([]);
  });

  it('una hija que sigue siendo FK de OTRA relación conserva su flag', async () => {
    rels.tB = [R1, R2];
    await useModelerStore.getState().deleteTable('t1', { pre: TPRE as never });
    expect(writes()).not.toContain('w-col:cB');
    expect(firstWrite()).toBeGreaterThan(lastRead());
  });

  it('sin otra relación, la FK huérfana se apaga (como antes)', async () => {
    await useModelerStore.getState().deleteTable('t1', { pre: TPRE as never });
    expect(writes()).toEqual(['w-bulk', 'w-col:cB', 'w-table:t1']);
  });
});
