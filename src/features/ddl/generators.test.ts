import { describe, expect, it } from 'vitest';
import {
  databricksDdl, viewDDL, orderedPartitions, locationFolder,
  needsQuote, ddlType, createTableSql, tableStatements,
  DEFAULT_DATABRICKS_OPTS as DEF, type DatabricksDdlInput, type DatabricksDdlOptions, type DdlTable, type DdlView, ddlZipName,
} from './generators';

// Doc 93: los DEFAULTS son la macro BCP (sin comillas, tipos en minúscula,
// CREATE OR REPLACE). Las pruebas de forma históricas corren con el perfil
// «clásico», que reproduce EXACTO el estilo anterior.
const CLASSIC: DatabricksDdlOptions = {
  ...DEF, identifierCase: 'as-is', external: false,
  quoteIdentifiers: 'always', typeCase: 'upper', createTable: 'if-not-exists',
};

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

describe('DEFAULT_DATABRICKS_OPTS — perfil de la macro BCP (doc 76 D9)', () => {
  it('defaults de la macro: lower, sin comillas, tipos en minúscula, OR REPLACE, abfss + carpeta MAYÚSCULA', () => {
    expect(DEF.identifierCase).toBe('lower');
    expect(DEF.quoteIdentifiers).toBe('when-needed');
    expect(DEF.typeCase).toBe('lower');
    expect(DEF.createTable).toBe('or-replace');
    expect(DEF.viewTagsAs).toBe('table');
    expect(DEF.includeKeys).toBe(false);
    expect(DEF.external).toBe(true);
    expect(DEF.location).toBe('abfss://<container_name>@<storage_account_name>.dfs.core.windows.net/<path>');
    expect(DEF.locationFolderCase).toBe('upper');
    const ddl = databricksDdl(BASE, DEF);
    expect(ddl).toContain('CREATE OR REPLACE TABLE core.cliente (\n  id bigint,\n  nombre string\n)\nUSING DELTA\n');
    expect(ddl).toContain("LOCATION 'abfss://<container_name>@<storage_account_name>.dfs.core.windows.net/<path>/CLIENTE'");
    expect(ddl).not.toContain('`');
    expect(ddl).not.toContain('NOT NULL');
  });

  it('Comments OFF por default: el CREATE sale sin COMMENT hasta que se pidan', () => {
    expect(DEF.includeComments).toBe(false);
    const commented = {
      ...BASE,
      tables: [{ id: 't1', physicalName: 'CLIENTE', schema: 'core', description: 'Maestro de Clientes' }],
      columns: [{ id: 'c1', tableId: 't1', physicalName: 'ID', dataType: 'bigint', ordinal: 0, description: 'Id del Cliente' }],
    };
    expect(databricksDdl(commented, DEF)).not.toContain('COMMENT');
    expect(databricksDdl(commented, { ...DEF, includeComments: true })).toContain("COMMENT 'Id del Cliente'");
  });

  it('doc 85: el COMMENT de columna prefiere la descripción física y cae a la lógica', () => {
    const input = { ...BASE, columns: [
      { id: 'c1', tableId: 't1', physicalName: 'ID', dataType: 'bigint', ordinal: 0, description: 'Id logico', physicalDescription: 'Id fisico' },
      { id: 'c2', tableId: 't1', physicalName: 'NOMBRE', dataType: 'string', ordinal: 1, description: 'Nombre', physicalDescription: '  ' },
    ] };
    const ddl = databricksDdl(input, { ...CLASSIC, includeComments: true });
    expect(ddl).toContain("COMMENT 'Id fisico'");
    expect(ddl).not.toContain("COMMENT 'Id logico'");
    expect(ddl).toContain("COMMENT 'Nombre'");
  });

  it('locationFolder: casing de la carpeta independiente del de identificadores', () => {
    expect(locationFolder('Hd_Venta', { locationFolderCase: 'upper' })).toBe('HD_VENTA');
    expect(locationFolder('Hd_Venta', { locationFolderCase: 'lower' })).toBe('hd_venta');
    expect(locationFolder('Hd_Venta', { locationFolderCase: 'as-is' })).toBe('Hd_Venta');
    expect(locationFolder('Hd_Venta', {})).toBe('HD_VENTA');
    const ddl = databricksDdl(BASE, { ...DEF, locationFolderCase: 'lower' });
    expect(ddl).toContain("<path>/cliente'");
  });
});

describe('viewDDL — la User-Defined SQL es informativa (doc 96 D6)', () => {
  const tables = new Map<string, DdlTable>([
    ['t1', { id: 't1', physicalName: 'CLIENTE', schema: 'core' } as DdlTable],
    ['t2', { id: 't2', physicalName: 'CUENTA', schema: 'core' } as DdlTable],
  ]);
  const regular: DdlView = { id: 'v', tableId: 't1', sourceTableIds: ['t1', 't2'], name: 'v_cc', schema: 'core',
    sources: [{ tableId: 't1', column: 'ID' }, { tableId: 't2', column: 'SALDO' }] };

  it('con customSql el DDL es el MISMO que sin ella: sale de las columnas y la query no aparece', () => {
    const withSql = { ...regular, customSql: 'CREATE VIEW core.otra AS SELECT 1 FROM x JOIN y ON 1=1 WHERE secreto = 1' };
    expect(viewDDL(withSql, DEF, tables)).toBe(viewDDL(regular, DEF, tables));
    expect(viewDDL(withSql, DEF, tables)).not.toContain('secreto');
  });

  it('2 fuentes: FROM t1, t2 separado por coma, sin JOIN', () => {
    const ddl = viewDDL(regular, DEF, tables);
    expect(ddl).toMatch(/FROM\s+core\.cliente\s+t1,\s+core\.cuenta\s+t2/i);
    expect(ddl).not.toMatch(/\bJOIN\b/i);
  });
});

describe('databricksDdl — vistas (editor 07b-2)', () => {
  it('NO emite vistas cuando includeViews=false', () => {
    expect(databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_c', schema: 'core' }), { ...DEF, includeViews: false })).not.toContain('VIEW');
  });

  it('SELECT * (fallback) solo cuando la vista NO tiene proyección (legacy); sin WHERE (doc 91 D2)', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_cliente', schema: 'core' }), { ...DEF, includeViews: true });
    expect(ddl).toContain('CREATE OR REPLACE VIEW core.v_cliente');
    expect(ddl).toContain('SELECT *');
    expect(ddl).toContain('FROM core.cliente');
    expect(ddl).not.toContain('WHERE');
  });

  it('con TODAS las columnas como sources => las LISTA explícitas `col AS col` (doc 76 D10)', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_all', schema: 'core', sources: [{ column: 'ID' }, { column: 'NOMBRE' }] }), { ...DEF, includeViews: true });
    expect(ddl).not.toContain('SELECT *');
    expect(ddl).toMatch(/SELECT\n\s+id AS id,\n\s+nombre AS nombre\nFROM/);
  });

  it('columnas EXPLÍCITAS (una por línea) cuando es un subconjunto', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_sub', schema: 'core', sources: [{ column: 'ID' }] }), { ...DEF, includeViews: true });
    expect(ddl).toMatch(/SELECT\n\s+id AS id\nFROM/);
    expect(ddl).not.toContain('SELECT *');
  });

  it('columnas EXPLÍCITAS con rename y expresión (la expresión y su alias VERBATIM)', () => {
    const ddl = databricksDdl(withView({
      id: 'v', tableId: 't1', name: 'v_x', schema: 'core',
      sources: [{ column: 'ID', outputAlias: 'Cuenta_Id' }, { column: 'NOMBRE', expression: 'UPPER(NOMBRE)', outputAlias: 'Nombre_Up' }],
    }), { ...DEF, includeViews: true });
    expect(ddl).toContain('id AS cuenta_id');
    expect(ddl).toContain('UPPER(NOMBRE) AS Nombre_Up');
    expect(ddl).not.toContain('SELECT *');
  });

  it("con 'as-is' las proyecciones conservan el casing del modelo", () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_all', schema: 'core', sources: [{ column: 'ID' }, { column: 'NOMBRE' }] }), { ...CLASSIC, includeViews: true });
    expect(ddl).toMatch(/SELECT\n\s+ID AS ID,\n\s+NOMBRE AS NOMBRE\nFROM/);
  });

  it('honra Unity Catalog en el nombre de la vista', () => {
    const ddl = databricksDdl(withView({ id: 'v', tableId: 't1', name: 'v_cliente', schema: 'core' }), { ...DEF, includeViews: true, unityCatalog: true, catalog: 'main' });
    expect(ddl).toContain('CREATE OR REPLACE VIEW main.core.v_cliente');
  });

  it('solo emite vistas de tablas dentro del set exportado', () => {
    const ddl = databricksDdl({ ...withView({ id: 'v', tableId: 't1', name: 'v_cliente', schema: 'core' }), tableIds: ['otra'] }, { ...DEF, includeViews: true });
    expect(ddl).not.toContain('v_cliente');
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

  it('doc 91 D5: FROM lista las fuentes separadas por coma con alias posicionales, SIN JOIN ni ON (aunque haya relación)', () => {
    const ddl = databricksDdl({ ...TWO, views: [V] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('FROM core.cliente t1,\n  core.cuenta t2;');
    expect(ddl).not.toMatch(/\bJOIN\b/);
    expect(ddl).not.toMatch(/\bON\b/);
    expect(ddl).not.toContain('WHERE');
  });

  it('3 fuentes: t1, t2, t3 en el orden de sourceTableIds', () => {
    const three: DatabricksDdlInput = { ...TWO, tables: [...TWO.tables, { id: 't3', physicalName: 'MOVIMIENTO', schema: 'core' }] };
    const v: DdlView = { ...V, sourceTableIds: ['t1', 't2', 't3'], sources: [{ column: 'ID', tableId: 't1' }] };
    const ddl = databricksDdl({ ...three, views: [v] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('FROM core.cliente t1,\n  core.cuenta t2,\n  core.movimiento t3;');
  });

  it('columnas cualificadas con alias posicional + CAST(col AS tipo) AS alias', () => {
    const ddl = databricksDdl({ ...TWO, views: [V] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('t1.id AS id');
    expect(ddl).toContain('CAST(t2.saldo AS STRING) AS saldo_txt');
  });

  it('sin relación modelada el FROM es el mismo (el join, si hace falta, va en el User-Defined SQL)', () => {
    const ddl = databricksDdl({ ...TWO, relationships: [], views: [V] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('FROM core.cliente t1,\n  core.cuenta t2;');
    expect(ddl).not.toMatch(/\bJOIN\b/);
  });

  it('UNA fuente: sin alias ni cualificación (regresión legacy); CAST sin alias conserva el nombre', () => {
    const one: DdlView = {
      id: 'v1', tableId: 't1', name: 'v_c', schema: 'core', sourceTableIds: ['t1'],
      sources: [{ column: 'ID', tableId: 't1', castType: 'STRING' }],
    };
    const ddl = databricksDdl({ ...TWO, views: [one] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('CAST(id AS STRING) AS id');
    expect(ddl).not.toContain('t1.id');
  });

  it('la vista entra al export si ALGUNA fuente está en el set exportado', () => {
    const ddl = databricksDdl({ ...TWO, views: [V], tableIds: ['t2'] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('v_cliente_cuenta');
  });

  it('fuente FUERA del contexto (tabla desconocida): id visible', () => {
    const v: DdlView = { ...V, sourceTableIds: ['t1', 'tx'], sources: [{ column: 'ID', tableId: 't1' }] };
    const ddl = databricksDdl({ ...TWO, views: [v] }, { ...DEF, includeViews: true });
    expect(ddl).toContain('FROM core.cliente t1,\n  tx t2;');
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
    expect(ddl).toContain('t1.id AS id'); // la fuente válida sobrevive
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

  it("'as-is': identificadores tal cual están en el modelo", () => {
    const ddl = databricksDdl(CASED, { ...CLASSIC, includeKeys: true });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `Core`.`Cliente`');
    expect(ddl).toContain('`Id` BIGINT');
    expect(ddl).toContain('CONSTRAINT `pk_Cliente` PRIMARY KEY (`Id`)');
  });

  it("'upper': schema/tabla/columna y nombres de constraint en MAYÚSCULAS", () => {
    const ddl = databricksDdl(CASED, { ...CLASSIC, includeKeys: true, identifierCase: 'upper' });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `CORE`.`CLIENTE`');
    expect(ddl).toContain('`ID` BIGINT');
    expect(ddl).toContain('CONSTRAINT `PK_CLIENTE` PRIMARY KEY (`ID`)');
    expect(ddl).toContain(
      'CONSTRAINT `FK_CUENTA_CLIENTEID` FOREIGN KEY (`CLIENTEID`) REFERENCES `CORE`.`CLIENTE`(`ID`)',
    );
    expect(ddl).not.toContain('`Cliente`');
  });

  it("'lower' (default): todo identificador en minúsculas", () => {
    const ddl = databricksDdl(CASED, { ...CLASSIC, includeKeys: true, identifierCase: 'lower' });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS `core`.`cliente`');
    expect(ddl).toContain('CONSTRAINT `pk_cliente` PRIMARY KEY (`id`)');
    expect(ddl).not.toContain('`Cliente`');
  });

  it("'upper' NO toca literales de string ni COMMENTs", () => {
    const ddl = databricksDdl(CASED, { ...CLASSIC, identifierCase: 'upper', includeComments: true });
    expect(ddl).toContain("COMMENT 'Maestro de Clientes'");
    expect(ddl).toContain("COMMENT 'Id del Cliente'");
  });

  it("'lower' NO toca tipos de datos ni el path base de LOCATION; la carpeta sigue locationFolderCase", () => {
    const input: DatabricksDdlInput = {
      ...CASED,
      columns: [{ id: 'c1', tableId: 't1', physicalName: 'Monto', dataType: 'decimal(10,2)', ordinal: 0 }],
      relationships: [],
    };
    const opts = { ...CLASSIC, identifierCase: 'lower' as const, external: true, location: 's3://Bucket/Warehouse' };
    // dbxType decide el casing del tipo, no el switch:
    expect(databricksDdl(input, opts)).toContain('`monto` DECIMAL(10,2)');
    // LOCATION es un literal (path físico): la base queda intacta y la carpeta
    // sigue SU propio casing (doc 76 D9: default MAYÚSCULA; as-is = crudo).
    expect(databricksDdl(input, opts)).toContain("LOCATION 's3://Bucket/Warehouse/CLIENTE'");
    expect(databricksDdl(input, { ...opts, locationFolderCase: 'as-is' })).toContain("LOCATION 's3://Bucket/Warehouse/Cliente'");
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

  it("'upper' casea nombre de vista, tablas del FROM y columnas/alias de proyección; alias generados t1/t2 quedan tal cual", () => {
    const vp = viewPart(databricksDdl(MULTI, { ...CLASSIC, includeViews: true, identifierCase: 'upper' }));
    expect(vp).toContain('CREATE OR REPLACE VIEW `CORE`.`V_CLIENTE_CUENTA`');
    expect(vp).toContain('FROM `CORE`.`CLIENTE` t1,\n  `CORE`.`CUENTA` t2;');
    expect(vp).toContain('t1.ID AS ID');
    expect(vp).toContain('t2.CLIENTEID AS CUENTA_ID');
    expect(vp).toMatch(/\bt1\b/);      // alias generado: minúscula intacta
    expect(vp).not.toMatch(/\bT1\b/);
    expect(vp).toMatch(/\bt2\b/);
    expect(vp).not.toMatch(/\bT2\b/);
  });

  it('expresiones de vista se emiten VERBATIM (sin casing)', () => {
    const v: DdlView = {
      id: 'v', tableId: 't1', name: 'v_x', schema: 'Core', sourceTableIds: ['t1'],
      sources: [
        { column: 'Id', tableId: 't1' },
        { column: 'Id', tableId: 't1', expression: 'UPPER(Nombre)', outputAlias: 'nombre_up' },
      ],
    };
    const vp = viewPart(databricksDdl({ ...MULTI, views: [v] }, { ...CLASSIC, includeViews: true, identifierCase: 'lower' }));
    expect(vp).toContain('UPPER(Nombre)');
  });

  it('castType NO se casea (es un tipo de dato, no un identificador)', () => {
    const v: DdlView = {
      id: 'v', tableId: 't1', name: 'v_cast', schema: 'Core', sourceTableIds: ['t1'],
      sources: [{ column: 'Id', tableId: 't1', castType: 'DECIMAL(10,2)', outputAlias: 'id_dec' }],
    };
    const vp = viewPart(databricksDdl({ ...MULTI, views: [v] }, { ...CLASSIC, includeViews: true, identifierCase: 'lower' }));
    expect(vp).toContain('CAST(id AS DECIMAL(10,2)) AS id_dec');
  });

  // ── Criterio obligatorio #2 (controller): 2 fuentes bajo 'upper' — un solo
  //    caso que congela TODAS las reglas verbatim junto al casing del FROM/JOIN.
  it("2 fuentes bajo 'upper': FROM caseado; alias/expression/castType VERBATIM", () => {
    const v: DdlView = {
      id: 'v', tableId: 't1', name: 'v_multi', schema: 'Core',
      sourceTableIds: ['t1', 't2'],
      sources: [
        { column: 'Id', tableId: 't1' },
        { column: 'Saldo', tableId: 't2', expression: 'ROUND(t2.saldo, 2)', outputAlias: 'saldo_r' },
        { column: 'Saldo', tableId: 't2', castType: 'DECIMAL(10,2)', outputAlias: 'saldo_dec' },
      ],
    };
    const vp = viewPart(databricksDdl({ ...MULTI, views: [v] }, { ...CLASSIC, includeViews: true, identifierCase: 'upper' }));
    // FROM: nombres del modelo caseados, fuentes separadas por coma (doc 91 D5).
    expect(vp).toContain('FROM `CORE`.`CLIENTE` t1,\n  `CORE`.`CUENTA` t2;');
    // Alias generados: minúscula intacta (no `T1`/`T2`).
    expect(vp).not.toMatch(/\bT1\b/);
    expect(vp).not.toMatch(/\bT2\b/);
    // expression: VERBATIM, alias incluido.
    expect(vp).toContain('ROUND(t2.saldo, 2) AS saldo_r');
    // castType: VERBATIM (tipo de dato, no identificador); columna y alias caseados.
    expect(vp).toContain('CAST(t2.SALDO AS DECIMAL(10,2)) AS SALDO_DEC');
  });

  // ── Criterio obligatorio #1 (controller): el path directo `viewDDL(...)` (el que
  //    usa ViewEditor, nunca databricksDdl) no debe heredar el `activeCase` del
  //    ÚLTIMO export. viewDDL fija activeCase desde SUS opciones al entrar.
  it("path directo viewDDL tras un export 'upper' NO hereda el casing (deriva activeCase de SUS opciones)", () => {
    // Ensucia el activeCase global con un export en MAYÚSCULAS.
    databricksDdl(MULTI, { ...CLASSIC, includeViews: true, identifierCase: 'upper' });
    // Ahora el ViewEditor llama viewDDL directo con el perfil clásico ('as-is').
    const tableById = new Map<string, DdlTable>(MULTI.tables.map((t) => [t.id, t]));
    const out = viewDDL(MULTI.views![0], CLASSIC, tableById);
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
    expect(databricksDdl(complex(t), DEF)).toContain(`payload ${t}`);
  });

  it('respeta el casing tipeado por el usuario dentro del tipo complejo', () => {
    const t = 'array<struct<id:int, tags:map<string,string>>>';
    expect(databricksDdl(complex(t), DEF)).toContain(`payload ${t}`);
  });

  it('el switch identifierCase NO toca tipos complejos', () => {
    const t = 'STRUCT<Nombre:STRING>';
    expect(databricksDdl(complex(t), { ...DEF, identifierCase: 'upper' })).toContain(t);
    expect(databricksDdl(complex(t), { ...DEF, identifierCase: 'lower' })).toContain(t);
  });

  it('doc 92 D6: un tipo complejo multilínea (como lo trae Erwin) sale en UNA línea, verbatim en casing', () => {
    const erwin = 'Array \n<\n\tstruct <\n\tcodcampania: varchar(30),\n\tfecsolicitud: date\n\t>\n>';
    const ddl = databricksDdl(complex(erwin), DEF);
    expect(ddl).toContain('payload Array < struct < codcampania: varchar(30), fecsolicitud: date > >');
    expect(ddl.split('\n').filter((l) => l.includes('codcampania'))).toHaveLength(1);
  });

  it('los tipos simples siguen mapeando igual que antes', () => {
    expect(databricksDdl(complex('varchar'), DEF)).toContain('payload string');
    expect(databricksDdl(complex('decimal(10,2)'), DEF)).toContain('payload decimal(10,2)');
  });
});

describe('doc 94 — orden único: PK primero y PRIMARY KEY por ordinal (sin orden de llave aparte)', () => {
  it('cuerpo del CREATE con las PK primero aunque el ordinal guardado esté desordenado; PRIMARY KEY en ese orden', () => {
    const input: DatabricksDdlInput = {
      tables: [{ id: 't1', physicalName: 'T', schema: 's' }],
      columns: [
        { id: 'a', tableId: 't1', physicalName: 'FEC', dataType: 'date', ordinal: 4, isPrimaryKey: true },
        { id: 'b', tableId: 't1', physicalName: 'COD', dataType: 'string', ordinal: 6, isPrimaryKey: true },
        { id: 'c', tableId: 't1', physicalName: 'OTRA', dataType: 'string', ordinal: 0 },
      ],
      relationships: [],
      modelName: 'm',
    };
    const ddl = databricksDdl(input, { ...CLASSIC, includeKeys: true });
    expect(ddl.indexOf('`FEC` DATE')).toBeLessThan(ddl.indexOf('`COD` STRING'));
    expect(ddl.indexOf('`COD` STRING')).toBeLessThan(ddl.indexOf('`OTRA` STRING'));
    expect(ddl).toContain('PRIMARY KEY (`FEC`, `COD`)');
  });

  it('entre PK manda el ordinal', () => {
    const input: DatabricksDdlInput = {
      tables: [{ id: 't1', physicalName: 'T', schema: 's' }],
      columns: [
        { id: 'a', tableId: 't1', physicalName: 'B2', dataType: 'string', ordinal: 2, isPrimaryKey: true },
        { id: 'b', tableId: 't1', physicalName: 'A1', dataType: 'string', ordinal: 1, isPrimaryKey: true },
      ],
      relationships: [],
      modelName: 'm',
    };
    expect(databricksDdl(input, { ...CLASSIC, includeKeys: true })).toContain('PRIMARY KEY (`A1`, `B2`)');
  });
});

describe('particiones: PARTITIONED BY con su tipo, partitionsLast y partitionOrder (doc 73 / doc 76 D3 / doc 107)', () => {
  const input: DatabricksDdlInput = {
    tables: [{ id: 't1', physicalName: 'T', schema: 's' }],
    columns: [
      { id: 'a', tableId: 't1', physicalName: 'CODMES', dataType: 'int', ordinal: 0, isPartition: true, isPrimaryKey: true },
      { id: 'b', tableId: 't1', physicalName: 'COD', dataType: 'string', ordinal: 1 },
      { id: 'c', tableId: 't1', physicalName: 'FECDIA', dataType: 'date', ordinal: 2, isPartition: true },
      { id: 'd', tableId: 't1', physicalName: 'MTO', dataType: 'decimal(18,2)', ordinal: 3 },
    ],
    relationships: [],
    modelName: 'm',
  };
  const bodyNames = (ddl: string) => {
    const body = ddl.slice(ddl.indexOf('(\n') + 2, ddl.indexOf('\n)'));
    return body.split(',\n').map((l) => l.trim().split(' ')[0]).filter((n) => n.startsWith('`'));
  };
  it('doc 107: con PARTITIONED BY las particiones salen de la lista y van ahí con su definición — con o sin la regla', () => {
    for (const o of [{ ...CLASSIC, includeKeys: true }, { ...CLASSIC, includeKeys: true, partitionsLast: true }]) {
      const ddl = databricksDdl(input, o);
      expect(bodyNames(ddl)).toEqual(['`COD`', '`MTO`']);
      expect(ddl).toContain('PARTITIONED BY (`CODMES` INT NOT NULL, `FECDIA` DATE)');
      expect(ddl).toContain('PRIMARY KEY (`CODMES`)');
    }
  });
  const ordered: DatabricksDdlInput = {
    ...input,
    columns: input.columns.map((c) => (c.id === 'a' ? { ...c, partitionOrder: 2 } : c.id === 'c' ? { ...c, partitionOrder: 1 } : c)),
  };
  it('con partitionOrder (UDP PART_nn) el PARTITIONED BY sigue el correlativo', () => {
    expect(databricksDdl(ordered, { ...CLASSIC, partitionsLast: true })).toContain('PARTITIONED BY (`FECDIA` DATE, `CODMES` INT)');
    expect(databricksDdl(ordered, CLASSIC)).toContain('PARTITIONED BY (`FECDIA` DATE, `CODMES` INT)');
  });
  it('sin PARTITIONED BY (Partitions apagada) vuelven a la lista: al final con la regla, si no en orden físico', () => {
    const off = { ...CLASSIC, includePartitions: false };
    expect(bodyNames(databricksDdl(ordered, { ...off, partitionsLast: true }))).toEqual(['`COD`', '`MTO`', '`FECDIA`', '`CODMES`']);
    expect(bodyNames(databricksDdl(ordered, off))).toEqual(['`CODMES`', '`COD`', '`FECDIA`', '`MTO`']);
    expect(databricksDdl(ordered, off)).not.toContain('PARTITIONED BY');
  });
  it('orderedPartitions: correlativos primero, sin correlativo después en orden físico (estable)', () => {
    const cols = [
      { id: 'a', tableId: 't', physicalName: 'A', dataType: 'int', ordinal: 0, isPartition: true, partitionOrder: 2 },
      { id: 'b', tableId: 't', physicalName: 'B', dataType: 'int', ordinal: 1 },
      { id: 'c', tableId: 't', physicalName: 'C', dataType: 'int', ordinal: 2, isPartition: true },
      { id: 'd', tableId: 't', physicalName: 'D', dataType: 'int', ordinal: 3, isPartition: true, partitionOrder: 1 },
    ];
    expect(orderedPartitions(cols).map((c) => c.physicalName)).toEqual(['D', 'A', 'C']);
  });
});

describe('doc 107 — particiones solo en el PARTITIONED BY (formato fijo, con o sin reglas)', () => {
  const input: DatabricksDdlInput = {
    tables: [{ id: 't1', physicalName: 'T', schema: 's' }],
    columns: [
      { id: 'a', tableId: 't1', physicalName: 'CODMES', dataType: 'INTEGER', ordinal: 0, isPartition: true, partitionOrder: 2, isNullable: false, description: 'Mes' },
      { id: 'b', tableId: 't1', physicalName: 'COD', dataType: 'string', ordinal: 1, isPrimaryKey: true },
      { id: 'c', tableId: 't1', physicalName: 'FECDIA', dataType: 'date', ordinal: 2, isPartition: true, partitionOrder: 1 },
      { id: 'd', tableId: 't1', physicalName: 'MTO', dataType: 'decimal(18,2)', ordinal: 3 },
    ],
    relationships: [],
    modelName: 'm',
  };
  const opts: DatabricksDdlOptions = { ...DEF, external: false };
  it('las particiones NO van en la lista: se declaran con su tipo en el PARTITIONED BY, en orden PART_nn', () => {
    expect(tableStatements(input, opts)[0].sql).toBe(
      'CREATE OR REPLACE TABLE s.t (\n  cod string,\n  mto decimal(18,2)\n)\nUSING DELTA\nPARTITIONED BY (fecdia date, codmes int);\n');
  });
  it('la definición se mueve completa: NOT NULL (con keys) y COMMENT (con comments) van dentro del PARTITIONED BY', () => {
    const sql = tableStatements(input, { ...opts, includeKeys: true, includeComments: true })[0].sql;
    expect(sql).toBe([
      'CREATE OR REPLACE TABLE s.t (', '  cod string NOT NULL,', '  mto decimal(18,2),',
      '  CONSTRAINT pk_t PRIMARY KEY (cod)', ')', 'USING DELTA',
      "PARTITIONED BY (fecdia date, codmes int NOT NULL COMMENT 'Mes');", '',
    ].join('\n'));
  });
  it('sin PARTITIONED BY (Output setting «Partitions» apagada) las particiones vuelven a la lista', () => {
    expect(tableStatements(input, { ...opts, includePartitions: false, partitionsLast: true })[0].sql).toBe(
      'CREATE OR REPLACE TABLE s.t (\n  cod string,\n  mto decimal(18,2),\n  fecdia date,\n  codmes int\n)\nUSING DELTA;\n');
  });
  it('una tabla sin particiones sale sin PARTITIONED BY', () => {
    const plain: DatabricksDdlInput = { ...input, columns: input.columns.map((c) => ({ ...c, isPartition: false })) };
    expect(tableStatements(plain, opts)[0].sql).toBe(
      'CREATE OR REPLACE TABLE s.t (\n  cod string,\n  codmes int,\n  fecdia date,\n  mto decimal(18,2)\n)\nUSING DELTA;\n');
  });
});

describe('ddlZipName', () => {
  it('one table → that table name .zip', () => {
    expect(ddlZipName([{ id: '1', physicalName: 'CLIENTE' }], 'M')).toBe('CLIENTE.zip');
  });
  it('many tables → model name .zip', () => {
    expect(ddlZipName(
      [{ id: '1', physicalName: 'A' }, { id: '2', physicalName: 'B' }],
      'My Model',
    )).toBe('My_Model.zip');
  });
});

// Doc 93 Anexo A — tabla del owner. Las particiones llegan como las deja
// `withUdpPartitions` (PART_01 = codmes, PART_02 = nbrgrupo…).
const SPEC_ROWS: [string, string, number | null][] = [
  ['CODCLAVEPARTYCLI', 'VARCHAR(128)', null], ['TIPROLCLI', 'CHAR(20)', null],
  ['CODCLAVECTA', 'VARCHAR(128)', null], ['CODPRODUCTO', 'VARCHAR(30)', null],
  ['NBRGRUPOPROCESOBCAMINORISTA', 'VARCHAR(120)', 2], ['CODMES', 'INTEGER', 1],
  ['CODCLAVEUNICOCLI', 'VARCHAR(128)', null], ['CODINTERNOCOMPUTACIONAL', 'VARCHAR(30)', null],
  ['CODCTAAPP', 'STRING', null], ['CODCTA20', 'STRING', null], ['CODCTACOMERCIAL', 'STRING', null],
  ['CODCTAINTERNA', 'STRING', null], ['CODCLAVEPRODUCTO', 'VARCHAR(128)', null],
  ['DESPRODUCTO', 'VARCHAR(256)', null], ['CODLLAVESECTORFIN', 'INTEGER', null],
  ['CODSECTORFIN', 'VARCHAR(30)', null], ['DESSECTORFIN', 'VARCHAR(256)', null],
  ['DESGLOSACIERREPROCESO', 'STRING', null], ['MTOSALDOMEDIOVIGSOL', 'DECIMAL(21,4)', null],
  ['MTOSALDOMEDIOVIGDOL', 'DECIMAL(21,4)', null], ['MTOSALDOFINMESVIGSOL', 'DECIMAL(21,4)', null],
  ['MTOSALDOFINMESVIGDOL', 'DECIMAL(21,4)', null], ['FECRUTINA', 'DATE', null],
  ['FECACTUALIZACIONREGISTRO', 'TIMESTAMP', null], ['TIPFRECUENCIAREGISTRO', 'CHAR(1)', null],
  ['FECDIA', 'DATE', null],
];
const SPEC_INPUT: DatabricksDdlInput = {
  tables: [{ id: 't1', physicalName: 'H_SALDOCIERREPROCESOBANCAMINORISTA', schema: 'bcp_udv_int' }],
  columns: SPEC_ROWS.map(([n, t, part], i) => ({
    id: `c${i}`, tableId: 't1', physicalName: n, dataType: t, ordinal: i,
    isPrimaryKey: i < 6, isNullable: i >= 6, isPartition: part !== null, partitionOrder: part,
  })),
  relationships: [], modelName: 'UDV INT',
};
const SPEC_LIST = [
  'CREATE OR REPLACE TABLE bcp_udv_int.h_saldocierreprocesobancaminorista (',
  '  codclavepartycli varchar(128),', '  tiprolcli char(20),', '  codclavecta varchar(128),',
  '  codproducto varchar(30),', '  codclaveunicocli varchar(128),', '  codinternocomputacional varchar(30),',
  '  codctaapp string,', '  codcta20 string,', '  codctacomercial string,', '  codctainterna string,',
  '  codclaveproducto varchar(128),', '  desproducto varchar(256),', '  codllavesectorfin int,',
  '  codsectorfin varchar(30),', '  dessectorfin varchar(256),', '  desglosacierreproceso string,',
  '  mtosaldomediovigsol decimal(21,4),', '  mtosaldomediovigdol decimal(21,4),',
  '  mtosaldofinmesvigsol decimal(21,4),', '  mtosaldofinmesvigdol decimal(21,4),', '  fecrutina date,',
  '  fecactualizacionregistro timestamp,', '  tipfrecuenciaregistro char(1),',
];
const SPEC_LOCATION = "LOCATION 'abfss://<container_name>@<storage_account_name>.dfs.core.windows.net/<path>/H_SALDOCIERREPROCESOBANCAMINORISTA';";
// Doc 107: particiones solo en el PARTITIONED BY, con su tipo (formato fijo).
const SPEC_BASE_SQL = [
  ...SPEC_LIST, '  fecdia date', ')', 'USING DELTA',
  'PARTITIONED BY (codmes int, nbrgrupoprocesobcaminorista varchar(120))', SPEC_LOCATION,
].join('\n');

describe('doc 93 — estilo de salida (comillas, tipos, CREATE, NOT NULL)', () => {
  it('needsQuote: solo nombres con espacios/caracteres especiales o palabras reservadas', () => {
    expect(needsQuote('codmes')).toBe(false);
    expect(needsQuote('_x1')).toBe(false);
    for (const n of ['hd base', 'destipmodalidadpagocreditoÉrsonal', '1col', 'a-b', 'select', 'FROM']) {
      expect(needsQuote(n)).toBe(true);
    }
  });

  it('nombres que necesitan comillas las conservan (tabla, columnas, FROM y proyecciones)', () => {
    const input: DatabricksDdlInput = {
      tables: [{ id: 't1', physicalName: 'HD BASE', schema: 'bcp' }],
      columns: [{ id: 'c1', tableId: 't1', physicalName: 'select', dataType: 'string', ordinal: 0 }],
      relationships: [], modelName: 'm',
      views: [{ id: 'v', tableId: 't1', name: 'v x', schema: 'bcp_vu', sources: [{ column: 'select' }] }],
    };
    const ddl = databricksDdl(input, { ...DEF, external: false });
    expect(ddl).toContain('CREATE OR REPLACE TABLE bcp.`hd base` (\n  `select` string\n)');
    expect(ddl).toContain('CREATE OR REPLACE VIEW bcp_vu.`v x` AS\nSELECT\n  `select` AS `select`\nFROM bcp.`hd base`;');
  });

  it("'always' + 'upper' + 'if-not-exists' = estilo anterior", () => {
    const ddl = databricksDdl(BASE, { ...DEF, quoteIdentifiers: 'always', typeCase: 'upper', createTable: 'if-not-exists' });
    expect(ddl).toContain('CREATE EXTERNAL TABLE IF NOT EXISTS `core`.`cliente` (\n  `id` BIGINT,\n  `nombre` STRING\n)');
  });

  it('NOT NULL solo con Primary & foreign keys', () => {
    expect(databricksDdl(BASE, DEF)).not.toContain('NOT NULL');
    expect(databricksDdl(BASE, { ...DEF, includeKeys: true })).toContain('  id bigint NOT NULL,');
  });

  it('ddlType: mapa Databricks con el casing pedido; complejos tal cual', () => {
    expect(ddlType('INTEGER')).toBe('int');
    expect(ddlType('CHAR(20)')).toBe('char(20)');
    expect(ddlType('varchar')).toBe('string');
    expect(ddlType('DECIMAL(21,4)', 'upper')).toBe('DECIMAL(21,4)');
    expect(ddlType('STRUCT<a:STRING>')).toBe('STRUCT<a:STRING>');
    expect(ddlType('')).toBe('string');
  });

  it('createTableSql: OR REPLACE por default; IF NOT EXISTS (con/sin EXTERNAL) por setting', () => {
    expect(createTableSql({ createTable: 'or-replace', external: true })).toBe('CREATE OR REPLACE TABLE');
    expect(createTableSql({ createTable: 'if-not-exists', external: true })).toBe('CREATE EXTERNAL TABLE IF NOT EXISTS');
    expect(createTableSql({ createTable: 'if-not-exists', external: false })).toBe('CREATE TABLE IF NOT EXISTS');
  });

  it('golden del spec-rule (doc 93 Anexo A · doc 107): el CREATE físico que recibe el motor — igual con o sin la regla', () => {
    expect(tableStatements(SPEC_INPUT, { ...DEF, partitionsLast: true })[0].sql).toBe(`${SPEC_BASE_SQL}\n`);
    expect(tableStatements(SPEC_INPUT, DEF)[0].sql).toBe(`${SPEC_BASE_SQL}\n`);
  });
});
