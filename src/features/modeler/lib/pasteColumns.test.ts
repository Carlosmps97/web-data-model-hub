import { describe, expect, it } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import { pasteColumnsToBulk, pastePlan, pastePreImages } from './pasteColumns';
import { invertBulk } from './undoInvert';

const col = (id: string, over: Partial<CanonicalColumn> = {}): CanonicalColumn => ({
  id, tableId: 'tSrc', logicalName: id, physicalName: id.toUpperCase(),
  dataType: 'STRING', typeOverridden: false, ordinal: 0,
  ...over,
});

describe('pastePlan (duplicados contra el destino)', () => {
  it('físico duplicado CI → blocked; lógico duplicado CI → warning sin bloquear; limpio → pasa', () => {
    const clipboard = [
      col('cust', { physicalName: 'CUST_ID', logicalName: 'customer id' }),
      col('region', { physicalName: 'REGION_CD', logicalName: 'Region' }),
      col('amount', { physicalName: 'AMOUNT', logicalName: 'amount' }),
    ];
    const target = [
      // Mismo físico en otra caja (la unicidad del backend es CI) → bloquea.
      col('t1', { tableId: 'tTgt', physicalName: 'cust_id', logicalName: 'otra' }),
      // Mismo lógico CI con físico distinto → no bloquea, solo warning.
      col('t2', { tableId: 'tTgt', physicalName: 'ZONA', logicalName: 'region' }),
    ];
    const plan = pastePlan(clipboard, target);
    expect(plan.map((r) => r.blocked)).toEqual([true, false, false]);
    expect(plan.map((r) => r.logicalDup)).toEqual([false, true, false]);
    expect(plan.map((r) => r.col.id)).toEqual(['cust', 'region', 'amount']);
  });
});

describe('pasteColumnsToBulk (variante de createTableFromSources sobre tabla existente)', () => {
  const ids = () => { let n = 0; return () => `n${++n}`; };

  it('copia la metadata completa, re-apunta tableId, id nuevo y ordinal tras el max del destino', () => {
    const src = col('cust', {
      physicalName: 'CUST_ID', logicalName: 'customer id', dataType: 'DECIMAL(10,0)',
      parentDomainId: 'domA', typeOverridden: true, isForeignKey: true,
      isNullable: false, isPartition: true, description: 'Id del cliente',
      udpValues: { u1: 'oro' }, ordinal: 7,
    });
    // Ordinales con huecos (0,1,4): el append es max+1 = 5, no length.
    const target = [
      col('t1', { tableId: 'tTgt', ordinal: 0 }),
      col('t2', { tableId: 'tTgt', physicalName: 'T2X', ordinal: 1 }),
      col('t3', { tableId: 'tTgt', physicalName: 'T3X', ordinal: 4 }),
    ];
    const changes = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: [src], targetCols: target, newId: ids() });
    expect(changes).toHaveLength(1);
    const ch = changes[0];
    expect(ch.collection).toBe('canonical_columns');
    expect(ch.op).toBe('upsert');
    expect(ch.entityId).toBe('n1');
    expect(ch.payload).toMatchObject({
      id: 'n1', tableId: 'tTgt', logicalName: 'customer id', physicalName: 'CUST_ID',
      dataType: 'DECIMAL(10,0)', parentDomainId: 'domA', typeOverridden: true,
      isNullable: false, isPartition: true,
      description: 'Id del cliente', udpValues: { u1: 'oro' }, ordinal: 5,
    });
    // La marca FK no viaja (la relación no se copia).
    expect('isForeignKey' in (ch.payload ?? {})).toBe(false);
    // Snapshot por valor: los UDP del payload no comparten referencia con la fuente.
    expect(ch.payload?.udpValues).not.toBe(src.udpValues);
  });

  it('payload limpio: nullable default, sin descripción y sin UDPs no viajan', () => {
    const src = col('plain', { isNullable: true, description: '   ', udpValues: {} });
    const changes = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: [src], targetCols: [], newId: ids() });
    const p = changes[0].payload ?? {};
    expect(p.ordinal).toBe(0);                      // destino vacío arranca en 0
    expect('description' in p).toBe(false);
    expect('isNullable' in p).toBe(false);
    expect('udpValues' in p).toBe(false);
    expect('isPartition' in p).toBe(false);
    expect('isForeignKey' in p).toBe(false);
    expect('pkPosition' in p).toBe(false);
  });

  it('PK pegada entra tras la última PK del destino y corre las no-PK en el mismo lote', () => {
    const target = [
      col('t1', { tableId: 'tTgt', physicalName: 'T1X', isPrimaryKey: true, ordinal: 0 }),
      col('t2', { tableId: 'tTgt', physicalName: 'T2X', ordinal: 1 }),
    ];
    const clip = [
      col('pk1', { physicalName: 'PK1X', isPrimaryKey: true }),
      col('data', { physicalName: 'DATAX' }),
      col('pk2', { physicalName: 'PK2X', isPrimaryKey: true }),
    ];
    const changes = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: clip, targetCols: target, newId: ids() });
    const byPhys = Object.fromEntries(changes.map((c) => [c.payload?.physicalName, c.payload?.ordinal]));
    // orden único: T1X(PK) · PK1X · PK2X · T2X · DATAX
    expect(byPhys).toEqual({ PK1X: 1, DATAX: 4, PK2X: 2, T2X: 3 });
    expect(changes.filter((c) => c.entityId === 't2')).toHaveLength(1);          // la corrida viaja una vez
    expect(changes.find((c) => c.entityId === 't2')?.payload?.physicalName).toBe('T2X');  // documento completo
    expect(changes.every((c) => !('pkPosition' in (c.payload ?? {})))).toBe(true);
    // Undo: las pegadas se borran y la corrida vuelve a su ordinal (nunca se borra una existente)
    const inverse = invertBulk(changes, pastePreImages(target));
    expect(inverse.find((c) => c.entityId === 't2')).toMatchObject({ op: 'upsert', payload: { ordinal: 1, physicalName: 'T2X' } });
    expect(inverse.filter((c) => c.op === 'delete').map((c) => c.entityId).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('sin PK pegadas: sin corridas, al final del destino', () => {
    const target = [col('t1', { tableId: 'tTgt', isPrimaryKey: true, ordinal: 0 }), col('t2', { tableId: 'tTgt', physicalName: 'T2X', ordinal: 1 })];
    const changes = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: [col('data', { physicalName: 'DATAX' })], targetCols: target, newId: ids() });
    expect(changes.map((c) => [c.entityId, c.payload?.ordinal])).toEqual([['n1', 2]]);
  });

  it('origin de auditoría: con sourceTable viaja por columna; sin él, no', () => {
    const clip = [col('a', { physicalName: 'COL_A' }), col('b', { physicalName: 'COL_B' })];
    const withSrc = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: clip, targetCols: [], sourceTable: 'M_SRC', newId: ids() });
    expect(withSrc.map((c) => c.origin)).toEqual([
      { kind: 'paste-columns', sourceTable: 'M_SRC', sourceColumn: 'COL_A' },
      { kind: 'paste-columns', sourceTable: 'M_SRC', sourceColumn: 'COL_B' },
    ]);
    expect(withSrc.every((c) => !('origin' in (c.payload as object)))).toBe(true);
    const without = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: clip, targetCols: [], newId: ids() });
    expect(without.every((c) => c.origin === undefined)).toBe(true);
  });
});

describe('pasteColumnsToBulk: la procedencia nombra la columna de la fuente', () => {
  it('con el físico de origen aunque la pegada salga con el case del destino', () => {
    const [ch] = pasteColumnsToBulk({
      targetTableId: 'tTgt', cols: [col('f', { physicalName: 'FEC_ALTA' })], targetCols: [], newId: () => 'n1',
      sourceTable: 'T_SRC', sourceColumns: new Map([['f', 'fec_alta']]),
    });
    expect(ch.origin).toEqual({ kind: 'paste-columns', sourceTable: 'T_SRC', sourceColumn: 'fec_alta' });
  });

  it('desde otro proyecto, también lo nombra', () => {
    const [ch] = pasteColumnsToBulk({
      targetTableId: 'tTgt', cols: [col('f')], targetCols: [], newId: () => 'n1', sourceTable: 'T_SRC', sourceProject: 'Piloto',
    });
    expect(ch.origin).toEqual({ kind: 'paste-columns', sourceTable: 'T_SRC', sourceColumn: 'F', sourceProject: 'Piloto' });
  });
});

describe('pasteColumnsToBulk lleva las dos facetas', () => {
  it('tipo lógico + override, comment físico, override del físico y marcas de faceta', () => {
    const src = col('f', {
      dataType: 'TIMESTAMP', logicalDataType: 'DATE', logicalTypeOverridden: true,
      physicalDescription: 'Comentario físico', physicalNameOverridden: true, logicalOnly: true,
    });
    const [ch] = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: [src], targetCols: [], newId: () => 'n1' });
    expect(ch.payload).toMatchObject({
      dataType: 'TIMESTAMP', logicalDataType: 'DATE', logicalTypeOverridden: true,
      physicalDescription: 'Comentario físico', physicalNameOverridden: true, logicalOnly: true,
    });
    expect('physicalOnly' in (ch.payload ?? {})).toBe(false);
  });
});
