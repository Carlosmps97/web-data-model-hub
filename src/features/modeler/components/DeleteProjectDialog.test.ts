// DeleteProjectDialog sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil).
// Si el conteo del proyecto falla, el texto no debe quedar en «Counting project
// contents…» ni «Delete project» deshabilitado para siempre (sin reintento ni
// salida).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import { byText, nextStates, resetFake, runEffects, textOf, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/projects.service', () => ({ getProjectCounts: vi.fn() }));
vi.mock('@/store/useModelerStore', () => ({ useModelerStore: (sel: (s: unknown) => unknown) => sel({ deleteProject: vi.fn() }) }));
import { getProjectCounts } from '@/services/projects.service';
import DeleteProjectDialog from './DeleteProjectDialog';

const PROJECT = { id: 'p1', name: 'Modelo Ventas' } as never;
const COUNTS = { tables: 2, columns: 9, views: 1, relationships: 1, schemas: 1, folders: 1, canvases: 1 };
const tick = () => new Promise((r) => setTimeout(r, 0));
let props: Parameters<typeof DeleteProjectDialog>[0];

function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = DeleteProjectDialog(props);
  runEffects();
  return tree;
}
async function open() {
  props = { open: true, project: PROJECT, onClose: vi.fn(), onDeleted: vi.fn() };
  resetFake();
  DeleteProjectDialog(props);
  runEffects();
  await tick();
  return rerender();
}
const deleteBtn = (tree: unknown) => byText(tree, 'button', 'Delete project');
const input = (tree: unknown) => [...walk(tree)].find((e) => e.type === 'input')!;
const typeName = (tree: unknown, v: string) => (input(tree).props.onChange as (e: unknown) => void)({ target: { value: v } });

beforeEach(() => { vi.clearAllMocks(); });

describe('DeleteProjectDialog: el conteo informa, no traba', () => {
  it('con el conteo caído lo dice, ofrece Retry y el nombre tipeado igual habilita el borrado', async () => {
    vi.mocked(getProjectCounts).mockRejectedValueOnce(new ApiError('Service unavailable', 503));
    let tree = await open();
    expect(textOf(tree)).toContain("Couldn't count the project contents: Service unavailable.");
    expect(textOf(tree)).not.toContain('Counting project contents…');
    expect(deleteBtn(tree).props.disabled).toBe(true);
    typeName(tree, 'Modelo Ventas');
    tree = rerender();
    expect(deleteBtn(tree).props.disabled).toBe(false);
    // el texto del conteo es una región viva (el resultado y el error se anuncian)
    const status = [...walk(tree)].find((e) => e.type === 'p' && e.props.role === 'status');
    expect(status && textOf(status)).toContain("Couldn't count the project contents");
    // Retry desaparece al pulsarlo: el foco pasa al campo del nombre (no a <body>)
    const focus = vi.fn();
    (input(tree).props.ref as { current: unknown }).current = { focus };
    vi.mocked(getProjectCounts).mockResolvedValueOnce(COUNTS);
    (byText(tree, 'button', 'Retry').props.onClick as () => void)();
    expect(focus).toHaveBeenCalled();
    rerender();                                   // el reintento vuelve a pedir el conteo…
    await tick();
    tree = rerender();                            // …y su respuesta llega
    expect(getProjectCounts).toHaveBeenCalledTimes(2);
    expect(textOf(tree)).toContain('2 tables');
  });

  it('el motivo va sin el consejo «— try again…» del transporte (el aviso ya ofrece Retry)', async () => {
    vi.mocked(getProjectCounts).mockRejectedValueOnce(new ApiError("The server didn't respond within 30s — try again in a moment.", 0));
    const tree = await open();
    expect(textOf(tree)).toContain("Couldn't count the project contents: The server didn't respond within 30s. Everything");
    expect(textOf(tree)).not.toContain('try again in a moment');
  });

  it('con el conteo bien, muestra el resumen y exige el nombre', async () => {
    vi.mocked(getProjectCounts).mockResolvedValueOnce(COUNTS);
    let tree = await open();
    expect(textOf(tree)).toContain('2 tables, 9 columns');
    expect(deleteBtn(tree).props.disabled).toBe(true);
    typeName(tree, 'Modelo Ventas');
    tree = rerender();
    expect(deleteBtn(tree).props.disabled).toBe(false);
  });
});
