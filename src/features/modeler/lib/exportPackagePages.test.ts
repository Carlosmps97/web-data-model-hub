import { describe, expect, it } from 'vitest';
import { sanitizeFileName, uniqueName } from './exportPackagePages';

describe('sanitizeFileName', () => {
  it('reemplaza los caracteres reservados de archivo por _', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });
  it('conserva acentos, paréntesis y espacios interiores', () => {
    expect(sanitizeFileName('Desempeño Financiero Cliente (UAI)')).toBe('Desempeño Financiero Cliente (UAI)');
  });
  it('recorta puntos y espacios finales (Windows no los admite)', () => {
    expect(sanitizeFileName('name...  ')).toBe('name');
  });
  it('vacío o solo separadores → untitled', () => {
    expect(sanitizeFileName('')).toBe('untitled');
    expect(sanitizeFileName('  . ')).toBe('untitled');
  });
  it('neutraliza caracteres de control', () => {
    expect(sanitizeFileName('a\tb\nc')).toBe('a_b_c');
  });
});

describe('uniqueName', () => {
  it('devuelve el base si está libre y lo registra', () => {
    const taken = new Set<string>();
    expect(uniqueName('Canvas', taken)).toBe('Canvas');
    expect(taken.has('canvas')).toBe(true);
  });
  it('colisión case-insensitive → sufijo _2, _3…', () => {
    const taken = new Set<string>();
    expect(uniqueName('Canvas', taken)).toBe('Canvas');
    expect(uniqueName('CANVAS', taken)).toBe('CANVAS_2');
    expect(uniqueName('canvas', taken)).toBe('canvas_3');
  });
});

import { packageLayout } from './exportPackagePages';
import type { Folder, SubjectArea } from '../services/modeler.service';

const F = (id: string, parent: string | null, name: string, order = 0): Folder =>
  ({ id, projectId: 'p1', parentFolderId: parent, name, order });
const SA = (id: string, folderId: string | null, name: string): SubjectArea =>
  ({ id, projectId: 'p1', name, folderId, tableIds: [], layout: {} });

describe('packageLayout', () => {
  const folders = [F('f1', null, 'CPYBCA'), F('f2', 'f1', 'CPYBCAPYM'), F('f3', 'f1', 'CPYBCANEG', 1), F('fx', null, 'Otros')];
  const sas = [
    SA('s1', 'f2', 'Datamart PYME'), SA('s2', 'f2', 'Alerta Mora'),
    SA('s3', 'f1', 'Suelto'), SA('s4', null, 'Raiz'), SA('s5', 'fx', 'FueraDeScope'),
  ];

  it('folder: subtree con subcarpetas; lo de otros folders y la raíz quedan fuera', () => {
    const out = packageLayout('folder', 'f1', 'Modelo DDV', folders, sas);
    expect(out.rootName).toBe('CPYBCA');
    expect(out.canvases.map((c) => [...c.dir, c.file].join('/'))).toEqual([
      'Suelto.html',
      'CPYBCAPYM/Alerta Mora.html',
      'CPYBCAPYM/Datamart PYME.html',
    ]);
    expect(out.canvases.some((c) => c.sa.id === 's5' || c.sa.id === 's4')).toBe(false);
  });

  it('doc 92 D1: carpetas y canvases A–Z sin importar `order` ni mayúsculas', () => {
    const f = [F('a', null, 'zeta', 0), F('b', null, 'Alfa', 5), F('c', null, 'beta', 1)];
    const c = [SA('s1', 'a', 'x'), SA('s2', null, 'Beta canvas'), SA('s3', null, 'alfa canvas')];
    const out = packageLayout('project', 'p1', 'P', f, c);
    expect(out.canvases.map((x) => [...x.dir, x.file].join('/'))).toEqual(['alfa canvas.html', 'Beta canvas.html', 'zeta/x.html']);
  });

  it('folder: crumb arranca en el folder exportado con nombres ORIGINALES', () => {
    const out = packageLayout('folder', 'f1', 'Modelo DDV', folders, sas);
    const dm = out.canvases.find((c) => c.sa.id === 's1');
    expect(dm?.crumb).toEqual(['CPYBCA', 'CPYBCAPYM']);
    expect(dm?.dir).toEqual(['CPYBCAPYM']);
  });

  it('project: incluye canvases de raíz (folderId null) y todo el árbol', () => {
    const out = packageLayout('project', 'p1', 'Modelo DDV', folders, sas);
    expect(out.rootName).toBe('Modelo DDV');
    const paths = out.canvases.map((c) => [...c.dir, c.file].join('/'));
    expect(paths).toContain('Raiz.html');
    expect(paths).toContain('CPYBCA/CPYBCAPYM/Datamart PYME.html');
    expect(paths).toContain('Otros/FueraDeScope.html');
  });

  it('nombres duplicados en la misma carpeta → _2 (case-insensitive)', () => {
    const dup = [SA('a', null, 'Same'), SA('b', null, 'SAME')];
    const out = packageLayout('project', 'p1', 'P', [], dup);
    expect(out.canvases.map((c) => c.file).sort()).toEqual(['SAME_2.html', 'Same.html']);
  });

  it('folder inexistente → throw', () => {
    expect(() => packageLayout('folder', 'nope', 'P', folders, sas)).toThrow();
  });
});

import { buildCanvasPage } from './exportPackagePages';
import { jsStringLiteral } from './exportHtml';
import type { Diagram } from '../services/modeler.service';

function fixtureDiagram(): Diagram {
  return {
    subjectArea: {
      id: 'sa1', projectId: 'p1', name: 'Datamart PYME', folderId: 'f2',
      tableIds: ['t1', 't2'], layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 } },
      udpValues: { uCanvas: 'Mensual' },
    },
    tables: [
      { id: 't1', physicalName: 'MD_PARAMETRO', logicalName: 'Parametro', schema: 'gold', description: 'Maestra <b>mensual</b>', udpValues: { uTable: 'Core' } },
      { id: 't2', physicalName: 'HD_VENTA', logicalName: 'Venta', schema: 'gold' },
    ],
    columns: [
      { id: 'c1', tableId: 't1', physicalName: 'CODMES', logicalName: 'Código de Mes', dataType: 'INT', typeOverridden: false, isPrimaryKey: true, ordinal: 0, isNullable: false, description: 'AAAAMM', udpValues: { uCol: 'SI' } },
      { id: 'c2', tableId: 't1', physicalName: 'DESPARAM', logicalName: 'Descripción', dataType: 'VARCHAR(200)', typeOverridden: false, ordinal: 1, isNullable: true, parentDomainId: 'd1' },
      { id: 'c3', tableId: 't2', physicalName: 'CODMES', logicalName: 'Código de Mes', dataType: 'INT', typeOverridden: false, isForeignKey: true, ordinal: 0, isPartition: true },
    ],
    relationships: [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }], parentCardinality: 'one', childCardinality: 'zero-many', identifying: false }],
    views: [{ id: 'v1', name: 'VW_VENTA', schema: 'gold_vu', sourceTableIds: ['t2'], customSql: 'SELECT * FROM gold.HD_VENTA WHERE x < 1' }],
  } as Diagram;
}

const LOOKUPS = {
  domainsById: { d1: 'Texto Corto' },
  udpDefsById: {
    uCanvas: { name: 'Frecuencia', level: 'canvas' as const },
    uTable: { name: 'Capa', level: 'table' as const },
    uCol: { name: 'Sensible', level: 'column' as const },
  },
};

describe('buildCanvasPage', () => {
  const svgL = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Parametro</text></svg>';
  const svgP = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>MD_PARAMETRO</text></svg>';
  const out = buildCanvasPage({
    title: 'Datamart PYME', breadcrumb: ['Modelo DDV', 'CPYBCA'], indexHref: '../index.html',
    svgLogical: svgL, svgPhysical: svgP, diagram: fixtureDiagram(), lookups: LOOKUPS,
  });

  it('documento completo con título escapado y link al index', () => {
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<title>Datamart PYME</title>');
    expect(out).toContain('href="../index.html"');
  });
  it('embebe AMBOS SVGs como literales JS neutralizados', () => {
    expect(out).toContain(jsStringLiteral(svgL));
    expect(out).toContain(jsStringLiteral(svgP));
  });
  it('pestañas y toggle presentes', () => {
    expect(out).toContain('data-tab="diagram"');
    expect(out).toContain('data-tab="tables"');
    expect(out).toContain('data-mode="logical"');
    expect(out).toContain('data-mode="physical"');
  });
  it('secciones de tabla con ancla por nombre físico y metadata completa', () => {
    expect(out).toContain('id="t-MD_PARAMETRO"');
    expect(out).toContain('PK #1');
    expect(out).toContain('NOT NULL');
    expect(out).toContain('Texto Corto');
    expect(out).toContain('Frecuencia');
    expect(out).toContain('Capa');
    expect(out).toContain('Sensible');
  });
  it('la descripción con HTML sale ESCAPADA (anti-XSS)', () => {
    expect(out).toContain('Maestra &lt;b&gt;mensual&lt;/b&gt;');
    expect(out).not.toContain('Maestra <b>mensual</b>');
  });
  it('relación con par FK resuelto a nombres de columna', () => {
    expect(out).toContain('one → zero-many');
    expect(out).toContain('CODMES → CODMES');
  });
  it('final review #3 (doc 96 D6): la vista muestra su DDL generado y la User-Defined SQL como informativa aparte', () => {
    const page = buildCanvasPage({
      title: 'Datamart PYME', breadcrumb: ['Modelo DDV', 'CPYBCA'], indexHref: '../index.html',
      svgLogical: svgL, svgPhysical: svgP, diagram: fixtureDiagram(), lookups: LOOKUPS,
      viewDdl: { v1: 'CREATE OR REPLACE VIEW gold_vu.VW_VENTA AS SELECT t1.CODMES AS CODMES FROM gold.HD_VENTA t1;' },
    });
    const card = page.slice(page.indexOf('VW_VENTA'));
    expect(card).toContain('CREATE OR REPLACE VIEW gold_vu.VW_VENTA AS SELECT t1.CODMES');
    expect(card).toContain('User-Defined SQL — informational, not exported');
    expect(card.indexOf('SELECT t1.CODMES')).toBeLessThan(card.indexOf('WHERE x &lt; 1'));
    expect(page).not.toContain('<span class="chip">Regular</span>');
  });
  it('vista User-Defined SQL con su SQL escapado', () => {
    expect(out).toContain('VW_VENTA');
    expect(out).toContain('User-Defined SQL');
    expect(out).toContain('WHERE x &lt; 1');
  });
  it('canvas suelto (indexHref null) no pinta link al index', () => {
    const solo = buildCanvasPage({ title: 'X', breadcrumb: ['P'], indexHref: null, svgLogical: svgL, svgPhysical: svgP, diagram: fixtureDiagram(), lookups: { domainsById: {}, udpDefsById: {} } });
    expect(solo).not.toContain('class="idx-link"');
  });
});

import { buildIndexPage } from './exportPackagePages';

describe('buildIndexPage', () => {
  const out = buildIndexPage({
    rootName: 'CPYBCA', generatedAt: '2026-09-01 15:00 UTC',
    entries: [
      { name: 'Suelto', dir: [], file: 'Suelto.html', tables: [{ logical: 'Parametro', physical: 'MD_PARAMETRO' }] },
      { name: 'Datamart PYME', dir: ['CPYBCAPYM'], file: 'Datamart PYME.html', tables: [{ logical: 'Venta', physical: 'HD_VENTA' }, { logical: 'Mora', physical: 'HD_MORA' }] },
    ],
  });

  it('header con nombre, fecha y conteos', () => {
    expect(out).toContain('CPYBCA');
    expect(out).toContain('2026-09-01 15:00 UTC');
    expect(out).toContain('2 canvases · 3 tables');
  });
  it('links relativos con segmentos URL-encoded', () => {
    expect(out).toContain('href="Suelto.html"');
    expect(out).toContain('href="CPYBCAPYM/Datamart%20PYME.html"');
  });
  it('árbol con la carpeta como <details> abierto', () => {
    expect(out).toContain('<details open>');
    expect(out).toContain('CPYBCAPYM');
  });
  it('embebe el JSON del filtro (canvases + tablas) como literal JS', () => {
    expect(out).toContain('MD_PARAMETRO');
    expect(out).toContain('HD_MORA');
    expect(out).toContain('id="q"');
  });
});

import { udpChipsHtml } from './exportPackagePages';

describe('udpChipsHtml (doc 69 · facetas)', () => {
  const lk = {
    domainsById: {},
    udpDefsById: {
      p: { name: 'Universal', level: 'table' as const },
      l: { name: 'Universal', level: 'table' as const, view: 'logical' as const },
      c: { name: 'Campo Cross', level: 'column' as const },
    },
  };
  it('físicas primero con nombre plano; lógicas marcadas', () => {
    expect(udpChipsHtml({ l: 'Si', p: 'No', c: 'Si' }, 'table', lk)).toBe(
      '<span class="chip" title="UDP">Universal: No</span>'
      + '<span class="chip logical" title="Logical UDP (Entity/Attribute)">L · Universal: Si</span>',
    );
  });
  it('omite valores vacíos, defs de otro nivel y defs desconocidas', () => {
    expect(udpChipsHtml({ c: 'Si', p: '', zz: 'x' }, 'table', lk)).toBe('');
  });
});
