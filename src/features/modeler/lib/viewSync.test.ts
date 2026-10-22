import { describe, expect, it, vi } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import type { View } from '@/services/views.service';
import { alignSourcesToPhysical, appendColumnSource, isMirrorOfTable, removeColumnSource, renameColumnSource, syncNewColumnToMirrorViews, syncNewColumnsToMirrorViews } from './viewSync';
import { SessionChangedError } from './sessionGuard';

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
  it('espejo = contiene todas las columnas de la tabla (case-insensitive)', () => {
    expect(isMirrorOfTable(mirror, 't1', [col('cod', 0), col('FEC', 1)])).toBe(true);
  });
  it('curada (le falta una columna a propósito) no es espejo', () => {
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
  it('el delete saca la columna de cualquier vista (espejo o curada)', () => {
    const next = removeColumnSource(mirror, 't1', 'fec');
    expect(next?.map((s) => s.column)).toEqual(['COD']);
    expect(removeColumnSource(mirror, 't1', 'NO_EXISTE')).toBeNull();
  });
  it('el rename re-apunta y el alias sigue al nombre solo si era el default', () => {
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

describe('alignSourcesToPhysical — vista curada (subset)', () => {
  it('reordena solo las columnas seleccionadas; nunca agrega las que faltan', () => {
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
  it('extiende solo las vistas espejo; las curadas quedan intactas', async () => {
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

// ── «Match the table's physical order» no ordena por `ordinal` crudo: una PK
// recién marcada conserva el ordinal del final y quedaría abajo. El orden de la
// vista es el orden único de la tabla: PK primero.
describe('vistas en el orden único (PK primero)', () => {
  const pk = (physicalName: string, ordinal: number): CanonicalColumn => ({ ...col(physicalName, ordinal), isPrimaryKey: true });

  it('alignSourcesToPhysical: una PK con ordinal alto queda con las PK, arriba', () => {
    const v: View = { ...mirror, sources: [
      { tableId: 't1', column: 'COD' }, { tableId: 't1', column: 'FEC' }, { tableId: 't1', column: 'NUEVA_PK' },
    ] };
    // la lista llega en ordinal crudo: igual sale PK primero
    const cols = [pk('COD', 0), col('FEC', 1), pk('NUEVA_PK', 2)];
    expect(alignSourcesToPhysical(v, new Map([['t1', cols]])).map((s) => s.column)).toEqual(['COD', 'NUEVA_PK', 'FEC']);
  });

  it('appendColumnSource: una columna nueva que es PK entra tras la última PK de su tabla', () => {
    const next = appendColumnSource(mirror, 't1', 'NUEVA_PK', ['COD']);
    expect(next?.map((s) => s.column)).toEqual(['COD', 'NUEVA_PK', 'FEC']);
  });

  it('appendColumnSource: PK sin otras PK en la vista ⇒ primera de su tabla', () => {
    const next = appendColumnSource(mirror, 't1', 'NUEVA_PK', []);
    expect(next?.map((s) => s.column)).toEqual(['NUEVA_PK', 'COD', 'FEC']);
  });

  it('syncNewColumnToMirrorViews: la PK nueva entra a la espejo tras las PK', async () => {
    const updateView = vi.fn().mockResolvedValue({});
    await syncNewColumnToMirrorViews(
      { listViews: vi.fn().mockResolvedValue([mirror]), updateView },
      't1', 'NUEVA_PK', [pk('COD', 0), col('FEC', 1)], true,
    );
    expect(updateView.mock.calls[0][1].sources.map((s: { column?: string }) => s.column))
      .toEqual(['COD', 'NUEVA_PK', 'FEC']);
  });
});

describe('syncNewColumnsToMirrorViews — varias columnas nuevas', () => {
  it('varias PK nuevas entran tras las PK en su orden; las no-PK al final', async () => {
    let current: View = { ...mirror, sources: [...(mirror.sources ?? [])] };
    const deps = {
      listViews: vi.fn(async () => [current]),
      updateView: vi.fn(async (_id: string, body: { sources?: View['sources'] }) => { current = { ...current, sources: body.sources }; return {}; }),
    };
    const pk = (n: string, o: number): CanonicalColumn => ({ ...col(n, o), isPrimaryKey: true });
    const n = await syncNewColumnsToMirrorViews(deps, 't1',
      [{ physicalName: 'PK_A', isPrimaryKey: true }, { physicalName: 'PK_B', isPrimaryKey: true }, { physicalName: 'DATO', isPrimaryKey: false }],
      [pk('COD', 0), col('FEC', 1)]);
    expect(n).toBe(3);
    expect(current.sources?.map((s) => s.column)).toEqual(['COD', 'PK_A', 'PK_B', 'FEC', 'DATO']);
  });
});

// Cada columna es best-effort, pero el corte por cambio de sesión (deps con
// pin: `pinnedViewDeps`) no es un error de esa vista: se propaga y corta el
// resto.
describe('syncNewColumnsToMirrorViews — corte por cambio de sesión', () => {
  it('propaga SessionChangedError y no sigue con las demás columnas', async () => {
    const updateView = vi.fn(async () => { throw new SessionChangedError(); });
    const deps = { listViews: vi.fn(async () => [mirror]), updateView };
    await expect(syncNewColumnsToMirrorViews(deps, 't1', [{ physicalName: 'A' }, { physicalName: 'B' }], [col('COD', 0), col('FEC', 1)]))
      .rejects.toBeInstanceOf(SessionChangedError);
    expect(updateView).toHaveBeenCalledTimes(1);
  });

  it('un error cualquiera de una columna sigue siendo best-effort (no rechaza)', async () => {
    const updateView = vi.fn(async () => { throw new Error('sin red'); });
    const deps = { listViews: vi.fn(async () => [mirror]), updateView };
    await expect(syncNewColumnsToMirrorViews(deps, 't1', [{ physicalName: 'A' }], [col('COD', 0), col('FEC', 1)]))
      .resolves.toBe(0);
    expect(updateView).toHaveBeenCalledTimes(1);
  });
});
