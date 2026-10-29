// El formulario de los paneles de tabla y de vista (doc 133 §13, P1): se siembra
// con el objeto en el mismo render en que llega (nunca se ve vacío ni a medias)
// y, si el objeto cambia en la versión (Undo, Redo, el propio guardado), cada
// campo sin cambios locales toma el valor nuevo.
import type { Dispatch, SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, nextStates, resetFake } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));

import { useModelForm } from './useModelForm';

type F = { name: string; description: string };
const EMPTY: F = { name: '', description: '' };
const A: F = { name: 'CLIENTE', description: '' };
let setForm: Dispatch<SetStateAction<F>>;

/** Primer render de un montaje nuevo: el formulario que muestra. */
const mount = (id: string, values: F | null): F => {
  resetFake();
  const [form, set] = useModelForm(id, values, EMPTY);
  setForm = set;
  return form;
};
/** Re-render del mismo montaje, con lo tipeado (`setForm`) aplicado: el formulario que muestra. */
const rerender = (id: string, values: F | null): F => {
  const states = nextStates();
  resetFake((init, i) => (i < states.length ? states[i] : init), { keepRefs: true });
  const [form, set] = useModelForm(id, values, EMPTY);
  setForm = set;
  return form;
};

describe('useModelForm', () => {
  beforeEach(() => resetFake());

  it('se siembra con el objeto en el primer render', () => {
    expect(mount('t1', A)).toEqual(A);
  });

  it('los mismos valores en otro objeto literal (cada render arma uno) no vuelven a sembrar: sin bucle de renders', () => {
    mount('t1', { ...A });
    expect(rerender('t1', { ...A })).toEqual(A);
    expect(fake.states[0].calls).toEqual([]);
  });

  it('montado sin objeto muestra el vacío; al llegar el objeto, ese mismo render ya lo muestra', () => {
    expect(mount('t1', null)).toEqual(EMPTY);
    expect(rerender('t1', A)).toEqual(A);
  });

  it('tras deshacer lo grabado (el objeto vuelve), el formulario lo muestra', () => {
    mount('t1', A);
    setForm((f) => ({ ...f, description: 'definicion' }));
    expect(rerender('t1', { ...A, description: 'definicion' })).toEqual({ ...A, description: 'definicion' });   // grabado
    expect(rerender('t1', A)).toEqual(A);                                                                       // Undo
  });

  it('lo que se está escribiendo sin grabar no se pisa cuando el objeto cambia', () => {
    mount('t1', A);
    setForm({ ...A, description: 'a medio escribir' });
    expect(rerender('t1', { ...A, name: 'CUENTA' })).toEqual({ name: 'CUENTA', description: 'a medio escribir' });
  });

  it('otro objeto: se siembra entero (lo escrito del anterior no pasa)', () => {
    mount('t1', A);
    setForm((f) => ({ ...f, description: 'algo' }));
    expect(rerender('t2', { name: 'PEDIDO', description: 'p' })).toEqual({ name: 'PEDIDO', description: 'p' });
  });

  it('sin objeto queda lo último; si vuelve igual, lo escrito sigue', () => {
    mount('t1', A);
    setForm((f) => ({ ...f, name: 'X' }));
    expect(rerender('t1', null)).toEqual({ name: 'X', description: '' });
    expect(rerender('t1', A)).toEqual({ name: 'X', description: '' });
  });
});
