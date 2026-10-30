// Popup Export DDL sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil):
// con reglas activas abre con «Use export rules» (dialecto y Output ocultos);
// sin reglas, con «Use export settings»; si una regla falla no se descarga nada.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, nextStates, resetFake, runEffects, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/store/useSessionStore', async (orig) => ({ ...(await orig<object>()), sessionProjectId: () => 'p1' }));
vi.mock('@/store/useBusyStore', async (orig) => ({ ...(await orig<object>()), runBlocking: (_t: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@/store/useAuthStore', async (orig) => ({ ...(await orig<object>()), useAuthStore: (sel: (s: { has: () => boolean }) => unknown) => sel({ has: () => true }) }));
vi.mock('@/lib/zip', async (orig) => ({ ...(await orig<object>()), buildZip: vi.fn(() => new Blob()) }));
vi.mock('../rulesBridge', async (orig) => ({
  ...(await orig<typeof import('../rulesBridge')>()),
  fetchExportRules: vi.fn(), fetchDdlConfig: vi.fn(async () => ({ output: null })), renderWithRules: vi.fn(),
}));
import { toast } from 'sonner';
import { ApiError } from '@/services/http';
import { buildZip } from '@/lib/zip';
import { fetchExportRules, renderWithRules } from '../rulesBridge';
import DdlOutputForm from './DdlOutputForm';
import ExportDdlModal from './ExportDdlModal';
import ExportRulesPanel from './ExportRulesPanel';

const diagram = {
  subjectArea: { id: 'sa1', name: 'Canvas', tableIds: ['t1'], viewIds: [] },
  tables: [{ id: 't1', physicalName: 'T', logicalName: 'T', schema: 's' }],
  columns: [{ id: 'c1', tableId: 't1', physicalName: 'COD', logicalName: 'Cod', dataType: 'STRING', ordinal: 0 }],
  relationships: [], views: [],
} as never;
const RULES = [
  { id: 'r1', name: 'tabla_fisica', scope: 'table', order: 0, enabled: true },
  { id: 'r2', name: 'apagada', scope: 'table', order: 1, enabled: false },
];

let props: Parameters<typeof ExportDdlModal>[0];
async function open() {
  props = { open: true, diagram, modelName: 'm', onClose: vi.fn() };
  resetFake();
  ExportDdlModal(props);
  runEffects();
  await Promise.resolve(); await Promise.resolve();
  return rerender();
}
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = ExportDdlModal(props);
  runEffects();
  return tree;
}
const has = (tree: unknown, type: unknown) => [...walk(tree)].some((e) => e.type === type);
const radio = (tree: unknown, name: string) =>
  [...walk(tree)].find((e) => e.props.role === 'radio' && JSON.stringify(e.props.children).includes(name))!;

beforeEach(() => { vi.clearAllMocks(); });

describe('Export DDL: configuración o reglas', () => {
  it('con reglas activas abre con «Use export rules»: lista de reglas en lugar del dialecto y Output', async () => {
    vi.mocked(fetchExportRules).mockResolvedValue(RULES as never);
    const tree = await open();
    expect(radio(tree, 'Use export rules').props['aria-checked']).toBe(true);
    expect(has(tree, ExportRulesPanel)).toBe(true);
    expect(has(tree, DdlOutputForm)).toBe(false);
    const panel = [...walk(tree)].find((e) => e.type === ExportRulesPanel)!;
    expect((panel.props.rules as { id: string }[]).map((r) => r.id)).toEqual(['r1']);   // solo las activas
  });

  it('sin reglas activas abre con «Use export settings» y la otra opción no se puede elegir', async () => {
    vi.mocked(fetchExportRules).mockResolvedValue([RULES[1]] as never);
    const tree = await open();
    expect(radio(tree, 'Use export settings').props['aria-checked']).toBe(true);
    expect(radio(tree, 'Use export rules').props.disabled).toBe(true);
    expect(has(tree, DdlOutputForm)).toBe(true);
  });

  it('si una regla falla, avisa regla, objeto, archivo y línea, y no descarga nada', async () => {
    vi.mocked(fetchExportRules).mockResolvedValue(RULES as never);
    vi.mocked(renderWithRules).mockRejectedValue(new ApiError('boom', 422,
      { message: 'boom', rule: 'tabla_fisica', object: 's.T', file: 'T/TABLE-T.sql', line: 2 }));
    let tree = await open();
    (byText(tree, 'button', 'All').props.onClick as () => void)();          // marca la tabla
    tree = rerender();
    await (byText(tree, null, 'Download .zip').props.onClick as () => Promise<void>)();
    expect(renderWithRules).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', ruleIds: ['r1'] }));
    expect(toast.error).toHaveBeenCalledWith('Rule tabla_fisica failed on s.T (T/TABLE-T.sql, line 2): boom');
    expect(buildZip).not.toHaveBeenCalled();
  });
});
