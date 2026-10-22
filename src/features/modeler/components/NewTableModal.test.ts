// «New table» sin DOM (hooks simulados: ver features/reporting/components/fakeReact.testutil).
// Enter respeta el alta en vuelo (`busy` sigue en false dentro del mismo render, así que
// un doble Enter o uno sostenido podrían crear varias tablas) y el Enter que crea y
// cierra llama a preventDefault.
import { describe, expect, it, vi } from 'vitest';
import { resetFake, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/store/useModelerStore', () => ({
  failureText: () => '',
  useModelerStore: (pick: (s: unknown) => unknown) => pick({
    viewMode: 'physical', naming: null, subjectAreas: [], diagram: null, addExistingTables: vi.fn(),
  }),
}));
vi.mock('@/services/governance.service', () => ({ physicalize: vi.fn(async () => ({ physical: '' })), listTables: vi.fn(async () => []) }));
vi.mock('../lib/sessionGuard', () => ({ reportWriteError: vi.fn() }));
vi.mock('../services/schemaPartition', () => ({ tableSchemasCached: vi.fn(async () => []) }));
import NewTableModal from './NewTableModal';

function render(onCreate: (...a: unknown[]) => Promise<unknown>, onClose = vi.fn()) {
  resetFake((init, i) => (i === 1 ? 'HD_CLIENTE' : init));        // `logical` = 2.º useState
  const tree = NewTableModal({ onClose, onCreate: onCreate as never });
  const input = [...walk(tree)].find((e: El) => e.type === 'input' && e.props.autoFocus)!;
  return (ev: Record<string, unknown> = {}) => {
    const e = { key: 'Enter', preventDefault: vi.fn(), ...ev };
    (input.props.onKeyDown as (x: unknown) => void)(e);
    return e;
  };
}

describe('New table: Enter crea una sola tabla y no llega a quien abrió el popup', () => {
  it('Enter: preventDefault (el keypress no «clica» al botón de atrás)', () => {
    const enter = render(vi.fn(async () => undefined));
    expect(enter().preventDefault).toHaveBeenCalled();
  });

  it('dos Enter seguidos (o uno sostenido) crean una sola tabla', async () => {
    let release!: () => void;
    const onCreate = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const onClose = vi.fn();
    const enter = render(onCreate, onClose);
    enter(); enter(); enter(); enter(); enter();
    expect(onCreate).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('si el alta falla (p. ej. 409), el siguiente Enter reintenta', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('Duplicate table')).mockResolvedValueOnce(undefined);
    const enter = render(onCreate);
    enter();
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    await Promise.resolve(); await Promise.resolve();
    enter();
    expect(onCreate).toHaveBeenCalledTimes(2);
  });
});
