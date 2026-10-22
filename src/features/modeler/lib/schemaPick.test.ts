import { describe, expect, it } from 'vitest';
import type { DbSchema } from '../services/schemas.service';
import { defaultViewSchema, schemasForKind, viewSchemaOnCreate } from './schemaPick';

const sch = (name: string, kind?: 'tables' | 'views' | 'both' | null): DbSchema =>
  ({ id: name, name, kind: kind ?? null });

const CATALOG: DbSchema[] = [
  sch('VENTAS', 'tables'),
  sch('RIESGOS', 'tables'),
  sch('VENTAS_VU', 'views'),
  sch('LEGACY_X', null),          // sin clasificar (`kind` null)
  sch('MIXTO', 'both'),           // contiene tablas y vistas
];

describe('schemasForKind', () => {
  it('tables: esquemas de tablas, los de ambos y sin clasificar; nunca los de vistas', () => {
    expect(schemasForKind(CATALOG, 'tables').map((s) => s.name))
      .toEqual(['VENTAS', 'RIESGOS', 'LEGACY_X', 'MIXTO']);
  });
  it('views: esquemas de vistas, los de ambos y sin clasificar; nunca los de tablas', () => {
    expect(schemasForKind(CATALOG, 'views').map((s) => s.name))
      .toEqual(['VENTAS_VU', 'LEGACY_X', 'MIXTO']);
  });
  it('all: catálogo completo tal cual', () => {
    expect(schemasForKind(CATALOG, 'all')).toEqual(CATALOG);
  });
});

describe('defaultViewSchema (convención _VU)', () => {
  it('encuentra <esquema>_VU case-insensitive y devuelve el nombre exacto', () => {
    expect(defaultViewSchema('VENTAS', CATALOG)).toBe('VENTAS_VU');
    expect(defaultViewSchema('ventas', CATALOG)).toBe('VENTAS_VU');
    expect(defaultViewSchema('  VENTAS  ', CATALOG)).toBe('VENTAS_VU');
  });
  it('sin match o sin esquema de tabla → null (el caller conserva su fallback)', () => {
    expect(defaultViewSchema('RIESGOS', CATALOG)).toBeNull();
    expect(defaultViewSchema('', CATALOG)).toBeNull();
    expect(defaultViewSchema(undefined, CATALOG)).toBeNull();
  });
  it('un esquema homónimo clasificado como `tables` no cuenta como match', () => {
    const catalog = [sch('VENTAS_VU', 'tables')];
    expect(defaultViewSchema('VENTAS', catalog)).toBeNull();
  });
  it('sin clasificar sí cuenta (`kind` null)', () => {
    const catalog = [sch('ventas_vu', null)];
    expect(defaultViewSchema('VENTAS', catalog)).toBe('ventas_vu');
  });
  it('un _VU que contiene tablas y vistas (both) sí cuenta', () => {
    const catalog = [sch('core_ventas_vu', 'both')];
    expect(defaultViewSchema('core_ventas', catalog)).toBe('core_ventas_vu');
    expect(viewSchemaOnCreate('core_ventas', catalog)).toEqual({ schema: 'core_ventas_vu', suggest: null });
  });
});

describe('viewSchemaOnCreate (sin _VU el campo queda vacío)', () => {
  it('pre-selecciona <esquema>_VU cuando existe (grafía exacta del catálogo)', () => {
    expect(viewSchemaOnCreate('VENTAS', CATALOG)).toEqual({ schema: 'VENTAS_VU', suggest: null });
    expect(viewSchemaOnCreate('ventas', CATALOG)).toEqual({ schema: 'VENTAS_VU', suggest: null });
  });

  it('sin _VU deja el campo vacío y sugiere el nombre a crear (no cae al esquema de la tabla)', () => {
    expect(viewSchemaOnCreate('LEGACY_X', CATALOG)).toEqual({ schema: '', suggest: 'LEGACY_X_VU' });
  });

  it('un esquema _VU catalogado como de tablas no sirve: sugiere crearlo', () => {
    expect(viewSchemaOnCreate('VENTAS', [sch('VENTAS_VU', 'tables')]))
      .toEqual({ schema: '', suggest: 'VENTAS_VU' });
  });

  it('sin tabla fuente no hay nada que sugerir', () => {
    expect(viewSchemaOnCreate('', CATALOG)).toEqual({ schema: '', suggest: null });
    expect(viewSchemaOnCreate(null, CATALOG)).toEqual({ schema: '', suggest: null });
    expect(viewSchemaOnCreate(undefined, CATALOG)).toEqual({ schema: '', suggest: null });
  });
});
