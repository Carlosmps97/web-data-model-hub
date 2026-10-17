import { describe, expect, it } from 'vitest';
import {
  cleanPhrase, labelMaxWidth, labelPlacement, phraseChange, phraseEdits, relationshipLabel, roleAppliedText, wrapLabel,
} from './relationshipLabel';

describe('relationshipLabel (doc 98 — etiqueta del wire, formato Erwin)', () => {
  it('con las dos frases: «padre→hijo / hijo→padre» en una línea', () => {
    expect(relationshipLabel({
      parentToChildPhrase: 'Cliente tiene', childToParentPhrase: 'pertenece a un Cliente',
    })).toBe('Cliente tiene / pertenece a un Cliente');
  });

  it('con una sola frase: solo esa, sin separador', () => {
    expect(relationshipLabel({ parentToChildPhrase: 'Cliente tiene' })).toBe('Cliente tiene');
    expect(relationshipLabel({ parentToChildPhrase: null, childToParentPhrase: 'un Estado Civil' }))
      .toBe('un Estado Civil');
  });

  it('sin frases (ausentes, null o en blanco): no hay etiqueta', () => {
    expect(relationshipLabel({})).toBeNull();
    expect(relationshipLabel({ parentToChildPhrase: null, childToParentPhrase: null })).toBeNull();
    expect(relationshipLabel({ parentToChildPhrase: '   ', childToParentPhrase: '' })).toBeNull();
  });

  it('una frase en blanco no deja un separador colgando', () => {
    expect(relationshipLabel({ parentToChildPhrase: '  ', childToParentPhrase: ' un Estado Civil ' }))
      .toBe('un Estado Civil');
  });

  it('frase más larga que el tope de dibujo: se corta con «…» (cada dirección por separado)', () => {
    const largo = 'a'.repeat(85);
    expect(relationshipLabel({ parentToChildPhrase: largo, childToParentPhrase: 'corta' }))
      .toBe(`${'a'.repeat(79)}… / corta`);
  });

  it('el tope es configurable: los paneles muestran la frase completa', () => {
    const largo = 'a'.repeat(85);
    expect(relationshipLabel({ parentToChildPhrase: largo }, Infinity)).toBe(largo);
  });

  it('el corte cuenta caracteres, no unidades UTF-16: no parte un emoji', () => {
    const s = `${'a'.repeat(78)}😀${'b'.repeat(10)}`;          // 89 caracteres
    expect(relationshipLabel({ parentToChildPhrase: s })).toBe(`${'a'.repeat(78)}😀…`);
  });

  it('un tope sin sentido (NaN, 0, 1) no corta nada', () => {
    for (const max of [Number.NaN, 0, 1]) {
      expect(relationshipLabel({ parentToChildPhrase: 'Cliente tiene' }, max)).toBe('Cliente tiene');
    }
  });
});

describe('labelMaxWidth (la etiqueta no debe tapar la línea ni los marcadores)', () => {
  it('hueco del auto-arrange (140): deja libres los crow-foot de ambos extremos', () => {
    expect(labelMaxWidth(140)).toBe(84);                      // 140 − 2·28
  });
  it('hueco amplio: tope de 260', () => {
    expect(labelMaxWidth(900)).toBe(260);
  });
  it('bloques casi pegados: piso de 72 (legible aunque roce los marcadores)', () => {
    expect(labelMaxWidth(90)).toBe(72);
  });
  it('sin hueco horizontal (bloques apilados): ancho por defecto', () => {
    expect(labelMaxWidth(0)).toBe(260);
    expect(labelMaxWidth(-240)).toBe(260);
  });
});

describe('wrapLabel (export: parte por palabras al ancho disponible)', () => {
  it('si cabe, queda en una línea', () => {
    expect(wrapLabel('Persona tiene', 20)).toEqual(['Persona tiene']);
  });
  it('parte por palabras sin pasarse del tope', () => {
    expect(wrapLabel('Persona tiene / un Estado Civil', 15)).toEqual(['Persona tiene /', 'un Estado Civil']);
    expect(wrapLabel('Estado Civil clasifica / tiene un Estado Civil', 15))
      .toEqual(['Estado Civil', 'clasifica /', 'tiene un Estado', 'Civil']);
  });
  it('una palabra más larga que el tope se corta dura', () => {
    expect(wrapLabel('Supercalifragilistico va', 8)).toEqual(['Supercal', 'ifragili', 'stico va']);
  });
  it('colapsa espacios repetidos', () => {
    expect(wrapLabel('  Persona    tiene  ', 20)).toEqual(['Persona tiene']);
  });
  it('tope sin sentido: una sola línea', () => {
    expect(wrapLabel('Persona tiene', 0)).toEqual(['Persona tiene']);
  });
});

describe('labelPlacement (dónde va la etiqueta y cuánto puede medir)', () => {
  const box = { x: 100, y: 200, w: 240 };

  it('normal: centrada en el punto medio del wire, ancho según el hueco', () => {
    expect(labelPlacement({ recursive: false, facesRight: true, sx: 300, tx: 440, midX: 370, midY: 129, box }))
      .toEqual({ x: 370, y: 129, maxWidth: 84, anchor: 'center' });
  });

  it('hijo a la IZQUIERDA del padre: el hueco se mide hacia ese lado', () => {
    // sx = borde izquierdo del padre (600) · tx = borde derecho del hijo (460)
    expect(labelPlacement({ recursive: false, facesRight: false, sx: 600, tx: 460, midX: 530, midY: 80, box }))
      .toEqual({ x: 530, y: 80, maxWidth: 84, anchor: 'center' });
  });

  it('bloques apilados (sin hueco horizontal): ancho por defecto', () => {
    expect(labelPlacement({ recursive: false, facesRight: true, sx: 340, tx: 100, midX: 220, midY: 330, box }))
      .toEqual({ x: 220, y: 330, maxWidth: 260, anchor: 'center' });
  });

  it('recursiva: el wire corre bajo el propio bloque, la etiqueta va ENCIMA y centrada', () => {
    expect(labelPlacement({ recursive: true, facesRight: true, sx: 340, tx: 100, midX: 220, midY: 250, box }))
      .toEqual({ x: 220, y: 192, maxWidth: 240, anchor: 'bottom' });
  });
});

describe('cleanPhrase (espejo de la normalización del backend)', () => {
  it('recorta los extremos y deja el interior', () => {
    expect(cleanPhrase('  Cliente  tiene ')).toBe('Cliente  tiene');
  });
  it('vacío, en blanco, null y undefined son «sin frase»', () => {
    expect(cleanPhrase('')).toBeNull();
    expect(cleanPhrase('   ')).toBeNull();
    expect(cleanPhrase(null)).toBeNull();
    expect(cleanPhrase(undefined)).toBeNull();
  });
});

describe('phraseChange (guardar al salir de la caja)', () => {
  it('mismo texto (aunque con espacios de más): no hay nada que grabar', () => {
    expect(phraseChange('Cliente tiene', '  Cliente tiene ')).toBeNull();
    expect(phraseChange(null, '   ')).toBeNull();
    expect(phraseChange(undefined, '')).toBeNull();
  });
  it('texto nuevo: devuelve la frase limpia a grabar', () => {
    expect(phraseChange(null, ' Cliente tiene ')).toEqual({ value: 'Cliente tiene' });
    expect(phraseChange('Cliente tiene', 'Cliente posee')).toEqual({ value: 'Cliente posee' });
  });
  it('caja vaciada: graba null (borra la frase)', () => {
    expect(phraseChange('Cliente tiene', '  ')).toEqual({ value: null });
  });
});

describe('phraseEdits (Apply del popup: un solo guardado con lo que cambió)', () => {
  const rel = { parentToChildPhrase: 'Cliente tiene', childToParentPhrase: null };

  it('sin borradores, o tipeando lo mismo: no hay nada que grabar', () => {
    expect(phraseEdits(rel, {})).toBeNull();
    expect(phraseEdits(rel, { parentToChildPhrase: ' Cliente tiene ', childToParentPhrase: '  ' })).toBeNull();
  });

  it('solo viaja la frase que cambió, limpia', () => {
    expect(phraseEdits(rel, { parentToChildPhrase: 'Cliente tiene', childToParentPhrase: ' es de un Cliente ' }))
      .toEqual({ childToParentPhrase: 'es de un Cliente' });
  });

  it('las dos frases en el MISMO guardado', () => {
    expect(phraseEdits(rel, { parentToChildPhrase: 'Cliente posee', childToParentPhrase: 'es de un Cliente' }))
      .toEqual({ parentToChildPhrase: 'Cliente posee', childToParentPhrase: 'es de un Cliente' });
  });

  it('caja vaciada: graba null (borra la frase)', () => {
    expect(phraseEdits(rel, { parentToChildPhrase: '' })).toEqual({ parentToChildPhrase: null });
  });
});

// Revisión doc 114 (H4): el aviso del role name en el modelo lógico decía
// «"X" renamed to "X"» cuando sólo cambiaba el físico (lo escondía).
describe('roleAppliedText (revisión doc 114)', () => {
  const cur = { logicalName: 'Codigo Cliente', physicalName: 'COD_CLI_X' };
  it('lógico: el nombre lógico de antes y el role name', () => {
    expect(roleAppliedText(cur, 'Codigo Comprador', 'COD_COMPRADOR', 'logical')).toBe('Role name applied: "Codigo Cliente" renamed to "Codigo Comprador"');
  });
  it('físico: los físicos', () => {
    expect(roleAppliedText(cur, 'Codigo Comprador', 'COD_COMPRADOR', 'physical')).toBe('Role name applied: "COD_CLI_X" renamed to "COD_COMPRADOR"');
  });
  it('mismo lógico (sólo cambia el físico): también en lógico nombra los físicos', () => {
    expect(roleAppliedText(cur, 'Codigo Cliente', 'CODCLIENTE', 'logical')).toBe('Role name applied: "COD_CLI_X" renamed to "CODCLIENTE"');
  });
});
