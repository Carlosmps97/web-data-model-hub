import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILE_NAMES, plainToObjects, statementsToObjects, objectsToEntries, viewKey, type DdlObject,
} from './ddlExportBundle';

const paths = (objs: DdlObject[], f = DEFAULT_FILE_NAMES) => objectsToEntries(objs, f).map((e) => e.path).sort();

describe('plainToObjects + objectsToEntries', () => {
  it('una tabla sin vistas → TABLE-NOMBRE.sql en la carpeta de la tabla', () => {
    const objs = plainToObjects({
      tables: [{ id: 't1', physicalName: 'CLIENTE', schema: 'ventas', sql: 'CREATE TABLE cliente;' }],
      views: [],
    });
    expect(paths(objs)).toEqual(['CLIENTE/TABLE-CLIENTE.sql']);
  });

  it('las vistas modeladas son VIEW_NEG y el nombre va en mayúsculas', () => {
    const objs = plainToObjects({
      tables: [{ id: 't1', physicalName: 'CLIENTE', schema: 'ventas', sql: 'CREATE TABLE cliente;' }],
      views: [
        { name: 'vw_a', schema: 'ventas', sourceTableIds: ['t1'], sql: 'CREATE VIEW vw_a;' },
        { name: 'VW_B', schema: 'ventas', sourceTableIds: ['t1'], sql: 'CREATE VIEW vw_b;' },
      ],
    });
    expect(paths(objs)).toEqual(['CLIENTE/TABLE-CLIENTE.sql', 'CLIENTE/VIEW_NEG-VW_A.sql', 'CLIENTE/VIEW_NEG-VW_B.sql']);
  });

  it('una vista multi-fuente va a la carpeta de la primera fuente exportada', () => {
    const objs = plainToObjects({
      tables: [{ id: 'a', physicalName: 'A', schema: 's', sql: 'CREATE TABLE a;' }],
      views: [{ name: 'VW', schema: 's', sourceTableIds: ['b', 'a'], sql: 'CREATE VIEW vw;' }],
    });
    expect(paths(objs)).toEqual(['A/TABLE-A.sql', 'A/VIEW_NEG-VW.sql']);
  });

  it('vista sin fuente exportada → carpeta raíz _views/', () => {
    const objs = plainToObjects({
      tables: [{ id: 'a', physicalName: 'A', schema: 's', sql: 'CREATE TABLE a;' }],
      views: [{ name: 'ORPHAN', schema: 's', sourceTableIds: [], sql: 'CREATE VIEW orphan;' }],
    });
    expect(paths(objs)).toContain('_views/VIEW_NEG-ORPHAN.sql');
  });

  it('mismo nombre físico en esquemas distintos → ambas carpetas desambiguadas', () => {
    const objs = plainToObjects({
      tables: [
        { id: '1', physicalName: 'CLIENTE', schema: 'ventas', sql: 'a;' },
        { id: '2', physicalName: 'CLIENTE', schema: 'riesgos', sql: 'b;' },
      ],
      views: [],
    });
    expect(paths(objs)).toEqual(['CLIENTE (riesgos)/TABLE-CLIENTE.sql', 'CLIENTE (ventas)/TABLE-CLIENTE.sql']);
  });

  it('sanea caracteres ilegales; sin corchetes en ningún lado', () => {
    const objs = plainToObjects({ tables: [{ id: '1', physicalName: 'A/B:C', schema: 's', sql: 'x;' }], views: [] });
    expect(paths(objs)).toEqual(['A_B_C/TABLE-A_B_C.sql']);
  });

  it('dos vistas con el mismo nombre en una carpeta → ambas llevan su esquema (nunca _2)', () => {
    const objs = plainToObjects({
      tables: [{ id: 't1', physicalName: 'T', schema: 's', sql: 't;' }],
      views: [
        { name: 'DUP', schema: 's', sourceTableIds: ['t1'], sql: 'v1;' },
        { name: 'DUP', schema: 'other', sourceTableIds: ['t1'], sql: 'v2;' },
      ],
    });
    expect(paths(objs)).toEqual(['T/TABLE-T.sql', 'T/VIEW_NEG-OTHER.DUP.sql', 'T/VIEW_NEG-S.DUP.sql']);
  });
});

describe('statementsToObjects (camino con reglas)', () => {
  it('pliega los tags en el archivo del objeto sin líneas en blanco; tablas generadas TABLE, vistas generadas VIEW_TEC', () => {
    const objs = statementsToObjects({
      statements: [
        { artifact: 'ddl.tabla_fisica', schema: 'v', name: 'CLIENTE', sql: 'CREATE TABLE cliente;' },
        { artifact: 'ddl.tabla_fisica.tags', schema: 'v', name: 'CLIENTE', sql: 'ALTER TABLE cliente SET TAGS (x=1);' },
        { artifact: 'ddl.tabla_fisica.extra', schema: 'v', name: 'CLIENTE', sql: 'OPTIMIZE cliente;' },
        { artifact: 'ddl.tabla_rej', schema: 'v', name: 'CLIENTE_rej', sql: 'CREATE TABLE cliente_rej;' },
        { artifact: 'ddl.vista_tecnica', schema: 'v_v', name: 'CLIENTE', sql: 'CREATE OR REPLACE VIEW v_v.cliente AS SELECT 1;' },
        { artifact: 'ddl.vista_negocio', schema: 'v_vu', name: 'VW', sql: 'CREATE OR REPLACE VIEW vw AS SELECT 1;' },
        { artifact: 'ddl.vista_negocio.tags', schema: 'v_vu', name: 'VW', sql: 'ALTER TABLE vw SET TAGS (d=4);' },
      ],
      viewSources: new Map([[viewKey('v_vu', 'VW'), ['t1']]]),
      tablesById: new Map([['t1', { physicalName: 'CLIENTE', schema: 'v' }]]),
    });
    const byPath = Object.fromEntries(objectsToEntries(objs).map((e) => [e.path, e.content]));
    expect(Object.keys(byPath).sort()).toEqual([
      'CLIENTE/TABLE-CLIENTE.sql', 'CLIENTE/TABLE-CLIENTE_REJ.sql', 'CLIENTE/VIEW_NEG-VW.sql', 'CLIENTE/VIEW_TEC-CLIENTE.sql',
    ]);
    // CREATE y sus ALTER seguidos, sin líneas en blanco
    expect(byPath['CLIENTE/TABLE-CLIENTE.sql']).toBe('CREATE TABLE cliente;\nALTER TABLE cliente SET TAGS (x=1);\nOPTIMIZE cliente;\n');
    expect(byPath['CLIENTE/VIEW_NEG-VW.sql']).toBe('CREATE OR REPLACE VIEW vw AS SELECT 1;\nALTER TABLE vw SET TAGS (d=4);\n');
  });

  it('caso con reglas: las vistas _v y _vu del mismo nombre nunca chocan', () => {
    const objs = statementsToObjects({
      statements: [
        { artifact: 'ddl.tabla_fisica', schema: 'stg', name: 'H_X', sql: 'CREATE TABLE h_x;' },
        { artifact: 'ddl.vista_tecnica', schema: 'stg_v', name: 'H_X', sql: 'CREATE OR REPLACE VIEW stg_v.h_x AS SELECT 1;' },
        { artifact: 'ddl.vista_tecnica_dac', schema: 'stg_v', name: 'H_Xdac', sql: 'CREATE OR REPLACE VIEW stg_v.h_xdac AS SELECT 1;' },
        { artifact: 'ddl.vista_negocio', schema: 'stg_vu', name: 'H_XDAC', sql: 'CREATE OR REPLACE VIEW stg_vu.h_xdac AS SELECT 1;' },
        { artifact: 'ddl.vista_negocio', schema: 'stg_vu', name: 'H_X', sql: 'CREATE OR REPLACE VIEW stg_vu.h_x AS SELECT 1;' },
      ],
      viewSources: new Map([[viewKey('stg_vu', 'H_XDAC'), ['t1']], [viewKey('stg_vu', 'H_X'), ['t1']]]),
      tablesById: new Map([['t1', { physicalName: 'H_X', schema: 'stg' }]]),
    });
    expect(paths(objs)).toEqual([
      'H_X/TABLE-H_X.sql', 'H_X/VIEW_NEG-H_X.sql', 'H_X/VIEW_NEG-H_XDAC.sql', 'H_X/VIEW_TEC-H_X.sql', 'H_X/VIEW_TEC-H_XDAC.sql',
    ]);
    // mismo prefijo y nombre con distinto casing o esquema → calificado con esquema, sin distinguir mayúsculas
    const clash: DdlObject[] = [
      { tableName: 'T', kind: 'view', origin: 'generated', schema: 'a', name: 'Tdac', sql: '1;' },
      { tableName: 'T', kind: 'view', origin: 'generated', schema: 'b', name: 'TDAC', sql: '2;' },
    ];
    expect(paths(clash)).toEqual(['T/VIEW_TEC-A.TDAC.sql', 'T/VIEW_TEC-B.TDAC.sql']);
  });

  it('fileNames: prefijos, separador y casing personalizados, y esquema "always"', () => {
    const objs: DdlObject[] = [
      { tableName: 'T', tableSchema: 's', kind: 'table', origin: 'model', schema: 's', name: 't', sql: 'x;' },
      { tableName: 'T', tableSchema: 's', kind: 'view', origin: 'generated', schema: 's_v', name: 't', sql: 'y;' },
    ];
    expect(paths(objs, { ...DEFAULT_FILE_NAMES, table: 'TBL', generatedView: 'VT', separator: '_', nameCase: 'lower' }))
      .toEqual(['T/TBL_t.sql', 'T/VT_t.sql']);
    expect(paths(objs, { ...DEFAULT_FILE_NAMES, schema: 'always' })).toEqual(['T/TABLE-S.T.sql', 'T/VIEW_TEC-S_V.T.sql']);
    expect(paths(objs, { ...DEFAULT_FILE_NAMES, table: '' })).toContain('T/T.sql');       // sin prefijo ⇒ solo el nombre
    expect(paths(objs, { ...DEFAULT_FILE_NAMES, table: 'A/B' })).toContain('T/A_B-T.sql'); // saneado
  });
});
