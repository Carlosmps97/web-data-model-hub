import { describe, expect, it } from 'vitest';
import { databricksDdl, DEFAULT_DATABRICKS_OPTS as DEF, type DatabricksDdlInput, type DdlView } from './generators';

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
