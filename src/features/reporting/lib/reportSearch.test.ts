// Búsqueda del Reporting con alcance (Tables / entities · Columns / attributes ·
// Definitions · Views): qué tablas entran y qué columnas y vistas muestran las
// hojas (en pantalla y en el Excel).
import { describe, expect, it } from 'vitest';
import type { ReportColumnRow, ReportTableRow, ReportViewRow } from '@/services/reporting.service';
import {
  columnFilter, narrowSheetData, SEARCH_SCOPES, scopeSheet, searchTerm, serverScope, tableMatches,
} from './reportSearch';

const table = (id: string, physicalName: string, logicalName = '', description = ''): ReportTableRow => ({
  id, physicalName, logicalName, schema: 's', subjectAreas: [], columnCount: 0, relationshipCount: 0, projects: [],
  description,
});
const column = (id: string, tableId: string, physicalName: string, logicalName = '', description = ''): ReportColumnRow => ({
  id, tableId, physicalName, logicalName, dataType: 'STRING', isPrimaryKey: false, isForeignKey: false,
  isNullable: true, isPartition: false, description, ordinal: 1,
});
const view = (id: string, name: string, sources: string[]): ReportViewRow => ({
  id, name, schema: 's_vu', sourceTableIds: sources, sourceTables: sources, showOnCanvas: true, columns: [],
});

describe('searchTerm', () => {
  it('sin bordes; por nombre de tabla desde el primer carácter, en el servidor desde 2', () => {
    expect(searchTerm('', 'tables')).toBe('');
    expect(searchTerm('  a ', 'tables')).toBe('a');
    for (const scope of ['columns', 'definitions', 'views'] as const) {
      expect(searchTerm('  a ', scope)).toBe('');
      expect(searchTerm('  cl ', scope)).toBe('cl');
    }
  });
});

describe('alcances', () => {
  it('cuatro, con los nombres del buscador del Model; Tables es el primero', () => {
    expect(SEARCH_SCOPES.map((s) => s.id)).toEqual(['tables', 'columns', 'definitions', 'views']);
    expect(SEARCH_SCOPES.map((s) => s.label)).toEqual(['Tables / entities', 'Columns / attributes', 'Definitions', 'Views']);
  });

  it('cada alcance lleva a su hoja natural', () => {
    expect(['tables', 'columns', 'definitions', 'views'].map((s) => scopeSheet(s as never)))
      .toEqual(['tables', 'columns', 'tables', 'views']);
  });

  it('solo Columns, Definitions y Views se resuelven en el servidor (y solo con término)', () => {
    expect(serverScope('tables', 'cli')).toBeNull();
    expect(serverScope('columns', '')).toBeNull();
    expect(serverScope('columns', 'cli')).toBe('columns');
    expect(serverScope('definitions', 'cli')).toBe('definitions');
    expect(serverScope('views', 'cli')).toBe('views');
  });
});

describe('tableMatches', () => {
  const t = table('t1', 'M_CLIENTE', 'Cliente Banca');
  it('sin término entran todas', () => {
    for (const s of SEARCH_SCOPES) expect(tableMatches(t, s.id, '', null)).toBe(true);
  });
  it('Tables: el nombre físico o lógico contiene el término, sin distinguir mayúsculas', () => {
    expect(tableMatches(t, 'tables', 'client', null)).toBe(true);
    expect(tableMatches(t, 'tables', 'BANCA', null)).toBe(true);
    expect(tableMatches(t, 'tables', 'cuenta', null)).toBe(false);
  });
  it('Columns, Definitions y Views: lo decide el conjunto del servidor (sin él, ninguna)', () => {
    expect(tableMatches(t, 'columns', 'cod', new Set(['t1']))).toBe(true);
    expect(tableMatches(t, 'definitions', 'cod', new Set(['t2']))).toBe(false);
    expect(tableMatches(t, 'views', 'cod', null)).toBe(false);
  });
});

describe('narrowSheetData', () => {
  const tables = [table('t1', 'M_CLIENTE'), table('t2', 'M_CUENTA')];
  const columns = [
    column('c1', 't1', 'CODCLIENTE', 'Codigo Cliente', 'Identificador del cliente'),
    column('c2', 't1', 'NOMBRE', 'Nombre', 'Nombre del CLIENTE'),
    column('c3', 't2', 'CODCUENTA', 'Codigo Cuenta', ''),
  ];
  const views = [view('v1', 'VW_CLIENTE', ['t1']), view('v2', 'VW_CUENTA', ['t2']), view('v3', 'VW_OTRA', ['t9'])];
  const ids = (xs: { id?: string }[] | undefined) => (xs ?? []).map((x) => x.id);

  it('Columns: solo las columnas cuyo nombre físico o lógico contiene el término', () => {
    const d = narrowSheetData({ tables, columns, views }, 'columns', 'codigo');
    expect(ids(d.columns)).toEqual(['c1', 'c3']);
    expect(ids(d.views)).toEqual(['v1', 'v2']);
  });

  it('Definitions: solo las columnas cuya definición contiene el término', () => {
    expect(ids(narrowSheetData({ tables, columns }, 'definitions', 'cliente').columns)).toEqual(['c1', 'c2']);
  });

  it('Views: solo las vistas cuyo nombre contiene el término (las columnas, todas)', () => {
    const d = narrowSheetData({ tables, columns, views }, 'views', 'cuenta');
    expect(ids(d.views)).toEqual(['v2']);
    expect(ids(d.columns)).toEqual(['c1', 'c2', 'c3']);
  });

  it('Tables o sin término: no recorta columnas ni vistas', () => {
    expect(ids(narrowSheetData({ tables, columns, views }, 'tables', 'cliente').columns)).toEqual(['c1', 'c2', 'c3']);
    expect(ids(narrowSheetData({ tables, columns, views }, 'columns', '').columns)).toEqual(['c1', 'c2', 'c3']);
  });

  it('una vista sin fuentes entre las tablas del reporte no entra', () => {
    expect(ids(narrowSheetData({ tables, views }, 'tables', '').views)).toEqual(['v1', 'v2']);
  });

  it('columnFilter recorta igual que las hojas (lo usa la plantilla); sin recorte, null', () => {
    for (const [scope, term] of [['columns', 'codigo'], ['definitions', 'cliente']] as const) {
      expect(columns.filter(columnFilter(scope, term)!)).toEqual(narrowSheetData({ tables, columns }, scope, term).columns);
    }
    for (const [scope, term] of [['views', 'cuenta'], ['tables', 'x'], ['columns', '']] as const) {
      expect(columnFilter(scope, term)).toBeNull();
      expect(narrowSheetData({ tables, columns }, scope, term).columns).toEqual(columns);
    }
  });

  it('lo que no se leyó sigue sin leer', () => {
    const d = narrowSheetData({ tables }, 'columns', 'cod');
    expect(d.columns).toBeUndefined();
    expect(d.views).toBeUndefined();
  });
});
