import { describe, expect, it } from 'vitest';
import type { DbSchema } from '../services/schemas.service';
import { defaultViewSchema, schemasForKind } from './schemaPick';

const sch = (name: string, kind?: 'tables' | 'views' | null): DbSchema =>
  ({ id: name, name, kind: kind ?? null });

const CATALOG: DbSchema[] = [
  sch('VENTAS', 'tables'),
  sch('RIESGOS', 'tables'),
  sch('VENTAS_VU', 'views'),
  sch('LEGACY_X', null),          // sin clasificar (pre-backfill)
];

describe('schemasForKind (doc 52 §3)', () => {
  it('tables: esquemas de tablas + sin clasificar; NUNCA los de vistas', () => {
    expect(schemasForKind(CATALOG, 'tables').map((s) => s.name))
      .toEqual(['VENTAS', 'RIESGOS', 'LEGACY_X']);
  });
  it('views: esquemas de vistas + sin clasificar; NUNCA los de tablas', () => {
    expect(schemasForKind(CATALOG, 'views').map((s) => s.name))
      .toEqual(['VENTAS_VU', 'LEGACY_X']);
  });
  it('all: catálogo completo tal cual', () => {
    expect(schemasForKind(CATALOG, 'all')).toEqual(CATALOG);
  });
});

describe('defaultViewSchema (doc 52 §4 — convención _VU)', () => {
  it('encuentra <esquema>_VU case-insensitive y devuelve el nombre EXACTO', () => {
    expect(defaultViewSchema('VENTAS', CATALOG)).toBe('VENTAS_VU');
    expect(defaultViewSchema('ventas', CATALOG)).toBe('VENTAS_VU');
    expect(defaultViewSchema('  VENTAS  ', CATALOG)).toBe('VENTAS_VU');
  });
  it('sin match o sin esquema de tabla → null (el caller conserva su fallback)', () => {
    expect(defaultViewSchema('RIESGOS', CATALOG)).toBeNull();
    expect(defaultViewSchema('', CATALOG)).toBeNull();
    expect(defaultViewSchema(undefined, CATALOG)).toBeNull();
  });
  it('un esquema homónimo clasificado como TABLES no cuenta como match', () => {
    const catalog = [sch('VENTAS_VU', 'tables')];
    expect(defaultViewSchema('VENTAS', catalog)).toBeNull();
  });
  it('sin clasificar SÍ cuenta (BD pre-backfill)', () => {
    const catalog = [sch('ventas_vu', null)];
    expect(defaultViewSchema('VENTAS', catalog)).toBe('ventas_vu');
  });
});
