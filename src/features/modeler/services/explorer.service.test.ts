import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  setDevUser: vi.fn(),
  setAuthToken: vi.fn(),
  setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; },
  apiErrorMessage: vi.fn(),
  isConflictError: vi.fn(),
}));
vi.mock('@/features/governance/services/changeset.service', () => ({
  effective: vi.fn(),
}));
import { apiGet } from '@/services/http';
import * as csvc from '@/features/governance/services/changeset.service';
import { useChangesetStore } from '@/store/useChangesetStore';
import { clampDbxSplit, explorerSearchColumns, schemasForSection } from './explorer.service';

describe('explorerSearchColumns (búsqueda por columna del Database Explorer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChangesetStore.setState({ activeId: null });
  });

  it('sin versión activa va al catálogo publicado (join server-side)', async () => {
    vi.mocked(apiGet).mockResolvedValue([
      { id: 'c1', physicalName: 'COD_CLIENTE', tableId: 't1', table: 'M_CLIENTE', schema: 'ddv' },
    ]);
    const out = await explorerSearchColumns('cod cli', 25);
    expect(apiGet).toHaveBeenCalledWith('/api/catalog/columns?q=cod%20cli&limit=25');
    expect(out[0].table).toBe('M_CLIENTE');
  });

  it('con versión activa junta columnas efectivas + tablas del draft y descarta huérfanas', async () => {
    useChangesetStore.setState({ activeId: 'cs1' });
    vi.mocked(csvc.effective)
      .mockResolvedValueOnce([
        { id: 'c1', tableId: 't1', physicalName: 'COD_CLIENTE', dataType: 'STRING' },
        { id: 'c2', tableId: 't2', physicalName: 'COD_CLIENTE_RIESGO', dataType: 'INT' },
        { id: 'c9', tableId: 't-borrada', physicalName: 'COD_CLIENTE_OLD', dataType: 'STRING' },
      ])
      .mockResolvedValueOnce([
        { id: 't1', physicalName: 'M_CLIENTE_DRAFT', schema: 'ddv_cliente' },
        { id: 't2', physicalName: 'H_RIESGO', schema: 'ddv_riesgo' },
        // t-borrada NO vuelve del efectivo (borrada en la versión) → c9 fuera
      ]);
    const out = await explorerSearchColumns('cod', 50);
    expect(csvc.effective).toHaveBeenNthCalledWith(1, 'cs1', 'canonical_columns', { q: 'cod', limit: 50 });
    expect(csvc.effective).toHaveBeenNthCalledWith(2, 'cs1', 'canonical_tables', { ids: ['t-borrada', 't1', 't2'] });
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2']);
    // el nombre de la tabla es el del DRAFT (rename pendiente visible)
    expect(out[0].table).toBe('M_CLIENTE_DRAFT');
    expect(out[0].schema).toBe('ddv_cliente');
  });

  it('con versión activa y sin hits no consulta tablas', async () => {
    useChangesetStore.setState({ activeId: 'cs1' });
    vi.mocked(csvc.effective).mockResolvedValueOnce([]);
    const out = await explorerSearchColumns('nada', 50);
    expect(out).toEqual([]);
    expect(csvc.effective).toHaveBeenCalledTimes(1);
  });
});

describe('schemasForSection (secciones Canonical Tables / Views del Database Explorer)', () => {
  const schemas = [
    { id: 's1', name: 'ddv_cliente', kind: 'tables' as const },
    { id: 's2', name: 'ddv_cliente_vu', kind: 'views' as const },
    { id: 's3', name: 'legacy_sin_kind', kind: null },
    { id: 's4', name: 'otro_sin_kind' }, // kind ausente (docs viejos)
  ];

  it("sección 'tables' = kind tables + sin clasificar (regla doc 52)", () => {
    expect(schemasForSection(schemas, 'tables').map((s) => s.id)).toEqual(['s1', 's3', 's4']);
  });

  it("sección 'views' = kind views + sin clasificar", () => {
    expect(schemasForSection(schemas, 'views').map((s) => s.id)).toEqual(['s2', 's3', 's4']);
  });

  it('no muta la lista de entrada', () => {
    const copia = [...schemas];
    schemasForSection(schemas, 'views');
    expect(schemas).toEqual(copia);
  });
});

describe('clampDbxSplit (fracción de alto del Database Explorer en el sidebar)', () => {
  it('respeta valores dentro del rango', () => {
    expect(clampDbxSplit(0.5)).toBe(0.5);
    expect(clampDbxSplit(0.15)).toBe(0.15);
    expect(clampDbxSplit(0.85)).toBe(0.85);
  });

  it('recorta a los límites 15%–85%', () => {
    expect(clampDbxSplit(0.05)).toBe(0.15);
    expect(clampDbxSplit(0.99)).toBe(0.85);
    expect(clampDbxSplit(-1)).toBe(0.15);
  });

  it('valores no finitos (localStorage corrupto) caen al default 50%', () => {
    expect(clampDbxSplit(Number.NaN)).toBe(0.5);
    expect(clampDbxSplit(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});
