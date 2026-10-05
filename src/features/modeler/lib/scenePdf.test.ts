import { describe, expect, it } from 'vitest';
import type { Scene } from './exportScene';
import { buildDiagramPdf, winAnsiEncode } from './scenePdf';

const scene = (items: Scene['items'], w = 640, h = 400): Scene => ({ w, h, bg: '#FBFCFD', items });
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

describe('winAnsiEncode', () => {
  it('pasa Latin-1, mapea … y comillas, degrada lo demás a ?', () => {
    const out = winAnsiEncode('Ñandú…“x”→');
    expect(out.charCodeAt(0)).toBe(0xD1);        // Ñ
    expect(out.includes(String.fromCharCode(0x85))).toBe(true);   // …
    expect(out.includes(String.fromCharCode(0x93))).toBe(true);   // “
    expect(out.endsWith('?')).toBe(true);        // → no existe en WinAnsi
  });
});

describe('buildDiagramPdf', () => {
  it('PDF válido: header, MediaBox a 0.75pt/px y EOF', () => {
    const s = dec(buildDiagramPdf(scene([])));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/MediaBox [0 0 480 300]');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('capa el tamaño de página al techo ISO de 14400pt', () => {
    const s = dec(buildDiagramPdf(scene([], 40000, 400)));
    expect(s).toContain('/MediaBox [0 0 14400 144]');
  });

  it('xref: cada offset apunta a su `N 0 obj` y startxref al xref', () => {
    const s = dec(buildDiagramPdf(scene([{ k: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#ffffff' }])));
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...s.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(10);
    entries.forEach((off, i) => expect(s.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
  });

  it('el /Length del content stream es exacto', () => {
    const s = dec(buildDiagramPdf(scene([{ k: 'line', x1: 0, y1: 0, x2: 5, y2: 5, stroke: '#000000', sw: 1 }])));
    const m = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(s)!;
    expect(m[2].length).toBe(Number(m[1]));
  });

  it('texto: fuente Courier para mono, escape de paréntesis, Tj presente', () => {
    const s = dec(buildDiagramPdf(scene([
      { k: 'text', x: 10, y: 20, s: 'a(b)c\\', size: 12, color: '#3A4658', mono: true },
    ])));
    expect(s).toContain('/F3 9 Tf');             // 12px · 0.75
    expect(s).toContain('(a\\(b\\)c\\\\) Tj');
    expect(s).toContain('BT');
  });

  it('trazos: dash escalado, rect redondeado como path, colores 0..1', () => {
    const s = dec(buildDiagramPdf(scene([
      { k: 'rect', x: 0, y: 0, w: 100, h: 50, rx: 11, stroke: '#C5CCD8', sw: 2, dash: '6 5' },
      { k: 'path', d: 'M0,0 L10,0 Q20,0 20,10', stroke: '#3A4658', sw: 1.5 },
    ])));
    expect(s).toContain('[4.5 3.75] 0 d');
    expect(s).toMatch(/c\n/);                     // esquinas y Q→C como curvas cúbicas
    expect(s).toContain('0.773 0.8 0.847 RG');    // #C5CCD8
  });

  it('fill hex de 8 dígitos (alpha) se pre-mezcla sobre el fondo', () => {
    const s = dec(buildDiagramPdf(scene([
      { k: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#0000001A' },   // negro al 10%
    ])));
    // alpha 0x1A=0.102: 0.898·(#FBFCFD) → 0.884 0.887 0.891
    expect(s).toContain('0.884 0.887 0.891 rg');
  });
});

import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import { buildMultiDiagramPdf } from './scenePdf';

describe('buildMultiDiagramPdf', () => {
  const pages = [
    { scene: scene([{ k: 'rect' as const, x: 0, y: 0, w: 10, h: 10, fill: '#ffffff' }]), title: 'CPYBCAPYM / Datamart PYME — Logical' },
    { scene: scene([{ k: 'line' as const, x1: 0, y1: 0, x2: 5, y2: 5, stroke: '#000000', sw: 1 }], 320, 200), title: 'Suelto — Physical' },
  ];

  it('N páginas: /Count, Kids y un MediaBox por página (tamaños propios)', () => {
    const s = dec(buildMultiDiagramPdf(pages));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Kids [3 0 R 4 0 R] /Count 2');
    expect(s).toContain('/MediaBox [0 0 480 300]');
    expect(s).toContain('/MediaBox [0 0 240 150]');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('bookmarks: /Outlines con un item por página y títulos WinAnsi', () => {
    const s = dec(buildMultiDiagramPdf(pages));
    expect(s).toContain('/Outlines');
    expect(s).toContain('/PageMode /UseOutlines');
    expect(s).toContain('/Count 2 >>');
    expect(s).toContain('(CPYBCAPYM / Datamart PYME');   // el em-dash va como byte 0x97
    expect(s).toContain('(Suelto');
    expect(s).toContain('/Fit]');
  });

  it('xref: cada offset apunta a su `N 0 obj` (9+3N objetos)', () => {
    const s = dec(buildMultiDiagramPdf(pages));
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...s.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(9 + 3 * 2);
    entries.forEach((off, i) => expect(s.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
  });

  it('compress: streams con /FlateDecode, /Length exacto y contenido recuperable', () => {
    const s = dec(buildMultiDiagramPdf(pages, { compress: (raw) => zlibSync(raw) }));
    expect(s).toContain('/Filter /FlateDecode');
    const m = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(s)!;
    const start = m.index + m[0].length;
    const body = s.slice(start, start + Number(m[1]));
    const raw = strFromU8(unzlibSync(strToU8(body, true)), true);
    expect(raw).toContain(' re');                 // operadores PDF del rect
  });

  it('sin páginas → throw', () => {
    expect(() => buildMultiDiagramPdf([])).toThrow();
  });
});

import { buildReportPdf } from './scenePdf';

describe('buildReportPdf', () => {
  const pages = [
    { scene: scene([{ k: 'text' as const, x: 40, y: 60, s: 'Report cover', size: 22, color: '#000000' }], 595, 842), scale: 1 },
    { scene: scene([{ k: 'rect' as const, x: 0, y: 0, w: 10, h: 10, fill: '#ffffff' }]) },   // sin scale → regla 0.75
  ];
  const bookmarks = [
    { title: 'Root doc', pageIndex: 0, children: [
      { title: 'Canvas A', pageIndex: 1, children: [{ title: 'T1', pageIndex: 1 }] },
    ] },
  ];

  it('scale 1 → la página queda en puntos A4 exactos; sin scale → regla 0.75', () => {
    const s = dec(buildReportPdf(pages, bookmarks));
    expect(s).toContain('/MediaBox [0 0 595 842]');
    expect(s).toContain('/MediaBox [0 0 480 300]');
  });

  it('outline JERÁRQUICO: títulos, /Count de descendientes y /Dest a la página', () => {
    const s = dec(buildReportPdf(pages, bookmarks));
    expect(s).toContain('(Root doc)');
    expect(s).toContain('(Canvas A)');
    expect(s).toContain('(T1)');
    expect(s).toContain('/Dest [3 0 R /Fit]');       // Root doc → página 0 (obj 3)
    expect(s).toContain('/Dest [4 0 R /Fit]');       // Canvas A y T1 → página 1 (obj 4)
    expect(s).toMatch(/\(Canvas A\)[^(]*\/Count 1/); // Canvas A tiene 1 descendiente
  });

  it('xref exacto con 9+2N+M objetos (N=2 páginas, M=3 bookmarks)', () => {
    const s = dec(buildReportPdf(pages, bookmarks));
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...s.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(9 + 2 * 2 + 3);
    entries.forEach((off, i) => expect(s.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
  });

  it('acepta compresor de streams', () => {
    const s = dec(buildReportPdf(pages, bookmarks, { compress: (raw) => zlibSync(raw) }));
    expect(s).toContain('/Filter /FlateDecode');
  });
});

describe('buildReportPdf · links', () => {
  it('página con links → /Annots /Link con /Rect transformado y /Dest', () => {
    const pgs = [
      { scene: scene([], 595, 842), scale: 1, links: [{ x: 56, y: 100, w: 400, h: 10, pageIndex: 1 }] },
      { scene: scene([], 595, 842), scale: 1 },
    ];
    const s = dec(buildReportPdf(pgs, [{ title: 'X', pageIndex: 0 }]));
    expect(s).toContain('/Annots');
    expect(s).toContain('/Subtype /Link');
    expect(s).toContain('/Rect [56 732 456 742]');     // y PDF invertida: 842-110 / 842-100
    expect(s).toContain('/Dest [4 0 R /Fit]');         // página 1 → obj 4
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...s.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(9 + 2 * 2 + 1 + 1);    // 9+2N+M+A
    entries.forEach((off, i) => expect(s.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`));
  });
});


describe('buildDiagramPdf — factor de ancho por texto (doc 98)', () => {
  const tdX = (pdf: string, text: string) => {
    const m = new RegExp(`([\\d.]+) [\\d.]+ Td\\n\\(${text}\\) Tj`).exec(pdf);
    return m ? Number(m[1]) : NaN;
  };
  const label = (wf?: number) => dec(buildDiagramPdf(scene([
    { k: 'text', x: 200, y: 100, s: 'Persona tiene', size: 11, color: '#3A4658', anchor: 'middle', ...(wf ? { wf } : {}) },
  ])));

  it('sin factor propio usa el de la fuente (0.55): 13 caracteres × 11 × 0.55 / 2 a la izquierda', () => {
    expect(tdX(label(), 'Persona tiene')).toBeCloseTo((200 - (13 * 11 * 0.55) / 2) * 0.75, 1);
  });
  it('con factor propio (0.5) el texto queda centrado con ESE ancho', () => {
    expect(tdX(label(0.5), 'Persona tiene')).toBeCloseTo((200 - (13 * 11 * 0.5) / 2) * 0.75, 1);
  });
});


describe('buildDiagramPdf — texto de dibujos (doc 109)', () => {
  it('subrayado = una línea bajo el texto, del color del texto', () => {
    const pdf = dec(buildDiagramPdf(scene([{ k: 'text', x: 10, y: 50, s: 'Hola', size: 16, color: '#C00000', underline: true }])));
    // bajo la línea base (262.5) y del ancho estimado: 4 × 16 px × 0.55 × 0.75
    expect(pdf).toContain('(Hola) Tj\nET Q\nq 0.753 0 0 RG 0.72 w 7.5 261.06 m 33.9 261.06 l S Q');
  });
  it('una familia monoespaciada sale en Courier; las demás en Helvetica', () => {
    const mono = dec(buildDiagramPdf(scene([{ k: 'text', x: 10, y: 50, s: 'A', size: 16, color: '#000000', font: 'Courier New' }])));
    const sans = dec(buildDiagramPdf(scene([{ k: 'text', x: 10, y: 50, s: 'A', size: 16, color: '#000000', font: 'Arial', bold: true }])));
    expect(mono).toMatch(/\/F3 12 Tf/);
    expect(sans).toMatch(/\/F2 12 Tf/);
  });
});
