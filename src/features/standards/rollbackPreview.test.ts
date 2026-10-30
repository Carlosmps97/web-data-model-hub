import { describe, expect, it } from 'vitest';
import { rollbackDomainRows, rollbackSummary } from './rollbackPreview';
import type { RollbackPreview } from './standards.service';

const P: RollbackPreview = {
  target: { seq: 1, label: 'v1' }, namesRederived: false, ddlRulesKept: false, ddlRulesMissingUdps: [],
  domains: [{ id: 'd1', name: 'Codigo Clave', physical: { from: 'UUID', to: 'INTEGER' }, logical: null, columns: 30000 }],
};

describe('vista previa del rollback', () => {
  it('filas por dominio con el cambio de tipo y las columnas', () => {
    expect(rollbackDomainRows(P)).toEqual([
      { id: 'd1', name: 'Codigo Clave', physical: 'UUID → INTEGER', logical: '—', columns: '30,000' }]);
  });
  it('resumen: re-tipos y re-derivado de nombres', () => {
    expect(rollbackSummary(P)).toEqual([
      '1 domain type change · 30,000 columns re-typed (only the ones that follow each domain).']);
    expect(rollbackSummary({ ...P, domains: [], namesRederived: true })).toEqual([
      'No domain type changes — no column is re-typed.',
      'Physical names are re-derived from the glossary and naming rules of v1.',
    ]);
  });
  it('resumen: reglas del Export DDL del formato anterior que no se restauran', () => {
    expect(rollbackSummary({ ...P, ddlRulesKept: true })).toContain(
      'The DDL export rules stay as they are: v1 has them in the previous format (its output settings do come back).');
    expect(rollbackSummary({ ...P, ddlRulesKept: true, ddlRulesMissingUdps: ['Particion'] })).toContain(
      "The kept rules use UDPs that v1 doesn't have (Particion): their values come out empty in the DDL.");
  });
});
