/**
 * Forma canónica de un número de UDP. Los UDP se guardan como texto y el
 * Reporting busca `udp."X" = 10.5` por el literal y su forma canónica: sin
 * ella, un «10.50» tipeado no aparecería. Es la misma forma del backend
 * (`app/core/udp_values.canonical_number`) en los casos en que Python y JS la
 * escriben igual — un entero exacto (sin pasar por float) y un decimal entre
 * 1e-4 y 1e16; fuera de ese rango Python usa exponente o «.0» y JS no. Lo que
 * no es un número, o queda fuera de ese rango, sigue tal cual se tipeó.
 */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d{1,300}$/;

export function canonicalNumberText(typed: string): string {
  const text = typed.trim();
  if (INTEGER.test(text)) return BigInt(text.replace(/^\+/, '')).toString();
  if (!NUMBER.test(text)) return typed;
  const n = Number(text);
  if (!Number.isFinite(n)) return typed;
  if (Number.isInteger(n)) return Math.abs(n) < 2 ** 53 ? String(n) : typed;
  return Math.abs(n) >= 1e-4 && Math.abs(n) < 1e16 ? String(n) : typed;
}
