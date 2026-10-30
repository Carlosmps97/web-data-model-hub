import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILE_NAMES, exportFolders, plainToObjects, objectsToEntries, type DdlObject,
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

describe('exportFolders: la carpeta que reciben las reglas es la del zip', () => {
  it('tabla → su nombre; homónimas de esquemas distintos → desambiguadas; vista → su primera fuente exportada', () => {
    const out = exportFolders({
      tables: [
        { id: 't1', physicalName: 'H_X', schema: 'a' }, { id: 't2', physicalName: 'H_X', schema: 'b' },
        { id: 't3', physicalName: 'H/Y', schema: 'a' },
      ],
      views: [{ sourceTableIds: ['tx', 't3'] }, { sourceTableIds: [] }, { sourceTableIds: ['t1'] }],
    });
    expect(out).toEqual({ tables: ['H_X (a)', 'H_X (b)', 'H_Y'], views: ['H_Y', '_views', 'H_X (a)'] });
  });
  it('homónimas del mismo esquema comparten carpeta, como en el zip', () => {
    const out = exportFolders({ tables: [{ id: 't1', physicalName: 'T', schema: 's' }, { id: 't2', physicalName: 'T', schema: 's' }], views: [] });
    expect(out.tables).toEqual(['T', 'T']);
  });
});

describe('objectsToEntries: nombres de archivo', () => {
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
