// Alta de columna con metadata completa (doc 40): el popup "New column" ahora
// captura definición funcional, flags (PK/FK/Nullable/Partition) y UDPs — el
// store los pasa al payload del changeset en el MISMO alta (antes había que ir
// a Properties · Columns después de crear).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/governance/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/governance/services/governance.service')>();
  return {
    ...actual,
    physicalize: vi.fn(async () => ({ physical: 'FIS' })),
    listDomains: vi.fn(async () => []),
    createColumn: vi.fn(async () => ({})),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(async () => []),
  updateView: vi.fn(),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));

import * as gov from '@/features/governance/services/governance.service';
import { useModelerStore } from './useModelerStore';

const diagramWith = (columns: unknown[]) => ({ tables: [], columns, relationships: [], views: [] }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  useModelerStore.setState({ activeSaId: null, dirty: false, diagram: diagramWith([]) });
});

describe('useModelerStore.addColumn — metadata en el alta (doc 40)', () => {
  it('pasa description, flags y udpValues al payload del changeset', async () => {
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL_A', mode: 'physical',
      description: '  qué representa  ',
      isPrimaryKey: true, isNullable: false, isPartition: true,
      udpValues: { u1: 'ref' },
    });
    expect(gov.createColumn).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload).toMatchObject({
      tableId: 't1', physicalName: 'COL_A',
      description: 'qué representa',
      isPrimaryKey: true, isNullable: false, isPartition: true,
      udpValues: { u1: 'ref' },
    });
  });

  it('flags apagados y campos vacíos NO viajan (payload limpio, como en edición)', async () => {
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL_B', mode: 'physical',
      description: '   ', isPrimaryKey: false, isForeignKey: false, isNullable: true,
      isPartition: false, udpValues: {},
    });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload.description).toBeUndefined();
    expect(payload.isPrimaryKey).toBeUndefined();
    expect(payload.isForeignKey).toBeUndefined();
    expect(payload.isNullable).toBeUndefined();     // nullable es el default: no se persiste true
    expect(payload.isPartition).toBeUndefined();
    expect(payload.udpValues).toBeUndefined();
  });

  it('PK nueva entra AL FINAL de la llave cuando la tabla maneja orden explícito', async () => {
    useModelerStore.setState({ diagram: diagramWith([
      { id: 'c1', tableId: 't1', isPrimaryKey: true, pkPosition: 0, ordinal: 0 },
      { id: 'c2', tableId: 't1', isPrimaryKey: true, pkPosition: 1, ordinal: 1 },
    ]) });
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL_C', mode: 'physical', isPrimaryKey: true,
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({ pkPosition: 2 });
  });

  it('sin orden explícito de llave, la PK nueva queda SIN pkPosition (rige el físico)', async () => {
    useModelerStore.setState({ diagram: diagramWith([
      { id: 'c1', tableId: 't1', isPrimaryKey: true, ordinal: 0 },
    ]) });
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL_D', mode: 'physical', isPrimaryKey: true,
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0].pkPosition).toBeUndefined();
  });

  it('el alta sin metadata conserva el contrato anterior (regresión)', async () => {
    await useModelerStore.getState().addColumn('t1', { logicalName: 'palabras', mode: 'logical' });
    expect(gov.physicalize).toHaveBeenCalledWith('palabras');
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload).toMatchObject({ tableId: 't1', physicalName: 'FIS', ordinal: 0 });
    expect(payload.udpValues).toBeUndefined();
  });
});
