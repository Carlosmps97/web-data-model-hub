/**
 * Pila de diálogos abiertos (doc 80 §1). `Dialog` escucha ESC en `window`, así
 * que con DOS diálogos abiertos —el popup de Esquemas montado ENCIMA del editor
 * de vistas— un solo ESC cerraba los dos: se perdía la vista a medio componer
 * por cancelar el popup de arriba. Con la pila, ESC lo consume únicamente el
 * diálogo del tope.
 *
 * El token es estable por diálogo (un `Symbol` por instancia, guardado en un
 * ref): registrar en cada render lo re-pondría en el tope y el de ABAJO se
 * comería el ESC. Puro, sin React — testeable.
 */
const stack: symbol[] = [];

export function pushDialog(token: symbol): void {
  if (!stack.includes(token)) stack.push(token);
}

export function removeDialog(token: symbol): void {
  const i = stack.indexOf(token);
  if (i >= 0) stack.splice(i, 1);
}

/** ¿Es el diálogo del tope? Un token no registrado NUNCA es el tope. */
export function isTopDialog(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}

/** Sólo para tests: vacía la pila. */
export function resetDialogStack(): void {
  stack.length = 0;
}
