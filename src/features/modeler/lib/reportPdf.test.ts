import { describe, expect, it } from 'vitest';
import { A4, estWidth, wrapText, buildModelReport } from './reportPdf';
import type { Diagram } from '../services/modeler.service';

describe('estWidth', () => {
  it('anchos por clase de carácter (mayúsculas anchas, bold +6%)', () => {
    expect(estWidth('abcd', 10)).toBeCloseTo(20, 5);      // minúsculas 0.5
    expect(estWidth('abcd', 10, true)).toBeCloseTo(21.2, 5);
    expect(estWidth('ABCD', 10)).toBeCloseTo(26.4, 5);    // mayúsculas 0.66
  });
});

describe('wrapText', () => {
  it('corta por espacios sin exceder el ancho', () => {
    expect(wrapText('aaa bbb ccc', 38.5, 10)).toEqual(['aaa bbb', 'ccc']);
  });
  it('palabra más larga que el ancho se parte por caracteres', () => {
    expect(wrapText('abcdefghij', 22, 10)).toEqual(['abcd', 'efghi', 'j']);   // f/i angostas: caben 5
  });
  it('respeta saltos de línea del dato', () => {
    expect(wrapText('a\nb', 100, 10)).toEqual(['a', 'b']);
  });
  it('vacío → una línea vacía', () => {
    expect(wrapText('', 100, 10)).toEqual(['']);
  });
});

describe('A4', () => {
  it('página en puntos con márgenes', () => {
    expect(A4.w).toBe(595);
    expect(A4.h).toBe(842);
    expect(A4.ml).toBeGreaterThan(0);
  });
});

const T = (id: string, phys: string, log: string, desc?: string) => ({ id, physicalName: phys, logicalName: log, description: desc });
const col = (id: string, tableId: string, phys: string, opts: object = {}) => ({ id, tableId, physicalName: phys, logicalName: phys.toLowerCase(), dataType: 'INT', typeOverridden: false, ordinal: 0, ...opts });
const dia = (tables: object[], columns: object[]): Diagram => ({
  subjectArea: { id: 's', projectId: 'p', name: 'x', tableIds: [], layout: {} },
  tables, columns, relationships: [], views: [],
} as unknown as Diagram);

const bigCols = Array.from({ length: 60 }, (_, i) => col(`c${i}`, 'tb', `COL_${i}`, { description: 'Descripción larga que envuelve para dar altura a la fila del reporte y forzar paginación real de la sección. '.repeat(2) }));

const INPUT = {
  rootName: 'CPYBCA',
  domainsById: { d1: 'Texto Corto' },
  canvases: [
    { name: 'A', location: 'CPYBCAPYM', diagram: dia(
        [T('t1', 'HD_VENTA', 'Venta', 'Histórica diaria de ventas'), T('t2', 'MD_PARAMETRO', 'Parametro')],
        [col('c1', 't1', 'CODMES', { isPrimaryKey: true, parentDomainId: 'd1', description: 'Código de mes' }), col('c2', 't1', 'DESPARAM'), col('c3', 't2', 'CODMES')],
      ) },
    { name: 'B', location: '', diagram: dia([T('tb', 'BIG', 'Big')], bigCols) },
  ],
};

const rep = buildModelReport(INPUT);
const texts = rep.pages.map((p) => p.scene.items.filter((i) => i.k === 'text').map((i) => (i as { s: string }).s).join('\n'));
const toc = texts.findIndex((t) => t.includes('Table Of Contents'));
const pageAfterToc = (needle: string) => texts.findIndex((t, i) => i > toc && t.includes(needle));

describe('buildModelReport (r2: sin diagramas + hipervínculos)', () => {
  it('portada con título y footer `Page N of M` en TODAS las páginas', () => {
    expect(texts[0]).toContain("Report 'CPYBCA'");
    texts.forEach((t, i) => expect(t).toContain(`Page ${i + 1} of ${rep.pages.length}`));
  });

  it('SIN diagramas: todas las páginas son A4 (scale 1) y no hay banda ER', () => {
    expect(rep.pages.every((p) => p.scale === 1)).toBe(true);
    expect(texts.some((t) => t.includes('ER Diagram(s)'))).toBe(false);
  });

  it('TOC en página 2, números correctos y LINK por entrada a su página', () => {
    expect(toc).toBe(1);
    const items = rep.pages[toc].scene.items.filter((i) => i.k === 'text') as { s: string; y: number; anchor?: string }[];
    const entry = items.find((i) => i.s.startsWith('Column(s) of Table "HD_VENTA"'));
    expect(entry).toBeTruthy();
    const target = pageAfterToc('Column(s) of Table "HD_VENTA"');
    const num = items.find((i) => i.anchor === 'end' && Math.abs(i.y - entry!.y) < 11);
    expect(num!.s).toBe(String(target + 1));
    const links = rep.pages[toc].links ?? [];
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.pageIndex === target)).toBe(true);
    links.forEach((l) => { expect(l.pageIndex).toBeGreaterThan(toc); expect(l.pageIndex).toBeLessThan(rep.pages.length); });
  });

  it('secciones estilo Erwin con dominio resuelto e Is PK true/false', () => {
    expect(pageAfterToc('Subject Area(s) of Model "CPYBCA"')).toBeGreaterThan(toc);
    const p = pageAfterToc('Column(s) of Table "HD_VENTA"');
    expect(texts[p]).toContain('CODMES');
    expect(texts[p]).toContain('Texto Corto');
    expect(texts[p]).toContain('true');
    expect(texts[p]).toContain('Código de mes');
    expect(texts[pageAfterToc('Table(s) of Subject Area "A"')]).toContain('Histórica diaria de ventas');
  });

  it('paginación: la tabla BIG fluye a más páginas', () => {
    const band = pageAfterToc('Column(s) of Table "BIG"');
    const lastRow = texts.findIndex((t, i) => i > toc && t.includes('COL_59'));
    expect(band).toBeGreaterThan(toc);
    expect(lastRow).toBeGreaterThan(band);
  });

  it('Index con links en los números de página', () => {
    const idx = rep.pages.findIndex((p) => p.scene.items.some((i) => i.k === 'text' && i.s === 'Index' && i.bold));
    expect(idx).toBeGreaterThan(toc);
    expect(texts[idx]).toContain('CODMES');
    const links = rep.pages[idx].links ?? [];
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => { expect(l.pageIndex).toBeGreaterThan(toc); expect(l.pageIndex).toBeLessThan(idx); });
  });

  it('bookmarks: root → canvas (a su Table(s)) → tablas', () => {
    const root = rep.bookmarks[0];
    expect(root.title).toBe('CPYBCA');
    const canvasA = root.children!.find((c) => c.title === 'A');
    expect(canvasA!.pageIndex).toBe(pageAfterToc('Table(s) of Subject Area "A"'));
    const tblBm = canvasA!.children!.find((c) => c.title === 'HD_VENTA')!;
    expect(tblBm.pageIndex).toBe(pageAfterToc('Column(s) of Table "HD_VENTA"'));
  });
});
