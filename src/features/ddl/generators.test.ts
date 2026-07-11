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
