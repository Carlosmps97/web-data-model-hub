import { describe, expect, it } from 'vitest';
import {
  NO_COLOR, boxTints, cleanColors, colorHex, colorLabel, effectiveRef, normalColor, themeIdOf, themeIndex, themeRef, tint,
} from './colors';

// Contrato con app/core/colors.py (misma gramática; mismos casos que
// tests/integration/test_colors_themes_doc109.py y test_apply_plan.py).
describe('ColorRef (doc 109)', () => {
  it('normaliza hex, acepta themes y sólo admite «none» donde corresponde', () => {
    expect(normalColor('#92d050')).toBe('#92D050');
    expect(normalColor(' #FFFF80 ')).toBe('#FFFF80');
    expect(normalColor('theme:t-pri')).toBe('theme:t-pri');
    expect(normalColor('none')).toBeNull();
    expect(normalColor('none', true)).toBe(NO_COLOR);
    for (const bad of ['verde', '#FFF', '#GGGGGG', 'theme:', 'theme:a b', 12, null, undefined, {}]) {
      expect(normalColor(bad, true)).toBeNull();
    }
  });

  it('limpia las excepciones del canvas como el backend', () => {
    expect(cleanColors({ t1: 'theme:t-pri', t2: '#ff0000', t3: 'none', t4: 'rojo', '': '#000000' }))
      .toEqual({ t1: 'theme:t-pri', t2: '#FF0000', t3: 'none' });
    expect(cleanColors(['no', 'mapa'])).toEqual({});
    expect(cleanColors(null)).toEqual({});
  });

  it('precedencia: excepción del canvas → color de la tabla → sin color', () => {
    expect(effectiveRef('t1', 'theme:a', {})).toBe('theme:a');
    expect(effectiveRef('t1', 'theme:a', { t1: '#FF0000' })).toBe('#FF0000');
    expect(effectiveRef('t1', 'theme:a', { t1: 'none' })).toBeNull();
    expect(effectiveRef('t1', null, { t2: '#FF0000' })).toBeNull();
    expect(effectiveRef('t1', 'basura', undefined)).toBeNull();
  });

  it('resuelve themes a su color y un theme borrado queda sin color', () => {
    const idx = themeIndex([{ id: 'a', name: 'Entidad Principal', color: '#ffff80' }]);
    expect(colorHex(themeRef('a'), idx)).toBe('#FFFF80');
    expect(colorHex('theme:x', idx)).toBeNull();
    expect(colorHex('#00ff00', idx)).toBe('#00FF00');
    expect(colorHex('none', idx)).toBeNull();
    expect(colorLabel('theme:a', idx)).toBe('Entidad Principal');
    expect(colorLabel('theme:x', idx)).toBe('Removed theme');
    expect(colorLabel(null, idx)).toBe('No color');
    expect(themeIdOf('theme:a')).toBe('a');
    expect(themeIdOf('#FFFFFF')).toBeNull();
  });

  it('el tinte mezcla con blanco', () => {
    expect(tint('#000000', 0)).toBe('#FFFFFF');
    expect(tint('#000000', 1)).toBe('#000000');
    expect(tint('#FF0000', 0.5)).toBe('#FF8080');
    expect(boxTints('#FFFF80')).toEqual({ body: tint('#FFFF80', 0.45), key: tint('#FFFF80', 0.62) });
  });
});
