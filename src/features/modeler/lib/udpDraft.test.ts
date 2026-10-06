// Lógica pura del guardado de UDPs (doc 40): los inputs de texto commitean al
// SALIR del campo (blur), no por tecla. `pending` acumula lo commiteado que el
// server todavía no refleja (el reload demora): sin ese overlay, commitear el
// campo B con el prop stale PISABA el campo A recién guardado (lost-update).
import { describe, it, expect } from 'vitest';
import { applyPending, commitValue, prunePending, udpChanges } from './udpDraft';

describe('commitValue', () => {
  it('setea el valor nuevo sobre la base', () => {
    expect(commitValue({ a: '1' }, 'b', 'x')).toEqual({ a: '1', b: 'x' });
  });

  it('cadena vacía ELIMINA la key (vuelve al default de la definición)', () => {
    expect(commitValue({ a: '1', b: 'x' }, 'b', '')).toEqual({ a: '1' });
  });

  it('no muta la base', () => {
    const base = { a: '1' };
    commitValue(base, 'a', '2');
    expect(base).toEqual({ a: '1' });
  });
});

describe('applyPending (overlay anti lost-update)', () => {
  it('los commits pendientes PISAN al prop stale del server', () => {
    // A se commiteó ('2') pero el reload aún no llega (prop dice '1').
    expect(applyPending({ a: '1', b: 'x' }, { a: '2' })).toEqual({ a: '2', b: 'x' });
  });

  it('un delete pendiente (\'\') quita la key aunque el prop stale la traiga', () => {
    expect(applyPending({ a: '1' }, { a: '' })).toEqual({});
  });

  it('sin pendientes devuelve la base tal cual', () => {
    expect(applyPending({ a: '1' }, {})).toEqual({ a: '1' });
  });
});

describe('prunePending (limpieza cuando el server ya refleja)', () => {
  it('quita los pendientes que el prop nuevo ya trae y conserva el resto', () => {
    expect(prunePending({ a: '2' }, { a: '2', b: 'y' })).toEqual({ b: 'y' });
  });

  it('un delete pendiente se limpia cuando la key ya no viene', () => {
    expect(prunePending({}, { a: '' })).toEqual({});
  });

  it('conserva los pendientes que el server todavía NO refleja', () => {
    expect(prunePending({ a: '1' }, { a: '2' })).toEqual({ a: '2' });
  });
});

describe('escenario integrado: editar A y B seguidos con reload lento', () => {
  it('el commit de B no pierde el commit de A', () => {
    const server = { a: 'vieja' };            // prop stale durante todo el flujo
    let pending: Record<string, string> = {};
    // blur de A → commit sobre la base efectiva
    const afterA = commitValue(applyPending(server, pending), 'a', 'nueva');
    pending = { ...pending, a: 'nueva' };
    expect(afterA).toEqual({ a: 'nueva' });
    // blur de B ANTES de que llegue el reload de A
    const afterB = commitValue(applyPending(server, pending), 'b', 'bb');
    expect(afterB).toEqual({ a: 'nueva', b: 'bb' });   // A sobrevive
    // llega el reload que refleja A → pending se poda solo
    pending = prunePending({ a: 'nueva', b: 'bb' }, { ...pending, b: 'bb' });
    expect(pending).toEqual({});
  });
});

describe('udpChanges (doc 112: la ficha graba sólo lo que cambió)', () => {
  it('sólo las keys que cambiaron respecto de cómo se abrió; cadena vacía = quitar', () => {
    expect(udpChanges({ a: '1', b: 'x' }, { a: '1', b: 'y', c: 'z' })).toEqual({ b: 'y', c: 'z' });
    expect(udpChanges({ a: '1', b: 'x' }, { a: '1' })).toEqual({ b: '' });
  });

  it('sin cambios, vacío (un valor vacío equivale a no tenerlo)', () => {
    expect(udpChanges({ a: '1' }, { a: '1' })).toEqual({});
    expect(udpChanges({ a: '' }, {})).toEqual({});
  });
});
