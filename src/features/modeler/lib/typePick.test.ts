// Lógica pura del selector de tipos: búsqueda "contiene" sin distinción de
// mayúsculas, catálogo alfabético en mayúsculas (convención de los modelos) y
// tipos parametrizados — DECIMAL(p,s), VARCHAR(n), … — editados por argumentos
// puntuales en vez de texto libre (el texto libre es fuente de errores).
import { describe, it, expect } from 'vitest';
import { TYPE_OPTIONS, argSpecFor, canonicalDefaultType, composeParamType, isTypeArg, parseParamType, containsCI } from './typePick';

describe('containsCI (búsqueda contiene, case-insensitive)', () => {
  it('matchea por substring sin importar mayúsculas ni posición', () => {
    expect(containsCI('DECIMAL', 'dec')).toBe(true);
    expect(containsCI('decimal', 'DEC')).toBe(true);
    expect(containsCI('TIMESTAMPTZ', 'stamp')).toBe(true);
    expect(containsCI('Monto Deuda', 'deuda')).toBe(true);
    expect(containsCI('Fecha Contable', 'conta')).toBe(true);
  });

  it('no matchea lo que no aparece en el texto', () => {
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
  it('está en mayúsculas y orden alfabético', () => {
    expect(TYPE_OPTIONS.every((t) => t === t.toUpperCase())).toBe(true);
    expect([...TYPE_OPTIONS].sort()).toEqual(TYPE_OPTIONS);
  });

  it('incluye los complejos (no van como botones aparte)', () => {
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
    expect(parseParamType('SDO_GEOMETRY')).toBeNull();
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

describe('VARIANT + tipos Oracle de la data real', () => {
  it('el catálogo incluye VARIANT (JSON libre), NUMBER y VARCHAR2', () => {
    for (const t of ['VARIANT', 'NUMBER', 'VARCHAR2']) expect(TYPE_OPTIONS).toContain(t);
  });

  it('NUMBER lleva precision/scale y VARCHAR2 lleva length', () => {
    expect(argSpecFor('NUMBER')).toEqual(['precision', 'scale']);
    expect(argSpecFor('number')).toEqual(['precision', 'scale']);
    expect(argSpecFor('VARCHAR2')).toEqual(['length']);
  });

  it('parsea los defaults reales de los parent domains', () => {
    expect(parseParamType('NUMBER(22,3)')).toEqual({ base: 'NUMBER', args: ['22', '3'] });
    expect(parseParamType('VARCHAR2(10)')).toEqual({ base: 'VARCHAR2', args: ['10'] });
    expect(parseParamType('VARIANT')).toEqual({ base: 'VARIANT', args: [] });
  });

  it('VARIANT no lleva argumentos', () => {
    expect(argSpecFor('VARIANT')).toBeNull();
  });
});

describe('catálogo de Databricks SQL / Hive, Oracle y SQL Server', () => {
  it('el combobox ofrece los tipos de los cuatro motores, sin repetidos', () => {
    const nuevos = [
      'INT', 'TIMESTAMP_NTZ', 'DOUBLE PRECISION', 'GEOGRAPHY', 'GEOMETRY',
      'NVARCHAR2', 'NCHAR', 'BINARY_FLOAT', 'BINARY_DOUBLE', 'LONG', 'LONG RAW', 'RAW', 'ROWID', 'UROWID',
      'CLOB', 'NCLOB', 'BFILE', 'XMLTYPE', 'VECTOR', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE',
      'INTERVAL YEAR TO MONTH', 'INTERVAL DAY TO SECOND',
      'BIT', 'SMALLMONEY', 'DATETIME2', 'DATETIMEOFFSET', 'SMALLDATETIME', 'NTEXT', 'IMAGE',
      'UNIQUEIDENTIFIER', 'SQL_VARIANT', 'HIERARCHYID', 'ROWVERSION',
    ];
    for (const t of nuevos) expect(TYPE_OPTIONS).toContain(t);
    expect(new Set(TYPE_OPTIONS).size).toBe(TYPE_OPTIONS.length);
  });

  it('argumentos de los tipos de Oracle, SQL Server y Databricks (todos opcionales)', () => {
    for (const t of ['NVARCHAR2', 'NCHAR', 'RAW', 'UROWID', 'BINARY']) expect(argSpecFor(t)).toEqual(['length']);
    for (const t of ['FLOAT', 'TIMESTAMP', 'TIME', 'DATETIME2', 'DATETIMEOFFSET']) expect(argSpecFor(t)).toEqual(['precision']);
    expect(argSpecFor('VECTOR')).toEqual(['dimensions', 'format']);
    expect(argSpecFor('GEOMETRY')).toEqual(['srid']);
    expect(argSpecFor('TIMESTAMP WITH TIME ZONE')).toBeNull();   // varias palabras: sin argumentos
  });

  it('parsea los tipos de varias palabras como una base del catálogo', () => {
    expect(parseParamType('timestamp  with time zone')).toEqual({ base: 'TIMESTAMP WITH TIME ZONE', args: [] });
    expect(parseParamType('Long Raw')).toEqual({ base: 'LONG RAW', args: [] });
    expect(parseParamType('TIMESTAMP WITH')).toBeNull();
  });

  it('los argumentos aceptan texto: MAX, 30 CHAR, *, -2', () => {
    expect(parseParamType('VARCHAR(MAX)')).toEqual({ base: 'VARCHAR', args: ['MAX'] });
    expect(composeParamType('VARCHAR', ['max'])).toBe('VARCHAR(MAX)');
    expect(composeParamType('VARCHAR2', ['30  char'])).toBe('VARCHAR2(30 CHAR)');
    expect(composeParamType('NUMBER', ['*', '-2'])).toBe('NUMBER(*,-2)');
  });

  it('isTypeArg: un número o una palabra, con una unidad opcional (espejo de `_ARG_RE` del back)', () => {
    for (const ok of ['MAX', 'max', '30', ' 30  char ', '30 BYTE', '*', '-2', 'FLOAT32']) expect(isTypeArg(ok)).toBe(true);
    for (const bad of ['', '-', '--', '18,2', '10.5', '30 CHAR BYTE', '1)', '30 *', "'x'", '1;2', '18 2', '1 0', 'ſ', 'ß']) expect(isTypeArg(bad)).toBe(false);
  });

  it('composeParamType: solo viaja el prefijo de argumentos válidos', () => {
    expect(composeParamType('DECIMAL', ['--'])).toBe('DECIMAL');
    expect(composeParamType('DECIMAL', ['18,2'])).toBe('DECIMAL');
    expect(composeParamType('NUMBER', ['10', '-'])).toBe('NUMBER(10)');
    expect(composeParamType('VARCHAR2', ['30 CHAR BYTE'])).toBe('VARCHAR2');
    expect(composeParamType('VARCHAR', ['10', '2'])).toBe('VARCHAR(10)');   // no más argumentos que los del tipo
  });

  it('parseParamType usa la misma gramática que el back: cantidad y contenido de los argumentos', () => {
    for (const bad of ['INT(11)', 'VARCHAR(1,2)', 'DECIMAL(10.5)', 'DECIMAL()', 'DECIMAL(,2)', 'TIMESTAMP WITH TIME ZONE(6)']) {
      expect(parseParamType(bad)).toBeNull();
    }
    expect(canonicalDefaultType('int(11)')).toBe('int(11)');                 // como el back: verbatim
  });

  it('INT y DOUBLE PRECISION quedan tal cual; VARCHAR(MAX) se homologa a mayúscula', () => {
    expect(canonicalDefaultType('int')).toBe('INT');
    expect(canonicalDefaultType('double precision')).toBe('DOUBLE PRECISION');
    expect(canonicalDefaultType('varchar(max)')).toBe('VARCHAR(MAX)');
    expect(canonicalDefaultType('Timestamp With Time Zone')).toBe('TIMESTAMP WITH TIME ZONE');
  });
});
