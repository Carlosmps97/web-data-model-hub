import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, Relationship } from '@/services/governance.service';
import {
  buildKeyMapping, demotablePkChildren, mappingToBulk,
  relationshipDrift, roleNamePlan, type MappingResolution,
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
  const existing = col('h1', 'H', 'REGION_CD', { isPrimaryKey: true, pkPosition: 0, isNullable: false });
  const childColsBulk = [existing, col('h2', 'H', 'AMOUNT', { ordinal: 1 })];
  const base = {
    relId: 'r9', parentTableId: 'P', childTableId: 'H',
    parentCardinality: 'one' as const, childCardinality: 'zero-many' as const,
  };
  const rows: MappingResolution[] = [
    { parentCol: parent1, target: { kind: 'create', id: 'n1', logicalName: 'customer_id', physicalName: 'CUSTOMER_ID' }, inherit: true },
    { parentCol: parent2, target: { kind: 'existing', col: existing }, inherit: true },
  ];

  it('identifying + inherit: crea con metadata del padre, PK al final de la llave, y no pisa pkPosition existente', () => {
    const { changes, createdCols, relationship } = mappingToBulk({ ...base, identifying: true, rows, childCols: childColsBulk });
    expect(createdCols).toHaveLength(1);
    const nueva = createdCols[0];
    expect(nueva).toMatchObject({
      id: 'n1', tableId: 'H', physicalName: 'CUSTOMER_ID', dataType: 'BIGINT', parentDomainId: 'domA',
      isForeignKey: true, isPrimaryKey: true, isNullable: false, pkPosition: 1, ordinal: 2,
      description: 'Id del cliente', udpValues: { u1: 'oro' },
    });
    // la existente: gana FK, conserva su pkPosition 0, hereda metadata del padre
    const upd = changes.find((c) => c.entityId === 'h1')!.payload as unknown as CanonicalColumn;
    expect(upd).toMatchObject({ isForeignKey: true, isPrimaryKey: true, pkPosition: 0, dataType: 'BIGINT' });
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
    expect(createdCols[0]).toMatchObject({ isForeignKey: true, isPrimaryKey: false, isNullable: true, pkPosition: null });
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

  it('hijo sin orden explícito de llave: pkPosition null también en identifying', () => {
    const plainChild = [col('h3', 'H', 'OTRA', { isPrimaryKey: true })];   // PK sin pkPosition
    const { createdCols } = mappingToBulk({
      ...base, identifying: true, childCols: plainChild,
      rows: [{ parentCol: parent1, target: { kind: 'create', id: 'n3', logicalName: 'x', physicalName: 'X' }, inherit: false }],
    });
    expect(createdCols[0].pkPosition).toBeNull();
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
