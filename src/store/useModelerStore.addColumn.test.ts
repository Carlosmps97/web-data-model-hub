// Alta de columna con metadata completa: el popup "New column" captura
// definición funcional, flags (PK/FK/Nullable/Partition) y UDPs, y el store los
// pasa al payload del changeset en la misma alta.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    physicalize: vi.fn(async () => ({ physical: 'FIS' })),
    listDomains: vi.fn(async () => []),
    createColumn: vi.fn(async () => ({})),
    recordChangesBulk: vi.fn(async () => ({})),
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

describe('useModelerStore.addColumn — metadata en el alta', () => {
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

  it('flags apagados y campos vacíos no viajan (payload limpio, como en edición)', async () => {
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

  it('una PK nueva entra tras la última PK y corre las no-PK en el mismo lote', async () => {
    useModelerStore.setState({ diagram: diagramWith([
      { id: 'c1', tableId: 't1', physicalName: 'C1', isPrimaryKey: true, ordinal: 0 },
      { id: 'c2', tableId: 't1', physicalName: 'C2', ordinal: 1 },
      { id: 'c3', tableId: 't1', physicalName: 'C3', ordinal: 2 },
    ]) });
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL_C', mode: 'physical', isPrimaryKey: true,
    });
    expect(gov.createColumn).not.toHaveBeenCalled();
    const sent = vi.mocked(gov.recordChangesBulk).mock.calls[0][0];
    const created = sent.find((ch) => (ch.payload as { physicalName?: string }).physicalName === 'COL_C')!.payload as Record<string, unknown>;
    expect(created).toMatchObject({ isPrimaryKey: true, ordinal: 1 });
    expect('pkPosition' in created).toBe(false);
    expect(sent.filter((ch) => ch.entityId !== created.id).map((ch) => [ch.entityId, (ch.payload as { ordinal: number }).ordinal]))
      .toEqual([['c2', 2], ['c3', 3]]);
  });

  it('PK nueva sin no-PK que correr: alta simple, tras las PK', async () => {
    useModelerStore.setState({ diagram: diagramWith([
      { id: 'c1', tableId: 't1', isPrimaryKey: true, ordinal: 0 },
    ]) });
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL_D', mode: 'physical', isPrimaryKey: true,
    });
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload).toMatchObject({ isPrimaryKey: true, ordinal: 1 });
    expect('pkPosition' in payload).toBe(false);
  });

  it('el alta sin metadata manda solo los campos básicos', async () => {
    await useModelerStore.getState().addColumn('t1', { logicalName: 'palabras', mode: 'logical' });
    expect(gov.physicalize).toHaveBeenCalledWith('palabras');
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload).toMatchObject({ tableId: 't1', physicalName: 'FIS', ordinal: 0 });
    expect(payload.udpValues).toBeUndefined();
  });
});

describe('useModelerStore.addColumn — typeOverridden vs default del dominio', () => {
  // El popup muestra el default del dominio en el campo de tipo y lo manda tal
  // cual: que llegue dataType no equivale a override; el override es
  // tipo ≠ default del dominio elegido.
  const DOM = [{ id: 'd1', name: 'monto6D', defaultDataType: 'DECIMAL(18,6)' }];

  it('tipo igual al default del dominio ⇒ typeOverridden false', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(DOM as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd1', dataType: 'DECIMAL(18,6)',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'DECIMAL(18,6)', typeOverridden: false,
    });
  });

  it('tipo distinto al default ⇒ typeOverridden true', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(DOM as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd1', dataType: 'DECIMAL(18,2)',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'DECIMAL(18,2)', typeOverridden: true,
    });
  });

  it('dominio sin tipo mandado ⇒ hereda el default con typeOverridden false', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce(DOM as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', parentDomainId: 'd1',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'DECIMAL(18,6)', typeOverridden: false,
    });
  });

  it('sin dominio, un tipo tipeado marca override', async () => {
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COL', mode: 'physical', dataType: 'STRING',
    });
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({
      dataType: 'STRING', typeOverridden: true,
    });
  });
});

describe('useModelerStore.addColumn — default crudo del dominio, homologado', () => {
  // La BD puede traer dominios sin homologar (`Array`, `BIG INTEGER`): el
  // store consume el default vía canonicalDefaultType (espejo del backend).
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

// La regla de case del scope (`naming_config.column.case`) se cumple también
// cuando el físico se tipea directo (modo Physical del popup), no solo al
// derivarlo desde el lógico.
const NAMING = (c: 'upper' | 'lower' | 'camel') =>
  ({ column: { separator: '_', case: c }, table: { separator: '_', case: 'upper' } }) as const;

describe('useModelerStore.addColumn — case del físico en modo Physical', () => {
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

  it('modo Logical deriva por physicalize y no re-normaliza la respuesta', async () => {
    useModelerStore.setState({ naming: NAMING('lower') });
    await useModelerStore.getState().addColumn('t1', { logicalName: 'monto', mode: 'logical' });
    expect(gov.physicalize).toHaveBeenCalledWith('monto');
    expect(vi.mocked(gov.createColumn).mock.calls[0][0]).toMatchObject({ physicalName: 'FIS' });
  });
});

describe('addColumn — tipos complejos', () => {
  const colArray = { id: 'd4', name: 'ColArray', defaultDataType: 'ARRAY<>', logicalDataType: 'ARRAY<>' };
  it('en Logical, un complejo tipeado con un dominio genérico también es el físico', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce([colArray] as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'Coleccion', mode: 'logical', parentDomainId: 'd4', logicalDataType: 'ARRAY<STRUCT<a:STRING>>',
    });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload.dataType).toBe('ARRAY<STRUCT<a:STRING>>');
    expect(payload.logicalDataType).toBe('ARRAY<STRUCT<a:STRING>>');
  });
  it('en Physical, un complejo tipeado también es el lógico', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce([colArray] as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'COLECCION', mode: 'physical', parentDomainId: 'd4', dataType: 'ARRAY<STRING>',
    });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect(payload.dataType).toBe('ARRAY<STRING>');
    expect(payload.logicalDataType).toBe('ARRAY<STRING>');
  });
});

describe('addColumn — un complejo tipeado es el mismo en las dos facetas', () => {
  it('gana al default complejo completo del dominio', async () => {
    vi.mocked(gov.listDomains).mockResolvedValueOnce([
      { id: 'd5', name: 'ColStruct', defaultDataType: 'ARRAY<STRING>', logicalDataType: 'ARRAY<STRING>' },
    ] as never);
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'Coleccion', mode: 'logical', parentDomainId: 'd5', logicalDataType: 'ARRAY<BIGINT>',
    });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect([payload.dataType, payload.logicalDataType]).toEqual(['ARRAY<BIGINT>', 'ARRAY<BIGINT>']);
  });
  it('un ARRAY<> tipeado en Physical también es el lógico', async () => {
    await useModelerStore.getState().addColumn('t1', { logicalName: 'COLECCION', mode: 'physical', dataType: 'ARRAY<>' });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect([payload.dataType, payload.logicalDataType]).toEqual(['ARRAY<>', 'ARRAY<>']);
  });
  it('sin dominio en Logical: la misma grafía en las dos facetas', async () => {
    await useModelerStore.getState().addColumn('t1', {
      logicalName: 'Coleccion', mode: 'logical', dataType: 'array<string>', logicalDataType: 'array<string>',
    });
    const payload = vi.mocked(gov.createColumn).mock.calls[0][0];
    expect([payload.dataType, payload.logicalDataType]).toEqual(['ARRAY<STRING>', 'ARRAY<STRING>']);
  });
});
