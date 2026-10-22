// El arnés de hooks de mentira (fakeReact.testutil) también se prueba: con
// setters estables (como en React), un setter de un montaje anterior — p. ej.
// un intervalo que no se soltó al desmontar — escribiría en el render vigente
// y un test de «desmontar» pasaría por la razón equivocada.
import { describe, expect, it } from 'vitest';
import { fake, fakeReact, resetFake } from './fakeReact.testutil';

const R = fakeReact({});
type Setter = (next: unknown) => void;

describe('fakeReact: setters por montaje', () => {
  it('un setter de un montaje anterior anota aparte (fake.stale), nunca en el render vigente', () => {
    resetFake();
    const [, setOld] = R.useState(0) as [number, Setter];
    resetFake();                                     // montaje nuevo
    R.useState(0);
    setOld(5);
    expect(fake.states[0].calls).toEqual([]);
    expect(fake.stale).toEqual([{ index: 0, next: 5 }]);
  });

  it('en un re-render del mismo montaje (keepRefs) el setter es el mismo y anota en el render vigente', () => {
    resetFake();
    const [, set] = R.useState(0) as [number, Setter];
    resetFake(null, { keepRefs: true });
    const [, again] = R.useState(0) as [number, Setter];
    set(7);
    expect(again).toBe(set);
    expect(fake.states[0].calls).toEqual([7]);
    expect(fake.stale).toEqual([]);
  });
});
