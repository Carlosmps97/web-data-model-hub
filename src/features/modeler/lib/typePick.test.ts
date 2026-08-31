// Lógica pura del selector de tipos (doc 41): búsqueda "contiene" sin
// distinción de mayúsculas (pedido 2026-08-30 — reemplaza al "empieza por"
// original), catálogo alfabético en MAYÚSCULAS (convención del DDV) y tipos
// parametrizados — DECIMAL(p,s), VARCHAR(n), … — editados por argumentos
// puntuales en vez de texto libre (pedido de los modeladores: el texto libre
// era fuente de errores).
import { describe, it, expect } from 'vitest';
import { TYPE_OPTIONS, argSpecFor, composeParamType, parseParamType, containsCI } from './typePick';

describe('containsCI (búsqueda contiene, case-insensitive)', () => {
  it('matchea por substring sin importar mayúsculas ni posición', () => {
    expect(containsCI('DECIMAL', 'dec')).toBe(true);
    expect(containsCI('decimal', 'DEC')).toBe(true);
    expect(containsCI('TIMESTAMPTZ', 'stamp')).toBe(true);
    expect(containsCI('Monto Deuda', 'deuda')).toBe(true);
    expect(containsCI('Fecha Contable', 'conta')).toBe(true);
  });

  it('NO matchea lo que no aparece en el texto', () => {
    expect(containsCI('TIMESTAMPTZ', 'fecha')).toBe(false);
    expect(containsCI('Monto Deuda', 'usd')).toBe(false);
  });

  it('query vacía o con espacios alrededor', () => {
    expect(containsCI('BIGINT', '')).toBe(true);
    expect(containsCI('BIGINT', '  big')).toBe(true);
    expect(containsCI('BIGINT', ' gin ')).toBe(true);
  });
});

describe('TYPE_OPTIONS (catálogo del combobox)', () => {
  it('está en MAYÚSCULAS y orden alfabético', () => {
    expect(TYPE_OPTIONS.every((t) => t === t.toUpperCase())).toBe(true);
    expect([...TYPE_OPTIONS].sort()).toEqual(TYPE_OPTIONS);
  });

  it('incluye los complejos (ya no van como botones aparte)', () => {
    for (const t of ['STRUCT', 'ARRAY', 'MAP']) expect(TYPE_OPTIONS).toContain(t);
  });

  it('cubre el catálogo canónico completo', () => {
    expect(TYPE_OPTIONS).toContain('DECIMAL');
    expect(TYPE_OPTIONS).toContain('VARCHAR');
    expect(TYPE_OPTIONS.length).toBeGreaterThanOrEqual(30);
  });
});

describe('argSpecFor (tipos con argumentos)', () => {
  it('DECIMAL/NUMERIC llevan precision y scale', () => {
    expect(argSpecFor('DECIMAL')).toEqual(['precision', 'scale']);
    expect(argSpecFor('numeric')).toEqual(['precision', 'scale']);
  });

  it('VARCHAR/CHAR/NVARCHAR/VARBINARY llevan length', () => {
    for (const t of ['VARCHAR', 'CHAR', 'NVARCHAR', 'VARBINARY']) {
      expect(argSpecFor(t)).toEqual(['length']);
    }
  });

  it('los simples no llevan argumentos', () => {
    expect(argSpecFor('BIGINT')).toBeNull();
    expect(argSpecFor('STRING')).toBeNull();
  });
});

describe('parseParamType', () => {
  it('separa base y argumentos, tolerante a espacios y minúsculas', () => {
    expect(parseParamType('DECIMAL(18,2)')).toEqual({ base: 'DECIMAL', args: ['18', '2'] });
    expect(parseParamType('decimal ( 18 , 2 )')).toEqual({ base: 'DECIMAL', args: ['18', '2'] });
    expect(parseParamType('varchar(100)')).toEqual({ base: 'VARCHAR', args: ['100'] });
  });

  it('base conocida sin argumentos', () => {
    expect(parseParamType('DECIMAL')).toEqual({ base: 'DECIMAL', args: [] });
    expect(parseParamType('bigint')).toEqual({ base: 'BIGINT', args: [] });
  });

  it('null para complejos, desconocidos y vacío (se muestran tal cual)', () => {
    expect(parseParamType('STRUCT<a:INT>')).toBeNull();
    expect(parseParamType('GEOGRAPHY')).toBeNull();
    expect(parseParamType('')).toBeNull();
  });
});

describe('composeParamType', () => {
  it('arma el tipo con los argumentos no vacíos (prefijo)', () => {
    expect(composeParamType('DECIMAL', ['18', '2'])).toBe('DECIMAL(18,2)');
    expect(composeParamType('DECIMAL', ['18', ''])).toBe('DECIMAL(18)');
    expect(composeParamType('DECIMAL', ['', '2'])).toBe('DECIMAL');
    expect(composeParamType('VARCHAR', ['100'])).toBe('VARCHAR(100)');
  });

  it('sin argumentos queda el base solo', () => {
    expect(composeParamType('DECIMAL', [])).toBe('DECIMAL');
    expect(composeParamType('BIGINT', [])).toBe('BIGINT');
  });

  it('round-trip estable con parse', () => {
    for (const v of ['DECIMAL(18,2)', 'VARCHAR(100)', 'DECIMAL', 'CHAR(1)']) {
      const p = parseParamType(v);
      expect(p && composeParamType(p.base, p.args)).toBe(v);
    }
  });
});
