// El pre-conteo de «Delete table» en Properties no traga los errores: con la
// lectura de vistas caída, mostrar «0 views» haría que el borrado se llevara
// igual las vistas que no mostró. Lo que no se pudo contar se dice (null), no
// se muestra como cero.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textOf } from '../../reporting/components/fakeReact.testutil';

vi.mock('@/components/ui/dialogs', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/services/governance.service', () => ({ tableUsage: vi.fn(), listRelationships: vi.fn() }));
vi.mock('@/services/views.service', () => ({ listViews: vi.fn() }));

import { confirmDialog } from '@/components/ui/dialogs';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { facetNouns } from '@/lib/facets';
import { confirmDeleteColumn, confirmDeleteColumns, confirmDeleteTable, confirmDeleteTables, readTableDeleteCounts, readTablesDeleteCounts } from './deleteConfirm';

const message = () => textOf(vi.mocked(confirmDialog).mock.calls[0][0].message);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gov.tableUsage).mockResolvedValue({ usage: [{ canvasId: 'sa1' }, { canvasId: 'sa2' }], total: 2 } as never);
  vi.mocked(gov.listRelationships).mockResolvedValue([{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [] }] as never);
  vi.mocked(viewsSvc.listViews).mockResolvedValue([{ id: 'v1' }] as never);
});

describe('conteo del impacto de borrar una tabla', () => {
  it('todo leído: los números', async () => {
    expect(await readTableDeleteCounts('t1')).toEqual({ canvases: 2, related: 1, views: 1 });
  });

  it.each([
    ['las vistas', () => vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('sin red')), { canvases: 2, related: 1, views: null }],
    ['las relaciones', () => vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red')), { canvases: 2, related: null, views: 1 }],
    ['los canvases', () => vi.mocked(gov.tableUsage).mockRejectedValueOnce(new Error('sin red')), { canvases: null, related: 1, views: 1 }],
  ])('si no se pudieron leer %s, queda en null (no en 0)', async (_label, fail, expected) => {
    fail();
    expect(await readTableDeleteCounts('t1')).toEqual(expected);
  });

  it('el diálogo dice qué no se pudo contar, en vez de «0»', async () => {
    await confirmDeleteTable({ name: 'M_T1', nouns: facetNouns('physical'), impact: { canvases: 2, related: null, views: null }, action: async () => {} });
    expect(message()).toContain("Couldn't count its views");
    expect(message()).toContain("Couldn't count its related tables");
    expect(message()).not.toMatch(/\b0 (views?|related)\b/);
    expect(message()).toContain('2 canvases it appears on');
  });

  it('en el modelo lógico, con sus sustantivos', async () => {
    await confirmDeleteTable({ name: 'E1', nouns: facetNouns('logical'), impact: { canvases: null, related: null, views: 0 }, action: async () => {} });
    expect(message()).toContain("Couldn't count the canvases it appears on");
    expect(message()).toContain("Couldn't count its related entities");
    expect(message()).toContain('0 views');
  });
});

// En el modelo lógico el texto del diálogo usa los mismos sustantivos por
// modelo que el título (no «Column … this table» ni «Its columns …»).
describe('los diálogos de borrado usan los sustantivos del modelo', () => {
  const noImpact = { relationships: [], total: 0 };
  const oneRel = { relationships: [{ relId: 'r1', otherTableName: 'T2', otherColumnName: 'C', canvases: [] }], total: 1 };

  it('tabla / entidad: «Its attributes and relationships go too»', async () => {
    await confirmDeleteTable({ name: 'E1', nouns: facetNouns('logical'), impact: { canvases: 1, related: 0, views: 0 }, action: async () => {} });
    expect(message()).toContain('Its attributes and relationships go too.');
  });

  it('columna / atributo sin relaciones: «Attribute … will be removed from this entity»', async () => {
    await confirmDeleteColumn({ name: 'COD', nouns: facetNouns('logical'), impact: noImpact as never, action: async () => {} });
    expect(message()).toBe('Attribute “COD” will be removed from this entity.');
  });

  it('columna / atributo con relaciones: «Attribute … participates in …»', async () => {
    await confirmDeleteColumn({ name: 'COD', nouns: facetNouns('logical'), impact: oneRel as never, action: async () => {} });
    expect(message()).toMatch(/^Attribute “COD” participates in 1 relationship/);
  });

  it('en físico, con tabla y columna', async () => {
    await confirmDeleteColumn({ name: 'COD', nouns: facetNouns('physical'), impact: noImpact as never, action: async () => {} });
    expect(message()).toBe('Column “COD” will be removed from this table.');
  });
});

// Borrar varias columnas (menú del canvas): un solo diálogo con todas, de qué
// tabla son y las relaciones que pierden pares; con una sola, el de siempre.
describe('diálogo de borrar varias columnas', () => {
  const noImpact = { relationships: [], total: 0 };
  const oneRel = { relationships: [{ relId: 'r1', otherTableName: 'H', otherColumnName: 'HA, HB', canvases: [{ id: 'sa1', name: 'Canvas 1' }] }], total: 1 };
  const opts = () => vi.mocked(confirmDialog).mock.calls[0][0];

  it('título, cuántas y de qué tabla, con todos los nombres', async () => {
    await confirmDeleteColumns({ names: ['PA', 'PB', 'C1'], tableName: 'P', nouns: facetNouns('physical'), impact: noImpact as never, action: async () => {} });
    expect(opts().title).toBe('Delete 3 columns');
    expect(message()).toContain('3 columns of “P” will be deleted:');
    expect(message()).toContain('PAPBC1');
    expect(opts().confirmLabel).toBe('Delete');
    expect(opts().variant).toBe('danger');
  });

  it('con relaciones: las nombra y el botón dice «Delete anyway»', async () => {
    await confirmDeleteColumns({ names: ['PA', 'PB'], tableName: 'P', nouns: facetNouns('physical'), impact: oneRel as never, action: async () => {} });
    expect(message()).toContain('They participate in 1 relationship — each will lose the pairs of these columns (or be deleted if none remain):');
    expect(message()).toContain('H.HA, HB');
    expect(message()).toContain('in Canvas 1');
    expect(opts().confirmLabel).toBe('Delete anyway');
  });

  it('en el modelo lógico, con sus sustantivos', async () => {
    await confirmDeleteColumns({ names: ['cod', 'fec'], tableName: 'Cliente', nouns: facetNouns('logical'), impact: noImpact as never, action: async () => {} });
    expect(opts().title).toBe('Delete 2 attributes');
    expect(message()).toContain('2 attributes of “Cliente” will be deleted:');
  });

  it('con una sola columna es el diálogo de siempre', async () => {
    await confirmDeleteColumns({ names: ['COD'], tableName: 'P', nouns: facetNouns('physical'), impact: noImpact as never, action: async () => {} });
    expect(opts().title).toBe('Delete column');
    expect(message()).toBe('Column “COD” will be removed from this table.');
  });
});

// Una vista que el borrado deja sin columnas: el Export DDL la escribiría como
// `SELECT *`. El diálogo lo avisa (y si no pudo revisarlo, lo dice); el borrado
// sigue.
describe('aviso de vistas que quedan sin columnas', () => {
  const noImpact = { relationships: [], total: 0 };
  const physical = facetNouns('physical');

  it('una columna, una vista', async () => {
    await confirmDeleteColumn({ name: 'COD', nouns: physical, impact: noImpact as never, emptiedViews: ['VU_A'], action: async () => {} });
    expect(message()).toContain('This view will be left without columns: VU_A. Edit or delete it afterwards.');
  });

  it('varias columnas, varias vistas', async () => {
    await confirmDeleteColumns({ names: ['PA', 'PB'], tableName: 'P', nouns: physical, impact: noImpact as never, emptiedViews: ['VU_A', 'VU_B'], action: async () => {} });
    expect(message()).toContain('These 2 views will be left without columns: VU_A, VU_B. Edit or delete them afterwards.');
  });

  it('si no se pudieron leer las vistas, lo dice', async () => {
    await confirmDeleteColumns({ names: ['PA', 'PB'], tableName: 'P', nouns: physical, impact: noImpact as never, emptiedViews: null, action: async () => {} });
    expect(message()).toContain("Couldn't check which views would be left without columns.");
  });

  it('sin vistas vacías no agrega nada', async () => {
    await confirmDeleteColumn({ name: 'COD', nouns: physical, impact: noImpact as never, emptiedViews: [], action: async () => {} });
    expect(message()).toBe('Column “COD” will be removed from this table.');
  });
});

// Borrar un grupo de tablas (doc 134 §3.9): el impacto sumado, sin repetir, y las
// relacionadas que cuentan son las de AFUERA del grupo.
describe('impacto de borrar varias tablas', () => {
  beforeEach(() => {
    vi.mocked(gov.tableUsage).mockImplementation(async (id: string) =>
      ({ usage: id === 't1' ? [{ canvasId: 'sa1' }, { canvasId: 'sa2' }] : [{ canvasId: 'sa2' }, { canvasId: 'sa3' }], total: 2 }) as never);
    vi.mocked(gov.listRelationships).mockImplementation(async (id?: string) => (id === 't1'
      ? [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [] }, { id: 'r2', parentTableId: 't1', childTableId: 't9', pairs: [] }]
      : [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [] }, { id: 'r3', parentTableId: 't8', childTableId: 't2', pairs: [] }]) as never);
    vi.mocked(viewsSvc.listViews).mockImplementation(async (id: string) => (id === 't1' ? [{ id: 'v1' }] : [{ id: 'v1' }, { id: 'v2' }]) as never);
  });
  it('canvases y vistas sin repetir; relacionadas solo las de afuera del grupo', async () => {
    expect(await readTablesDeleteCounts(['t1', 't2'])).toEqual({ canvases: 3, related: 2, views: 2 });
  });
  it('lo que no se pudo leer de alguna tabla no se cuenta (null)', async () => {
    vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('down'));
    expect(await readTablesDeleteCounts(['t1', 't2'])).toEqual({ canvases: 3, related: 2, views: null });
  });
});

describe('diálogo de borrar varias tablas', () => {
  const names = Array.from({ length: 12 }, (_, i) => `T${i + 1}`);
  it('título y botón con cuántas; los primeros 10 nombres y «+2 more»', async () => {
    await confirmDeleteTables({ names, nouns: facetNouns('physical'), impact: { canvases: 3, related: 2, views: 1 }, action: async () => {} });
    const o = vi.mocked(confirmDialog).mock.calls[0][0];
    expect(o.title).toBe('Delete 12 tables');
    expect(o.confirmLabel).toBe('Delete 12 tables');
    expect(message()).toContain('T10');
    expect(message()).not.toContain('T11');
    expect(message()).toContain('+2 more');
    expect(message()).toContain('3 canvases they appear on');
  });
  it('en el modelo lógico, con sus sustantivos', async () => {
    await confirmDeleteTables({ names: ['A', 'B'], nouns: facetNouns('logical'), impact: { canvases: 1, related: 0, views: 0 }, action: async () => {} });
    expect(vi.mocked(confirmDialog).mock.calls[0][0].title).toBe('Delete 2 entities');
  });
});
