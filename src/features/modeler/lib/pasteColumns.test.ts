import { describe, expect, it } from 'vitest';
import type { CanonicalColumn } from '@/features/governance/services/governance.service';
import { pasteColumnsToBulk, pastePlan } from './pasteColumns';

const col = (id: string, over: Partial<CanonicalColumn> = {}): CanonicalColumn => ({
  id, tableId: 'tSrc', logicalName: id, physicalName: id.toUpperCase(),
  dataType: 'STRING', typeOverridden: false, ordinal: 0,
  ...over,
});

describe('pastePlan (duplicados contra el destino, doc 48)', () => {
  it('físico duplicado CI → blocked; lógico duplicado CI → warning sin bloquear; limpio → pasa', () => {
    const clipboard = [
      col('cust', { physicalName: 'CUST_ID', logicalName: 'customer id' }),
      col('region', { physicalName: 'REGION_CD', logicalName: 'Region' }),
      col('amount', { physicalName: 'AMOUNT', logicalName: 'amount' }),
    ];
    const target = [
      // Mismo físico en OTRA caja (la unicidad del backend es CI) → bloquea.
      col('t1', { tableId: 'tTgt', physicalName: 'cust_id', logicalName: 'otra' }),
      // Mismo lógico CI con físico distinto → NO bloquea, solo warning.
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

  it('copia la metadata COMPLETA, re-apunta tableId, id nuevo y ordinal tras el max del destino', () => {
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
      isForeignKey: true, isNullable: false, isPartition: true,
      description: 'Id del cliente', udpValues: { u1: 'oro' }, ordinal: 5,
    });
    // Snapshot por VALOR: los UDP del payload no comparten referencia con la fuente.
    expect(ch.payload?.udpValues).not.toBe(src.udpValues);
  });

  it('payload LIMPIO: nullable default, sin descripción y sin UDPs no viajan', () => {
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

  it('PK pegada con orden de llave EXPLÍCITO en el destino: entra al final, secuencial', () => {
    const target = [
      col('t1', { tableId: 'tTgt', isPrimaryKey: true, pkPosition: 0, ordinal: 0 }),
      col('t2', { tableId: 'tTgt', physicalName: 'T2X', isPrimaryKey: true, pkPosition: 1, ordinal: 1 }),
    ];
    const clip = [
      col('pk1', { physicalName: 'PK1X', isPrimaryKey: true }),
      col('data', { physicalName: 'DATAX' }),
      col('pk2', { physicalName: 'PK2X', isPrimaryKey: true }),
    ];
    const changes = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: clip, targetCols: target, newId: ids() });
    expect(changes.map((c) => c.payload?.pkPosition)).toEqual([2, undefined, 3]);
    expect(changes.map((c) => c.payload?.ordinal)).toEqual([2, 3, 4]);
    expect(changes[0].payload?.isPrimaryKey).toBe(true);
  });

  it('PK pegada SIN orden explícito en el destino: sin pkPosition (rige el orden físico)', () => {
    const target = [col('t1', { tableId: 'tTgt', isPrimaryKey: true, ordinal: 0 })]; // PK a mano, sin pkPosition
    const clip = [col('pk1', { physicalName: 'PK1X', isPrimaryKey: true })];
    const changes = pasteColumnsToBulk({ targetTableId: 'tTgt', cols: clip, targetCols: target, newId: ids() });
    expect('pkPosition' in (changes[0].payload ?? {})).toBe(false);
    expect(changes[0].payload?.isPrimaryKey).toBe(true);
  });
});
