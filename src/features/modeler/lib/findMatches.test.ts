// Doc 64 §5 — matcheo puro del buscador "Locate & center" del toolbar.
import { describe, expect, it } from 'vitest';
import { findMatches } from './findMatches';

const TABLES = [
  { id: 't1', logicalName: 'Cliente', physicalName: 'M_CLIENTE' },
  { id: 't2', logicalName: 'Cuenta corriente', physicalName: 'M_CUENTA' },
  { id: 't3', logicalName: 'Producto', physicalName: 'M_PRODUCTO' },
];
const VIEWS = [
  { id: 'v1', name: 'VU_CLIENTE_ACTIVO' },
];

describe('findMatches (doc 64 §5)', () => {
  it('query vacía o solo espacios ⇒ sin coincidencias', () => {
    expect(findMatches('', TABLES, VIEWS)).toEqual([]);
    expect(findMatches('   ', TABLES, VIEWS)).toEqual([]);
  });

  it('matchea "contiene" CI por lógico Y físico, tablas primero', () => {
    const out = findMatches('cliente', TABLES, VIEWS);
    expect(out.map((m) => m.id)).toEqual(['t1', 'v1']);
    expect(out[0]).toEqual({ id: 't1', kind: 'table', primary: 'Cliente', secondary: 'M_CLIENTE' });
    expect(out[1].kind).toBe('view');
  });

  it('el físico también matchea (contiene, no empieza-por)', () => {
    expect(findMatches('cuenta', TABLES, VIEWS).map((m) => m.id)).toEqual(['t2']);
    expect(findMatches('_CUE', TABLES, VIEWS).map((m) => m.id)).toEqual(['t2']);
  });

  it('devuelve TODAS las coincidencias (sin tope — el dropdown corta aparte)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `x${i}`, logicalName: `Tabla ${i}`, physicalName: `T_${i}`,
    }));
    expect(findMatches('tabla', many, [])).toHaveLength(20);
  });
});
