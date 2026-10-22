/**
 * Pila de diálogos abiertos. `Dialog` escucha Esc en `window`, así que con dos
 * diálogos abiertos (el popup de Esquemas montado encima del editor de vistas)
 * un solo Esc cerraría los dos y se perdería la vista a medio componer al
 * cancelar el popup de arriba. Con la pila, Esc lo consume únicamente el
 * diálogo del tope.
 *
 * El token es estable por diálogo (un `Symbol` por instancia, guardado en un
 * ref): registrar en cada render lo volvería a poner en el tope y el de abajo se
 * quedaría con el Esc. Puro, sin React: testeable.
 */
const stack: symbol[] = [];

export function pushDialog(token: symbol): void {
  if (!stack.includes(token)) stack.push(token);
}

export function removeDialog(token: symbol): void {
  const i = stack.indexOf(token);
  if (i >= 0) stack.splice(i, 1);
}

/** ¿Es el diálogo del tope? Un token no registrado nunca es el tope. */
export function isTopDialog(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}

/** Solo para tests: vacía la pila. */
export function resetDialogStack(): void {
  stack.length = 0;
}
