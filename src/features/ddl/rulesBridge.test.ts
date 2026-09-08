import { describe, expect, it } from 'vitest';
import { isAddendum, layoutFromRules, partitionCorrelative, withPartitionOrder, type ExportRule } from './rulesBridge';

const rule = (id: string, over: Partial<ExportRule> = {}): ExportRule => ({
  id, name: id, kind: 'rule', priority: 100, enabled: true, validationState: 'valid',
  appliesTo: ['ddl.tabla_fisica'], action: { layout: { partitionColumns: 'last' } }, ...over,
});

describe('layoutFromRules (doc 73 / doc 76)', () => {
  it('regla de layout seleccionada sobre la física ⇒ partitionsLast', () => {
    expect(layoutFromRules([rule('l1')], ['l1'])).toEqual({ partitionsLast: true, partitionOrderUdp: null });
  });
  it('partitionOrderUdp de la regla ⇒ nombre del UDP que ordena las particiones', () => {
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionColumns: 'last', partitionOrderUdp: 'Particion' } } })], ['l1']))
      .toEqual({ partitionsLast: true, partitionOrderUdp: 'Particion' });
    // solo orden (sin mover al final) también vale
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionOrderUdp: ' Particion ' } } })], ['l1']))
      .toEqual({ partitionsLast: false, partitionOrderUdp: 'Particion' });
  });
  it('no seleccionada, keep, otro artefacto o generador ⇒ false', () => {
    const off = { partitionsLast: false, partitionOrderUdp: null };
    expect(layoutFromRules([rule('l1')], [])).toEqual(off);
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionColumns: 'keep' } } })], ['l1'])).toEqual(off);
    expect(layoutFromRules([rule('l1', { appliesTo: ['ddl.tabla_rej'] })], ['l1'])).toEqual(off);
    expect(layoutFromRules([rule('l1', { kind: 'generator' })], ['l1'])).toEqual(off);
    expect(layoutFromRules([rule('t1', { action: { tags: { a: 'b' } } })], ['t1'])).toEqual(off);
  });
});

describe('partitionCorrelative / withPartitionOrder (doc 76 D3)', () => {
  it('PART_01 → 1; valores fuera de la convención → null', () => {
    expect(partitionCorrelative('PART_01')).toBe(1);
    expect(partitionCorrelative('part-12')).toBe(12);
    expect(partitionCorrelative('No Definido')).toBeNull();
    expect(partitionCorrelative(undefined)).toBeNull();
  });
  it('estampa partitionOrder SOLO en las particiones, leyendo el UDP físico de columna por nombre', () => {
    const defs = [
      { id: 'u-log', name: 'Particion', level: 'column', view: 'logical' },     // homónimo lógico: no cuenta
      { id: 'u-part', name: 'Particion', level: 'column', view: 'physical' },
    ];
    const cols: { id: string; isPartition: boolean; udpValues: Record<string, string> }[] = [
      { id: 'a', isPartition: true, udpValues: { 'u-part': 'PART_02' } },
      { id: 'b', isPartition: false, udpValues: { 'u-part': 'PART_01' } },
      { id: 'c', isPartition: true, udpValues: {} },
    ];
    const out = withPartitionOrder(cols, defs, 'Particion');
    // b no es partición ⇒ sin campo; c es partición sin valor ⇒ null (va al final, orden físico)
    expect(out.map((c) => (c.partitionOrder === undefined ? 'none' : c.partitionOrder))).toEqual([2, 'none', null]);
    // sin UDP / sin def ⇒ intactas
    expect(withPartitionOrder(cols, defs, null)).toBe(cols);
    expect(withPartitionOrder(cols, [], 'Particion')).toBe(cols);
  });
});

describe('isAddendum', () => {
  it('.tags y .extra de cualquier artefacto son anexos', () => {
    expect(isAddendum('ddl.tabla_fisica.tags')).toBe(true);
    expect(isAddendum('ddl.vista_negocio.extra')).toBe(true);
    expect(isAddendum('ddl.vista_tecnica')).toBe(false);
  });
});
