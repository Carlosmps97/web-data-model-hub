import { describe, it, expect } from 'vitest';
import {
  plainToObjects, statementsToObjects, objectsToEntries, viewKey, type DdlObject,
} from './ddlExportBundle';

const paths = (objs: DdlObject[]) => objectsToEntries(objs).map((e) => e.path).sort();

describe('plainToObjects + objectsToEntries', () => {
  it('one table, no views → one file in the table folder', () => {
    const objs = plainToObjects({
      tables: [{ id: 't1', physicalName: 'CLIENTE', schema: 'ventas', sql: 'CREATE TABLE cliente;' }],
      views: [],
    });
    expect(paths(objs)).toEqual(['CLIENTE/[TABLE] CLIENTE.sql']);
  });

  it('one table with two views → three files in its folder', () => {
    const objs = plainToObjects({
      tables: [{ id: 't1', physicalName: 'CLIENTE', schema: 'ventas', sql: 'CREATE TABLE cliente;' }],
      views: [
        { name: 'VW_A', schema: 'ventas', sourceTableIds: ['t1'], sql: 'CREATE VIEW vw_a;' },
        { name: 'VW_B', schema: 'ventas', sourceTableIds: ['t1'], sql: 'CREATE VIEW vw_b;' },
      ],
    });
    expect(paths(objs)).toEqual([
      'CLIENTE/[TABLE] CLIENTE.sql',
      'CLIENTE/[VIEW] VW_A.sql',
      'CLIENTE/[VIEW] VW_B.sql',
    ]);
  });

  it('multi-source view lands in the first EXPORTED source folder', () => {
    const objs = plainToObjects({
      tables: [{ id: 'a', physicalName: 'A', schema: 's', sql: 'CREATE TABLE a;' }],
      // first source 'b' is not exported; 'a' is → folder A
      views: [{ name: 'VW', schema: 's', sourceTableIds: ['b', 'a'], sql: 'CREATE VIEW vw;' }],
    });
    expect(paths(objs)).toEqual(['A/[TABLE] A.sql', 'A/[VIEW] VW.sql']);
  });

  it('view with no exported source → _views/ root folder', () => {
    const objs = plainToObjects({
      tables: [{ id: 'a', physicalName: 'A', schema: 's', sql: 'CREATE TABLE a;' }],
      views: [{ name: 'ORPHAN', schema: 's', sourceTableIds: [], sql: 'CREATE VIEW orphan;' }],
    });
    expect(paths(objs)).toContain('_views/[VIEW] ORPHAN.sql');
  });

  it('same physical name in different schemas → both folders disambiguated', () => {
    const objs = plainToObjects({
      tables: [
        { id: '1', physicalName: 'CLIENTE', schema: 'ventas', sql: 'a;' },
        { id: '2', physicalName: 'CLIENTE', schema: 'riesgos', sql: 'b;' },
      ],
      views: [],
    });
    expect(paths(objs)).toEqual([
      'CLIENTE (riesgos)/[TABLE] CLIENTE.sql',
      'CLIENTE (ventas)/[TABLE] CLIENTE.sql',
    ]);
  });

  it('sanitizes illegal chars but keeps brackets, parens and spaces', () => {
    const objs = plainToObjects({
      tables: [{ id: '1', physicalName: 'A/B:C', schema: 's', sql: 'x;' }],
      views: [],
    });
    expect(paths(objs)).toEqual(['A_B_C/[TABLE] A_B_C.sql']);
  });

  it('dedups two views with the same name in one folder', () => {
    const objs = plainToObjects({
      tables: [{ id: 't1', physicalName: 'T', schema: 's', sql: 't;' }],
      views: [
        { name: 'DUP', schema: 's', sourceTableIds: ['t1'], sql: 'v1;' },
        { name: 'DUP', schema: 'other', sourceTableIds: ['t1'], sql: 'v2;' },
      ],
    });
    expect(paths(objs)).toEqual([
      'T/[VIEW] DUP.sql',
      'T/[VIEW] DUP_2.sql',
      'T/[TABLE] T.sql',
    ].sort());
  });
});

describe('statementsToObjects (rules path)', () => {
  it('folds tags into the table file, splits generated artifacts, places views', () => {
    const objs = statementsToObjects({
      statements: [
        { artifact: 'ddl.tabla_fisica', schema: 'v', name: 'CLIENTE', sql: 'CREATE TABLE cliente;' },
        { artifact: 'ddl.tabla_fisica.tags', schema: 'v', name: 'CLIENTE', sql: 'ALTER TABLE cliente SET TAGS (x=1);' },
        { artifact: 'ddl.tabla_rej', schema: 'v', name: 'CLIENTE_rej', sql: 'CREATE TABLE cliente_rej;' },
        { artifact: 'ddl.vista_negocio', schema: 'v', name: 'VW', sql: 'CREATE OR REPLACE VIEW vw AS SELECT 1;' },
      ],
      viewSources: new Map([[viewKey('v', 'VW'), ['t1']]]),
      tablesById: new Map([['t1', { physicalName: 'CLIENTE', schema: 'v' }]]),
    });
    const entries = objectsToEntries(objs);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.content]));
    expect(Object.keys(byPath).sort()).toEqual([
      'CLIENTE/[TABLE] CLIENTE.sql',
      'CLIENTE/[TABLE] CLIENTE_rej.sql',
      'CLIENTE/[VIEW] VW.sql',
    ]);
    // The table file carries both the CREATE and its tag ALTER.
    expect(byPath['CLIENTE/[TABLE] CLIENTE.sql']).toContain('CREATE TABLE cliente;');
    expect(byPath['CLIENTE/[TABLE] CLIENTE.sql']).toContain('ALTER TABLE cliente SET TAGS');
  });

  it('classifies a generated VIEW artifact as [VIEW] by its SQL', () => {
    const objs = statementsToObjects({
      statements: [
        { artifact: 'ddl.tabla_fisica', schema: 'v', name: 'T', sql: 'CREATE TABLE t;' },
        { artifact: 'ddl.vista_rej', schema: 'v', name: 'VW_T_TEC', sql: 'CREATE OR REPLACE VIEW vw_t_tec AS SELECT 1;' },
      ],
      viewSources: new Map(),
      tablesById: new Map(),
    });
    expect(objectsToEntries(objs).map((e) => e.path).sort()).toEqual([
      'T/[TABLE] T.sql',
      'T/[VIEW] VW_T_TEC.sql',
    ]);
  });
});
