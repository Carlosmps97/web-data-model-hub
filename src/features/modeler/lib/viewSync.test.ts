import { describe, expect, it, vi } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import type { View, ViewSource } from '@/services/views.service';
import { alignSourcesToPhysical, appendColumnSource, hasProjection, isMirrorOfTable, namesLeavingTable, removeColumnSource, removeColumnsSources, renameColumnSource, restoreColumnsSources, syncNewColumnToMirrorViews, syncNewColumnsToMirrorViews, syncRemovedColumnFromViews, syncRenamedColumnInViews, viewsLeftEmpty } from './viewSync';
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

describe('quitar y reponer una columna (Undo de un borrado)', () => {
  const v: View = { ...mirror, sources: [
    { tableId: 't1', column: 'COD', outputAlias: 'COD' },
    { tableId: 't1', column: 'FEC', outputAlias: 'FEC' },
    { tableId: 't1', column: 'cod', outputAlias: 'COD_2' },
  ] };
  const removedCod = () => removeColumnsSources(v, 't1', ['COD'])!.removed;

  it('las fuentes de la columna con su posición (case-insensitive, por tabla)', () => {
    expect(removedCod()).toEqual([{ physicalName: 'COD', at: [{ index: 0, source: v.sources![0] }, { index: 2, source: v.sources![2] }] }]);
    expect(removeColumnsSources(v, 't9', ['COD'])).toBeNull();
  });

  it('las repone en su lugar sobre el documento vigente, aunque cambió después', () => {
    const now: View = { ...v, name: 'RENOMBRADA', sources: [v.sources![1], { tableId: 't1', column: 'NUEVA', outputAlias: 'NUEVA' }] };
    expect(restoreColumnsSources(now, 't1', removedCod())).toEqual([v.sources![0], v.sources![1], v.sources![2],
      { tableId: 't1', column: 'NUEVA', outputAlias: 'NUEVA' }]);
    // Con menos fuentes que antes, al final.
    expect(restoreColumnsSources({ ...v, sources: [] }, 't1', removedCod())).toEqual([v.sources![0], v.sources![2]]);
  });

  it('null si la vista ya lista la columna', () => {
    expect(restoreColumnsSources(v, 't1', removedCod())).toBeNull();
  });

  it('null si la vista ya no lee de esa tabla o si repetiría un nombre de salida', () => {
    expect(restoreColumnsSources({ ...v, tableId: 't2', sourceTableIds: ['t2'], sources: [] }, 't1', removedCod())).toBeNull();
    expect(restoreColumnsSources({ ...v, sources: [{ tableId: 't1', column: 'FEC', outputAlias: 'COD' }] }, 't1', removedCod())).toBeNull();
  });

  it('un nombre de salida que ya estaba repetido en la vista puede repetirse; uno nuevo repetido dentro de la columna, no', () => {
    const A = { tableId: 't1', column: 'A', outputAlias: 'X' }, B = { tableId: 't1', column: 'B', outputAlias: 'X' };
    const COD = { tableId: 't1', column: 'COD', outputAlias: 'X' };
    const base: View = { ...v, sources: [A, B, COD] };
    const { removed } = removeColumnsSources(base, 't1', ['COD'])!;
    expect(restoreColumnsSources({ ...base, sources: [A, B] }, 't1', removed)).toEqual([A, B, COD]);
    const twice: View = { ...v, sources: [COD, { ...COD }] };
    const out = removeColumnsSources(twice, 't1', ['COD'])!;
    expect(restoreColumnsSources({ ...twice, sources: out.sources }, 't1', out.removed)).toBeNull();
  });

  it('una fuente legacy sin tabla vuelve con la suya (no se resuelve contra otra primera fuente)', () => {
    const legacy: View = { id: 'v9', name: 'V', tableId: 't1', sourceTableIds: ['t1', 't2'], sources: [{ column: 'COD', outputAlias: 'COD' }] };
    const { removed } = removeColumnsSources(legacy, 't1', ['COD'])!;
    expect(removed).toEqual([{ physicalName: 'COD', at: [{ index: 0, source: { column: 'COD', outputAlias: 'COD', tableId: 't1' } }] }]);
    const now: View = { ...legacy, tableId: 't2', sourceTableIds: ['t2', 't1'], sources: [] };
    expect(restoreColumnsSources(now, 't1', removed)).toEqual([{ column: 'COD', outputAlias: 'COD', tableId: 't1' }]);
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

describe('varias columnas de una vista (borrado de varias columnas)', () => {
  const v: View = { id: 'v1', name: 'VU_P', tableId: 'tP', sourceTableIds: ['tP'], sources: [
    { tableId: 'tP', column: 'PA', outputAlias: 'PA' },
    { tableId: 'tP', column: 'PB', outputAlias: 'PB' },
    { tableId: 'tP', column: 'C1', outputAlias: 'C1' },
    { expression: '1', outputAlias: 'UNO' },
  ] };
  const [PA, PB, C1, UNO] = v.sources!;

  it('las quita en un solo documento y anota cada una con su posición en el documento de antes del borrado', () => {
    expect(removeColumnsSources(v, 'tP', ['PB', 'PA'])).toEqual({
      sources: [C1, UNO],
      removed: [{ physicalName: 'PB', at: [{ index: 1, source: PB }] }, { physicalName: 'PA', at: [{ index: 0, source: PA }] }],
    });
    expect(removeColumnsSources(v, 'tP', ['PA', 'PB'])?.removed).toEqual([
      { physicalName: 'PA', at: [{ index: 0, source: PA }] }, { physicalName: 'PB', at: [{ index: 1, source: PB }] },
    ]);
  });

  it('salta las que la vista no lista; null si no lista ninguna', () => {
    expect(removeColumnsSources(v, 'tP', ['ZZ', 'C1'])?.removed.map((r) => r.physicalName)).toEqual(['C1']);
    expect(removeColumnsSources(v, 'tP', ['ZZ'])).toBeNull();
    expect(removeColumnsSources(v, 't9', ['PA'])).toBeNull();
  });

  it('el Undo las repone en su lugar sobre el documento vigente: lo editado después queda', () => {
    const { removed } = removeColumnsSources(v, 'tP', ['PB', 'PA'])!;
    const NEW = { tableId: 'tP', column: 'NUEVA', outputAlias: 'NUEVA' };
    expect(restoreColumnsSources({ ...v, sources: [C1, UNO, NEW] }, 'tP', removed)).toEqual([PA, PB, C1, UNO, NEW]);
  });

  it('se salta la que la vista ya volvió a listar (al final, como la sincroniza la espejo); null si no repone ninguna', () => {
    const { removed } = removeColumnsSources(v, 'tP', ['PA', 'PB'])!;
    expect(restoreColumnsSources({ ...v, sources: [C1, UNO, PA] }, 'tP', removed)).toEqual([PB, C1, UNO, PA]);
    expect(restoreColumnsSources({ ...v, tableId: 't2', sourceTableIds: ['t2'], sources: [] }, 'tP', removed)).toBeNull();
  });

  it('las demás vuelven a su lugar entre las que quedaron aunque la que volvió a listarse esté al final', () => {
    const [A, B, C, D] = ['A', 'B', 'C', 'D'].map((c) => ({ tableId: 'tP', column: c, outputAlias: c }));
    const four: View = { ...v, sources: [A, B, C, D] };
    const { removed } = removeColumnsSources(four, 'tP', ['B', 'C'])!;
    expect(restoreColumnsSources({ ...four, sources: [A, D, B] }, 'tP', removed)).toEqual([A, C, D, B]);
  });

  it('si una no vuelve (su nombre de salida ya está tomado), las otras vuelven en su orden relativo', () => {
    const { removed } = removeColumnsSources(v, 'tP', ['PB', 'PA'])!;
    const X = { expression: "'x'", outputAlias: 'PA' };
    expect(restoreColumnsSources({ ...v, sources: [C1, X] }, 'tP', removed)).toEqual([PB, C1, X]);
  });

  it('quitar y reponer deja la vista como estaba, en cualquier orden y con fuentes nuevas al final (fuzz)', () => {
    let seed = 127;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 300; run += 1) {
      const names = Array.from({ length: 2 + rnd(12) }, (_, i) => `C${i}`);
      const sources: ViewSource[] = names.flatMap((name, i): ViewSource[] => {
        const kind = rnd(5);
        if (kind === 0) return [{ expression: `${i}`, outputAlias: `E${i}` }];
        if (kind === 1) return [{ tableId: 'tQ', column: name, outputAlias: `Q_${name}` }];
        if (kind === 2) return [{ column: name, outputAlias: name }];   // legacy: sin tabla, de la primera fuente
        return [{ tableId: 'tP', column: name, outputAlias: name }];
      });
      const view: View = { id: 'vf', name: 'VF', tableId: 'tP', sourceTableIds: ['tP', 'tQ'], sources };
      const pick = names.filter(() => rnd(2) === 0).sort(() => rnd(3) - 1);
      const out = removeColumnsSources(view, 'tP', pick);
      // Lo que vuelve trae su tabla explícita.
      const expected = sources.map((x) => (out && !('tableId' in x) && !('expression' in x) && pick.includes(x.column!) ? { ...x, tableId: 'tP' } : x));
      if (!out) { expect(sources.filter((x) => 'column' in x && !('tableId' in x && x.tableId === 'tQ') && pick.includes(x.column!))).toEqual([]); continue; }
      expect(restoreColumnsSources({ ...view, sources: out.sources }, 'tP', out.removed)).toEqual(expected);
      const added = { tableId: 'tP', column: 'NUEVA', outputAlias: 'NUEVA' };
      expect(restoreColumnsSources({ ...view, sources: [...out.sources, added] }, 'tP', out.removed)).toEqual([...expected, added]);
    }
  });

  it('cuesta lineal: 4.500 fuentes y 1.990 columnas, quitar y reponer en menos de medio segundo', () => {
    const big: View = { id: 'vb', name: 'VB', tableId: 'tP', sourceTableIds: ['tP'],
      sources: Array.from({ length: 4500 }, (_, i) => ({ tableId: 'tP', column: `COL_${i}`, outputAlias: `COL_${i}` })) };
    const pick = Array.from({ length: 1990 }, (_, i) => `COL_${i * 2}`);
    const t0 = performance.now();
    const out = removeColumnsSources(big, 'tP', pick)!;
    const back = restoreColumnsSources({ ...big, sources: out.sources }, 'tP', out.removed);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(back).toEqual(big.sources);
  });

  it('proyección = alguna columna o expresión no vacía (sin ninguna, el DDL cae a SELECT *)', () => {
    expect(hasProjection(undefined)).toBe(false);
    expect(hasProjection([])).toBe(false);
    expect(hasProjection([{ column: '  ' }, { table: 'T' }])).toBe(false);
    expect(hasProjection([{ expression: ' 1 ' }])).toBe(true);
    expect(hasProjection([{ column: 'PA' }])).toBe(true);
  });

  it('vistas que quedan sin proyección: solo las que esas columnas vacían', () => {
    const only: View = { ...v, id: 'v2', sources: [PA, PB] };
    const withExpr: View = { ...v, id: 'v3', sources: [PA, UNO] };
    const other: View = { ...v, id: 'v4', sources: [C1] };
    expect(viewsLeftEmpty([only, withExpr, other], 'tP', ['PA', 'PB']).map((x) => x.id)).toEqual(['v2']);
  });
});

// Columnas repetidas (homónimas heredadas de Erwin): las fuentes de una vista
// apuntan a la columna por nombre. Si al borrar o renombrar una queda otra con
// ese nombre en la tabla, la fuente sigue resolviendo a ella y no se toca.
describe('columnas homónimas', () => {
  const homonym = (id: string): CanonicalColumn => ({ ...col('COD', 0), id });

  it('namesLeavingTable: solo salen los nombres que nadie conserva', () => {
    expect(namesLeavingTable(['COD', 'FEC'], [homonym('cod-2')])).toEqual(['FEC']);
    expect(namesLeavingTable(['cod'], [])).toEqual(['cod']);
  });

  it('borrar una de dos homónimas no saca la fuente; borrar la última sí', async () => {
    const updateView = vi.fn<(id: string, body: { sources?: ViewSource[] }) => Promise<void>>(async () => {});
    const deps = { listViews: vi.fn(async () => [mirror]), updateView,
      listColumns: vi.fn(async () => [homonym('cod-2'), col('FEC', 1)]) };
    expect(await syncRemovedColumnFromViews(deps, 't1', 'COD')).toBe(0);
    expect(updateView).not.toHaveBeenCalled();
    deps.listColumns.mockResolvedValueOnce([col('FEC', 1)]);
    expect(await syncRemovedColumnFromViews(deps, 't1', 'COD')).toBe(1);
    expect(updateView.mock.calls[0]?.[1].sources?.map((x) => x.column)).toEqual(['FEC']);
  });

  it('renombrar una de dos homónimas no re-apunta la fuente (es de la otra)', async () => {
    const updateView = vi.fn(async () => {});
    const deps = { listViews: vi.fn(async () => [mirror]), updateView,
      listColumns: vi.fn(async () => [{ ...homonym('cod-1'), physicalName: 'COD_X' }, homonym('cod-2'), col('FEC', 1)]) };
    expect(await syncRenamedColumnInViews(deps, 't1', 'COD', 'COD_X')).toBe(0);
    expect(updateView).not.toHaveBeenCalled();
  });

  it('sin la lectura de columnas, o si falla, se comporta como siempre', async () => {
    const updateView = vi.fn(async () => {});
    expect(await syncRenamedColumnInViews({ listViews: vi.fn(async () => [mirror]), updateView }, 't1', 'COD', 'COD_X')).toBe(1);
    const failing = { listViews: vi.fn(async () => [mirror]), updateView,
      listColumns: vi.fn(async (): Promise<CanonicalColumn[]> => { throw new Error('sin red'); }) };
    expect(await syncRenamedColumnInViews(failing, 't1', 'COD', 'COD_X')).toBe(1);
  });

  it('una columna creada en el mismo lote con el nombre anterior no lo sostiene', async () => {
    // Migrar la llave: E (COD) pasa a COD_X por role name y el lote crea C, también COD.
    const updateView = vi.fn(async () => {});
    const deps = { listViews: vi.fn(async () => [mirror]), updateView,
      listColumns: vi.fn(async () => [{ ...homonym('e'), physicalName: 'COD_X' }, homonym('c')]) };
    expect(await syncRenamedColumnInViews(deps, 't1', 'COD', 'COD_X', { createdIds: ['c'] })).toBe(1);
  });

  it('las columnas y las vistas se leen a la vez (sin sumar una ida y vuelta)', async () => {
    let views!: (v: View[]) => void;
    const deps = { listViews: vi.fn(() => new Promise<View[]>((r) => { views = r; })), updateView: vi.fn(async () => {}),
      listColumns: vi.fn(async () => [] as CanonicalColumn[]) };
    const run = syncRemovedColumnFromViews(deps, 't1', 'COD');
    await Promise.resolve();
    expect(deps.listViews).toHaveBeenCalled();
    expect(deps.listColumns).toHaveBeenCalled();
    views([mirror]);
    expect(await run).toBe(1);
  });
});
