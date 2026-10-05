import { describe, expect, it } from 'vitest';
import type { Scene } from './exportScene';
import { buildDiagramSvg } from './sceneSvg';

const scene = (items: Scene['items']): Scene => ({ w: 640, h: 400, bg: '#FBFCFD', items });

describe('buildDiagramSvg', () => {
  it('documento SVG con tamaño, viewBox y fondo', () => {
    const out = buildDiagramSvg(scene([]));
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out).toContain('width="640"');
    expect(out).toContain('viewBox="0 0 640 400"');
    expect(out).toContain('fill="#FBFCFD"');
    expect(out.trim().endsWith('</svg>')).toBe(true);
  });

  it('rect con radio, borde y dash', () => {
    const out = buildDiagramSvg(scene([{ k: 'rect', x: 1, y: 2, w: 30, h: 40, rx: 11, stroke: '#C5CCD8', sw: 2, dash: '6 5' }]));
    expect(out).toContain('<rect x="1" y="2" width="30" height="40" rx="11"');
    expect(out).toContain('stroke-dasharray="6 5"');
    expect(out).toContain('fill="none"');
  });

  it('rect rtop = path con SOLO las esquinas de arriba redondeadas', () => {
    const out = buildDiagramSvg(scene([{ k: 'rect', x: 0, y: 0, w: 100, h: 32, rx: 11, rtop: true, fill: '#1A2B4A' }]));
    expect(out).toContain('<path d="M0,32');
    expect(out).toContain('fill="#1A2B4A"');
  });

  it('texto: escape XML, anchor, mono, bold, italic y letter-spacing', () => {
    const out = buildDiagramSvg(scene([
      { k: 'text', x: 5, y: 9, s: 'a<b>&"c"', size: 12, color: '#3A4658', mono: true, bold: true, anchor: 'end' },
      { k: 'text', x: 5, y: 20, s: 'fx', size: 9, color: '#7A8598', italic: true, ls: 1.3 },
    ]));
    expect(out).toContain('a&lt;b&gt;&amp;"c"');
    expect(out).toContain('text-anchor="end"');
    expect(out).toContain('Geist Mono');
    expect(out).toContain('font-weight="700"');
    expect(out).toContain('font-style="italic"');
    expect(out).toContain('letter-spacing="1.3"');
  });

  it('hatch: define el pattern una sola vez y lo referencia', () => {
    const out = buildDiagramSvg(scene([
      { k: 'hatch', x: 0, y: 0, w: 50, h: 50 },
      { k: 'hatch', x: 60, y: 0, w: 50, h: 50 },
    ]));
    expect(out.split('<pattern').length).toBe(2);          // 1 sola definición
    expect(out).toContain('url(#dmh-hatch)');
  });

  it('poly, ellipse, line con cap y path', () => {
    const out = buildDiagramSvg(scene([
      { k: 'poly', pts: [[0, 0], [10, 0], [5, 8]], fill: '#16A37B1A', stroke: '#16A37B', sw: 2, join: 'round' },
      { k: 'ellipse', cx: 4, cy: 5, rx: 3, ry: 2, stroke: '#E0A024', sw: 1.5 },
      { k: 'line', x1: 0, y1: 0, x2: 9, y2: 9, stroke: '#2E5BFF', sw: 2.4, cap: 'round' },
      { k: 'path', d: 'M0,0 L5,5', stroke: '#3A4658', sw: 1.5 },
    ]));
    expect(out).toContain('<polygon points="0,0 10,0 5,8"');
    expect(out).toContain('<ellipse cx="4" cy="5" rx="3" ry="2"');
    expect(out).toContain('stroke-linecap="round"');
    expect(out).toContain('<path d="M0,0 L5,5"');
  });

  it('incluye el CSS de fuentes embebido si se pasa', () => {
    const out = buildDiagramSvg(scene([]), { fontCss: '@font-face { font-family: X; }' });
    expect(out).toContain('<style>@font-face { font-family: X; }</style>');
  });
});

describe('buildDiagramSvg — texto de dibujos (doc 109)', () => {
  it('familia elegida (con la de la app de respaldo) y subrayado', () => {
    const out = buildDiagramSvg(scene([{ k: 'text', x: 1, y: 2, s: 'Hola', size: 16, color: '#000000', font: 'Arial', underline: true }]));
    expect(out).toContain('font-family="&quot;Arial&quot;, ');
    expect(out).toContain('text-decoration="underline"');
  });
  it('sin familia ni subrayado, como siempre; la sangría de Erwin se conserva', () => {
    const out = buildDiagramSvg(scene([{ k: 'text', x: 1, y: 2, s: '   Título', size: 16, color: '#000000' }]));
    expect(out).not.toContain('text-decoration');
    expect(out).not.toContain('&quot;');
    expect(out).toContain('xml:space="preserve"');
  });
  it('una familia con comillas no rompe el atributo', () => {
    const out = buildDiagramSvg(scene([{ k: 'text', x: 1, y: 2, s: 'x', size: 16, color: '#000000', font: 'Bad"<Font' }]));
    expect(out).toMatch(/font-family="[^"]*Bad\\&quot;&lt;Font[^"]*"/);
  });
});
