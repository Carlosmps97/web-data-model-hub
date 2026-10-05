import { describe, expect, it } from 'vitest';
import type { Drawing } from '../services/modeler.service';
import {
  DEFAULT_FONT_PT, DEFAULT_STROKE, DEFAULT_TEXT_COLOR, drawingAlign, drawingFill, drawingFont, drawingStroke,
  fontPatch, hasText, isLegacyText, legacyUpgrade, textCss,
} from './drawingStyle';

const d = (over: Partial<Drawing>): Drawing => ({ id: 'd1', type: 'rect', x: 0, y: 0, w: 100, h: 60, ...over });

describe('drawingStyle (doc 109)', () => {
  it('una forma anterior al doc 109 se ve como siempre: borde de su color y su tinte suave', () => {
    expect(drawingStroke(d({}))).toBe(DEFAULT_STROKE);
    expect(drawingFill(d({}))).toBe(`${DEFAULT_STROKE}1A`);
    expect(drawingStroke(d({ color: '#16a37b' }))).toBe('#16A37B');
    expect(drawingFill(d({ color: '#16A37B' }))).toBe('#16A37B1A');
  });

  it('relleno y borde propios; «none» = transparente / sin borde', () => {
    expect(drawingFill(d({ fill: '#FFFF80' }))).toBe('#FFFF80');
    expect(drawingFill(d({ fill: 'none' }))).toBeNull();
    expect(drawingStroke(d({ color: 'none' }))).toBeNull();
    expect(drawingFill(d({ type: 'line' }))).toBeNull();
  });

  it('un texto viejo (sin `font`): sin borde, 14 px seminegrita del color del dibujo', () => {
    const old = d({ type: 'text', color: '#8B5CF6' });
    expect(isLegacyText(old)).toBe(true);
    expect(drawingStroke(old)).toBeNull();
    expect(drawingFont(old)).toMatchObject({ size: 10.5, bold: true, color: '#8B5CF6' });
    expect(textCss(old).fontWeight).toBe(600);
  });

  it('el texto nuevo toma los defaults de su tipo', () => {
    const t = d({ type: 'text', font: {} });
    expect(drawingFont(t)).toEqual({ family: null, size: DEFAULT_FONT_PT, bold: false, italic: false, underline: false, color: DEFAULT_TEXT_COLOR });
    expect(drawingAlign(t)).toEqual({ align: 'left', valign: 'middle' });
    expect(drawingAlign(d({ font: {} }))).toEqual({ align: 'center', valign: 'middle' });   // forma con texto: centrado
    expect(hasText(d({ type: 'line' }))).toBe(false);
  });

  it('CSS del texto: familia con respaldo, puntos, B/I/U y alineación vertical', () => {
    const css = textCss(d({ font: { family: 'Arial', size: 14, bold: true, italic: true, underline: true, color: '#c00000' }, valign: 'top', align: 'right' }));
    expect(css.fontFamily).toMatch(/^"Arial", /);
    expect(css).toMatchObject({ fontSize: '14pt', fontWeight: 700, fontStyle: 'italic', textDecoration: 'underline', color: '#C00000', textAlign: 'right', justifyContent: 'flex-start' });
  });

  it('cualquier edición de un texto viejo lo pasa antes al modelo nuevo: el borde es borde y la alineación se aplica', () => {
    const old = d({ type: 'text', color: '#8B5CF6' });
    const withBorder = { ...old, ...legacyUpgrade(old), color: '#C00000' };
    expect(drawingStroke(withBorder)).toBe('#C00000');
    expect(drawingFont(withBorder).color).toBe('#8B5CF6');               // la letra conserva su color
    const centered = { ...old, ...legacyUpgrade(old), align: 'center' as const };
    expect(drawingAlign(centered).align).toBe('center');
    expect(legacyUpgrade(d({ type: 'text', font: {} }))).toEqual({});     // uno nuevo no cambia
    // una edición de fuente posterior no pisa la alineación elegida
    expect(fontPatch(centered, { size: 14 })).toEqual({ font: { size: 14, bold: true, color: '#8B5CF6' } });
  });

  it('formatear un texto viejo lo pasa al modelo nuevo conservando cómo se veía', () => {
    const p = fontPatch(d({ type: 'text', color: '#8B5CF6' }), { italic: true });
    expect(p).toEqual({ font: { size: 10.5, bold: true, color: '#8B5CF6', italic: true }, color: null, align: 'left', valign: 'middle' });
    expect(fontPatch(d({ font: { size: 9 } }), { bold: true })).toEqual({ font: { size: 9, bold: true } });
  });
});
