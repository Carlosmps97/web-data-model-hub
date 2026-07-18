import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, Relationship } from '@/features/governance/services/governance.service';
import { childCandidates, demotablePkChildren, pairError, parentCandidates, roleNamePlan } from './relationshipPairs';

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

describe('pairError', () => {
  it('rechaza par duplicado y columna hija repetida', () => {
    expect(pairError(rel(), 'p1', 'c1')).toMatch(/already exists/);
    expect(pairError(rel(), 'p2', 'c1')).toMatch(/already used/);
  });
  it('acepta par nuevo válido y exige ambas columnas', () => {
    expect(pairError(rel(), 'p2', 'c2')).toBeNull();
    expect(pairError(rel(), '', 'c2')).toMatch(/both/);
  });
});

describe('candidatas', () => {
  const cols = [
    { id: 'p1', tableId: 'tP', isPrimaryKey: true },
    { id: 'p2', tableId: 'tP', isPrimaryKey: false },
    { id: 'c1', tableId: 'tC', isPrimaryKey: false },
  ] as CanonicalColumn[];
  it('padre: solo columnas PK; hijo: todas las suyas', () => {
    expect(parentCandidates(cols, 'tP').map((c) => c.id)).toEqual(['p1']);
    expect(childCandidates(cols, 'tC').map((c) => c.id)).toEqual(['c1']);
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
