// Publish sin DOM (hooks simulados: ver features/reporting/components/
// fakeReact.testutil): ni enviar a aprobación ni descartar lo borrado por otra
// versión mientras corre un Undo o un Redo — sus escrituras seguirían cayendo
// en la versión que se está enviando o sobre lo descartado.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const { SESSION, MODELER, svc } = vi.hoisted(() => ({
  SESSION: { activeChangesetId: 'cs1', activeVersionLabel: 'v1', activeProjectId: 'p1', openModel: () => undefined },
  MODELER: { projectDeletionPending: false, projects: [], activeProjectId: 'p1', clearDirty: () => undefined, refreshExplorer: async () => undefined },
  svc: {
    submit: vi.fn(async () => ({})), discardDeleted: vi.fn(async () => ({ discarded: [] })),
    listUsers: vi.fn(async () => []), listUserNames: vi.fn(async () => []), getPublished: vi.fn(async () => null),
    publishBlockedDetail: vi.fn(() => null),
  },
}));
vi.mock('@/store/useSessionStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick(SESSION);
  return { useSessionStore: Object.assign(hook, { getState: () => SESSION, subscribe: () => () => undefined }) };
});
vi.mock('@/store/useModelerStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick(MODELER);
  return { useModelerStore: Object.assign(hook, { getState: () => MODELER }) };
});
vi.mock('@/store/useBusyStore', () => ({ runBlocking: async (_label: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@/services/versioning.service', () => svc);
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';
import { useUndoStore } from '@/store/useUndoStore';
import PublishModal from './PublishModal';

/** Los `useState` del popup: revisores (5.º) y bloqueo por lo borrado (7.º). */
const mount = (blocked: unknown = null) => {
  resetFake((init, i) => (i === 4 ? ['beto'] : i === 6 ? blocked : init));
  return PublishModal({ open: true, onClose: vi.fn() }) as unknown as El;
};
/** Clic en el botón con ese texto (el elemento que tiene el handler, no su contenedor). */
const click = (tree: El, text: string) => {
  const hit = [...walk(tree)].find((e) => textOf(e).trim() === text && typeof e.props.onClick === 'function');
  if (!hit) throw new Error(`no button «${text}»`);
  return (hit.props.onClick as () => Promise<void>)();
};
const BLOCKED = { code: 'deleted_in_production', message: 'Objects deleted in production — discard them', items: [], next: null };

beforeEach(() => {
  vi.clearAllMocks();
  useUndoStore.setState({ busy: false });
});

describe('Publish mientras corre un Undo o un Redo', () => {
  it('Send for Approval espera: avisa y no envía', async () => {
    useUndoStore.setState({ busy: true });
    await click(mount(), 'Send for Approval');
    expect(toast.error).toHaveBeenCalledWith('Undo or redo is still running — send when it finishes.');
    expect(svc.submit).not.toHaveBeenCalled();
  });

  it('sin nada en curso, envía', async () => {
    await click(mount(), 'Send for Approval');
    expect(svc.submit).toHaveBeenCalledWith('cs1', { title: undefined, description: undefined, reviewers: ['beto'] });
  });

  it('descartar lo borrado por otra versión también espera', async () => {
    useUndoStore.setState({ busy: true });
    await click(mount(BLOCKED), 'Discard changes on deleted objects');
    expect(toast.error).toHaveBeenCalledWith('Undo or redo is still running — discard when it finishes.');
    expect(svc.discardDeleted).not.toHaveBeenCalled();
  });
});
