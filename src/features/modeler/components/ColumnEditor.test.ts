// «New column» sin DOM (hooks de mentira: ver features/reporting/components/fakeReact.testutil).
// Enter en el nombre crea la columna y cierra el popup; sin preventDefault, si
// el cierre ocurre antes de que llegue el keypress de ese Enter, el keypress
// «clicaría» al botón que lo abrió (se reabriría el popup).
import { describe, expect, it, vi } from 'vitest';
import { resetFake, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('@/store/useModelerStore', () => ({
  useModelerStore: (pick: (s: unknown) => unknown) => pick({ viewMode: 'physical', naming: null }),
}));
// Parcial: `UdpAssign` toma el pin de la sesión (sessionGuard se suscribe al store real).
vi.mock('@/store/useSessionStore', async (orig) => ({ ...(await orig<object>()), sessionProjectId: () => 'p1' }));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('@/services/governance.service', () => ({ listDomains: vi.fn(async () => []) }));
import ColumnEditor from './ColumnEditor';

describe('New column: el Enter que crea y cierra no llega a quien lo abrió', () => {
  it('Enter en el nombre: preventDefault y crea la columna', async () => {
    resetFake((init, i) => (i === 0 ? 'MTO_DEU' : init));     // `name` = 1.er useState
    const onAdd = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const tree = ColumnEditor({ tableId: 't1', onClose, onAdd });
    const input = [...walk(tree)].find((e: El) => e.type === 'input' && e.props.autoFocus)!;
    const enter = { key: 'Enter', preventDefault: vi.fn() };
    (input.props.onKeyDown as (e: unknown) => void)(enter);
    expect(enter.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onAdd).toHaveBeenCalledWith('t1', expect.objectContaining({}));
  });
});

// Enter debe respetar el alta en vuelo (`busy` sigue en false dentro del mismo
// render): sin la guarda, un doble Enter crearía 2 columnas y uno sostenido, 5;
// el backend chequea la unicidad sin bloqueo, y los duplicados bloquean el publish.
describe('New column: un alta a la vez', () => {
  const render = (onAdd: (...a: unknown[]) => Promise<unknown>, onClose = vi.fn()) => {
    resetFake((init, i) => (i === 0 ? 'MTO_DEU' : init));
    const tree = ColumnEditor({ tableId: 't1', onClose, onAdd: onAdd as never });
    const input = [...walk(tree)].find((e: El) => e.type === 'input' && e.props.autoFocus)!;
    return () => (input.props.onKeyDown as (e: unknown) => void)({ key: 'Enter', preventDefault: vi.fn() });
  };

  it('dos Enter seguidos (o uno sostenido) crean una sola columna', async () => {
    let release!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const onClose = vi.fn();
    const enter = render(onAdd, onClose);
    enter(); enter(); enter(); enter(); enter();
    expect(onAdd).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('si el alta falla (p. ej. 409), el siguiente Enter reintenta', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('Duplicate column')).mockResolvedValueOnce(undefined);
    const enter = render(onAdd);
    enter();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    await Promise.resolve(); await Promise.resolve();
    enter();
    expect(onAdd).toHaveBeenCalledTimes(2);
  });
});
