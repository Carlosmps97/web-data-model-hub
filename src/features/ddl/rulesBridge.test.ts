import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiPost } from '@/services/http';
import { DEFAULT_DATABRICKS_OPTS } from './generators';
import {
  emitTarget, isAddendum, layoutFromRules, missingSource, partitionCorrelative, renderWithRules, withLayout, withUdpPartitions,
  type ExportRule,
} from './rulesBridge';

beforeEach(() => vi.clearAllMocks());

const rule = (id: string, over: Partial<ExportRule> = {}): ExportRule => ({
  id, name: id, kind: 'rule', priority: 100, enabled: true, validationState: 'valid',
  appliesTo: ['ddl.tabla_fisica'], action: { layout: { partitionColumns: 'last' } }, ...over,
});

describe('layoutFromRules (doc 73 / doc 76 / doc 93 / doc 107)', () => {
  it('regla de layout seleccionada sobre la física ⇒ partitionsLast', () => {
    expect(layoutFromRules([rule('l1')], ['l1'])).toEqual({ partitionsLast: true, partitionsInClause: false, partitionUdp: null });
  });
  it('partitionUdp (o su alias legado partitionOrderUdp) ⇒ UDP que define las particiones', () => {
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionColumns: 'last', partitionUdp: 'Particion' } } })], ['l1']))
      .toEqual({ partitionsLast: true, partitionsInClause: false, partitionUdp: 'Particion' });
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionOrderUdp: ' Particion ' } } })], ['l1']))
      .toEqual({ partitionsLast: false, partitionsInClause: false, partitionUdp: 'Particion' });
  });
  it("doc 107: 'partitioned-by' ⇒ particiones solo en el PARTITIONED BY", () => {
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionColumns: 'partitioned-by', partitionUdp: 'Particion' } } })], ['l1']))
      .toEqual({ partitionsLast: false, partitionsInClause: true, partitionUdp: 'Particion' });
  });
  it('withLayout: el export toma de la regla dónde van las particiones (nunca de las Output settings)', () => {
    const lay = { partitionsLast: false, partitionsInClause: true, partitionUdp: 'Particion' };
    const out = withLayout({ ...DEFAULT_DATABRICKS_OPTS, partitionsLast: true }, lay);
    expect(out.partitionsLast).toBe(false);
    expect(out.partitionsInClause).toBe(true);
    expect(out.includePartitions).toBe(DEFAULT_DATABRICKS_OPTS.includePartitions);
  });
  it('no seleccionada, keep, otro artefacto o generador ⇒ false', () => {
    const off = { partitionsLast: false, partitionsInClause: false, partitionUdp: null };
    expect(layoutFromRules([rule('l1')], [])).toEqual(off);
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionColumns: 'keep' } } })], ['l1'])).toEqual(off);
    expect(layoutFromRules([rule('l1', { appliesTo: ['ddl.tabla_rej'] })], ['l1'])).toEqual(off);
    expect(layoutFromRules([rule('l1', { kind: 'generator' })], ['l1'])).toEqual(off);
    expect(layoutFromRules([rule('t1', { action: { tags: { a: 'b' } } })], ['t1'])).toEqual(off);
  });
});

describe('partitionCorrelative / withUdpPartitions (doc 93 D10)', () => {
  it('PART_01 → 1; valores fuera de la convención → null', () => {
    expect(partitionCorrelative('PART_01')).toBe(1);
    expect(partitionCorrelative('part-12')).toBe(12);
    expect(partitionCorrelative('No Definido')).toBeNull();
    expect(partitionCorrelative(undefined)).toBeNull();
  });
  it('el UDP DEFINE las particiones: PART_nn ⇒ partición ordenada; el flag de la plataforma se ignora', () => {
    const defs = [
      { id: 'u-log', name: 'Particion', level: 'column', view: 'logical' },     // homónimo lógico: no cuenta
      { id: 'u-part', name: 'Particion', level: 'column', view: 'physical' },
    ];
    const cols: { id: string; isPartition: boolean; udpValues: Record<string, string> }[] = [
      { id: 'a', isPartition: true, udpValues: { 'u-part': 'PART_02' } },
      { id: 'b', isPartition: false, udpValues: { 'u-part': 'PART_01' } },
      { id: 'c', isPartition: true, udpValues: {} },
    ];
    const out = withUdpPartitions(cols, defs, 'Particion');
    expect(out.map((c) => [c.id, c.isPartition, c.partitionOrder])).toEqual([['a', true, 2], ['b', true, 1], ['c', false, null]]);
    expect(withUdpPartitions(cols, defs, null)).toBe(cols);
    expect(withUdpPartitions(cols, [], 'Particion')).toBe(cols);    // UDP inexistente ⇒ flag (Review Focus #3)
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

describe('renderWithRules — payload y ensamblado (doc 93)', () => {
  it('manda las opciones de estilo y el ddlType; el .sql pega los ALTER a su objeto', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      statements: [
        { artifact: 'ddl.tabla_fisica', schema: 'core', name: 'T', sql: 'CREATE OR REPLACE TABLE core.t (a int);' },
        { artifact: 'ddl.tabla_fisica.tags', schema: 'core', name: 'T', sql: "ALTER TABLE core.t SET TAGS ('k' = 'v');" },
        { artifact: 'ddl.vista_tecnica', schema: 'core_v', name: 'T', sql: 'CREATE OR REPLACE VIEW core_v.t AS SELECT a AS a FROM core.t;' },
      ],
      log: [], rulesetVersion: 'v3', applied: 1, skipped: 0,
    });
    const diagram = { tables: [{ id: 't1', udpValues: {} }], columns: [{ id: 'c1', udpValues: {} }], subjectArea: null };
    const input = {
      tables: [{ id: 't1', physicalName: 'T', schema: 'core' }],
      columns: [{ id: 'c1', tableId: 't1', physicalName: 'A', dataType: 'INTEGER', ordinal: 0 }],
      relationships: [], views: [], modelName: 'm',
    };
    const { sql } = await renderWithRules({
      projectId: 'p1', diagram: diagram as unknown as Parameters<typeof renderWithRules>[0]['diagram'],
      input, opts: DEFAULT_DATABRICKS_OPTS, ruleIds: ['r1'], modelName: 'm',
    });
    const body = vi.mocked(apiPost).mock.calls[0][1] as {
      options: Record<string, unknown>; tables: { columns: { ddlType: string }[] }[];
    };
    expect(body.options).toMatchObject({
      quoteIdentifiers: 'when-needed', typeCase: 'lower', createTable: 'or-replace', viewTagsAs: 'table', includeKeys: false,
    });
    expect(body.tables[0].columns[0].ddlType).toBe('int');
    expect(sql).toContain("CREATE OR REPLACE TABLE core.t (a int);\nALTER TABLE core.t SET TAGS ('k' = 'v');\n\nCREATE OR REPLACE VIEW");
  });
});
