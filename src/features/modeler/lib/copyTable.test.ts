import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { copyNameBase, copyTableToBulk, nextCopyNames } from './copyTable';

const TABLE: CanonicalTable = {
  id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core',
  description: 'maestro', udpValues: { u1: 'v1' },
};
const col = (over: Partial<CanonicalColumn>): CanonicalColumn => ({
  id: 'c1', tableId: 't1', physicalName: 'ID', logicalName: 'id',
  dataType: 'BIGINT', typeOverridden: false, ordinal: 0, ...over,
});

describe('copyNameBase', () => {
  it('deja el nombre intacto si no hay sufijo', () => {
    expect(copyNameBase('M_CLIENTE', 'physical')).toBe('M_CLIENTE');
    expect(copyNameBase('Cliente', 'logical')).toBe('Cliente');
  });
  it('despoja UN sufijo previo (copia de copia incrementa, no anida)', () => {
    expect(copyNameBase('M_CLIENTE_copy_2', 'physical')).toBe('M_CLIENTE');
    expect(copyNameBase('Cliente copy 12', 'logical')).toBe('Cliente');
  });
  it('el sufijo es case-insensitive y solo al FINAL', () => {
    expect(copyNameBase('M_CLIENTE_COPY_3', 'physical')).toBe('M_CLIENTE');
    expect(copyNameBase('M_copy_1_CLIENTE', 'physical')).toBe('M_copy_1_CLIENTE');
  });
});

describe('nextCopyNames', () => {
  it('arranca en _copy_1 con el pool vacío', () => {
    expect(nextCopyNames('M_CLIENTE', 'Cliente', [])).toEqual({
      physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1', n: 1,
    });
  });
  it('salta a la primera libre, case-insensitive', () => {
    const taken = ['m_cliente_COPY_1', 'M_CLIENTE_copy_2'];
    expect(nextCopyNames('M_CLIENTE', 'Cliente', taken).physicalName).toBe('M_CLIENTE_copy_3');
  });
  it('re-usa un hueco (copy_1 borrada)', () => {
    expect(nextCopyNames('M_CLIENTE', 'Cliente', ['M_CLIENTE_copy_2']).n).toBe(1);
  });
});

describe('copyTableToBulk', () => {
  const cols: CanonicalColumn[] = [
    // Doc 94: orden único con ordinal DESORDENADO a propósito (dato viejo): la
    // no-PK DES quedó con ordinal 0 y las PK después — la copia sale PK primero.
    col({ id: 'c3', physicalName: 'DES', logicalName: 'des', ordinal: 0, isForeignKey: true, isNullable: false, isPartition: true, udpValues: { u2: 'x' } }),
    col({ id: 'c1', physicalName: 'ID', ordinal: 1, isPrimaryKey: true }),
    col({ id: 'c2', physicalName: 'COD', logicalName: 'cod', ordinal: 2, isPrimaryKey: true, description: ' des ' }),
  ];
  let seq = 0;
  const changes = copyTableToBulk({
    table: TABLE, cols, id: 'NEW', physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1',
    newId: () => `n${++seq}`,
  });

  it('la tabla hereda esquema, definición y UDPs con el nombre nuevo', () => {
    expect(changes[0]).toMatchObject({
      collection: 'canonical_tables', entityId: 'NEW', op: 'upsert',
      payload: { id: 'NEW', physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1', schema: 'core', description: 'maestro', udpValues: { u1: 'v1' } },
    });
  });
  it('columnas con id nuevo, ordinal secuencial en el ORDEN ÚNICO (PK primero) y metadata heredada', () => {
    const paylo = changes.slice(1).map((c) => c.payload as Record<string, unknown>);
    expect(paylo.map((p) => p.physicalName)).toEqual(['ID', 'COD', 'DES']);
    expect(paylo.map((p) => p.id)).toEqual(['n1', 'n2', 'n3']);
    expect(paylo.map((p) => p.ordinal)).toEqual([0, 1, 2]);
    expect(paylo[1]).toMatchObject({ description: 'des' });
    expect(paylo[2]).toMatchObject({ isNullable: false, isPartition: true, udpValues: { u2: 'x' } });
    expect(paylo.every((p) => !('pkPosition' in p))).toBe(true);   // doc 94: sin orden de llave aparte
  });
  it('isForeignKey NO viaja (las relaciones no se copian)', () => {
    const paylo = changes.slice(1).map((c) => c.payload as Record<string, unknown>);
    expect(paylo.every((p) => !('isForeignKey' in p))).toBe(true);
  });
  it('origin de auditoría (doc 51): tabla y columnas apuntan a la fuente', () => {
    expect(changes[0].origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE' });
    expect(changes.slice(1).map((c) => c.origin)).toEqual([
      { kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'ID' },
      { kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'COD' },
      { kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'DES' },
    ]);
    // El origin viaja EN EL CAMBIO, no en el payload (no ensucia el doc).
    expect(changes.every((c) => !('origin' in (c.payload as object)))).toBe(true);
  });
});
