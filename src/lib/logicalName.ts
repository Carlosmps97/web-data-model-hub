// Nombres lógicos (Entidad / Atributo) sin caracteres especiales.
// Permitidos: letras Unicode (tildes, ñ), dígitos, espacio y guion bajo. Se
// aplica al tipear en cada input de nombre lógico; el backend espeja la misma
// regla en el choke point de changesets (`core/naming/logical.py`), así ningún
// escritor (Excel, API) la salta. Los físicos tienen sus propias reglas.
// Un espacio de otro tipo (el «no separable» que pegan Word/Outlook, tabulador)
// es un espacio (quitarlo pegaría las palabras); los invisibles (control,
// formato y los «default ignorable»: ancho cero, BOM, guion suave, selectores de
// variación, rellenos hangul) se quitan sin contar como especiales; una marca
// combinante solo queda pegada a su letra o dígito y el resultado se compone en
// NFC al final (componer antes de quitar los invisibles dejaría la tilde suelta).

/** Espacios que no son el espacio común: el mismo conjunto del backend
 *  (`_OTHER_SPACES`) — `\s` no sirve, JS y Python difieren. */
const OTHER_SPACES = /[\t\n\v\f\r\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const MARK = /[\p{Mn}\p{Mc}]/u;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/** Lo que queda y los caracteres visibles quitados (en orden, sin repetir). */
function split(value: string): { kept: string; removed: string[] } {
  let kept = '';
  const removed = new Set<string>();
  let attach = false;
  for (const ch of (value ?? '').replace(OTHER_SPACES, ' ')) {
    if (INVISIBLE.test(ch)) continue;
    if (ch === ' ' || ch === '_') { kept += ch; attach = false; }
    else if (LETTER_OR_DIGIT.test(ch)) { kept += ch; attach = true; }
    else if (MARK.test(ch) && attach) kept += ch;
    else { attach = false; removed.add(ch); }
  }
  return { kept: kept.normalize('NFC'), removed: [...removed] };
}

/** Quita los caracteres no permitidos; conserva espacios simples tal cual se
 *  tipean (el trim lo hace cada commit). */
export function sanitizeLogicalName(value: string): string {
  return split(value).kept;
}

/** true si el texto trae algún carácter visible que la regla quitaría. */
export function hasSpecialChars(value: string): boolean {
  return split(value).removed.length > 0;
}
