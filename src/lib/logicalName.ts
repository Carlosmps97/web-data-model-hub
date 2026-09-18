// Doc 92 D8 — nombres LÓGICOS (Entidad / Atributo) sin caracteres especiales.
// Permitidos: letras Unicode (tildes, ñ), dígitos, espacio y guion bajo. Se
// aplica AL TIPEAR en cada input de nombre lógico; el backend espeja la misma
// regla en el choke point de changesets (`core/naming/logical.py`), así ningún
// escritor (Excel, API) la salta. Los físicos tienen sus propias reglas.

const FORBIDDEN = /[^\p{L}\p{N}\p{M} _]/gu;

/** Quita los caracteres no permitidos; conserva espacios simples tal cual se
 *  tipean (el trim lo hace cada commit, como hasta hoy). */
export function sanitizeLogicalName(value: string): string {
  return (value ?? '').replace(FORBIDDEN, '');
}

/** true si el texto trae algún carácter que la regla quitaría. */
export function hasSpecialChars(value: string): boolean {
  return FORBIDDEN.test(value ?? '') && ((FORBIDDEN.lastIndex = 0), true);
}
