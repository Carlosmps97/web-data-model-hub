// Doc 105 (ronda 7, R18a-5) — «Save and leave» del aviso de cambios sin
// guardar: si el guardado fallaba, el aviso decía sólo «Couldn't save — you're
// still on the canvas», sin el motivo, y el usuario quedaba entre «Cancel» y
// «Leave without saving» sin saber qué pasó. Ahora lo lleva (`failureText`).
// Sin DOM: hooks de mentira (ver reporting/components/fakeReact.testutil).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, textOf, walk } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ Link: 'a', useLocation: () => ({ pathname: '/model' }), useNavigate: () => navigate }));
const session = { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' };
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: Object.assign((sel: (s: unknown) => unknown) => sel(session), { getState: () => session, subscribe: () => () => {} }),
}));
const auth = { user: { username: 'ana', permissions: {} } };
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: Object.assign((sel: (s: unknown) => unknown) => sel(auth), { getState: () => auth, subscribe: () => () => {} }),
}));
const saveAll = vi.fn();
const mstate = { dirty: true, saveAll, clearDirty: vi.fn() };
vi.mock('@/store/useModelerStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useModelerStore')>();
  return { ...actual, useModelerStore: Object.assign((sel: (s: unknown) => unknown) => sel(mstate), { getState: () => mstate }) };
});

import { toast } from 'sonner';
import { ApiError } from '@/services/http';
import TopNav from './TopNav';

const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
/** El aviso de cambios sin guardar abierto (leaveTo = '/', useState #1) y su «Save and leave». */
function saveAndLeave() {
  resetFake((init, i) => (i === 1 ? '/' : init));
  const b = [...walk(TopNav())].find((el) => typeof el.props.onClick === 'function' && textOf(el).includes('Save and leave'));
  if (!b) throw new Error('no «Save and leave»');
  return b.props.onClick as () => void;
}

beforeEach(() => { vi.clearAllMocks(); saveAll.mockReset(); });

describe('«Save and leave» (doc 105, ronda 7, R18a-5)', () => {
  it('si el guardado falla, el aviso dice por qué — y no sale', async () => {
    saveAll.mockRejectedValueOnce(new ApiError('Internal server error', 500, null, '/api/subject-areas/sa1/layout?changesetId=cs1'));
    saveAndLeave()();
    await ticks();
    expect(navigate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual(["Couldn't save — you're still on the canvas: Internal server error."]);
  });

  it('sin motivo legible, el aviso de siempre', async () => {
    saveAll.mockRejectedValueOnce(new Error(''));
    saveAndLeave()();
    await ticks();
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual(["Couldn't save — you're still on the canvas"]);
  });

  it('si guarda, sale', async () => {
    saveAll.mockResolvedValueOnce(undefined);
    saveAndLeave()();
    await ticks();
    expect(navigate).toHaveBeenCalledWith('/');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
