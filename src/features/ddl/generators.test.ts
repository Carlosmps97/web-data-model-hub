import { describe, expect, it } from 'vitest';
import { databricksDdl, viewDDL, inferJoin, DEFAULT_DATABRICKS_OPTS as DEF, type DatabricksDdlInput, type DdlTable, type DdlView } from './generators';

const BASE = {
  tables: [{ id: 't1', physicalName: 'CLIENTE', schema: 'core' }],
  columns: [
    { id: 'c1', tableId: 't1', physicalName: 'ID', dataType: 'bigint', ordinal: 0, isPrimaryKey: true },
    { id: 'c2', tableId: 't1', physicalName: 'NOMBRE', dataType: 'string', ordinal: 1 },
  ],
  relationships: [],
  modelName: 'm',
};
const withView = (v: DdlView): DatabricksDdlInput => ({ ...BASE, views: [v] });

describe('databricksDdl — vistas (editor 07b-2)', () => {
  it('NO emite vistas cuando includeViews=false', () => {
    expect(databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_c', schema: 'core' }), { ...DEF, includeViews: false })).not.toContain('VIEW');
  });

  it('SELECT * (fallback) solo cuando la vista NO tiene proyección (legacy) + WHERE', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_cliente', schema: 'core', filter: "estado = 'A'" }), { ...DEF, includeViews: true });
    expect(ddl).toContain('CREATE OR REPLACE VIEW `core`.`v_cliente`');
    expect(ddl).toContain('SELECT *');
    expect(ddl).toContain('FROM `core`.`CLIENTE`');
    expect(ddl).toContain("WHERE estado = 'A'");
  });

  it('con TODAS las columnas como sources => las LISTA explícitas (ya no SELECT *)', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_all', schema: 'core', sources: [{ column: 'ID' }, { column: 'NOMBRE' }] }), { ...DEF, includeViews: true });
    expect(ddl).not.toContain('SELECT *');
    expect(ddl).toMatch(/SELECT\n\s+ID,\n\s+NOMBRE\nFROM/);
  });

  it('columnas EXPLÍCITAS (una por línea) cuando es un subconjunto', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_sub', schema: 'core', sources: [{ column: 'ID' }] }), { ...DEF, includeViews: true });
    expect(ddl).toMatch(/SELECT\n\s+ID\nFROM/);
    expect(ddl).not.toContain('SELECT *');
  });

  it('columnas EXPLÍCITAS con rename y expresión', () => {
    const ddl = databricksDdl(withView({
      id: 'v', tableId: 't1', name: 'v_x', schema: 'core',
      sources: [{ column: 'ID', outputAlias: 'cuenta_id' }, { column: 'NOMBRE', expression: 'UPPER(NOMBRE)' }],
    }), { ...DEF, includeViews: true });
    expect(ddl).toContain('ID AS cuenta_id');
    expect(ddl).toContain('UPPER(NOMBRE)');
    expect(ddl).not.toContain('SELECT *');
  });

  it('honra Unity Catalog en el nombre de la vista', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_cliente', schema: 'core' }), { ...DEF, includeViews: true, unityCatalog: true, catalog: 'main' });
    expect(ddl).toContain('CREATE OR REPLACE VIEW `main`.`core`.`v_cliente`');
  });

  it('solo emite vistas de tablas dentro del set exportado', () => {
    const ddl = databricksDdl({ ...withView({ id: 'v', tableId: 't1', name: 'v_cliente', schema: 'core' }), tableIds: ['otra'] }, { ...DEF, includeViews: true });
    expect(ddl).not.toContain('v_cliente');
  });
});

describe('inferJoin — condición de JOIN inferida (F3, spec §3-5 D2)', () => {
  const COLS = [
    { id: 'c1', tableId: 't1', physicalName: 'ID', dataType: 'bigint', ordinal: 0 },
    { id: 'c2', tableId: 't2', physicalName: 'CLIENTE_ID', dataType: 'bigint', ordinal: 0 },
    { id: 'c3', tableId: 't2', physicalName: 'ID', dataType: 'bigint', ordinal: 1 },
    { id: 'c4', tableId: 't3', physicalName: 'CUENTA_ID', dataType: 'bigint', ordinal: 0 },
  ];
  const R = (id: string, pT: string, pC: string, cT: string, cC: string) =>
    ({ id, parentTableId: pT, childTableId: cT, pairs: [{ parentColumnId: pC, childColumnId: cC }] });

  it('2 fuentes con FK hija→padre: fuente ANTERIOR primero (t1.pk = t2.fk)', () => {
    expect(inferJoin(['t1', 't2'], [R('r1', 't1', 'c1', 't2', 'c2')], COLS))
      .toBe('t1.ID = t2.CLIENTE_ID');
  });

  it('orientación de la relación indistinta (padre/hijo invertidos, mismo resultado)', () => {
    expect(inferJoin(['t1', 't2'], [R('r1', 't2', 'c2', 't1', 'c1')], COLS))
      .toBe('t1.ID = t2.CLIENTE_ID');
  });

  it('3 fuentes encadenadas: condiciones unidas con AND', () => {
    const rels = [R('r1', 't1', 'c1', 't2', 'c2'), R('r2', 't2', 'c3', 't3', 'c4')];
    expect(inferJoin(['t1', 't2', 't3'], rels, COLS))
      .toBe('t1.ID = t2.CLIENTE_ID AND t2.ID = t3.CUENTA_ID');
  });

  it('sin relación entre las fuentes ⇒ cadena vacía (el editor exige joinOverride)', () => {
    expect(inferJoin(['t1', 't3'], [R('r1', 't1', 'c1', 't2', 'c2')], COLS)).toBe('');
  });

  it('menos de 2 fuentes ⇒ cadena vacía', () => {
    expect(inferJoin(['t1'], [], COLS)).toBe('');
    expect(inferJoin([], [], COLS)).toBe('');
  });

  it('ids de columna desconocidos degradan al id crudo (no revienta)', () => {
    expect(inferJoin(['t1', 't2'], [R('r1', 't1', 'cy', 't2', 'cx')], COLS))
      .toBe('t1.cy = t2.cx');
  });
});

describe('viewDDL / databricksDdl — vistas multi-fuente (F3, spec §3-5)', () => {
  const TWO: DatabricksDdlInput = {
    tables: [
      { id: 't1', physicalName: 'CLIENTE', schema: 'core' },
      { id: 't2', physicalName: 'CUENTA', schema: 'core' },
    ],
    columns: [
      { id: 'c1', tableId: 't1', physicalName: 'ID', dataType: 'bigint', ordinal: 0, isPrimaryKey: true },
      { id: 'c2', tableId: 't2', physicalName: 'CLIENTE_ID', dataType: 'bigint', ordinal: 0 },
      { id: 'c3', tableId: 't2', physicalName: 'SALDO', dataType: 'decimal', ordinal: 1 },
    ],
    relationships: [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [{ parentColumnId: 'c1', childColumnId: 'c2' }] }],
    modelName: 'm',
  };
  const V: DdlView = {
    id: 'v', tableId: 't1', name: 'v_cliente_cuenta', schema: 'core',
    sourceTableIds: ['t1', 't2'],
    sources: [
      { column: 'ID', tableId: 't1' },
      { column: 'SALDO', tableId: 't2', castType: 'STRING', outputAlias: 'saldo_txt' },
    ],
  };

  it('FROM primera fuente t1 + INNER JOIN resto ON inferido de relationships', () => {
    const ddl = databricksDdl({ ...TWO, views: [V] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('FROM `core`.`CLIENTE` t1');
    expect(ddl).toContain('INNER JOIN `core`.`CUENTA` t2');
    expect(ddl).toContain('ON t1.ID = t2.CLIENTE_ID');
  });

  it('columnas cualificadas con alias posicional + CAST(col AS tipo) AS alias', () => {
    const ddl = databricksDdl({ ...TWO, views: [V] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('t1.ID');
    expect(ddl).toContain('CAST(t2.SALDO AS STRING) AS saldo_txt');
  });

  it('joinOverride gana sobre la condición inferida y se emite VERBATIM', () => {
    const ddl = databricksDdl(
      { ...TWO, views: [{ ...V, joinOverride: 't1.ID = t2.CLIENTE_ID AND t2.SALDO > 0' }] },
      { ...DEF, includeViews: true },
    );
    expect(ddl).toContain('ON t1.ID = t2.CLIENTE_ID AND t2.SALDO > 0');
  });

  it('sin relación ni joinOverride ⇒ fallback explícito 1 = 1 comentado', () => {
    const ddl = databricksDdl({ ...TWO, relationships: [], views: [V] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('ON 1 = 1 /* no modeled relationship between the sources */');
  });

  it('UNA fuente: sin alias ni cualificación (regresión legacy); CAST sin alias conserva el nombre', () => {
    const one: DdlView = {
      id: 'v1', tableId: 't1', name: 'v_c', schema: 'core', sourceTableIds: ['t1'],
      sources: [{ column: 'ID', tableId: 't1', castType: 'STRING' }],
    };
    const ddl = databricksDdl({ ...TWO, views: [one] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('CAST(ID AS STRING) AS ID');
    expect(ddl).not.toContain('t1.ID');
  });

  it('la vista entra al export si ALGUNA fuente está en el set exportado', () => {
    const ddl = databricksDdl({ ...TWO, views: [V], tableIds: ['t2'] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('v_cliente_cuenta');
  });

  it('fuente FUERA del contexto (tabla desconocida): id backtickeado visible', () => {
    const v: DdlView = { ...V, sourceTableIds: ['t1', 'tx'], sources: [{ column: 'ID', tableId: 't1' }] };
    const ddl = databricksDdl({ ...TWO, views: [v] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('INNER JOIN `tx` t2');
  });

  it('expression se emite VERBATIM también con 2+ fuentes (sin cualificar)', () => {
    const v: DdlView = {
      ...V,
      sources: [
        { column: 'ID', tableId: 't1' },
        { column: 'SALDO', tableId: 't2', expression: 'ROUND(t2.SALDO, 2)', outputAlias: 'saldo_r' },
      ],
    };
    const ddl = databricksDdl({ ...TWO, views: [v] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('ROUND(t2.SALDO, 2) AS saldo_r');
  });

  it('descarta una fuente con expression en blanco (A4: no emite `t1.undefined`)', () => {
    const v: DdlView = {
      ...V,
      sources: [
        { column: 'ID', tableId: 't1' },
        { expression: '   ' }, // solo espacios ⇒ se trata como ausente, no como proyección
      ],
    };
    const ddl = databricksDdl({ ...TWO, views: [v] }, { ...DEF, includeViews: true });
    expect(ddl).not.toContain('undefined');
    expect(ddl).toContain('t1.ID'); // la fuente válida sobrevive
  });
});

describe('databricksDdl — identifierCase (switch triple de casing, F4 #7)', () => {
  const CASED: DatabricksDdlInput = {
    tables: [
      { id: 't1', physicalName: 'Cliente', schema: 'Core', description: 'Maestro de Clientes' },
      { id: 't2', physicalName: 'Cuenta', schema: 'Core' },
    ],
    columns: [
      { id: 'c1', tableId: 't1', physicalName: 'Id', dataType: 'bigint', ordinal: 0, isPrimaryKey: true, description: 'Id del Cliente' },
      { id: 'c2', tableId: 't2', physicalName: 'ClienteId', dataType: 'bigint', ordinal: 0, isForeignKey: true },
    ],
    relationships: [
      { id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [{ parentColumnId: 'c1', childColumnId: 'c2' }] },
    ],
    modelName: 'm',
  };

  it("default 'as-is': identificadores tal cual están en el modelo", () => {
    const ddl = databricksDdl(CASED, DEF);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `Core`.`Cliente`');
    expect(ddl).toContain('`Id` BIGINT');
    expect(ddl).toContain('CONSTRAINT `pk_Cliente` PRIMARY KEY (`Id`)');
  });

  it("'upper': schema/tabla/columna y nombres de constraint en MAYÚSCULAS", () => {
    const ddl = databricksDdl(CASED, { ...DEF, identifierCase: 'upper' });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `CORE`.`CLIENTE`');
    expect(ddl).toContain('`ID` BIGINT');
    expect(ddl).toContain('CONSTRAINT `PK_CLIENTE` PRIMARY KEY (`ID`)');
    expect(ddl).toContain(
      'CONSTRAINT `FK_CUENTA_CLIENTEID` FOREIGN KEY (`CLIENTEID`) REFERENCES `CORE`.`CLIENTE`(`ID`)',
    );
    expect(ddl).not.toContain('`Cliente`');
  });

  it("'lower': todo identificador en minúsculas", () => {
    const ddl = databricksDdl(CASED, { ...DEF, identifierCase: 'lower' });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `core`.`cliente`');
    expect(ddl).toContain('CONSTRAINT `pk_cliente` PRIMARY KEY (`id`)');
    expect(ddl).not.toContain('`Cliente`');
  });

  it("'upper' NO toca literales de string ni COMMENTs", () => {
    const ddl = databricksDdl(CASED, { ...DEF, identifierCase: 'upper' });
    expect(ddl).toContain("COMMENT 'Maestro de Clientes'");
    expect(ddl).toContain("COMMENT 'Id del Cliente'");
  });

  it("'lower' NO toca tipos de datos ni el path de LOCATION", () => {
    const input: DatabricksDdlInput = {
      ...CASED,
      columns: [{ id: 'c1', tableId: 't1', physicalName: 'Monto', dataType: 'decimal(10,2)', ordinal: 0 }],
      relationships: [],
    };
    const ddl = databricksDdl(input, {
      ...DEF, identifierCase: 'lower', external: true, location: 's3://Bucket/Warehouse',
    });
    // dbxType decide el casing del tipo, no el switch:
    expect(ddl).toContain('`monto` DECIMAL(10,2)');
    // LOCATION es un literal (path físico): queda intacto, incluido el physicalName:
    expect(ddl).toContain("LOCATION 's3://Bucket/Warehouse/Cliente'");
  });
});

describe('databricksDdl — identifierCase sobre vistas multi-fuente (F3b + F4 #7)', () => {
  const MULTI: DatabricksDdlInput = {
    tables: [
      { id: 't1', physicalName: 'Cliente', schema: 'Core' },
      { id: 't2', physicalName: 'Cuenta', schema: 'Core' },
    ],
    columns: [
      { id: 'c1', tableId: 't1', physicalName: 'Id', dataType: 'bigint', ordinal: 0, isPrimaryKey: true },
      { id: 'c2', tableId: 't2', physicalName: 'ClienteId', dataType: 'bigint', ordinal: 0, isForeignKey: true },
      { id: 'c3', tableId: 't2', physicalName: 'Saldo', dataType: 'decimal', ordinal: 1 },
    ],
    relationships: [
      { id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [{ parentColumnId: 'c1', childColumnId: 'c2' }] },
    ],
    modelName: 'm',
    views: [{
      id: 'v', tableId: 't1', name: 'v_cliente_cuenta', schema: 'Core',
      sourceTableIds: ['t1', 't2'],
      sources: [
        { column: 'Id', tableId: 't1' },
        { column: 'ClienteId', tableId: 't2', outputAlias: 'cuenta_id' },
      ],
    }],
  };
  /** Sección de vistas del DDL (desde el primer CREATE VIEW), para no matchear
   *  contra los CREATE TABLE de arriba. */
  const viewPart = (ddl: string) => ddl.slice(ddl.indexOf('CREATE OR REPLACE VIEW'));

  it("'upper' casea nombre de vista y tablas del FROM/JOIN; alias generados t1/t2 quedan tal cual", () => {
    const vp = viewPart(databricksDdl(MULTI, { ...DEF, includeViews: true, identifierCase: 'upper' }));
    expect(vp).toContain('CREATE OR REPLACE VIEW `CORE`.`V_CLIENTE_CUENTA`');
    expect(vp).toContain('`CORE`.`CLIENTE`');
    expect(vp).toContain('`CORE`.`CUENTA`');
    expect(vp).toMatch(/\bt1\b/);      // alias generado: minúscula intacta
    expect(vp).not.toMatch(/\bT1\b/);
    expect(vp).toMatch(/\bt2\b/);
    expect(vp).not.toMatch(/\bT2\b/);
  });

  it('joinOverride se emite VERBATIM (sin casing)', () => {
    const input: DatabricksDdlInput = {
      ...MULTI,
      views: [{ ...MULTI.views![0], joinOverride: 't1.Id = t2.ClienteId' }],
    };
    const vp = viewPart(databricksDdl(input, { ...DEF, includeViews: true, identifierCase: 'upper' }));
    expect(vp).toContain('t1.Id = t2.ClienteId');
  });

  it('expresiones de vista se emiten VERBATIM (sin casing)', () => {
    const v: DdlView = {
      id: 'v', tableId: 't1', name: 'v_x', schema: 'Core', sourceTableIds: ['t1'],
      sources: [
        { column: 'Id', tableId: 't1' },
        { column: 'Id', tableId: 't1', expression: 'UPPER(Nombre)', outputAlias: 'nombre_up' },
      ],
    };
    const vp = viewPart(databricksDdl({ ...MULTI, views: [v] }, { ...DEF, includeViews: true, identifierCase: 'lower' }));
    expect(vp).toContain('UPPER(Nombre)');
  });

  it('castType NO se casea (es un tipo de dato, no un identificador)', () => {
    const v: DdlView = {
      id: 'v', tableId: 't1', name: 'v_cast', schema: 'Core', sourceTableIds: ['t1'],
      sources: [{ column: 'Id', tableId: 't1', castType: 'DECIMAL(10,2)', outputAlias: 'id_dec' }],
    };
    const vp = viewPart(databricksDdl({ ...MULTI, views: [v] }, { ...DEF, includeViews: true, identifierCase: 'lower' }));
    expect(vp).toContain('DECIMAL(10,2)');
  });

  // ── Criterio obligatorio #2 (controller): 2 fuentes bajo 'upper' — un solo
  //    caso que congela TODAS las reglas verbatim junto al casing del FROM/JOIN.
  it("2 fuentes bajo 'upper': FROM/JOIN caseados; alias/joinOverride/expression/castType VERBATIM", () => {
    const v: DdlView = {
      id: 'v', tableId: 't1', name: 'v_multi', schema: 'Core',
      sourceTableIds: ['t1', 't2'],
      joinOverride: 't1.Id = t2.ClienteId',
      sources: [
        { column: 'Id', tableId: 't1' },
        { column: 'Saldo', tableId: 't2', expression: 'ROUND(t2.saldo, 2)', outputAlias: 'saldo_r' },
        { column: 'Saldo', tableId: 't2', castType: 'DECIMAL(10,2)', outputAlias: 'saldo_dec' },
      ],
    };
    const vp = viewPart(databricksDdl({ ...MULTI, views: [v] }, { ...DEF, includeViews: true, identifierCase: 'upper' }));
    // FROM/JOIN: nombres del modelo caseados.
    expect(vp).toContain('FROM `CORE`.`CLIENTE` t1');
    expect(vp).toContain('INNER JOIN `CORE`.`CUENTA` t2');
    // Alias generados: minúscula intacta (no `T1`/`T2`).
    expect(vp).not.toMatch(/\bT1\b/);
    expect(vp).not.toMatch(/\bT2\b/);
    // joinOverride: VERBATIM (gana a la inferida, sin casing).
    expect(vp).toContain('ON t1.Id = t2.ClienteId');
    // expression: VERBATIM.
    expect(vp).toContain('ROUND(t2.saldo, 2) AS saldo_r');
    // castType: VERBATIM (tipo de dato, no identificador).
    expect(vp).toContain('DECIMAL(10,2)');
  });

  // ── Criterio obligatorio #1 (controller): el path directo `viewDDL(...)` (el que
  //    usa ViewEditor, nunca databricksDdl) no debe heredar el `activeCase` del
  //    ÚLTIMO export. viewDDL fija activeCase desde SUS opciones al entrar.
  it("path directo viewDDL tras un export 'upper' NO casea (deriva activeCase de SUS opciones)", () => {
    // Ensucia el activeCase global con un export en MAYÚSCULAS.
    databricksDdl(MULTI, { ...DEF, includeViews: true, identifierCase: 'upper' });
    // Ahora el ViewEditor llama viewDDL directo con las opciones por defecto ('as-is').
    const tableById = new Map<string, DdlTable>(MULTI.tables.map((t) => [t.id, t]));
    const out = viewDDL(MULTI.views![0], DEF, tableById, MULTI.relationships, MULTI.columns);
    // Identificadores del modelo: tal cual (no caseados por el export previo).
    expect(out).toContain('CREATE OR REPLACE VIEW `Core`.`v_cliente_cuenta`');
    expect(out).toContain('`Core`.`Cliente`');
    expect(out).toContain('`Core`.`Cuenta`');
    expect(out).not.toContain('`CORE`');
    expect(out).not.toContain('`CLIENTE`');
  });
});

describe('databricksDdl — tipos complejos verbatim (F4 #6)', () => {
  const complex = (dataType: string): DatabricksDdlInput => ({
    tables: [{ id: 't1', physicalName: 'evento', schema: 'core' }],
    columns: [{ id: 'c1', tableId: 't1', physicalName: 'payload', dataType, ordinal: 0 }],
    relationships: [],
    modelName: 'm',
  });

  it('un STRUCT anidado se emite VERBATIM (bug actual: toUpperCase rompe la sintaxis interna)', () => {
    const t = 'STRUCT<nombre:STRING, montos:ARRAY<DECIMAL(10,2)>, extra:MAP<STRING,STRING>>';
    expect(databricksDdl(complex(t), DEF)).toContain(`\`payload\` ${t}`);
  });

  it('respeta el casing tipeado por el usuario dentro del tipo complejo', () => {
    const t = 'array<struct<id:int, tags:map<string,string>>>';
    expect(databricksDdl(complex(t), DEF)).toContain(`\`payload\` ${t}`);
  });

  it('el switch identifierCase NO toca tipos complejos', () => {
    const t = 'STRUCT<Nombre:STRING>';
    expect(databricksDdl(complex(t), { ...DEF, identifierCase: 'upper' })).toContain(t);
    expect(databricksDdl(complex(t), { ...DEF, identifierCase: 'lower' })).toContain(t);
  });

  it('los tipos simples siguen mapeando igual que antes', () => {
    expect(databricksDdl(complex('varchar'), DEF)).toContain('`payload` STRING');
    expect(databricksDdl(complex('decimal(10,2)'), DEF)).toContain('`payload` DECIMAL(10,2)');
  });
});

describe('PRIMARY KEY compuesta — orden de la LLAVE (pkPosition), no orden físico (doc 19 §12b)', () => {
  it('ordena el constraint por pkPosition aunque el ordinal diga lo contrario', () => {
    const input: DatabricksDdlInput = {
      tables: [{ id: 't1', physicalName: 'T', schema: 's' }],
      columns: [
        { id: 'a', tableId: 't1', physicalName: 'FEC', dataType: 'date', ordinal: 4, isPrimaryKey: true, pkPosition: 3 },
        { id: 'b', tableId: 't1', physicalName: 'COD', dataType: 'string', ordinal: 6, isPrimaryKey: true, pkPosition: 2 },
        { id: 'c', tableId: 't1', physicalName: 'OTRA', dataType: 'string', ordinal: 0 },
      ],
      relationships: [],
      modelName: 'm',
    };
    const ddl = databricksDdl(input, DEF);
    // columnas del CREATE en orden físico (ordinal)…
    expect(ddl.indexOf('`OTRA`')).toBeLessThan(ddl.indexOf('`FEC` DATE'));
    // …pero el PRIMARY KEY en orden de llave (COD antes que FEC).
    expect(ddl).toContain('PRIMARY KEY (`COD`, `FEC`)');
  });

  it('PK marcada a mano (sin pkPosition) cae al orden físico', () => {
    const input: DatabricksDdlInput = {
      tables: [{ id: 't1', physicalName: 'T', schema: 's' }],
      columns: [
        { id: 'a', tableId: 't1', physicalName: 'B2', dataType: 'string', ordinal: 2, isPrimaryKey: true },
        { id: 'b', tableId: 't1', physicalName: 'A1', dataType: 'string', ordinal: 1, isPrimaryKey: true },
      ],
      relationships: [],
      modelName: 'm',
    };
    expect(databricksDdl(input, DEF)).toContain('PRIMARY KEY (`A1`, `B2`)');
  });
});
