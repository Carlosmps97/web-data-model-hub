// Lista de reglas sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil):
// en orden (arriba = más prioridad), mover cambia la posición, on/off y el set
// base con la lista vacía.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, runEffects, textOf, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../ddlRules.service', () => ({
  reorderDdlRules: vi.fn(() => Promise.resolve({ label: 'v2' })),
  restoreBaseRuleSet: vi.fn(async () => ({ label: 'v3' })),
  toggleDdlRule: vi.fn(async () => ({ label: 'v4' })),
}));
import { reorderDdlRules, restoreBaseRuleSet, toggleDdlRule } from '../ddlRules.service';
import type { DdlRule } from '../standards.service';
import DdlRuleList, { moveRule, sortRules } from './DdlRuleList';

const rule = (id: string, order: number, over: Partial<DdlRule> = {}): DdlRule => ({
  id, name: id, description: null, scope: 'table', when: '', order, enabled: true,
  files: [{ name: 'a.sql', content: 'x' }], ...over,
});
const CONFIG = { pieces: '', variables: { desencriptar: 'f' }, output: {} };

let props: Parameters<typeof DdlRuleList>[0];
function open(rules: DdlRule[], canEdit = true) {
  props = {
    projectId: 'p1', rules, config: CONFIG, canEdit, onOpen: vi.fn(), onNew: vi.fn(), onPieces: vi.fn(),
    onOutput: vi.fn(), onApplied: vi.fn(async () => {}),
  };
  resetFake();
  const tree = DdlRuleList(props);
  runEffects();
  return tree;
}
const byLabel = (tree: unknown, label: string) => {
  const el = [...walk(tree)].find((e) => e.props['aria-label'] === label);
  if (!el) throw new Error(`no element ${label}`);
  return el;
};

beforeEach(() => { vi.clearAllMocks(); });

describe('orden de la lista', () => {
  it('por posición y, en un empate, por nombre; mover deja la regla en su nuevo lugar', () => {
    const rs = [rule('b', 1), rule('z', 0), rule('a', 1)];
    expect(sortRules(rs).map((r) => r.id)).toEqual(['z', 'a', 'b']);
    expect(moveRule(sortRules(rs), 0, 2).map((r) => r.id)).toEqual(['a', 'b', 'z']);
  });

  it('las filas salen en orden con su posición, «para cada» y condición', () => {
    const tree = open([rule('vista_negocio', 1, { scope: 'view', when: 'vista.en_canvas' }), rule('tabla_fisica', 0)]);
    const text = textOf(tree);
    expect(text.indexOf('tabla_fisica')).toBeLessThan(text.indexOf('vista_negocio'));
    expect(text).toContain('#1');
    expect(text).toContain('Each view');
    expect(text).toContain('when vista.en_canvas');
  });

  it('bajar la primera regla manda la lista nueva (order = posición); la primera no sube', async () => {
    const tree = open([rule('a', 0), rule('b', 1), rule('c', 2)]);
    expect(byLabel(tree, 'Move a up').props.disabled).toBe(true);
    await (byLabel(tree, 'Move a down').props.onClick as () => Promise<void>)();
    expect(vi.mocked(reorderDdlRules).mock.calls[0][1].map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('el nombre abre el editor (también con el teclado)', () => {
    const tree = open([rule('a', 0)]);
    const name = [...walk(tree)].find((e) => e.type === 'button' && textOf(e) === 'a')!;
    (name.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: () => {} });
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('on/off de una regla', async () => {
    const tree = open([rule('a', 0)]);
    const toggle = [...walk(tree)].find((e) => e.props.label === 'a' && 'onFlip' in e.props)!;
    expect(toggle.props.on).toBe(true);
    (toggle.props.onFlip as () => void)();
    expect(toggleDdlRule).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a' }), false);
  });

  it('sin permiso: no se reordena ni se crea', () => {
    const tree = open([rule('a', 0)], false);
    expect([...walk(tree)].some((e) => e.props['aria-label'] === 'Move a down')).toBe(false);
    expect(textOf(tree)).not.toContain('New rule');
  });
});

describe('lista vacía', () => {
  it('el CTA restaura el set base con la config del proyecto', async () => {
    const tree = open([]);
    const cta = [...walk(tree)].find((e) => textOf(e) === 'Restore the base rule set')!;
    await (cta.props.onClick as () => Promise<void>)();
    expect(restoreBaseRuleSet).toHaveBeenCalledWith('p1', CONFIG);
  });
});
