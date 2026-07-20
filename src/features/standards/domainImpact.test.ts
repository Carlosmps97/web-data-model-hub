import { describe, it, expect } from 'vitest';
import { impactWarning, visibleImpactTables, tableLabel } from './domainImpact';
import type { DomainImpact, DomainImpactTable } from '@/services/naming.service';

const TABLES: DomainImpactTable[] = [
  { tableId: 't1', schema: 'core', physicalName: 'CLIENTE', logicalName: 'cliente', columns: 2, overridden: 0 },
  { tableId: 't2', schema: null, physicalName: 'CUENTA', logicalName: 'cuenta soles', columns: 3, overridden: 1 },
];

const IMPACT: DomainImpact = {
  columnsUsing: 5, willUpdate: 4, overridden: 1, totalTables: 2, modelsAffected: 3, tables: TABLES,
};

describe('impactWarning', () => {
  it('arma el warning explícito con columnas/tablas/modelos', () => {
    expect(impactWarning(IMPACT)).toBe(
      'This change will affect 4 columns in 2 tables across 3 data models',
    );
  });
});

describe('visibleImpactTables', () => {
  it('sin toggle devuelve todas', () => {
    expect(visibleImpactTables(TABLES, false)).toEqual(TABLES);
  });
  it('con toggle filtra a tablas con columnas con override', () => {
    expect(visibleImpactTables(TABLES, true)).toEqual([TABLES[1]]);
  });
});

describe('tableLabel', () => {
  it('antepone el esquema cuando existe', () => {
    expect(tableLabel(TABLES[0])).toBe('core.CLIENTE');
    expect(tableLabel(TABLES[1])).toBe('CUENTA');
  });
});
