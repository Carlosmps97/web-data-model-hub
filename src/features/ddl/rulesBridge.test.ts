import { describe, expect, it } from 'vitest';
import {
  emitTarget, isAddendum, layoutFromRules, missingSource, partitionCorrelative, withPartitionOrder,
  type ExportRule,
} from './rulesBridge';

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

// Generadores tal como los siembra el kit (templates.py): el `emit` lleva el
// artefacto, el tipo y el nombre CON PLACEHOLDERS del motor.
const gen = (id: string, emit: Record<string, unknown>, over: Partial<ExportRule> = {}): ExportRule => ({
  id, name: id, kind: 'generator', priority: 200, enabled: true, validationState: 'valid',
  appliesTo: [], action: { emit }, ...over,
});

describe('emitTarget — qué objeto crea cada generador', () => {
  it('traduce los placeholders del motor a un destino legible', () => {
    expect(emitTarget(gen('vista_tecnica', {
      artifact: 'ddl.vista_tecnica', type: 'view', schema: '{tabla.esquema}_v', name: '{tabla.nombre}',
    }))).toEqual({ type: 'view', label: '<schema>_v.<table>' });
    expect(emitTarget(gen('tabla_rechazos', {
      artifact: 'ddl.tabla_rej', type: 'table', schema: '{tabla.esquema}', name: '{tabla.nombre}_rej',
    }))).toEqual({ type: 'table', label: '<schema>.<table>_rej' });
    expect(emitTarget(gen('vista_rechazos_dac', {
      artifact: 'ddl.vista_rej_dac', type: 'view', schema: '{tabla.esquema}_v', name: '{tabla.nombre}dac_rej',
    }))).toEqual({ type: 'view', label: '<schema>_v.<table>dac_rej' });
  });
  it('sin esquema usa solo el nombre; sin emit (o regla normal) devuelve null', () => {
    expect(emitTarget(gen('g', { type: 'table', name: '{tabla.nombre}_x' })))
      .toEqual({ type: 'table', label: '<table>_x' });
    expect(emitTarget(gen('g', {}))).toBeNull();
    expect(emitTarget(rule('r1'))).toBeNull();
  });
});

describe('missingSource — cascada de generadores (spec §7.3)', () => {
  const rej = gen('tabla_rechazos', { artifact: 'ddl.tabla_rej', type: 'table', name: '{tabla.nombre}_rej' },
    { sourceArtifact: 'ddl.tabla_fisica' });
  const vistaRej = gen('vista_rechazos', { artifact: 'ddl.vista_rej', type: 'view', name: '{tabla.nombre}_rej' },
    { sourceArtifact: 'ddl.tabla_rej' });
  const all = [rej, vistaRej];

  it('el generador que come de otro NO seleccionado no emite nada: avisa de quién depende', () => {
    expect(missingSource(vistaRej, all, new Set(['vista_rechazos']))).toBe('tabla_rechazos');
  });
  it('con su fuente seleccionada, o si la fuente es un artefacto raíz, no falta nada', () => {
    expect(missingSource(vistaRej, all, new Set(['vista_rechazos', 'tabla_rechazos']))).toBeNull();
    expect(missingSource(rej, all, new Set(['tabla_rechazos']))).toBeNull();
    expect(missingSource(rule('r1'), all, new Set<string>())).toBeNull();
  });
});
