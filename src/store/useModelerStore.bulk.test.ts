// Cascadas EN LOTE (doc 39): deleteTable y createTableFromSources graban sus
// cambios con UNA llamada recordChangesBulk en vez de N requests secuenciales
// (a 4k columnas el loop viejo eran minutos). La semántica se conserva:
// lecturas pre-borrado, FK huérfano, canvases y la tabla AL FINAL.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(),
    listColumns: vi.fn(),
    tableUsage: vi.fn(),
    updateColumn: vi.fn(async (c: { id: string }) => { order.push(`fk:${c.id}`); return {}; }),
    recordChangesBulk: vi.fn(async () => { order.push('bulk'); return {}; }),
    deleteTable: vi.fn(async (id: string) => { order.push(`table:${id}`); return {}; }),
    deleteColumn: vi.fn(),
    deleteRelationship: vi.fn(),
    physicalize: vi.fn(async () => ({ physical: 'TBL_FIS' })),
    createTable: vi.fn(),
    createColumn: vi.fn(),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(),
  deleteView: vi.fn(),
}));
vi.mock('@/features/modeler/services/structure.service', () => ({
  removeFromCanvas: vi.fn(async (saId: string) => { order.push(`canvas:${saId}`); }),
  addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(async () => { throw new Error('sin canvas en el test'); }),
}));

import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import * as struct from '@/features/modeler/services/structure.service';
import { useModelerStore } from './useModelerStore';

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  useModelerStore.setState({ activeSaId: null, dirty: false, selectedTableId: null, selectedEdgeId: null });
});

describe('useModelerStore.deleteTable — cascada en lote', () => {
  it('graba vistas+relaciones+columnas en UN bulk y la tabla AL FINAL (tras los canvases)', async () => {
    vi.mocked(viewsSvc.listViews).mockResolvedValue([{ id: 'v1' } as never]);
    vi.mocked(gov.listRelationships).mockImplementation(async (tid?: string) => (
      tid === 't1'
        ? [{ id: 'r1', parentTableId: 't1', childTableId: 'tB',
             pairs: [{ parentColumnId: 'pc', childColumnId: 'cc' }] } as never]
        : []));
    vi.mocked(gov.listColumns).mockImplementation(async (tid: string) => (
      tid === 't1'
        ? [{ id: 'c1', tableId: 't1' } as never, { id: 'c2', tableId: 't1' } as never]
        : [{ id: 'cc', tableId: 'tB', isForeignKey: true } as never]));
    vi.mocked(gov.tableUsage).mockResolvedValue({ usage: [{ canvasId: 'sa1' }, { canvasId: 'sa2' }] } as never);
    useModelerStore.setState({ selectedTableId: 't1' });

    await useModelerStore.getState().deleteTable('t1');

    // UN solo lote con la cascada completa, en orden vistas → relaciones → columnas.
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][0]).toEqual([
      { collection: 'views', entityId: 'v1', op: 'delete' },
      { collection: 'relationships', entityId: 'r1', op: 'delete' },
      { collection: 'canonical_columns', entityId: 'c1', op: 'delete' },
      { collection: 'canonical_columns', entityId: 'c2', op: 'delete' },
    ]);
    // Nada viaja cambio-por-cambio.
    expect(viewsSvc.deleteView).not.toHaveBeenCalled();
    expect(gov.deleteRelationship).not.toHaveBeenCalled();
    expect(gov.deleteColumn).not.toHaveBeenCalled();
    // FK huérfano de la tabla SOBREVIVIENTE (cc ya no participa en ninguna
    // relación) se desmarca igual que en el flujo viejo.
    expect(gov.updateColumn).toHaveBeenCalledWith(expect.objectContaining({ id: 'cc', isForeignKey: false }));
    // Orden observable: lote → FK → canvases → tabla al final.
    expect(order).toEqual(['bulk', 'fk:cc', 'canvas:sa1', 'canvas:sa2', 'table:t1']);
    expect(useModelerStore.getState().selectedTableId).toBeNull();
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('tabla sin cascada: bulk vacío NO viaja, la tabla igual se borra', async () => {
    vi.mocked(viewsSvc.listViews).mockResolvedValue([]);
    vi.mocked(gov.listRelationships).mockResolvedValue([]);
    vi.mocked(gov.listColumns).mockResolvedValue([]);
    vi.mocked(gov.tableUsage).mockResolvedValue({ usage: [] } as never);

    await useModelerStore.getState().deleteTable('t9');

    const bulks = vi.mocked(gov.recordChangesBulk).mock.calls;
    expect(bulks.length === 0 || bulks[0][0].length === 0).toBe(true);
    expect(gov.deleteTable).toHaveBeenCalledWith('t9');
  });
});

describe('useModelerStore.createTableFromSources — tabla+columnas en lote', () => {
  it('graba la tabla y TODAS las columnas con un solo recordChangesBulk', async () => {
    useModelerStore.setState({ activeSaId: 'sa1' });

    await useModelerStore.getState().createTableFromSources({
      logicalName: 'nueva tabla',
      schema: 'core',
      columns: [
        { logicalName: 'id', physicalName: 'ID', dataType: 'BIGINT', typeOverridden: false, isPrimaryKey: true },
        { logicalName: 'saldo', physicalName: 'SALDO', dataType: 'DECIMAL(18,2)', typeOverridden: true, isPrimaryKey: false },
      ] as never,
    });

    expect(gov.createTable).not.toHaveBeenCalled();
    expect(gov.createColumn).not.toHaveBeenCalled();
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    const items = vi.mocked(gov.recordChangesBulk).mock.calls[0][0];
    expect(items).toHaveLength(3);
    const [tabla, ...cols] = items;
    expect(tabla.collection).toBe('canonical_tables');
    expect(tabla.op).toBe('upsert');
    expect(tabla.payload).toMatchObject({ logicalName: 'nueva tabla', physicalName: 'TBL_FIS', schema: 'core' });
    expect(cols.map((c) => c.collection)).toEqual(['canonical_columns', 'canonical_columns']);
    expect(cols.map((c) => (c.payload as { ordinal: number }).ordinal)).toEqual([0, 1]);
    expect(cols.every((c) => (c.payload as { tableId: string }).tableId === tabla.entityId)).toBe(true);
    // La membresía al canvas sigue igual (fuera del lote, colección de estructura).
    // Doc 100: «agrega esta tabla»; la lista completa la arma el servicio en su cola.
    expect(struct.addToCanvas).toHaveBeenCalledWith('sa1', { tableIds: [tabla.entityId] });
    expect(useModelerStore.getState().selectedTableId).toBe(tabla.entityId);
  });
});

describe('useModelerStore.createTableFromSources — herencia de metadata individual (doc 45)', () => {
  it('copia definición, flags, UDPs, dominio y tipo; ids nuevos y ordinal PK primero (doc 94)', async () => {
    useModelerStore.setState({ activeSaId: 'sa1' });

    await useModelerStore.getState().createTableFromSources({
      logicalName: 'nueva',
      columns: [
        { id: 'cSrc', tableId: 'tSrc', ordinal: 7, logicalName: 'codigo', physicalName: 'COD',
          dataType: 'BIGINT', typeOverridden: false, isPrimaryKey: true, isForeignKey: true,
          isNullable: false, isPartition: true, description: 'Código del cliente',
          parentDomainId: 'dom-1', udpValues: { 'udp-1': 'CLIENTE' } },
        { id: 'cSrc2', tableId: 'tSrc', ordinal: 8, logicalName: 'texto', physicalName: 'TXT',
          dataType: 'STRING', typeOverridden: false, isPrimaryKey: false },
        { id: 'cSrc3', tableId: 'tSrc', ordinal: 9, logicalName: 'fecha', physicalName: 'FEC',
          dataType: 'DATE', typeOverridden: false, isPrimaryKey: true },
      ] as never,
    });

    const items = vi.mocked(gov.recordChangesBulk).mock.calls[0][0];
    // orden único: las PK primero (COD, FEC) y después el resto (TXT)
    const [tabla, c1, c3, c2] = items;
    expect(c1.payload).toMatchObject({
      physicalName: 'COD', dataType: 'BIGINT', parentDomainId: 'dom-1',
      isPrimaryKey: true, isForeignKey: true, isNullable: false, isPartition: true,
      description: 'Código del cliente', udpValues: { 'udp-1': 'CLIENTE' },
      ordinal: 0,
    });
    // ids NUEVOS y tableId de la tabla nueva — no arrastra los del origen
    expect(c1.payload?.id).not.toBe('cSrc');
    expect(c1.payload?.tableId).toBe(tabla.entityId);
    // columna sin extras: payload limpio (las claves opcionales NO viajan)
    expect(c2.payload).toMatchObject({ physicalName: 'TXT', ordinal: 2 });
    for (const k of ['description', 'isForeignKey', 'isPartition', 'udpValues', 'pkPosition']) {
      expect(c2.payload).not.toHaveProperty(k);
    }
    // la segunda PK sube al bloque de PK aunque se haya elegido después de TXT
    expect(c3.payload).toMatchObject({ physicalName: 'FEC', isPrimaryKey: true, ordinal: 1 });
    expect(c1.payload).not.toHaveProperty('pkPosition');
  });
});
