import { beforeEach, describe, expect, it } from 'vitest';
import { isTopDialog, pushDialog, removeDialog, resetDialogStack } from './dialogStack';

describe('dialogStack (doc 80 §1 — ESC lo consume sólo el diálogo de arriba)', () => {
  beforeEach(resetDialogStack);

  it('el último en abrirse es el tope', () => {
    const viewEditor = Symbol('view');
    const schemas = Symbol('schemas');
    pushDialog(viewEditor);
    expect(isTopDialog(viewEditor)).toBe(true);
    pushDialog(schemas);
    expect(isTopDialog(schemas)).toBe(true);
    expect(isTopDialog(viewEditor)).toBe(false);   // el de abajo NO se cierra con ESC
  });

  it('al cerrar el de arriba, el de abajo recupera el ESC', () => {
    const a = Symbol('a'); const b = Symbol('b');
    pushDialog(a); pushDialog(b);
    removeDialog(b);
    expect(isTopDialog(a)).toBe(true);
  });

  it('re-registrar un token YA abierto no lo sube al tope (renders repetidos)', () => {
    const a = Symbol('a'); const b = Symbol('b');
    pushDialog(a); pushDialog(b);
    pushDialog(a);                    // el de abajo re-renderiza
    expect(isTopDialog(b)).toBe(true);
    expect(isTopDialog(a)).toBe(false);
  });

  it('un token no registrado nunca es el tope, ni con la pila vacía', () => {
    expect(isTopDialog(Symbol('x'))).toBe(false);
    pushDialog(Symbol('a'));
    expect(isTopDialog(Symbol('x'))).toBe(false);
  });

  it('cerrar un token que no está en la pila no rompe nada', () => {
    const a = Symbol('a');
    pushDialog(a);
    removeDialog(Symbol('otro'));
    expect(isTopDialog(a)).toBe(true);
  });
});
