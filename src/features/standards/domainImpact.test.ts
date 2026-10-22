import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, impactBanner, tableLabel, typeCell, typeChanges, typeTargets, usageLines } from './domainImpact';
import type { DomainColumnImpact, DomainColumnImpactRow } from '@/services/naming.service';

const IMPACT: DomainColumnImpact = {
  domain: { physical: 'INTEGER', logical: 'NUMBER' }, targets: { physical: 'UUID' },
  totals: { columns: 180, tables: 120, change: 177, changeTables: 118, override: 2, differs: 1, models: 37 },
  matched: 177, rows: [],
};
const ROW: DomainColumnImpactRow = {
  columnId: 'c1', tableId: 't1', schema: 'core', table: 'CLIENTE', tableLogical: 'cliente', column: 'CODCLI',
  attribute: 'codigo cliente', physicalType: 'INTEGER', logicalType: 'NUMBER', physical: 'change', logical: null, status: 'change',
};

describe('typeTargets', () => {
  it('detecta cambio físico y/o lógico; vacío o igual no cuenta', () => {
    const before = { defaultDataType: 'INTEGER', logicalDataType: 'NUMBER' };
    expect(typeTargets(before, { defaultDataType: 'UUID', logicalDataType: 'NUMBER' })).toEqual({ physicalTo: 'UUID' });
    expect(typeTargets(before, { defaultDataType: 'INTEGER', logicalDataType: 'TEXT' })).toEqual({ logicalTo: 'TEXT' });
    expect(typeTargets(before, { defaultDataType: 'INTEGER', logicalDataType: '' })).toEqual({});
    expect(typeTargets(null, { defaultDataType: 'UUID' })).toEqual({});
  });
});

describe('textos del popup y del panel', () => {
  it('banner exacto con los saltados y su motivo', () => {
    expect(impactBanner(IMPACT)).toBe(
      '177 columns in 118 tables across 37 data models will be re-typed · 2 skipped (override) · 1 skipped (type already differs)');
  });
  it('panel en inglés, con el conteo de modelos de datos', () => {
    expect(usageLines(IMPACT)).toEqual({
      headline: 'Used by 180 columns in 120 tables across 37 data models.', follow: '177 follow the domain',
      override: '2 overridden (skipped)', differs: '1 with another type (skipped)',
    });
  });
  it('líneas de tipo por faceta', () => {
    expect(typeChanges(IMPACT)).toEqual(['Physical: INTEGER → UUID']);
    expect(typeChanges({ domain: { physical: 'INTEGER', logical: null }, targets: { logical: 'TEXT' } }))
      .toEqual(['Logical: — → TEXT']);
  });
  it('celda de tipo: «actual → nuevo» solo si esa faceta cambia en la fila', () => {
    expect(typeCell(ROW, 'physical', IMPACT.targets)).toBe('INTEGER → UUID');
    expect(typeCell({ ...ROW, physical: 'override', physicalType: 'BIGINT' }, 'physical', IMPACT.targets)).toBe('BIGINT');
    expect(STATUS_LABEL.differs).toBe('Skipped · type differs');
  });
  it('tabla con esquema', () => {
    expect(tableLabel(ROW)).toBe('core.CLIENTE');
    expect(tableLabel({ schema: null, table: 'CUENTA' })).toBe('CUENTA');
  });
});
