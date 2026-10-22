// Teclado en la barra del canvas y sus menús.
//  · Enter (o Espacio) sostenido repite la tecla: si cada repetición activara lo
//    que tiene el foco, el grupo abriría su menú, el foco iría a la 1.ª
//    herramienta, usarla lo devolvería al grupo… hasta confirmar un Auto-arrange.
//    En la barra y sus menús, la repetición no activa nada (en los modales, sí:
//    no son la barra).
//  · Tab al final del menú (un portal al final de la página) saltaría lejos:
//    vuelve a la barra — Shift+Tab al botón del grupo, Tab a lo que le sigue.
import { describe, expect, it } from 'vitest';
import { blocksRepeat, nextIn, tabExit } from './toolbarKeys';

/** Un «elemento» de mentira: sus clases y si es (o está dentro de) un botón. */
const el = (classes: string[], inButton = true) => ({
  closest: (sel: string) => (sel.split(',').map((x) => x.trim()).some((x) => (x === 'button' ? inButton : classes.includes(x.replace(/^\./, '')))) ? {} : null),
});

describe('blocksRepeat', () => {
  const inBar = el(['wk-toolbar']), inMenu = el(['wk-tbpop']), inExport = el(['wk-ctxmenu']), inModal = el(['dmh-modal']);
  const root = { contains: (n: unknown) => n === inBar };
  it('Enter o Espacio repetido en un botón de la barra o de sus menús: no activa nada', () => {
    for (const target of [inBar, inMenu, inExport]) {
      for (const key of ['Enter', ' ']) expect(blocksRepeat({ repeat: true, key, target }, root), key).toBe(true);
    }
  });
  it('la 1.ª pulsación, otras teclas y lo de un modal (aunque lo abra la barra) pasan', () => {
    expect(blocksRepeat({ repeat: false, key: 'Enter', target: inBar }, root)).toBe(false);
    expect(blocksRepeat({ repeat: true, key: 'ArrowDown', target: inBar }, root)).toBe(false);
    expect(blocksRepeat({ repeat: true, key: 'Enter', target: inModal }, root)).toBe(false);
    expect(blocksRepeat({ repeat: true, key: ' ', target: el(['wk-toolbar'], false) }, { contains: () => true })).toBe(false);   // no es un botón
  });
});

describe('tabExit', () => {
  const panel = 'panel', a = 'a', b = 'b', c = 'c';
  it('Shift+Tab en la primera herramienta (o en el menú mismo): vuelve al botón del grupo', () => {
    expect(tabExit({ key: 'Tab', shiftKey: true }, [a, b, c], a, panel)).toBe('back');
    expect(tabExit({ key: 'Tab', shiftKey: true }, [a, b, c], panel, panel)).toBe('back');
  });
  it('Tab en la última: sigue con lo que viene después del grupo en la barra', () => {
    expect(tabExit({ key: 'Tab', shiftKey: false }, [a, b, c], c, panel)).toBe('forward');
  });
  it('sin herramientas habilitadas (el foco en el menú): Tab sigue, Shift+Tab vuelve', () => {
    expect(tabExit({ key: 'Tab', shiftKey: false }, [], panel, panel)).toBe('forward');
    expect(tabExit({ key: 'Tab', shiftKey: true }, [], panel, panel)).toBe('back');
  });
  it('en el medio, u otra tecla: el navegador hace lo suyo (Tab en el menú mismo va a su 1.ª herramienta)', () => {
    expect(tabExit({ key: 'Tab', shiftKey: false }, [a, b, c], b, panel)).toBeNull();
    expect(tabExit({ key: 'Tab', shiftKey: false }, [a, b, c], panel, panel)).toBeNull();
    expect(tabExit({ key: 'Tab', shiftKey: true }, [a, b, c], c, panel)).toBeNull();
    expect(tabExit({ key: 'Enter', shiftKey: false }, [a, b, c], c, panel)).toBeNull();
  });
});

describe('nextIn', () => {
  it('lo que sigue a `from` en la lista; null si es el último o no está', () => {
    expect(nextIn(['x', 'g', 'y'], 'g')).toBe('y');
    expect(nextIn(['x', 'g'], 'g')).toBeNull();
    expect(nextIn(['x'], 'g')).toBeNull();
  });
});
