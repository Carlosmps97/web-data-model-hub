import { describe, expect, it, vi } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import type { View } from '@/services/views.service';
import { alignSourcesToPhysical, appendColumnSource, isMirrorOfTable, removeColumnSource, renameColumnSource, syncNewColumnToMirrorViews } from './viewSync';

const col = (physicalName: string, ordinal: number): CanonicalColumn => ({
  id: physicalName.toLowerCase(), tableId: 't1', physicalName, logicalName: physicalName.toLowerCase(),
  dataType: 'STRING', typeOverridden: false, ordinal,
});

const mirror: View = {
  id: 'v1', name: 'VU_T1', tableId: 't1', sourceTableIds: ['t1'],
  sources: [
    { tableId: 't1', column: 'COD', outputAlias: 'COD' },
    { tableId: 't1', column: 'FEC', outputAlias: 'FEC' },
  ],
};

describe('isMirrorOfTable', () => {
  it('espejo = contiene TODAS las columnas de la tabla (case-insensitive)', () => {
    expect(isMirrorOfTable(mirror, 't1', [col('cod', 0), col('FEC', 1)])).toBe(true);
  });
  it('curada (le falta una columna a propósito) NO es espejo', () => {
    expect(isMirrorOfTable(mirror, 't1', [col('COD', 0), col('FEC', 1), col('OTRA', 2)])).toBe(false);
  });
});

describe('appendColumnSource', () => {
  it('agrega al final con alias = físico; idempotente si ya estaba', () => {
    const next = appendColumnSource(mirror, 't1', 'NUEVA');
    expect(next?.map((s) => s.column)).toEqual(['COD', 'FEC', 'NUEVA']);
    expect(appendColumnSource(mirror, 't1', 'fec')).toBeNull();
  });
});

describe('alignSourcesToPhysical', () => {
  it('reordena al orden físico (caso _vu con la llave primero → orden de tabla)', () => {
    const v: View = { ...mirror, sources: [
      { tableId: 't1', column: 'FEC' }, { tableId: 't1', column: 'COD' }, { tableId: 't1', column: 'ZZZ_DESCONOCIDA' },
    ] };
    const out = alignSourcesToPhysical(v, new Map([['t1', [col('COD', 0), col('FEC', 1)]]]));
    expect(out.map((s) => s.column)).toEqual(['COD', 'FEC', 'ZZZ_DESCONOCIDA']);
  });
  it('multi-fuente: agrupa por sourceTableIds y ordena dentro de cada grupo', () => {
    const v: View = { id: 'v2', name: 'X', sourceTableIds: ['t1', 't2'], sources: [
      { tableId: 't2', column: 'B2' }, { tableId: 't1', column: 'FEC' },
      { tableId: 't2', column: 'A2' }, { tableId: 't1', column: 'COD' },
    ] };
    const out = alignSourcesToPhysical(v, new Map([
      ['t1', [col('COD', 0), col('FEC', 1)]],
      ['t2', [{ ...col('A2', 0), tableId: 't2' }, { ...col('B2', 1), tableId: 't2' }]],
    ]));
    expect(out.map((s) => `${s.tableId}.${s.column}`)).toEqual(['t1.COD', 't1.FEC', 't2.A2', 't2.B2']);
  });
});

describe('removeColumnSource / renameColumnSource', () => {
  it('el delete saca la columna de CUALQUIER vista (espejo o curada)', () => {
    const next = removeColumnSource(mirror, 't1', 'fec');
    expect(next?.map((s) => s.column)).toEqual(['COD']);
    expect(removeColumnSource(mirror, 't1', 'NO_EXISTE')).toBeNull();
  });
  it('el rename re-apunta y el alias sigue al nombre SOLO si era el default', () => {
    const v: View = { ...mirror, sources: [
      { tableId: 't1', column: 'FEC', outputAlias: 'FEC' },          // alias default
      { tableId: 't1', column: 'COD', outputAlias: 'CODIGO_NEGOCIO' }, // alias custom
    ] };
    const renamed = renameColumnSource(v, 't1', 'FEC', 'FECREGISTRO');
    expect(renamed?.[0]).toMatchObject({ column: 'FECREGISTRO', outputAlias: 'FECREGISTRO' });
    const renamed2 = renameColumnSource(v, 't1', 'COD', 'COD2');
    expect(renamed2?.[1]).toMatchObject({ column: 'COD2', outputAlias: 'CODIGO_NEGOCIO' });
    expect(renameColumnSource(v, 't1', 'ZZZ', 'W')).toBeNull();
  });
});

describe('alignSourcesToPhysical — vista CURADA (subset)', () => {
  it('reordena SOLO las columnas seleccionadas; NUNCA agrega las que faltan', () => {
    const curated: View = { ...mirror, sources: [
      { tableId: 't1', column: 'FEC' }, { tableId: 't1', column: 'COD' },
    ] };
    const out = alignSourcesToPhysical(curated, new Map([
      ['t1', [col('COD', 0), col('OTRA', 1), col('FEC', 2)]],  // la tabla tiene 3
    ]));
    expect(out.map((s) => s.column)).toEqual(['COD', 'FEC']);  // sigue con 2
  });
});

describe('syncNewColumnToMirrorViews', () => {
  it('extiende SOLO las vistas espejo; las curadas quedan intactas', async () => {
    const curated: View = { ...mirror, id: 'v-cur', sources: [{ tableId: 't1', column: 'COD' }] };
    const updateView = vi.fn().mockResolvedValue({});
    const n = await syncNewColumnToMirrorViews(
      { listViews: vi.fn().mockResolvedValue([mirror, curated]), updateView },
      't1', 'NUEVA', [col('COD', 0), col('FEC', 1)],
    );
    expect(n).toBe(1);
    expect(updateView).toHaveBeenCalledTimes(1);
    expect(updateView.mock.calls[0][0]).toBe('v1');
    expect(updateView.mock.calls[0][1].sources.map((s: { column?: string }) => s.column))
      .toEqual(['COD', 'FEC', 'NUEVA']);
  });
});
