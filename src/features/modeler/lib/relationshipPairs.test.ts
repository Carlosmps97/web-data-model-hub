import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, Relationship } from '@/services/governance.service';
import {
  buildKeyMapping, demotablePkChildren, mappingToBulk,
  relationshipDrift, roleNamePlan, syncMappingInput, type MappingResolution,
} from './relationshipPairs';

const rel = (over: Partial<Relationship> = {}): Relationship => ({
  id: 'r1', parentTableId: 'tP', childTableId: 'tC',
  pairs: [{ parentColumnId: 'p1', childColumnId: 'c1' }],
  parentCardinality: 'one', childCardinality: 'zero-many', identifying: false,
  ...over,
});

describe('roleNamePlan (rename vs split — unificación Erwin)', () => {
  it('columna hija usada SOLO por este par → rename in place', () => {
    expect(roleNamePlan(rel(), 0, [rel()])).toEqual({ kind: 'rename', columnId: 'c1' });
  });

  it('columna hija compartida con OTRA relación → split', () => {
    const other = rel({ id: 'r2', pairs: [{ parentColumnId: 'p9', childColumnId: 'c1' }] });
    expect(roleNamePlan(rel(), 0, [rel(), other])).toEqual({ kind: 'split', fromColumnId: 'c1' });
  });

  it('columna hija repetida en OTRO par de la misma relación → split', () => {
    const r = rel({ pairs: [
      { parentColumnId: 'p1', childColumnId: 'c1' },
      { parentColumnId: 'p2', childColumnId: 'c1' },
    ] });
    expect(roleNamePlan(r, 0, [r]).kind).toBe('split');
  });
});

describe('demotablePkChildren (identifying → non-identifying)', () => {
  it('demotea la hija salvo que OTRA relación identifying la tenga como hija', () => {
    const r = rel({ identifying: true });
    expect(demotablePkChildren(r, [])).toEqual(['c1']);
    const otherIdent = rel({ id: 'r2', identifying: true, pairs: [{ parentColumnId: 'x', childColumnId: 'c1' }] });
    expect(demotablePkChildren(r, [otherIdent])).toEqual([]);
    const otherNon = rel({ id: 'r3', identifying: false, pairs: [{ parentColumnId: 'x', childColumnId: 'c1' }] });
    expect(demotablePkChildren(r, [otherNon])).toEqual(['c1']);
  });
});

// ── buildKeyMapping / relationshipDrift (doc 47) ─────────────────────────────

const col = (id: string, tableId: string, physicalName: string, extra: Partial<CanonicalColumn> = {}): CanonicalColumn =>
  ({ id, tableId, physicalName, logicalName: physicalName.toLowerCase(), dataType: 'BIGINT',
     typeOverridden: false, ordinal: 0, ...extra });

describe('buildKeyMapping (doc 47)', () => {
  const pks = [col('p1', 'P', 'CUSTOMER_ID'), col('p2', 'P', 'REGION_CD')];

  it('matchea homónimas del hijo case-insensitive y el resto lo crea', () => {
    const childCols = [col('h1', 'H', 'customer_id'), col('h2', 'H', 'AMOUNT')];
    expect(buildKeyMapping(pks, childCols)).toEqual([
      { parentColumnId: 'p1', target: { kind: 'existing', columnId: 'h1' } },
      { parentColumnId: 'p2', target: { kind: 'create' } },
    ]);
  });

  it('una columna hija no se reclama dos veces (unicidad de destinos)', () => {
    // ambas PKs comparten nombre lógico con h1 → sólo la primera la reclama
    const childCols = [col('h1', 'H', 'X', { logicalName: 'customer_id' })];
    const rows = buildKeyMapping(
      [col('p1', 'P', 'A', { logicalName: 'customer_id' }), col('p2', 'P', 'B', { logicalName: 'customer_id' })],
      childCols);
    expect(rows[0].target).toEqual({ kind: 'existing', columnId: 'h1' });
    expect(rows[1].target).toEqual({ kind: 'create' });
  });

  it('recursiva: una PK no se mapea a sí misma aunque el nombre coincida', () => {
    // padre == hijo (misma tabla): la homónima de p1 es p1 → se excluye
    const rows = buildKeyMapping([col('p1', 'P', 'EMPLOYEE_ID')], [col('p1', 'P', 'EMPLOYEE_ID')]);
    expect(rows[0].target).toEqual({ kind: 'create' });
  });

  it('el drop en una columna puntual la preselecciona en la primera fila create', () => {
    const childCols = [col('h9', 'H', 'LEGACY_FK')];
    const rows = buildKeyMapping(pks, childCols, 'h9');
    expect(rows[0].target).toEqual({ kind: 'existing', columnId: 'h9' });
    expect(rows[1].target).toEqual({ kind: 'create' });
  });

  it('el drop que YA matchea por nombre no se duplica en otra fila', () => {
    const childCols = [col('h1', 'H', 'REGION_CD')];
    const rows = buildKeyMapping(pks, childCols, 'h1');
    expect(rows[0].target).toEqual({ kind: 'create' });                       // p1 sin match
    expect(rows[1].target).toEqual({ kind: 'existing', columnId: 'h1' });     // p2 ya lo tenía
  });
});

describe('mappingToBulk (doc 47)', () => {
  const parent1 = col('p1', 'P', 'CUSTOMER_ID', {
    parentDomainId: 'domA', description: 'Id del cliente', udpValues: { u1: 'oro' } });
  const parent2 = col('p2', 'P', 'REGION_CD');
  const existing = col('h1', 'H', 'REGION_CD', { isPrimaryKey: true, isNullable: false });
  const childColsBulk = [existing, col('h2', 'H', 'AMOUNT', { ordinal: 1 })];
  const base = {
    relId: 'r9', parentTableId: 'P', childTableId: 'H',
    parentCardinality: 'one' as const, childCardinality: 'zero-many' as const,
  };
  const rows: MappingResolution[] = [
    { parentCol: parent1, target: { kind: 'create', id: 'n1', logicalName: 'customer_id', physicalName: 'CUSTOMER_ID' }, inherit: true },
    { parentCol: parent2, target: { kind: 'existing', col: existing }, inherit: true },
  ];

  it('identifying + inherit: crea con metadata del padre; doc 94: la PK nueva entra tras la última PK y la no-PK se corre en el MISMO lote', () => {
    const { changes, createdCols, relationship } = mappingToBulk({ ...base, identifying: true, rows, childCols: childColsBulk });
    expect(createdCols).toHaveLength(1);
    const nueva = createdCols[0];
    expect(nueva).toMatchObject({
      id: 'n1', tableId: 'H', physicalName: 'CUSTOMER_ID', dataType: 'BIGINT', parentDomainId: 'domA',
      isForeignKey: true, isPrimaryKey: true, isNullable: false, ordinal: 1,
      description: 'Id del cliente', udpValues: { u1: 'oro' },
    });
    expect('pkPosition' in nueva).toBe(false);
    // la existente: gana FK, conserva su ordinal (ya era PK), hereda metadata del padre
    const upd = changes.find((c) => c.entityId === 'h1')!.payload as unknown as CanonicalColumn;
    expect(upd).toMatchObject({ isForeignKey: true, isPrimaryKey: true, ordinal: 0, dataType: 'BIGINT' });
    // la no-PK se corre (orden único: REGION_CD · CUSTOMER_ID · AMOUNT) — una sola vez, doc completo
    const shifted = changes.filter((c) => c.entityId === 'h2');
    expect(shifted).toHaveLength(1);
    expect(shifted[0].payload).toMatchObject({ physicalName: 'AMOUNT', ordinal: 2 });
    // relación al final del lote, pares en orden de llave
    expect(changes[changes.length - 1]).toMatchObject({ collection: 'relationships', entityId: 'r9', op: 'upsert' });
    expect(relationship.pairs).toEqual([
      { parentColumnId: 'p1', childColumnId: 'n1' },
      { parentColumnId: 'p2', childColumnId: 'h1' },
    ]);
  });

  it('non-identifying + inherit=No: la nueva queda FK nullable en blanco; la PK existente del hijo CONSERVA su PK', () => {
    const rowsNo = rows.map((r) => ({ ...r, inherit: false }));
    const { changes, createdCols } = mappingToBulk({ ...base, identifying: false, rows: rowsNo, childCols: childColsBulk });
    expect(createdCols[0]).toMatchObject({ isForeignKey: true, isPrimaryKey: false, isNullable: true, ordinal: 2 });
    expect(changes.some((c) => c.entityId === 'h2')).toBe(false);   // non-identifying: al final, sin corridas
    expect(createdCols[0].description).toBeUndefined();
    const upd = changes.find((c) => c.entityId === 'h1')!.payload as unknown as CanonicalColumn;
    expect(upd).toMatchObject({ isForeignKey: true, isPrimaryKey: true, isNullable: false });
    expect(upd.description).toBe(existing.description);   // intacta
  });

  it('preexisting (sync): el par se conserva sin re-emitir la columna; roleName viaja en el par', () => {
    const rowsSync: MappingResolution[] = [
      { parentCol: parent1, target: { kind: 'create', id: 'n2', logicalName: 'boss id', physicalName: 'BOSS_ID' }, roleName: 'boss id', inherit: true },
      { parentCol: parent2, target: { kind: 'existing', col: existing, preexisting: true }, roleName: 'region', inherit: true },
    ];
    const { changes, relationship } = mappingToBulk({ ...base, identifying: false, rows: rowsSync, childCols: childColsBulk });
    expect(changes.some((c) => c.entityId === 'h1')).toBe(false);            // preexisting: sin cambio de columna
    expect(relationship.pairs).toEqual([
      { parentColumnId: 'p1', childColumnId: 'n2', roleName: 'boss id' },
      { parentColumnId: 'p2', childColumnId: 'h1', roleName: 'region' },
    ]);
  });

  it('doc 94: identifying que PROMUEVE una no-PK existente: sube al bloque de PK (un solo cambio por columna)', () => {
    const child = [col('k', 'H', 'K', { isPrimaryKey: true }), col('a', 'H', 'A', { ordinal: 1 }), col('b', 'H', 'B', { ordinal: 2 })];
    const { changes } = mappingToBulk({
      ...base, identifying: true, childCols: child,
      rows: [{ parentCol: parent1, target: { kind: 'existing', col: child[2] }, inherit: false }],
    });
    const byId = Object.fromEntries(changes.filter((c) => c.collection === 'canonical_columns')
      .map((c) => [c.entityId, c.payload as unknown as CanonicalColumn]));
    expect([byId.b.isPrimaryKey, byId.b.ordinal, byId.a.ordinal]).toEqual([true, 1, 2]);
    expect(changes.filter((c) => c.entityId === 'b')).toHaveLength(1);
  });

  it('inherit POR FILA: una fila en blanco y otra heredando en el MISMO lote', () => {
    const mixed: MappingResolution[] = [
      { parentCol: parent2, target: { kind: 'create', id: 'n4', logicalName: 'region_cd', physicalName: 'REGION_CD' }, inherit: false },
      { parentCol: parent1, target: { kind: 'existing', col: existing }, inherit: true },
    ];
    const { changes, createdCols } = mappingToBulk({ ...base, identifying: false, rows: mixed, childCols: childColsBulk });
    expect(createdCols[0].description).toBeUndefined();                     // fila 1: sin herencia
    const upd = changes.find((c) => c.entityId === 'h1')!.payload as unknown as CanonicalColumn;
    expect(upd).toMatchObject({                                             // fila 2: hereda TODO del padre
      parentDomainId: 'domA', description: 'Id del cliente', udpValues: { u1: 'oro' },
    });
  });

  it('existente con role name: el update RENOMBRA la columna y el par lleva roleName', () => {
    const rowsRen: MappingResolution[] = [{
      parentCol: parent1, roleName: 'region venta', inherit: false,
      target: { kind: 'existing', col: existing, rename: { logicalName: 'region venta', physicalName: 'REGION_VENTA' } },
    }];
    const { changes, relationship } = mappingToBulk({ ...base, identifying: false, rows: rowsRen, childCols: childColsBulk });
    const upd = changes.find((c) => c.entityId === 'h1')!.payload as unknown as CanonicalColumn;
    expect(upd).toMatchObject({ logicalName: 'region venta', physicalName: 'REGION_VENTA', isForeignKey: true });
    expect(relationship.pairs[0]).toEqual({ parentColumnId: 'p1', childColumnId: 'h1', roleName: 'region venta' });
  });
});

describe('mappingToBulk · frases de relación (doc 98)', () => {
  const parent = col('p1', 'P', 'CUSTOMER_ID', { isPrimaryKey: true });
  const child = col('h1', 'H', 'CUSTOMER_ID');
  const input = {
    relId: 'r9', parentTableId: 'P', childTableId: 'H', identifying: false,
    parentCardinality: 'one' as const, childCardinality: 'zero-many' as const,
    rows: [{ parentCol: parent, target: { kind: 'existing' as const, col: child, preexisting: true }, inherit: true }],
    childCols: [child],
  };

  it('las frases viajan en la relación del lote (crear, y Sync que la re-emite)', () => {
    const { changes, relationship } = mappingToBulk({
      ...input, parentToChildPhrase: 'Cliente tiene', childToParentPhrase: 'pertenece a un Cliente',
    });
    expect(relationship.parentToChildPhrase).toBe('Cliente tiene');
    expect(relationship.childToParentPhrase).toBe('pertenece a un Cliente');
    expect(changes[changes.length - 1].payload).toMatchObject({
      id: 'r9', parentToChildPhrase: 'Cliente tiene', childToParentPhrase: 'pertenece a un Cliente',
    });
  });

  it('se graban limpias: recortadas, y una en blanco no viaja', () => {
    const { relationship } = mappingToBulk({
      ...input, parentToChildPhrase: '  Cliente tiene ', childToParentPhrase: '   ',
    });
    expect(relationship.parentToChildPhrase).toBe('Cliente tiene');
    expect('childToParentPhrase' in relationship).toBe(false);
  });

  it('sin frases: la relación sale como siempre, sin llaves nuevas', () => {
    const { relationship } = mappingToBulk(input);
    expect('parentToChildPhrase' in relationship).toBe(false);
    expect('childToParentPhrase' in relationship).toBe(false);
  });
});

describe('syncMappingInput (doc 98 — «Sync with parent key» re-emite la relación)', () => {
  const parent = col('p1', 'P', 'CUSTOMER_ID', { isPrimaryKey: true });
  const child = col('h1', 'H', 'CUSTOMER_ID');
  const rows: MappingResolution[] = [
    { parentCol: parent, target: { kind: 'existing', col: child, preexisting: true }, inherit: true },
  ];
  const existing: Relationship = {
    id: 'r7', parentTableId: 'P', childTableId: 'H',
    pairs: [{ parentColumnId: 'pOld', childColumnId: 'h1' }],
    parentCardinality: 'zero-one', childCardinality: 'one-many', identifying: false,
    parentToChildPhrase: 'Cliente tiene', childToParentPhrase: 'pertenece a un Cliente',
  };

  it('todo lo que vive a nivel de RELACIÓN sale intacto; solo cambian los pares', () => {
    const { relationship } = mappingToBulk(syncMappingInput(existing, rows, [child]));
    expect(relationship).toEqual({
      id: 'r7', parentTableId: 'P', childTableId: 'H',
      pairs: [{ parentColumnId: 'p1', childColumnId: 'h1' }],
      parentCardinality: 'zero-one', childCardinality: 'one-many', identifying: false,
      parentToChildPhrase: 'Cliente tiene', childToParentPhrase: 'pertenece a un Cliente',
    });
  });

  it('una subcategoría conserva su símbolo', () => {
    const sub: Relationship = {
      ...existing, identifying: true, parentCardinality: 'one', childCardinality: 'one',
      subcategory: true, subtypeSymbolId: 'sym-3',
    };
    const { relationship } = mappingToBulk(syncMappingInput(sub, rows, [child]));
    expect(relationship).toMatchObject({ subcategory: true, subtypeSymbolId: 'sym-3' });
  });
});

describe('relationshipDrift (doc 47)', () => {
  const relDrift: Relationship = {
    id: 'r1', parentTableId: 'P', childTableId: 'H',
    pairs: [{ parentColumnId: 'p1', childColumnId: 'h1' }],
    parentCardinality: 'one', childCardinality: 'zero-many', identifying: true,
  };
  it('null cuando pares == llave', () => {
    expect(relationshipDrift(relDrift, ['p1'])).toBeNull();
  });
  it('missing: PK del padre sin par', () => {
    expect(relationshipDrift(relDrift, ['p1', 'p2'])).toEqual({ missing: ['p2'], extra: [] });
  });
  it('extra: par cuya columna padre ya no es PK', () => {
    expect(relationshipDrift(relDrift, ['pX'])).toEqual({ missing: ['pX'], extra: ['p1'] });
  });
});
