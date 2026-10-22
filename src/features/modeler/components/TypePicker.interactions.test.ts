// TypePicker sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil).
// Las cajas de argumentos aceptan texto, pero al valor solo viaja un argumento
// válido: nada que rompa el tipo ni el DDL (`--` es un comentario SQL), nada que
// se «arregle» en silencio (`18,2` no es `182`) y nada oculto de un tipo anterior
// (`VARCHAR(10,2)`).
import { describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, runEffects, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
import TypePicker from './TypePicker';
import SearchSelect from './SearchSelect';

/** Monta el selector con `value`; cada `onChange` re-renderiza con el valor nuevo (como el panel). */
function mount(value: string) {
  const emitted: string[] = [];
  let props = { value, onChange: (next: string) => { emitted.push(next); props = { ...props, value: next }; } };
  resetFake();
  let tree = TypePicker(props) as unknown;
  runEffects();
  const rerender = () => {
    const next = nextStates();
    resetFake((_init, i) => next[i], { keepRefs: true });
    tree = TypePicker(props) as unknown;
    runEffects();
  };
  const inputs = () => [...walk(tree)].filter((e): e is El => e.type === 'input');
  return {
    emitted,
    inputs,
    type(i: number, text: string) {
      (inputs()[i].props.onChange as (e: unknown) => void)({ target: { value: text } });
      rerender();
    },
    pick(base: string) {
      const ss = [...walk(tree)].find((e) => e.type === SearchSelect)!;
      (ss.props.onPick as (v: string) => void)(base);
      rerender();
    },
    /** El valor cambia por fuera (p. ej. heredar el default de un dominio). */
    outside(next: string) {
      props = { ...props, value: next };
      rerender();
    },
  };
}

describe('cajas de argumentos', () => {
  it('«--» no viaja al tipo (en el DDL comentaría el resto de la línea): el tipo queda como estaba y la caja marcada', () => {
    const p = mount('DECIMAL(10,2)');
    p.type(0, '--');
    expect(p.emitted).toEqual([]);
    expect(p.inputs()[0].props['aria-invalid']).toBe(true);
  });

  it('«18,2» o «10.5» pegados en la precisión no se convierten en 182 / 105 ni borran la escala', () => {
    const p = mount('DECIMAL(10,2)');
    p.type(0, '18,2');
    p.type(0, '10.5');
    p.type(1, '3');                                           // otra caja válida tampoco aplica mientras haya una inválida
    expect(p.emitted).toEqual([]);
    expect(p.inputs()[0].props.value).toBe('10.5');          // lo tipeado se ve, marcado
    expect(p.inputs()[0].props['aria-invalid']).toBe(true);
    p.type(0, '12');                                          // al corregirla, aplica todo
    expect(p.emitted.at(-1)).toBe('DECIMAL(12,3)');
  });

  it('un argumento oculto de otro tipo no se cuela al elegir otra base', () => {
    const p = mount('DECIMAL(10,2)');
    p.type(0, '');                                            // queda solo la escala «2»
    expect(p.emitted.at(-1)).toBe('DECIMAL');
    p.pick('VARCHAR');
    p.type(0, '10');
    expect(p.emitted.at(-1)).toBe('VARCHAR(10)');
  });

  it('un valor anterior de las cajas no reaparece si la base cambia por fuera', () => {
    const p = mount('DECIMAL(10,2)');
    p.type(0, '');                                            // queda solo la escala «2»
    p.pick('STRING');
    p.outside('NUMBER');                                      // p. ej. hereda el default de un dominio
    expect(p.inputs().map((i) => i.props.value)).toEqual(['', '']);
    p.type(0, '10');
    expect(p.emitted.at(-1)).toBe('NUMBER(10)');
    const q = mount('DECIMAL');
    q.type(1, '7');
    q.outside('VARCHAR');
    q.outside('NUMERIC');
    expect(q.inputs().map((i) => i.props.value)).toEqual(['', '']);
  });

  it('VECTOR con solo el formato → TIMESTAMP(6), sin el FLOAT32', () => {
    const p = mount('VECTOR');
    p.type(1, 'float32');
    p.pick('TIMESTAMP');
    p.type(0, '6');
    expect(p.emitted.at(-1)).toBe('TIMESTAMP(6)');
  });

  it('lo válido viaja: MAX, 30 CHAR, *', () => {
    const p = mount('VARCHAR2');
    p.type(0, '30 ');
    expect(p.emitted.at(-1)).toBe('VARCHAR2(30)');
    p.type(0, '30 char');
    expect(p.emitted.at(-1)).toBe('VARCHAR2(30 CHAR)');
    expect(p.inputs()[0].props['aria-invalid']).toBeFalsy();
    const n = mount('NUMBER');
    n.type(0, '*');
    n.type(1, '2');
    expect(n.emitted.at(-1)).toBe('NUMBER(*,2)');
  });
});
