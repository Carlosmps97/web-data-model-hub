import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { copyNameBase, copyTableToBulk, nextCopyNames, pasteNames, groupPasteNames } from './copyTable';

const TABLE: CanonicalTable = {
  id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core',
  description: 'maestro', udpValues: { u1: 'v1' }, color: 'theme:th1',
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
  it('despoja un sufijo previo (copia de copia incrementa, no anida)', () => {
    expect(copyNameBase('M_CLIENTE_copy_2', 'physical')).toBe('M_CLIENTE');
    expect(copyNameBase('Cliente copy 12', 'logical')).toBe('Cliente');
  });
  it('el sufijo es case-insensitive y solo al final', () => {
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
    // Orden único con ordinal desordenado a propósito: la no-PK DES tiene
    // ordinal 0 y las PK van después; la copia sale PK primero.
    col({ id: 'c3', physicalName: 'DES', logicalName: 'des', ordinal: 0, isForeignKey: true, isNullable: false, isPartition: true, udpValues: { u2: 'x' } }),
    col({ id: 'c1', physicalName: 'ID', ordinal: 1, isPrimaryKey: true }),
    col({ id: 'c2', physicalName: 'COD', logicalName: 'cod', ordinal: 2, isPrimaryKey: true, description: ' des ' }),
  ];
  let seq = 0;
  const changes = copyTableToBulk({
    table: TABLE, cols, id: 'NEW', physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1',
    newId: () => `n${++seq}`,
  });

  it('la tabla hereda esquema, definición, UDPs y color con el nombre de la copia', () => {
    expect(changes[0]).toMatchObject({
      collection: 'canonical_tables', entityId: 'NEW', op: 'upsert',
      payload: { id: 'NEW', physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1', schema: 'core', description: 'maestro', udpValues: { u1: 'v1' }, color: 'theme:th1' },
    });
  });
  it('una tabla sin color pega sin la clave', () => {
    const [t] = copyTableToBulk({ table: { ...TABLE, color: null }, cols: [], id: 'N2', physicalName: 'X', logicalName: 'x' });
    expect('color' in (t.payload as object)).toBe(false);
  });
  it('columnas con id nuevo, ordinal secuencial en el orden único (PK primero) y metadata heredada', () => {
    const paylo = changes.slice(1).map((c) => c.payload as Record<string, unknown>);
    expect(paylo.map((p) => p.physicalName)).toEqual(['ID', 'COD', 'DES']);
    expect(paylo.map((p) => p.id)).toEqual(['n1', 'n2', 'n3']);
    expect(paylo.map((p) => p.ordinal)).toEqual([0, 1, 2]);
    expect(paylo[1]).toMatchObject({ description: 'des' });
    expect(paylo[2]).toMatchObject({ isNullable: false, isPartition: true, udpValues: { u2: 'x' } });
    expect(paylo.every((p) => !('pkPosition' in p))).toBe(true);   // sin orden de llave aparte
  });
  it('isForeignKey no viaja (las relaciones no se copian)', () => {
    const paylo = changes.slice(1).map((c) => c.payload as Record<string, unknown>);
    expect(paylo.every((p) => !('isForeignKey' in p))).toBe(true);
  });
  it('origin de auditoría: tabla y columnas apuntan a la fuente', () => {
    expect(changes[0].origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE' });
    expect(changes.slice(1).map((c) => c.origin)).toEqual([
      { kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'ID' },
      { kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'COD' },
      { kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'DES' },
    ]);
    // El origin viaja en el cambio, no en el payload (no ensucia el doc).
    expect(changes.every((c) => !('origin' in (c.payload as object)))).toBe(true);
  });
});

describe('pasteNames: el nombre se conserva si está libre en el destino', () => {
  it('libre → tal cual, también si ya trae un _copy_n', () => {
    expect(pasteNames({ physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1' }, ['M_CLIENTE']))
      .toEqual({ physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1', renamed: false });
  });
  it('tomado (CI) → el primer copy_n libre, con el lógico alineado', () => {
    expect(pasteNames({ physicalName: 'M_CLIENTE', logicalName: 'Cliente' }, ['m_cliente', 'M_CLIENTE_copy_1']))
      .toEqual({ physicalName: 'M_CLIENTE_copy_2', logicalName: 'Cliente copy 2', renamed: true });
  });
  it('una copia tomada incrementa sobre la base (no anida)', () => {
    expect(pasteNames({ physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1' },
      ['M_CLIENTE', 'M_CLIENTE_copy_1']).physicalName).toBe('M_CLIENTE_copy_2');
  });
  it('sin lógico, la base lógica es el físico', () => {
    expect(pasteNames({ physicalName: 'T', logicalName: '' }, ['T']).logicalName).toBe('T copy 1');
  });
});

describe('copyTableToBulk: procedencia desde otro proyecto', () => {
  it('la tabla y sus columnas nombran el proyecto de origen', () => {
    const [t, c] = copyTableToBulk({
      table: { ...TABLE, physicalName: 'M_CLIENTE' }, cols: [col({ id: 'c1' })], id: 'N', physicalName: 'M_CLIENTE', logicalName: 'Cliente',
      source: { table: 'M_CLIENTE', columns: new Map([['c1', 'id']]), project: 'Piloto' }, newId: () => 'nc',
    });
    expect(t.origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceProject: 'Piloto' });
    expect(c.origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceColumn: 'id', sourceProject: 'Piloto' });
  });
});

describe('copyTableToBulk lleva las dos facetas', () => {
  const [t, c] = copyTableToBulk({
    table: { ...TABLE, physicalNameOverridden: true, logicalOnly: true },
    cols: [col({
      logicalDataType: 'DATE', logicalTypeOverridden: true, physicalDescription: 'Comentario físico',
      physicalNameOverridden: true, physicalOnly: true, dataType: 'TIMESTAMP',
    })],
    id: 'N', physicalName: 'X', logicalName: 'x', newId: () => 'nc',
  });
  it('tabla: override del físico y marca de faceta', () => {
    expect(t.payload).toMatchObject({ physicalNameOverridden: true, logicalOnly: true });
    expect('physicalOnly' in (t.payload as object)).toBe(false);
  });
  it('columna: tipo lógico + override, comment físico, override del físico y marca de faceta', () => {
    expect(c.payload).toMatchObject({
      dataType: 'TIMESTAMP', logicalDataType: 'DATE', logicalTypeOverridden: true,
      physicalDescription: 'Comentario físico', physicalNameOverridden: true, physicalOnly: true,
    });
    expect('logicalOnly' in (c.payload as object)).toBe(false);
  });
});

// Pegar un grupo (doc 134 §3.7): cada nombre elegido cuenta como tomado para las
// siguientes, así dos tablas del grupo nunca reciben el mismo nombre.
describe('groupPasteNames', () => {
  it('X y X_copy_1 juntas, con las dos ya tomadas, dan X_copy_2 y X_copy_3', () => {
    const out = groupPasteNames([{ physicalName: 'X', logicalName: 'x' }, { physicalName: 'X_copy_1', logicalName: 'x copy 1' }], ['X', 'X_copy_1']);
    expect(out).toEqual([
      { physicalName: 'X_copy_2', logicalName: 'x copy 2', renamed: true },
      { physicalName: 'X_copy_3', logicalName: 'x copy 3', renamed: true },
    ]);
  });
  it('una libre conserva su nombre y lo toma para las siguientes', () => {
    const out = groupPasteNames([{ physicalName: 'NUEVA', logicalName: 'nueva' }, { physicalName: 'NUEVA', logicalName: 'nueva' }], []);
    expect(out.map((n) => [n.physicalName, n.renamed])).toEqual([['NUEVA', false], ['NUEVA_copy_1', true]]);
  });
});
