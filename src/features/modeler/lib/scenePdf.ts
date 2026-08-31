// Doc 59: escena → PDF VECTORIAL sin dependencias (política de deps pineadas:
// no se agrega jsPDF). Fuentes core Type1 (Helvetica/Courier + variantes) con
// WinAnsiEncoding — cubre Latin-1 (es-PE completo); lo no mapeable degrada a
// '?'. La página escala px→pt a 0.75 y se CAPA al techo del estándar ISO
// 32000 (14400pt = 200in por lado; Acrobat trunca más allá). Streams sin
// comprimir: el peso sigue siendo ~100× menor que la captura DOM anterior.
// Limitación aceptada: el hatch de vistas va como fondo plano (el borde
// punteado + badge VISTA mantienen la identidad visual).
import type { Scene, SceneItem } from './exportScene';

const K = 0.5522847498;   // kappa: círculo/esquina por Bézier cúbica

// ── WinAnsi (cp1252): Latin-1 directo + mapeos del rango 0x80-0x9F ────────
const WIN: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

/** String de BYTES (cada char ≤ 0xFF) en WinAnsi; irrepresentable → '?'. */
export function winAnsiEncode(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 0xFF && !(c >= 0x80 && c <= 0x9F)) out += String.fromCharCode(c);
    else out += String.fromCharCode(WIN[c] ?? 0x3F);
  }
  return out;
}

const escText = (bytes: string) => bytes.replace(/[\\()]/g, (c) => `\\${c}`);
const n2 = (v: number) => String(Math.round(v * 1000) / 1000);

/** '#RRGGBB' o '#RRGGBBAA' → 'r g b' 0..1 (el alpha se PRE-mezcla sobre bg). */
function rgb(hex: string, bg: string): string {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (h.length === 8) {
    const a = parseInt(h.slice(6, 8), 16) / 255;
    const bh = bg.replace('#', '');
    r = a * r + (1 - a) * parseInt(bh.slice(0, 2), 16);
    g = a * g + (1 - a) * parseInt(bh.slice(2, 4), 16);
    b = a * b + (1 - a) * parseInt(bh.slice(4, 6), 16);
  }
  return `${n2(r / 255)} ${n2(g / 255)} ${n2(b / 255)}`;
}

// ── Parser mínimo del path SVG que EMITE este export (M/L/Q/C/Z absolutos:
//    getSmoothStepPath usa M/L/Q y getBezierPath usa M/C) ──────────────────
type Cmd = [string, number[]];
function parsePath(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MLQCZz])([^MLQCZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    out.push([m[1].toUpperCase(), nums]);
  }
  return out;
}

const FONTS = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'];
const fontOf = (i: Extract<SceneItem, { k: 'text' }>): { f: string; wf: number } => {
  if (i.mono) return i.bold ? { f: 'F4', wf: 0.6 } : { f: 'F3', wf: 0.6 };
  if (i.bold && i.italic) return { f: 'F6', wf: 0.58 };
  if (i.bold) return { f: 'F2', wf: 0.58 };
  if (i.italic) return { f: 'F5', wf: 0.55 };
  return { f: 'F1', wf: 0.55 };
};

export function buildDiagramPdf(scene: Scene): Uint8Array<ArrayBuffer> {
  const S = Math.min(0.75, 14400 / scene.w, 14400 / scene.h);
  const W = scene.w * S, H = scene.h * S;
  const X = (v: number) => n2(v * S);
  const Y = (v: number) => n2(H - v * S);
  const ops: string[] = [];
  const push = (s: string) => ops.push(s);

  // Fondo.
  push(`q ${rgb(scene.bg, scene.bg)} rg 0 0 ${n2(W)} ${n2(H)} re f Q`);

  const strokeSetup = (i: { stroke?: string; sw?: number; dash?: string; cap?: string; join?: string }): string => {
    let s = `${rgb(i.stroke!, scene.bg)} RG ${n2((i.sw ?? 1) * S)} w`;
    if (i.dash) s += ` [${i.dash.split(/\s+/).map((v) => n2(Number(v) * S)).join(' ')}] 0 d`;
    if (i.cap === 'round') s += ' 1 J';
    if (i.join === 'round') s += ' 1 j';
    return s;
  };
  const paint = (fill?: string, stroke?: string) => (fill && stroke ? 'B' : fill ? 'f' : 'S');

  /** Rect redondeado (4 esquinas, o solo las de ARRIBA para headers). */
  const roundedRect = (x: number, y: number, w: number, h: number, r: number, topOnly: boolean): string => {
    const k = K * r;
    const p: string[] = [];
    p.push(`${X(x)} ${Y(y + h)} m`);                                     // abajo-izq
    p.push(`${X(x)} ${Y(y + r)} l`);
    p.push(`${X(x)} ${n2(H - (y + r - k) * S)} ${n2((x + r - k) * S)} ${Y(y)} ${X(x + r)} ${Y(y)} c`);
    p.push(`${X(x + w - r)} ${Y(y)} l`);
    p.push(`${n2((x + w - r + k) * S)} ${Y(y)} ${X(x + w)} ${n2(H - (y + r - k) * S)} ${X(x + w)} ${Y(y + r)} c`);
    if (topOnly) { p.push(`${X(x + w)} ${Y(y + h)} l`); p.push('h'); return p.join('\n'); }
    p.push(`${X(x + w)} ${Y(y + h - r)} l`);
    p.push(`${X(x + w)} ${n2(H - (y + h - r + k) * S)} ${n2((x + w - r + k) * S)} ${Y(y + h)} ${X(x + w - r)} ${Y(y + h)} c`);
    p.push(`${X(x + r)} ${Y(y + h)} l`);
    p.push(`${n2((x + r - k) * S)} ${Y(y + h)} ${X(x)} ${n2(H - (y + h - r + k) * S)} ${X(x)} ${Y(y + h - r)} c`);
    p.push('h');
    return p.join('\n');
  };

  for (const i of scene.items) {
    switch (i.k) {
      case 'hatch': break;   // limitación PDF: el fondo plano ya lo pintó el rect previo
      case 'rect': {
        let s = 'q';
        if (i.fill) s += ` ${rgb(i.fill, scene.bg)} rg`;
        if (i.stroke) s += ` ${strokeSetup(i)}`;
        if (i.rx) s += `\n${roundedRect(i.x, i.y, i.w, i.h, Math.min(i.rx, i.w / 2, i.h / 2), !!i.rtop)}\n${paint(i.fill, i.stroke)} Q`;
        else s += `\n${X(i.x)} ${Y(i.y + i.h)} ${n2(i.w * S)} ${n2(i.h * S)} re\n${paint(i.fill, i.stroke)} Q`;
        push(s);
        break;
      }
      case 'ellipse': {
        const kx = K * i.rx, ky = K * i.ry;
        const p = [
          `${X(i.cx - i.rx)} ${Y(i.cy)} m`,
          `${X(i.cx - i.rx)} ${Y(i.cy - ky)} ${X(i.cx - kx)} ${Y(i.cy - i.ry)} ${X(i.cx)} ${Y(i.cy - i.ry)} c`,
          `${X(i.cx + kx)} ${Y(i.cy - i.ry)} ${X(i.cx + i.rx)} ${Y(i.cy - ky)} ${X(i.cx + i.rx)} ${Y(i.cy)} c`,
          `${X(i.cx + i.rx)} ${Y(i.cy + ky)} ${X(i.cx + kx)} ${Y(i.cy + i.ry)} ${X(i.cx)} ${Y(i.cy + i.ry)} c`,
          `${X(i.cx - kx)} ${Y(i.cy + i.ry)} ${X(i.cx - i.rx)} ${Y(i.cy + ky)} ${X(i.cx - i.rx)} ${Y(i.cy)} c`,
        ].join('\n');
        push(`q${i.fill ? ` ${rgb(i.fill, scene.bg)} rg` : ''}${i.stroke ? ` ${strokeSetup(i)}` : ''}\n${p}\n${paint(i.fill, i.stroke)} Q`);
        break;
      }
      case 'line':
        push(`q ${strokeSetup(i)}\n${X(i.x1)} ${Y(i.y1)} m\n${X(i.x2)} ${Y(i.y2)} l\nS Q`);
        break;
      case 'poly': {
        const p = i.pts.map(([px, py], idx) => `${X(px)} ${Y(py)} ${idx ? 'l' : 'm'}`).join('\n');
        push(`q${i.fill ? ` ${rgb(i.fill, scene.bg)} rg` : ''}${i.stroke ? ` ${strokeSetup(i)}` : ''}\n${p}\nh\n${paint(i.fill, i.stroke)} Q`);
        break;
      }
      case 'path': {
        const segs = parsePath(i.d);
        const p: string[] = [];
        let cx = 0, cy = 0;
        for (const [cmd, v] of segs) {
          if (cmd === 'M') { cx = v[0]; cy = v[1]; p.push(`${X(cx)} ${Y(cy)} m`); for (let j = 2; j + 1 < v.length; j += 2) { cx = v[j]; cy = v[j + 1]; p.push(`${X(cx)} ${Y(cy)} l`); } }
          else if (cmd === 'L') { for (let j = 0; j + 1 < v.length; j += 2) { cx = v[j]; cy = v[j + 1]; p.push(`${X(cx)} ${Y(cy)} l`); } }
          else if (cmd === 'Q') {
            for (let j = 0; j + 3 < v.length; j += 4) {
              const qx = v[j], qy = v[j + 1], ex = v[j + 2], ey = v[j + 3];
              const c1x = cx + (2 / 3) * (qx - cx), c1y = cy + (2 / 3) * (qy - cy);
              const c2x = ex + (2 / 3) * (qx - ex), c2y = ey + (2 / 3) * (qy - ey);
              p.push(`${X(c1x)} ${Y(c1y)} ${X(c2x)} ${Y(c2y)} ${X(ex)} ${Y(ey)} c`);
              cx = ex; cy = ey;
            }
          } else if (cmd === 'C') {
            for (let j = 0; j + 5 < v.length; j += 6) {
              p.push(`${X(v[j])} ${Y(v[j + 1])} ${X(v[j + 2])} ${Y(v[j + 3])} ${X(v[j + 4])} ${Y(v[j + 5])} c`);
              cx = v[j + 4]; cy = v[j + 5];
            }
          } else if (cmd === 'Z') p.push('h');
        }
        push(`q${i.fill ? ` ${rgb(i.fill, scene.bg)} rg` : ''}${i.stroke ? ` ${strokeSetup(i)}` : ''}\n${p.join('\n')}\n${paint(i.fill, i.stroke)} Q`);
        break;
      }
      case 'text': {
        const { f, wf } = fontOf(i);
        const len = [...i.s].length;
        const width = (wf * i.size * len + (i.ls ?? 0) * Math.max(0, len - 1)) * S;
        const dx = i.anchor === 'end' ? width : i.anchor === 'middle' ? width / 2 : 0;
        const bytes = escText(winAnsiEncode(i.s));
        let s = `q BT ${rgb(i.color, scene.bg)} rg /${f} ${n2(i.size * S)} Tf`;
        if (i.ls) s += ` ${n2(i.ls * S)} Tc`;
        s += `\n${n2(i.x * S - dx)} ${Y(i.y)} Td\n(${bytes}) Tj\nET Q`;
        push(s);
        break;
      }
    }
  }

  // ── Ensamblado: objetos 1..10, xref con offsets EXACTOS, trailer ────────
  const stream = ops.join('\n');
  const objs: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources << /Font << ${FONTS.map((_, k) => `/F${k + 1} ${k + 5} 0 R`).join(' ')} >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...FONTS.map((f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`),
  ];
  let out = `%PDF-1.4\n%${String.fromCharCode(0xE2, 0xE3, 0xCF, 0xD3)}\n`;
  const offsets: number[] = [];
  objs.forEach((body, k) => {
    offsets.push(out.length);
    out += `${k + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xFF;
  return bytes;
}
