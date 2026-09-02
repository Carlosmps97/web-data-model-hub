// Doc 67: motor de layout del REPORTE PDF estilo Erwin. Páginas A4 en PUNTOS
// (595×842) emitidas como escenas de la IR del doc 59 (scale=1 en scenePdf).
// Puro: sin red ni DOM — testeable en node. La referencia analizada es
// PDF_DDV_REMVAR.pdf (ver plan-implementacion/67-EXPORT-PDF-REPORTE-ERWIN.md).

/** Página A4 en puntos y márgenes del reporte (aprox. de la referencia). */
export const A4 = { w: 595, h: 842, ml: 56, mr: 56, mt: 78, mb: 60 };

/** Anchos por CLASE de carácter (Helvetica aprox): la media plana de 0.55
 *  subestima textos EN MAYÚSCULAS (nombres físicos) y desbordaba celdas. */
const NARROW = /[ijltf.,:;'"|!()[\]]/;
export function estWidth(s: string, size: number, bold?: boolean): number {
  let u = 0;
  for (const ch of s) {
    if (ch === ' ') u += 0.28;
    else if (NARROW.test(ch)) u += 0.32;
    else if (ch >= 'a' && ch <= 'z') u += 0.5;
    else if (ch >= '0' && ch <= '9') u += 0.56;
    else u += 0.66;             // mayúsculas, acentuadas, símbolos anchos
  }
  return (bold ? u * 1.06 : u) * size;
}

/** Envuelve texto a `maxW` puntos: respeta `\n` del dato, corta por espacios
 *  y parte por caracteres la palabra que sola no cabe. Vacío → ['']. */
export function wrapText(s: string, maxW: number, size: number, bold?: boolean): string[] {
  const out: string[] = [];
  for (const rawLine of s.split('\n')) {
    const words = rawLine.split(' ');
    let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (estWidth(cand, size, bold) <= maxW) { line = cand; continue; }
      if (line) { out.push(line); line = ''; }
      let word = w;
      while (estWidth(word, size, bold) > maxW && word.length > 1) {
        let fit = 1;
        while (fit < word.length && estWidth(word.slice(0, fit + 1), size, bold) <= maxW) fit++;
        out.push(word.slice(0, fit));
        word = word.slice(fit);
      }
      line = word;
    }
    out.push(line);
  }
  return out;
}

// ═══ Reporte completo (doc 67) ═══════════════════════════════════════════
import type { SceneItem } from './exportScene';
import type { Diagram } from '../services/modeler.service';
import type { CanonicalColumn } from '@/features/governance/services/governance.service';
import type { PdfBookmark, ReportPage } from './scenePdf';

export interface ReportCanvasInput { name: string; location: string; diagram: Diagram }
export interface ModelReportInput { rootName: string; canvases: ReportCanvasInput[]; domainsById: Record<string, string> }

// Colores (aproximación visual de la referencia Erwin — ver doc 67 supuestos).
const C = { band: '#F2A0F0', bandBorder: '#8A8A8A', head: '#AEE9EF', border: '#9A9A9A', text: '#000000', dim: '#555555' };
const CONTENT_W = A4.w - A4.ml - A4.mr;      // 483pt
const LH = 9.5, PAD = 5, ROW_SIZE = 7;       // métrica de filas
const FULL_H = A4.h - A4.mt - A4.mb;         // alto útil de una página

/** Flujo de páginas: intercala páginas "builder" (A4 en pt, scale 1) con
 *  páginas de diagrama (escena doc 59 pass-through con scale de ajuste). */
interface Flow { pages: ReportPage[]; items: SceneItem[] | null; y: number }
const newFlow = (): Flow => ({ pages: [], items: null, y: 0 });
function openPage(f: Flow): void {
  const items: SceneItem[] = [];
  f.items = items;
  f.pages.push({ scene: { w: A4.w, h: A4.h, bg: '#FFFFFF', items }, scale: 1, links: [] });
  f.y = A4.mt;
}
function ensure(f: Flow, h: number): void {
  if (!f.items || f.y + h > A4.h - A4.mb) openPage(f);
}
const pageIdx = (f: Flow) => f.pages.length - 1;

function text(f: Flow, x: number, y: number, s: string, size: number, o: { bold?: boolean; color?: string; anchor?: 'middle' | 'end' } = {}): void {
  f.items!.push({ k: 'text', x, y, s, size, color: o.color ?? C.text, bold: o.bold, anchor: o.anchor });
}

/** Banda de sección magenta (estilo Erwin). Devuelve la página donde cayó. */
function band(f: Flow, title: string): number {
  ensure(f, 30);
  f.y += 6;
  f.items!.push({ k: 'rect', x: A4.ml, y: f.y, w: CONTENT_W, h: 18, fill: C.band, stroke: C.bandBorder, sw: 0.75 });
  text(f, A4.ml + 6, f.y + 13, title, 10, { bold: true });
  f.y += 22;
  return pageIdx(f);
}

/** Header de columnas cyan. */
function gridHeader(f: Flow, cols: string[], widths: number[]): void {
  ensure(f, 13 + LH + PAD);   // que no quede huérfano sin al menos una fila
  let x = A4.ml;
  cols.forEach((label, i) => {
    f.items!.push({ k: 'rect', x, y: f.y, w: widths[i], h: 13, fill: C.head, stroke: C.border, sw: 0.5 });
    text(f, x + 3, f.y + 9.5, label, ROW_SIZE, { bold: true });
    x += widths[i];
  });
  f.y += 13;
}

/** Fila de grid: celdas envueltas, alto = celda más alta; si no cabe entera
 *  y sí cabría en página nueva, salta; si es más alta que una página, se
 *  PARTE por líneas (continúa con los mismos bordes). Devuelve la página de
 *  su primera línea. */
function gridRow(f: Flow, cells: string[], widths: number[]): number {
  const wrapped = cells.map((c, i) => wrapText(c ?? '', widths[i] - 6, ROW_SIZE));
  const lineCount = Math.max(...wrapped.map((l) => l.length));
  const rowH = lineCount * LH + PAD;
  if (!f.items) openPage(f);
  if (f.y + rowH > A4.h - A4.mb && rowH <= FULL_H) openPage(f);
  let lineStart = 0, firstPage = -1;
  while (lineStart < lineCount) {
    if (!f.items) openPage(f);
    const avail = A4.h - A4.mb - f.y;
    let n = Math.floor((avail - PAD) / LH);
    if (n < 1) { openPage(f); continue; }
    n = Math.min(n, lineCount - lineStart);
    const h = n * LH + PAD;
    if (firstPage === -1) firstPage = pageIdx(f);
    let x = A4.ml;
    wrapped.forEach((lines, ci) => {
      f.items!.push({ k: 'rect', x, y: f.y, w: widths[ci], h, stroke: C.border, sw: 0.5 });
      for (let k = 0; k < n; k++) {
        const s = lines[lineStart + k];
        if (s) text(f, x + 3, f.y + 8 + k * LH, s, ROW_SIZE);
      }
      x += widths[ci];
    });
    f.y += h;
    lineStart += n;
  }
  return firstPage;
}

/** Página(s) del TOC. `numberFor` devuelve el número YA desplazado (o '' en
 *  la pasada de conteo — el número no altera el layout: columna reservada). */
interface TocEntry { title: string; level: number; cIdx: number }
function buildTocPages(entries: TocEntry[], numberFor: (cIdx: number) => string, targetFor?: (cIdx: number) => number): Flow {
  const f = newFlow();
  openPage(f);
  text(f, A4.w / 2, f.y + 8, 'Table Of Contents', 11, { bold: true, anchor: 'middle' });
  f.y += 26;
  for (const e of entries) {
    const indent = e.level * 12;
    const maxW = CONTENT_W - indent - 40;      // 40pt reservados para el número
    const lines = wrapText(e.title, maxW, 8);
    ensure(f, lines.length * 10.5 + 1);
    lines.forEach((s, k) => {
      text(f, A4.ml + indent, f.y + 8, s, 8);
      if (k === 0) {
        const num = numberFor(e.cIdx);
        if (num) text(f, A4.w - A4.mr, f.y + 8, num, 8, { anchor: 'end' });
        // Hipervínculo (r2): toda la línea de la entrada salta a su página.
        if (targetFor) f.pages[f.pages.length - 1].links!.push({ x: A4.ml + indent, y: f.y, w: CONTENT_W - indent, h: 10.5, pageIndex: targetFor(e.cIdx) });
      }
      f.y += 10.5;
    });
  }
  return f;
}

/** Reporte completo estilo Erwin: portada · TOC · secciones · diagramas ·
 *  index — páginas + bookmarks listos para `buildReportPdf`. */
export function buildModelReport(input: ModelReportInput): { pages: ReportPage[]; bookmarks: PdfBookmark[] } {
  const { rootName, canvases, domainsById } = input;

  // ── Pasada de CONTENIDO (cIdx 0-based, luego se desplaza) ──
  const f = newFlow();
  const tocEntries: TocEntry[] = [];
  const indexMap = new Map<string, Set<number>>();       // physName → cIdx set
  interface CanvasMarks { name: string; page: number; tables: { name: string; page: number }[] }
  const marks: CanvasMarks[] = [];

  const saBand = band(f, `Subject Area(s) of Model "${rootName}"`);
  tocEntries.push({ title: `Subject Area(s) of Model "${rootName}"`, level: 0, cIdx: saBand });
  gridHeader(f, ['Name', 'Location'], [190, 293]);
  for (const cv of canvases) gridRow(f, [cv.name, cv.location], [190, 293]);

  for (const cv of canvases) {
    // r2 (pedido owner): SIN páginas de diagrama — el canvas apunta a su Table(s).
    const tables = [...cv.diagram.tables].sort((a, b) => a.physicalName.localeCompare(b.physicalName));
    const tBand = band(f, `Table(s) of Subject Area "${cv.name}"`);
    tocEntries.push({ title: cv.name, level: 0, cIdx: tBand });
    const mark: CanvasMarks = { name: cv.name, page: tBand, tables: [] };
    marks.push(mark);
    tocEntries.push({ title: `Table(s) of Subject Area "${cv.name}"`, level: 1, cIdx: tBand });
    gridHeader(f, ['Physical Name', 'Comments'], [190, 293]);
    for (const t of tables) gridRow(f, [t.physicalName, t.description ?? ''], [190, 293]);

    const colsByTable = new Map<string, CanonicalColumn[]>();
    for (const c of cv.diagram.columns) {
      const arr = colsByTable.get(c.tableId); if (arr) arr.push(c); else colsByTable.set(c.tableId, [c]);
    }
    const W = [95, 80, 142, 30, 80, 56];   // suma CONTENT_W (483)
    for (const t of tables) {
      const cBand = band(f, `Column(s) of Table "${t.physicalName}"`);
      tocEntries.push({ title: `Column(s) of Table "${t.physicalName}"`, level: 2, cIdx: cBand });
      mark.tables.push({ name: t.physicalName, page: cBand });
      gridHeader(f, ['Physical Name', 'Logical Name', 'Comments', 'Is PK', 'Physical Data Type', 'Domain'], W);
      const cols = [...(colsByTable.get(t.id) ?? [])].sort((a, b) => a.ordinal - b.ordinal);
      for (const c of cols) {
        const pg = gridRow(f, [
          c.physicalName, c.logicalName, c.description ?? '',
          c.isPrimaryKey ? 'true' : 'false', c.dataType,
          (c.parentDomainId && domainsById[c.parentDomainId]) || '',
        ], W);
        const set = indexMap.get(c.physicalName); if (set) set.add(pg); else indexMap.set(c.physicalName, new Set([pg]));
      }
    }
  }
  const contentPages = f.pages;

  // ── TOC en dos pasadas (el conteo no depende de los números) ──
  const tocCount = buildTocPages(tocEntries, () => '').pages.length;
  const offset = 1 + tocCount;                            // portada + TOC
  const display = (cIdx: number) => String(offset + cIdx + 1);
  const tocFlow = buildTocPages(tocEntries, display, (cIdx) => offset + cIdx);

  // ── Index alfabético de columnas (después de conocer offset) ──
  const g = newFlow();
  openPage(g);
  text(g, A4.w / 2, g.y + 10, 'Index', 13, { bold: true, anchor: 'middle' });
  g.y += 30;
  const names = [...indexMap.keys()].sort((a, b) => a.localeCompare(b));
  let letter = '';
  for (const name of names) {
    const first = (name[0] ?? '#').toUpperCase();
    if (first !== letter) {
      letter = first;
      ensure(g, 16 + 12);
      g.y += 4;
      text(g, A4.ml, g.y + 10, letter, 11, { bold: true });
      g.y += 16;
    }
    // r2: cada número de página es un LINK individual (números en azul, como
    // la referencia Erwin — sus números cyan son hipervínculos).
    ensure(g, LH + 1);
    text(g, A4.ml, g.y + 8, name, ROW_SIZE);
    let x = A4.ml + estWidth(name, ROW_SIZE) + 8;
    const targets = [...indexMap.get(name)!].sort((a, b) => a - b);
    targets.forEach((cIdx, k) => {
      const numStr = display(cIdx);
      const wNum = estWidth(numStr, ROW_SIZE);
      if (x + wNum > A4.w - A4.mr) {
        g.y += LH;
        if (g.y + LH > A4.h - A4.mb) openPage(g);
        x = A4.ml + 14;
      }
      g.items!.push({ k: 'text', x, y: g.y + 8, s: numStr, size: ROW_SIZE, color: '#1F7AC4' });
      g.pages[g.pages.length - 1].links!.push({ x, y: g.y, w: wNum, h: LH, pageIndex: offset + cIdx });
      x += wNum;
      if (k < targets.length - 1) { text(g, x, g.y + 8, ',', ROW_SIZE); x += estWidth(', ', ROW_SIZE); }
    });
    g.y += LH;
  }
  const indexPages = g.pages;

  // ── Portada ──
  const cover = newFlow();
  openPage(cover);
  text(cover, A4.w / 2, A4.h / 2, `Report '${rootName}'`, 22, { bold: true, anchor: 'middle' });

  const pages: ReportPage[] = [...cover.pages, ...tocFlow.pages, ...contentPages, ...indexPages];

  // ── Header/footer en TODAS las páginas (diagramas: coords ÷ escala) ──
  const total = pages.length;
  pages.forEach((p, i) => {
    p.scene.items.push(
      { k: 'text', x: A4.ml, y: 30, s: rootName, size: 7, color: C.dim },
      { k: 'text', x: A4.w / 2, y: A4.h - 22, s: `Page ${i + 1} of ${total}`, size: 7, color: C.dim, anchor: 'middle' },
    );
  });

  // ── Bookmarks jerárquicos ──
  const shift = (cIdx: number) => offset + cIdx;
  const idxStart = offset + contentPages.length;
  const bookmarks: PdfBookmark[] = [{
    title: rootName, pageIndex: 0, children: [
      { title: 'Table Of Contents', pageIndex: 1 },
      { title: `Subject Area(s) of Model "${rootName}"`, pageIndex: shift(saBand) },
      ...marks.map((m) => ({
        title: m.name, pageIndex: shift(m.page),
        children: m.tables.map((t) => ({ title: t.name, pageIndex: shift(t.page) })),
      })),
      { title: 'Index', pageIndex: idxStart },
    ],
  }];

  return { pages, bookmarks };
}
