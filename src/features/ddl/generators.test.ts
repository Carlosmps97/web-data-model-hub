import { describe, expect, it } from 'vitest';
import { databricksDdl, inferJoin, DEFAULT_DATABRICKS_OPTS as DEF, type DatabricksDdlInput, type DdlView } from './generators';

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
  const R = (id: string, sT: string, sC: string, tT: string, tC: string) =>
    ({ id, sourceTableId: sT, sourceColumnId: sC, targetTableId: tT, targetColumnId: tC });

  it('2 fuentes con FK hija→padre: fuente ANTERIOR primero (t1.pk = t2.fk)', () => {
    expect(inferJoin(['t1', 't2'], [R('r1', 't2', 'c2', 't1', 'c1')], COLS))
      .toBe('t1.ID = t2.CLIENTE_ID');
  });

  it('orientación de la relación indistinta (declarada t1→t2, mismo resultado)', () => {
    expect(inferJoin(['t1', 't2'], [R('r1', 't1', 'c1', 't2', 'c2')], COLS))
      .toBe('t1.ID = t2.CLIENTE_ID');
  });

  it('3 fuentes encadenadas: condiciones unidas con AND', () => {
    const rels = [R('r1', 't2', 'c2', 't1', 'c1'), R('r2', 't3', 'c4', 't2', 'c3')];
    expect(inferJoin(['t1', 't2', 't3'], rels, COLS))
      .toBe('t1.ID = t2.CLIENTE_ID AND t2.ID = t3.CUENTA_ID');
  });

  it('sin relación entre las fuentes ⇒ cadena vacía (el editor exige joinOverride)', () => {
    expect(inferJoin(['t1', 't3'], [R('r1', 't2', 'c2', 't1', 'c1')], COLS)).toBe('');
  });

  it('menos de 2 fuentes ⇒ cadena vacía', () => {
    expect(inferJoin(['t1'], [], COLS)).toBe('');
    expect(inferJoin([], [], COLS)).toBe('');
  });

  it('ids de columna desconocidos degradan al id crudo (no revienta)', () => {
    expect(inferJoin(['t1', 't2'], [R('r1', 't2', 'cx', 't1', 'cy')], COLS))
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
    relationships: [{ id: 'r1', sourceTableId: 't2', sourceColumnId: 'c2', targetTableId: 't1', targetColumnId: 'c1' }],
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
    expect(ddl).toContain('ON 1 = 1 /* sin relación modelada entre las fuentes */');
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
      { id: 'r1', sourceTableId: 't2', sourceColumnId: 'c2', targetTableId: 't1', targetColumnId: 'c1' },
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
