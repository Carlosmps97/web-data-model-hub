// El formulario de un panel que copia campos de una tabla o vista (doc 133 §13,
// P1): si el objeto cambia en la versión —un Undo o Redo, el propio guardado, otra
// pestaña—, cada campo sin cambios locales toma el valor nuevo; uno que se está
// editando se conserva. Sin esto, tras deshacer lo tipeado el formulario seguía
// mostrándolo y, al volver a salir del campo, lo grababa otra vez.
import { describe, expect, it } from 'vitest';
import { reseedForm } from './modelForm';

describe('reseedForm', () => {
  it('un campo sin cambios locales toma el valor nuevo', () => {
    expect(reseedForm({ name: 'CLIENTE', description: 'x' }, { name: 'CLIENTE', description: 'x' }, { name: 'CLIENTE', description: '' }))
      .toEqual({ name: 'CLIENTE', description: '' });
  });
  it('uno que se está editando se conserva', () => {
    expect(reseedForm({ name: 'CLIENTE_X', description: 'x' }, { name: 'CLIENTE', description: 'x' }, { name: 'CUENTA', description: '' }))
      .toEqual({ name: 'CLIENTE_X', description: '' });
  });
  it('un campo cuyo valor del modelo no cambió queda como está (no pierde espacios mientras se escribe)', () => {
    expect(reseedForm({ name: 'CLIENTE', description: 'abc. ' }, { name: 'CLIENTE', description: 'abc.' }, { name: 'CUENTA', description: 'abc.' }))
      .toEqual({ name: 'CUENTA', description: 'abc. ' });
  });
  it('en el nombre lógico los espacios de adentro no cuentan (el backend los junta); en los demás campos sí', () => {
    expect(reseedForm(
      { logicalName: 'Cliente  Nuevo', description: 'a  b' },
      { logicalName: 'Cliente Nuevo', description: 'a b' },
      { logicalName: 'Cliente', description: 'c' },
    )).toEqual({ logicalName: 'Cliente', description: 'a  b' });
  });
  it('en el esquema, la opción vacía es el esquema por defecto (el backend graba en él lo que va sin esquema)', () => {
    // Se eligió el default y se grabó (el modelo dice Not_defined); un Undo lo devuelve a SCH_A.
    expect(reseedForm({ schema: '' }, { schema: 'Not_defined' }, { schema: 'SCH_A' })).toEqual({ schema: 'SCH_A' });
    // El default elegido sin grabar sigue siendo un cambio local.
    expect(reseedForm({ schema: '' }, { schema: 'SCH_A' }, { schema: 'SCH_B' })).toEqual({ schema: '' });
  });
  it('los espacios de los bordes no cuentan como cambio (lo grabado va sin ellos)', () => {
    expect(reseedForm({ name: 'CLIENTE', description: 'abc ' }, { name: 'CLIENTE', description: 'abc' }, { name: 'CLIENTE', description: '' }))
      .toEqual({ name: 'CLIENTE', description: '' });
  });
});
