// Editor de una regla sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil):
// guardar manda la regla con sus archivos; un error de validación (con su línea)
// deshabilita guardar; la vista previa corre la lista con la regla en su lugar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, nextStates, resetFake, runEffects, textOf, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/dialogs', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('./CodeEditor', () => ({ default: function CodeEditor() { return null; } }));
vi.mock('../ddlRules.service', async (orig) => ({
  ...(await orig<typeof import('../ddlRules.service')>()),
  validateDdlRule: vi.fn(async () => ({ errors: [], warnings: [] })),
  saveDdlRule: vi.fn(async () => ({ label: 'v5' })),
  deleteDdlRule: vi.fn(async () => ({ label: 'v6' })),
  previewDdlRules: vi.fn(async () => ({ files: [], log: [] })),
  previewPayloadFor: vi.fn(async () => ({ model: { name: '', udpValues: {} }, tables: [], views: [] })),
  searchPreviewTables: vi.fn(async () => []),
}));
import { saveDdlRule, validateDdlRule } from '../ddlRules.service';
import type { DdlRule } from '../standards.service';
import CodeEditor from './CodeEditor';
import DdlRuleEditor, { newRuleDraft, previewRules } from './DdlRuleEditor';

const rule = (id: string, order: number, over: Partial<DdlRule> = {}): DdlRule => ({
  id, name: id, description: null, scope: 'table', when: '', order, enabled: true,
  files: [{ name: '{{ tabla.carpeta }}/T.sql', content: 'CREATE TABLE {{ tabla.nombre }};' }], ...over,
});
const RULES = [rule('a', 0), rule('b', 1), rule('c', 2)];

let props: Parameters<typeof DdlRuleEditor>[0];
function open(r: DdlRule | null) {
  props = {
    projectId: 'p1', rule: r, rules: RULES, config: { pieces: '', variables: {}, output: {} }, udpDefs: [],
    canEdit: true, canPreview: true, onBack: vi.fn(), onSaved: vi.fn(async () => {}),
  };
  resetFake();
  const tree = DdlRuleEditor(props);
  runEffects();
  return tree;
}
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = DdlRuleEditor(props);
  runEffects();
  return tree;
}
const saveBtn = (tree: unknown) => byText(tree, null, 'Save rule');
const editors = (tree: unknown) => [...walk(tree)].filter((e) => e.type === CodeEditor);
const flush = async () => { await vi.advanceTimersByTimeAsync(600); };

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('previewRules: la lista que corre la vista previa', () => {
  it('la regla en edición va en su lugar y activa; una nueva, en su posición', () => {
    const edited = { ...newRuleDraft(RULES), id: 'b', name: 'b', order: 1, enabled: false };
    expect(previewRules(RULES, edited).map((r) => [r.name, r.enabled])).toEqual([['a', true], ['b', true], ['c', true]]);
    expect(previewRules(RULES, { ...newRuleDraft(RULES), name: 'nueva' }).map((r) => r.name)).toEqual(['a', 'b', 'c', 'nueva']);
  });

  it('tras un borrado (posiciones 0, 1, 3) la nueva va debajo de todas, sin empatar', () => {
    const gaps = [rule('a', 0), rule('b', 1), rule('d', 3)];
    expect(newRuleDraft(gaps).order).toBe(4);
    expect(newRuleDraft([]).order).toBe(0);
    expect(previewRules(gaps, { ...newRuleDraft(gaps), name: 'nueva' }).map((r) => r.name)).toEqual(['a', 'b', 'd', 'nueva']);
  });
});

describe('editor de una regla', () => {
  it('sin cambios no se guarda; al cambiar el contenido, guarda la regla con sus archivos', async () => {
    let tree = open(RULES[1]);
    expect(saveBtn(tree).props.disabled).toBe(true);
    (editors(tree)[2].props.onChange as (v: string) => void)('CREATE OR REPLACE TABLE {{ tabla.nombre }};');
    tree = rerender();
    await flush();
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(false);
    await (saveBtn(tree).props.onClick as () => Promise<void>)();
    expect(saveDdlRule).toHaveBeenCalledWith('p1', expect.objectContaining({
      id: 'b', name: 'b', order: 1,
      files: [{ name: '{{ tabla.carpeta }}/T.sql', content: 'CREATE OR REPLACE TABLE {{ tabla.nombre }};' }],
    }), false);
    expect(props.onSaved).toHaveBeenCalled();
  });

  it('un error de validación se muestra con su línea y deshabilita guardar', async () => {
    vi.mocked(validateDdlRule).mockResolvedValue({
      errors: [{ field: 'files[0].content', line: 3, message: "unexpected '}'" }], warnings: ["UDP 'X' doesn't exist in this project (physical facet)."],
    });
    let tree = open(RULES[0]);
    (editors(tree)[2].props.onChange as (v: string) => void)('a\nb\n{% if }');
    tree = rerender();
    await flush();
    tree = rerender();
    const content = [...walk(tree)].find((e) => e.props.label === 'Content' && 'errors' in e.props)!;
    expect(content.props.errors).toEqual([{ field: 'files[0].content', line: 3, message: "unexpected '}'" }]);
    expect(textOf(tree)).toContain("UDP 'X' doesn't exist");
    expect(saveBtn(tree).props.disabled).toBe(true);
  });

  it('una regla nueva arranca al final con un archivo por tabla y se guarda como alta', async () => {
    let tree = open(null);
    expect(textOf(tree)).toContain('New rule');
    const name = [...walk(tree)].find((e) => e.type === 'input' && e.props['aria-label'] === 'Rule name')!;
    (name.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'extra' } });
    tree = rerender();
    await flush();
    tree = rerender();
    await (byText(tree, null, 'Add rule').props.onClick as () => Promise<void>)();
    expect(saveDdlRule).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'extra', order: 3, scope: 'table' }), true);
  });
});
