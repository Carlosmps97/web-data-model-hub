// Escena → SVG standalone. Texto como <text> (vectorial, nítido a
// cualquier zoom), hatch de vistas como <pattern>, fuentes embebibles vía
// opts.fontCss (@font-face con data URLs — el archivo funciona offline).
import type { Scene, SceneItem } from './exportScene';

const MONO = "'Geist Mono Variable', ui-monospace, 'JetBrains Mono', monospace";
const UI = "'Geist Variable', -apple-system, 'Segoe UI', sans-serif";

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
/** Valor de atributo: `"` y `&` escapados (la familia viene entre comillas). */
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const n = (v: number) => String(Math.round(v * 100) / 100);

/** Atributos con omisión de undefined. Los valores ya vienen saneados. */
function at(o: Record<string, string | number | undefined>): string {
  let out = '';
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') out += ` ${k}="${v}"`;
  return out;
}

const strokeAt = (i: { stroke?: string; sw?: number; dash?: string }) => ({
  stroke: i.stroke, 'stroke-width': i.stroke ? n(i.sw ?? 1) : undefined, 'stroke-dasharray': i.dash,
});

/** Header con solo las esquinas superiores redondeadas (cuadráticas: paridad
 *  con la conversión Q→C del PDF). */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${n(x)},${n(y + h)} L${n(x)},${n(y + r)} Q${n(x)},${n(y)} ${n(x + r)},${n(y)} L${n(x + w - r)},${n(y)} Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + r)} L${n(x + w)},${n(y + h)} Z`;
}

function item(i: SceneItem, defs: { hatch: boolean }): string {
  switch (i.k) {
    case 'rect':
      if (i.rtop) return `<path d="${roundedTop(i.x, i.y, i.w, i.h, i.rx ?? 0)}"${at({ fill: i.fill ?? 'none', ...strokeAt(i) })}/>`;
      return `<rect x="${n(i.x)}" y="${n(i.y)}" width="${n(i.w)}" height="${n(i.h)}"${at({ rx: i.rx !== undefined ? n(i.rx) : undefined, fill: i.fill ?? 'none', ...strokeAt(i) })}/>`;
    case 'hatch':
      defs.hatch = true;
      return `<rect x="${n(i.x)}" y="${n(i.y)}" width="${n(i.w)}" height="${n(i.h)}" fill="url(#dmh-hatch)"/>`;
    case 'ellipse':
      return `<ellipse cx="${n(i.cx)}" cy="${n(i.cy)}" rx="${n(i.rx)}" ry="${n(i.ry)}"${at({ fill: i.fill ?? 'none', ...strokeAt(i) })}/>`;
    case 'line':
      return `<line x1="${n(i.x1)}" y1="${n(i.y1)}" x2="${n(i.x2)}" y2="${n(i.y2)}"${at({ ...strokeAt(i), 'stroke-linecap': i.cap })}/>`;
    case 'poly':
      return `<polygon points="${i.pts.map(([px, py]) => `${n(px)},${n(py)}`).join(' ')}"${at({ fill: i.fill ?? 'none', ...strokeAt(i), 'stroke-linejoin': i.join })}/>`;
    case 'path':
      return `<path d="${i.d}"${at({ fill: i.fill ?? 'none', ...strokeAt(i) })}/>`;
    case 'text':
      return `<text x="${n(i.x)}" y="${n(i.y)}"${at({
        // La familia elegida en un dibujo, con la de la app de respaldo.
        'font-family': i.mono ? MONO : i.font ? `${escAttr(JSON.stringify(i.font))}, ${UI}` : UI,
        'font-size': n(i.size),
        'font-weight': i.bold ? 700 : undefined,
        'font-style': i.italic ? 'italic' : undefined,
        'text-decoration': i.underline ? 'underline' : undefined,
        'text-anchor': i.anchor && i.anchor !== 'start' ? i.anchor : undefined,
        'letter-spacing': i.ls !== undefined ? n(i.ls) : undefined,
        fill: i.color,
        'xml:space': /^\s|\s\s/.test(i.s) ? 'preserve' : undefined,
      })}>${esc(i.s)}</text>`;
  }
}

export function buildDiagramSvg(scene: Scene, opts?: { fontCss?: string }): string {
  const defs = { hatch: false };
  const body = scene.items.map((i) => item(i, defs)).join('\n');
  const head: string[] = [];
  if (opts?.fontCss) head.push(`<style>${opts.fontCss}</style>`);
  if (defs.hatch) {
    head.push('<defs><pattern id="dmh-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
      + '<line x1="0" y1="0" x2="0" y2="8" stroke="#DDE0E6" stroke-width="1"/></pattern></defs>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.w)}" height="${n(scene.h)}" viewBox="0 0 ${n(scene.w)} ${n(scene.h)}">\n`
    + `${head.join('\n')}${head.length ? '\n' : ''}`
    + `<rect x="0" y="0" width="${n(scene.w)}" height="${n(scene.h)}" fill="${scene.bg}"/>\n`
    + `${body}\n</svg>`;
}
