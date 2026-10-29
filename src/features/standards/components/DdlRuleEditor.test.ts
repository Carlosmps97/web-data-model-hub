// Editor de reglas de DDL Export sin DOM (hooks simulados: ver
// reporting/components/fakeReact.testutil). «Save rule» solo se habilita con un
// cambio real (no basta con que la regla sea válida): así no se registra una
// versión vacía.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { DdlRule } from '../standards.service';
import { nextStates, resetFake, runEffects, textOf, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/http', async (orig) => ({ ...(await orig<object>()), apiGet: vi.fn(async () => []) }));
vi.mock('../ddlRules.service', async (orig) => ({
  ...(await orig<object>()),
  validateDdlRule: vi.fn(async () => ({ state: 'valid', errors: [], checks: [], udpRefs: [], condition: '' })),
  impactDdlRule: vi.fn(async () => ({ columns: 3, tables: 1 })),
  testDdlRule: vi.fn(), saveDdlRule: vi.fn(async () => ({ label: 'v9' })), deleteDdlRule: vi.fn(),
}));
import { toast } from 'sonner';
import { apiGet } from '@/services/http';
import {
  impactDdlRule, saveDdlRule, testDdlRule, validateDdlRule, type DdlImpact, type DdlTestResult, type DdlValidateResult,
} from '../ddlRules.service';
import DdlRuleEditor from './DdlRuleEditor';

const RULE: DdlRule = {
  id: 'r1', name: 'tag_dac', description: null, kind: 'rule', target: 'column', sourceArtifact: null,
  condition: "columna.udp[\"Clasificacion\"] LIKE 'DAC-%'", udpRefs: [{ udpId: 'u1', level: 'column' }],
  action: { tags: { clasificacion: '{udp:Clasificacion}' } }, appliesTo: ['ddl.tabla'], priority: 100, enabled: true,
  validationState: 'valid', validationReport: {},
};

let props: Parameters<typeof DdlRuleEditor>[0];
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = DdlRuleEditor(props);
  runEffects();
  return tree;
}
/** Abre la regla guardada y espera la validación en vivo (debounce 450 ms). */
async function open(rule: DdlRule = RULE) {
  props = {
    projectId: 'p1', rule, rules: [rule], config: { lookups: {}, functions: [] }, udpDefs: [], artifacts: [],
    canEdit: true, onBack: vi.fn(), onSaved: vi.fn(async () => {}),
  };
  resetFake();
  DdlRuleEditor(props);
  runEffects();
  await vi.advanceTimersByTimeAsync(500);
  return rerender();
}
const saveBtn = (tree: unknown) => [...walk(tree)].find((e) => e.type === 'button' && textOf(e).trim() === 'Save rule')!;

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Regla de DDL: «Save rule» solo con un cambio real', () => {
  it('válida pero sin cambios queda deshabilitado, con «No changes to apply»', async () => {
    const tree = await open();
    expect(saveBtn(tree).props.disabled).toBe(true);
    expect(saveBtn(tree).props.title).toBe('No changes to apply');
  });

  it('con un cambio se habilita; si el backend igual responde «sin cambios», el aviso es neutro', async () => {
    let tree = await open();
    const priority = [...walk(tree)].find((e) => e.type === 'input' && e.props.type === 'number')!;
    (priority.props.onChange as (e: unknown) => void)({ target: { value: '50' } });
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(false);

    vi.mocked(saveDdlRule).mockRejectedValueOnce(new ApiError('There are no changes to apply.', 422));
    await (saveBtn(tree).props.onClick as () => Promise<void>)();
    expect(toast.info).toHaveBeenCalledWith('There are no changes to apply.');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('guardada invalid/stale que hoy valida (sin tocar nada): se puede re-guardar y vuelve al export', async () => {
    for (const validationState of ['invalid', 'stale'] as const) {
      vi.mocked(saveDdlRule).mockClear();
      const tree = await open({ ...RULE, validationState });
      expect(saveBtn(tree).props.disabled).toBe(false);
      expect(saveBtn(tree).props.title).toBeUndefined();
      expect(textOf(tree)).toContain('Validated · draft not saved');
      await (saveBtn(tree).props.onClick as () => Promise<void>)();
      expect(saveDdlRule).toHaveBeenCalledTimes(1);
    }
  });
});

// Los tres efectos con red del editor (validación en vivo, impacto/Test y buscador de
// tablas) descartan la respuesta tardía de un borrador (o búsqueda) anterior para que no
// pise la vigente, y dependen del proyecto (eslint exhaustive-deps): con el editor
// abierto, un cambio de proyecto los vuelve a correr contra el proyecto vigente.
describe('Regla de DDL: respuestas tardías y cambio de proyecto', () => {
  const VALID: DdlValidateResult = { state: 'valid', errors: [], checks: [], warnings: [], udpRefs: [], condition: '' };
  const INVALID: DdlValidateResult = {
    state: 'invalid', checks: [], warnings: [], udpRefs: [], condition: '',
    errors: [{ check: 'Syntax', message: 'Unexpected token', line: 1, col: 1 }],
  };
  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  /** Una promesa que el test resuelve a mano (para ordenar las respuestas). */
  function deferred<T>() {
    const out: ((v: T) => void)[] = [];
    const make = () => new Promise<T>((resolve) => { out.push(resolve); });
    return { out, make };
  }
  const setPriority = (tree: unknown, value: string) => {
    const input = [...walk(tree)].find((e) => e.type === 'input' && e.props.type === 'number')!;
    (input.props.onChange as (e: unknown) => void)({ target: { value } });
    return rerender();
  };

  it('validación: la respuesta tardía de un borrador anterior no pisa la del actual', async () => {
    let tree = await open();
    const d = deferred<DdlValidateResult>();
    vi.mocked(validateDdlRule).mockImplementationOnce(d.make).mockImplementationOnce(d.make);
    tree = setPriority(tree, '50');
    await vi.advanceTimersByTimeAsync(450);             // pedido 1 (borrador «50»)
    tree = setPriority(tree, '60');
    await vi.advanceTimersByTimeAsync(450);             // pedido 2 (borrador «60»)
    expect(d.out).toHaveLength(2);
    d.out[1](VALID); await flush();
    d.out[0](INVALID); await flush();                   // la del «50» llega tarde
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(false);   // manda la del borrador vigente
  });

  it('impacto: la respuesta tardía de un borrador anterior no pisa la del actual', async () => {
    let tree = await open();
    const d = deferred<DdlImpact>();
    vi.mocked(impactDdlRule).mockImplementationOnce(d.make).mockImplementationOnce(d.make);
    tree = setPriority(tree, '50');
    await vi.advanceTimersByTimeAsync(250);             // impacto 1
    tree = setPriority(tree, '60');
    await vi.advanceTimersByTimeAsync(250);             // impacto 2
    expect(d.out).toHaveLength(2);
    d.out[1]({ columns: 7, tables: 2 }); await flush();
    d.out[0]({ columns: 99, tables: 9 }); await flush();
    tree = rerender();
    expect(textOf(tree)).toContain('7 columns');
    expect(textOf(tree)).not.toContain('99 columns');
  });

  it('Test contra una tabla: la respuesta tardía de un borrador anterior no pisa la del actual', async () => {
    let tree = await open();
    (byLabel(tree, 'Sample table').props.onClick as () => void)();
    tree = rerender();
    vi.mocked(apiGet).mockResolvedValueOnce([{ id: 't1', physicalName: 'CLIENTE' }]);
    await vi.advanceTimersByTimeAsync(250); await flush();
    tree = rerender();
    vi.mocked(testDdlRule).mockResolvedValueOnce({ table: 'CLIENTE', matched: 0, total: 5, fragments: [] });
    (byLabel(tree, 'CLIENTE').props.onClick as () => void)();          // elige la tabla de prueba
    tree = rerender();
    await vi.advanceTimersByTimeAsync(250); await flush();
    tree = rerender();
    const d = deferred<DdlTestResult>();
    vi.mocked(testDdlRule).mockImplementationOnce(d.make).mockImplementationOnce(d.make);
    tree = setPriority(tree, '50');
    await vi.advanceTimersByTimeAsync(250);             // Test 1
    tree = setPriority(tree, '60');
    await vi.advanceTimersByTimeAsync(250);             // Test 2
    expect(d.out).toHaveLength(2);
    d.out[1]({ table: 'CLIENTE', matched: 2, total: 5, fragments: [] }); await flush();
    d.out[0]({ table: 'CLIENTE', matched: 4, total: 5, fragments: [] }); await flush();
    tree = rerender();
    expect(textOf(tree)).toContain('2 of 5 columns');
    expect(textOf(tree)).not.toContain('4 of 5 columns');
  });

  it('buscador de tablas: resultados tardíos de una búsqueda anterior no pisan los de la actual', async () => {
    let tree = await open();
    (byLabel(tree, 'Sample table').props.onClick as () => void)();   // abre el selector
    tree = rerender();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    const d = deferred<unknown>();
    vi.mocked(apiGet).mockImplementationOnce(d.make).mockImplementationOnce(d.make);
    const search = (t: unknown) => [...walk(t)].find((e) => e.type === 'input' && e.props.placeholder === 'Search tables…')!;
    (search(tree).props.onChange as (e: unknown) => void)({ target: { value: 'cli' } });
    tree = rerender();
    await vi.advanceTimersByTimeAsync(250);             // búsqueda 1
    (search(tree).props.onChange as (e: unknown) => void)({ target: { value: 'cliente' } });
    tree = rerender();
    await vi.advanceTimersByTimeAsync(250);             // búsqueda 2
    expect(d.out).toHaveLength(2);
    d.out[1]([{ id: 't2', physicalName: 'CLIENTE' }]); await flush();
    d.out[0]([{ id: 't1', physicalName: 'CLI_VIEJA' }]); await flush();
    tree = rerender();
    expect(textOf(tree)).toContain('CLIENTE');
    expect(textOf(tree)).not.toContain('CLI_VIEJA');
  });

  it('si cambia el proyecto con el editor abierto, valida, estima y busca contra el nuevo', async () => {
    let tree = await open();
    (byLabel(tree, 'Sample table').props.onClick as () => void)();
    tree = rerender();
    await vi.advanceTimersByTimeAsync(450);
    await flush();
    vi.mocked(validateDdlRule).mockClear();
    vi.mocked(impactDdlRule).mockClear();
    vi.mocked(apiGet).mockClear();
    props = { ...props, projectId: 'p2' };
    rerender();
    await vi.advanceTimersByTimeAsync(450);
    expect(validateDdlRule).toHaveBeenCalledWith('p2', expect.anything());
    expect(impactDdlRule).toHaveBeenCalledWith('p2', expect.anything());
    expect(vi.mocked(apiGet).mock.calls.map(([url]) => url)).toEqual([expect.stringContaining('/projects/p2/')]);
  });
});

/** Botón cuyo texto empieza con `label` (sin importar lo que siga). */
function byLabel(tree: unknown, label: string) {
  const hit = [...walk(tree)].find((e) => e.type === 'button' && textOf(e).trim().startsWith(label));
  if (!hit) throw new Error(`no button «${label}»`);
  return hit;
}

describe('Regla de layout: las particiones van siempre en el PARTITIONED BY', () => {
  const LAYOUT: DdlRule = {
    ...RULE, id: 'l1', name: 'particiones_al_final', target: 'table', condition: '', udpRefs: [],
    action: { layout: { partitionColumns: 'last', partitionUdp: 'Particion' } }, appliesTo: ['ddl.tabla_fisica'],
  };
  /** El panel de la acción (sub-componente) renderizado con sus props reales. */
  const actionPanel = (tree: unknown, onChange?: (a: Record<string, unknown>) => void) => {
    const el = [...walk(tree)].find((e) => typeof e.type === 'function' && e.type.name === 'RuleAction')!;
    const render = el.type as (p: unknown) => unknown;
    resetFake(null, { keepRefs: true });            // sus hooks arrancan con sus valores iniciales
    return render(onChange ? { ...el.props, onChange } : el.props);
  };

  it('«Partition columns» solo decide qué pasa sin PARTITIONED BY, y la ayuda lo dice', async () => {
    const panel = actionPanel(await open(LAYOUT));
    const select = [...walk(panel)].find((e) => e.type === 'select')!;
    expect(select.props.value).toBe('last');
    const opts = [...walk(select)].filter((e) => e.type === 'option').map((o) => [o.props.value, textOf(o)]);
    expect(opts).toEqual([['last', 'Emit at the end of the CREATE TABLE'], ['keep', 'Keep the physical order']]);
    const text = textOf(panel);
    expect(text).toContain('Without PARTITIONED BY');
    expect(text).toContain('PARTITIONED BY (codmes int, …)');
  });

  it('una regla sin «partitionColumns» se muestra y se guarda como el motor la aplica (orden físico)', async () => {
    const onChange = vi.fn();
    const legacy: DdlRule = { ...LAYOUT, action: { layout: { partitionOrderUdp: 'Particion' } } };
    const panel = actionPanel(await open(legacy), onChange);
    const select = [...walk(panel)].find((e) => e.type === 'select')!;
    expect(select.props.value).toBe('keep');
    const udp = [...walk(panel)].find((e) => e.type === 'input' && e.props.list === 'ddl-column-udps')!;
    (udp.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Particion' } });
    expect(onChange).toHaveBeenCalledWith({ layout: { partitionColumns: 'keep', partitionUdp: 'Particion' } });
  });

  it('una acción de layout nueva arranca con el formato de la semilla', async () => {
    const onChange = vi.fn();
    const tree = await open({ ...LAYOUT, action: { tblproperties: { a: 'b' } } });
    const seg = [...walk(actionPanel(tree, onChange))].find((e) => typeof e.type === 'function' && e.type.name === 'Segmented')!;
    (seg.props.onPick as (v: string) => void)('layout');
    expect(onChange).toHaveBeenCalledWith({ layout: { partitionColumns: 'last', partitionUdp: 'Particion' } });
  });
});

describe('Acciones «Keep column» (columna) y «Don\'t generate» (tabla)', () => {
  const OMIT: DdlRule = {
    ...RULE, id: 'o1', name: 'sufijo_dac_sin_vistas_dac', target: 'table', condition: "tabla.nombre ENDS WITH 'DAC'",
    udpRefs: [], action: { omit: true }, appliesTo: ['ddl.vista_tecnica_dac', 'ddl.vista_rej_dac'],
  };
  const KEEP: DdlRule = {
    ...RULE, id: 'k1', name: 'sufijo_dac_conservar_columnas', target: 'column', condition: "tabla.nombre ENDS WITH 'DAC'",
    udpRefs: [], action: { keep: true }, appliesTo: ['ddl.vista_tecnica', 'ddl.vista_rej'],
  };
  const panelOf = (tree: unknown, onChange?: (a: Record<string, unknown>) => void) => {
    const el = [...walk(tree)].find((e) => typeof e.type === 'function' && e.type.name === 'RuleAction')!;
    resetFake(null, { keepRefs: true });
    return (el.type as (p: unknown) => unknown)(onChange ? { ...el.props, onChange } : el.props);
  };
  const segOf = (panel: unknown) => [...walk(panel)].find((e) => typeof e.type === 'function' && e.type.name === 'Segmented')!;

  it('una regla guardada con omit / keep abre en su acción y explica qué hace', async () => {
    const omit = panelOf(await open(OMIT));
    expect(segOf(omit).props.value).toBe('omit');
    expect(segOf(omit).props.options).toContainEqual(['omit', "Don't generate"]);
    expect(textOf(omit)).toContain('are not generated');
    const keep = panelOf(await open(KEEP));
    expect(segOf(keep).props.value).toBe('keep');
    expect(segOf(keep).props.options).toContainEqual(['keep', 'Keep column']);
    expect(textOf(keep)).toContain('lower priority');
  });

  it('elegir la acción arma su JSON', async () => {
    const onChange = vi.fn();
    (segOf(panelOf(await open({ ...OMIT, action: { tags: { a: 'b' } } }), onChange)).props.onPick as (v: string) => void)('omit');
    expect(onChange).toHaveBeenLastCalledWith({ omit: true });
    (segOf(panelOf(await open({ ...KEEP, action: { exclude: true } }), onChange)).props.onPick as (v: string) => void)('keep');
    expect(onChange).toHaveBeenLastCalledWith({ keep: true });
  });
});

