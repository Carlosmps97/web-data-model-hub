// Alta de columna con metadata completa (doc 40): el popup "New column" ahora
// captura definición funcional, flags (PK/FK/Nullable/Partition) y UDPs — el
// store los pasa al payload del changeset en el MISMO alta (antes había que ir
// a Properties · Columns después de crear).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
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

import * as gov from '@/services/governance.service';
import { useModelerStore } from './useModelerStore';

const diagramWith = (columns: unknown[]) => ({ tables: [], columns, relationships: [], views: [] }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  useModelerStore.setState({ activeSaId: null, dirty: false, diagram: diagramWith([]), naming: null });
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

describe('useModelerStore.addColumn — typeOverridden vs default del dominio (doc 64 §1)', () => {
  // El popup ahora muestra el default del dominio EN el campo de tipo y lo
  // manda tal cual: "vino dataType" ya no equivale a override — el override
  // real es tipo ≠ default del dominio elegido (regla doc 46).
  const DOM = [{ id: 'd1', name: 'monto6D', defaultDataType: 'DECIMAL(18,6)' }];

  it('tipo IGUAL al default del dominio ⇒ typeOverridden false', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(DOM as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd1', dataType: 'DECIMAL(18,6)',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'DECIMAL(18,6)', typeOverridden: false,
    });
  });

  it('tipo DISTINTO al default ⇒ typeOverridden true', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(DOM as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd1', dataType: 'DECIMAL(18,2)',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'DECIMAL(18,2)', typeOverridden: true,
    });
  });

  it('dominio SIN tipo mandado ⇒ hereda el default con typeOverridden false (regresión)', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(DOM as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd1',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'DECIMAL(18,6)', typeOverridden: false,
    });
  });

  it('sin dominio, un tipo tipeado sigue marcando override (semántica previa)', async () => {
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', dataType: 'STRING',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'STRING', typeOverridden: true,
    });
  });
});

describe('useModelerStore.addColumn — default LEGACY del dominio homologado (doc 64 r2)', () => {
  // La BD puede traer dominios sin homologar (`Array`, `BIG INTEGER`): el
  // store consume el default vía canonicalDefaultType (espejo del back doc 62).
  const LEGACY = [{ id: 'd2', name: 'ColArray', defaultDataType: 'Array' }];

  it('dominio `Array` (crudo en BD) hereda `ARRAY<>` sin override', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(LEGACY as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd2',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'ARRAY<>', typeOverridden: false,
    });
  });

  it('declarar el elemento del ARRAY heredado sí es override', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(LEGACY as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd2', dataType: 'ARRAY<INTEGER>',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'ARRAY<INTEGER>', typeOverridden: true,
    });
  });
});

// Doc 83: la regla de case del scope (`naming_config.column.case`) se cumple
// también cuando el físico se TIPEA directo (modo Physical del popup), no sólo
// al derivarlo desde el lógico.
const NAMING = (c: 'upper' | 'lower' | 'camel') =>
  ({ column: { separator: '_', case: c }, table: { separator: '_', case: 'upper' } }) as const;

describe('useModelerStore.addColumn — case del físico en modo Physical (doc 83)', () => {
  it('lo tipeado en minúscula se persiste con la regla del scope; el lógico queda tal cual', async () => {
    useModelerStore.setState({ naming: NAMING('upper') });
    await useModelerStore.getState().addColumn('t1', { logicalName: 'monto_deuda', mode: 'physical' });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload).toMatchObject({ physicalName: 'MONTO_DEUDA', logicalName: 'monto_deuda' });
    expect(gov.physicalize).not.toHaveBeenCalled();
  });

  it('regla lower ⇒ minúscula', async () => {
    useModelerStore.setState({ naming: NAMING('lower') });
    await useModelerStore.getState().addColumn('t1', { logicalName: 'MTO_DEU', mode: 'physical' });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({ physicalName: 'mto_deu' });
  });

  it('sin naming cargado ⇒ upper (default sembrado por el backend)', async () => {
    useModelerStore.setState({ naming: null });
    await useModelerStore.getState().addColumn('t1', { logicalName: 'monto', mode: 'physical' });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({ physicalName: 'MONTO' });
  });

  it('modo Logical sigue derivando por physicalize y NO re-normaliza la respuesta', async () => {
    useModelerStore.setState({ naming: NAMING('lower') });
    await useModelerStore.getState().addColumn('t1', { logicalName: 'monto', mode: 'logical' });
    expect(gov.physicalize).toHaveBeenCalledWith('monto');
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({ physicalName: 'FIS' });
  });
});
