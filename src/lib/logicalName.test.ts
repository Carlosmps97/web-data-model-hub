import { describe, expect, it } from 'vitest';
import { hasSpecialChars, sanitizeLogicalName } from './logicalName';

describe('sanitizeLogicalName', () => {
  it('conserva letras (con tildes y ñ), dígitos, espacios y guion bajo', () => {
    expect(sanitizeLogicalName('Código Único Cliente 2 _x')).toBe('Código Único Cliente 2 _x');
    expect(sanitizeLogicalName('Año Ñandú')).toBe('Año Ñandú');
  });
  it('quita puntuación y símbolos', () => {
    expect(sanitizeLogicalName('Cuenta (activa)')).toBe('Cuenta activa');
    expect(sanitizeLogicalName('E/3360')).toBe('E3360');
    expect(sanitizeLogicalName('%AttDomain')).toBe('AttDomain');
    expect(sanitizeLogicalName('a-b.c,d|e;f:g"h\'i')).toBe('abcdefghi');
    expect(sanitizeLogicalName('x@y#z$w')).toBe('xyzw');
  });
  it('tolera vacío', () => {
    expect(sanitizeLogicalName('')).toBe('');
  });
  it('hasSpecialChars detecta sin dejar estado en la regex global', () => {
    expect(hasSpecialChars('Cuenta (activa)')).toBe(true);
    expect(hasSpecialChars('Cuenta activa')).toBe(false);
    expect(hasSpecialChars('Cuenta (activa)')).toBe(true);
  });
});

// Espejo del backend (`core/naming/logical.py`): lo que se ve igual no es un
// carácter especial. Un espacio de otro tipo (el «no separable» que pegan
// Word/Outlook) es un espacio (así no se pegan las palabras), un invisible se
// quita y una tilde descompuesta (NFD) se conserva.
describe('sanitizeLogicalName — espacios de otro tipo e invisibles', () => {
  it.each(['\u00a0', '\t', '\u2009', '\u202f', '\u3000', '\u2028', '\u200a', '\u205f', '\u1680'])(
    'un espacio de otro tipo (%j) es un espacio', (sep) => {
      expect(sanitizeLogicalName(`Cliente${sep}Persona`)).toBe('Cliente Persona');
      expect(hasSpecialChars(`Cliente${sep}Persona`)).toBe(false);
    });
  it.each(['\u200b', '\ufeff', '\u00ad', '\u200d', '\u2060'])('un invisible (%j) se quita sin contar como especial', (ch) => {
    expect(sanitizeLogicalName(`Año${ch}Fiscal`)).toBe('AñoFiscal');
    expect(hasSpecialChars(`Año${ch}Fiscal`)).toBe(false);
  });
  it('una tilde descompuesta (NFD) se compone (NFC)', () => {
    const nfd = 'Información Única Pingüino'.normalize('NFD');
    expect(sanitizeLogicalName(nfd)).toBe('Información Única Pingüino'.normalize('NFC'));
    expect(hasSpecialChars(nfd)).toBe(false);
  });
  it('lo visible sigue contando', () => {
    expect(hasSpecialChars('Cuenta\u00a0(activa)')).toBe(true);
    expect(sanitizeLogicalName('Cuenta\u00a0(activa)')).toBe('Cuenta activa');
  });
});

// Espejo del backend: un emoji con selector de variación no deja residuo; el
// keycap y una marca sin letra delante se quitan y cuentan.
describe('sanitizeLogicalName — emoji, keycap y marcas sueltas', () => {
  const ch = (cp: number) => String.fromCodePoint(cp);
  it('emoji con selector de variación', () => {
    expect(sanitizeLogicalName(`Producto ${ch(0x2714)}${ch(0xfe0f)}`)).toBe('Producto ');
    expect(hasSpecialChars(`Producto ${ch(0x2714)}${ch(0xfe0f)}`)).toBe(true);
    expect(hasSpecialChars(`Producto${ch(0xfe0f)}`)).toBe(false);
  });
  it('keycap y marca sin base', () => {
    expect(sanitizeLogicalName(`Paso 1${ch(0xfe0f)}${ch(0x20e3)}`)).toBe('Paso 1');
    expect(hasSpecialChars(`Paso 1${ch(0x20e3)}`)).toBe(true);
    expect(sanitizeLogicalName(`${ch(0x301)}abc`)).toBe('abc');
    expect(hasSpecialChars(`${ch(0x301)}abc`)).toBe(true);
  });
  it('lo que deja al tipear es estable', () => {
    for (const raw of [`Producto ${ch(0x2714)}${ch(0xfe0f)}`, `${ch(0x301)}x${ch(0x20e3)}`, 'Año (b)'.normalize('NFD')]) {
      const once = sanitizeLogicalName(raw);
      expect(sanitizeLogicalName(once)).toBe(once);
      expect(hasSpecialChars(once)).toBe(false);
    }
  });
});

// Espejo del backend: idempotente (NFC al final, después de quitar invisibles:
// un invisible entre la letra y su tilde dejaría la tilde suelta) y sin los
// invisibles «default ignorable» que no son control ni formato (relleno hangul,
// CGJ, selectores mongoles).
describe('sanitizeLogicalName — idempotente e ignorables', () => {
  const c = (n: number) => String.fromCodePoint(n);
  it.each([
    'Co' + c(0x200b) + c(0x301) + 'digo', 'Co' + c(0xfe0f) + c(0x301) + 'digo',
    'Co' + c(0xad) + c(0x301) + 'digo', 'n' + c(0x2060) + c(0x303) + 'o', c(0x1100) + '(' + c(0x1161),
  ].map((s) => [JSON.stringify(s), s]))('%s: en NFC y estable', (_label, raw) => {
    const once = sanitizeLogicalName(raw);
    expect(once).toBe(once.normalize('NFC'));
    expect(sanitizeLogicalName(once)).toBe(once);
  });
  it.each([0x34f, 0x180b, 0x17b4, 0x3164, 0xffa0])('U+%s no deja residuo', (cp) => {
    expect(sanitizeLogicalName('Cliente' + c(cp))).toBe('Cliente');
    expect(hasSpecialChars('Cliente' + c(cp))).toBe(false);
  });
  it('lineal: una celda de 30 000 signos distintos se sanea de inmediato', () => {
    const syms = Array.from({ length: 30000 }, (_, i) => c(0x2100 + (i % 3000)));
    const t0 = performance.now();
    sanitizeLogicalName('Tabla ' + syms.join(''));
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
