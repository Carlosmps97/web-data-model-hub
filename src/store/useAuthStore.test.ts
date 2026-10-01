// Doc 105 (F5) — permisos al día sin recargar: `refreshMe()` re-lee /me al
// volver el foco a la pestaña o ante un 403, con tope (una en vuelo, como
// mucho una cada ME_GAP_MS). Un usuario deshabilitado en Admin cierra sesión
// (mismo camino que restore()). Nunca degrada la sesión de edición por permisos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/auth.service', () => ({ fetchMe: vi.fn(), login: vi.fn(), ssoLogin: vi.fn(), logout: vi.fn() }));
vi.mock('../features/modeler/services/modeler.service', () => ({}));

import * as auth from '../features/auth/auth.service';
import { ApiError, apiGet, NETWORK_ERROR_TEXT } from '@/services/http';
import { ME_GAP_MS, SERVER_CHECK_TEXT, SESSION_ENDED_TEXT, SESSION_REVOKED_TEXT, useAuthStore } from './useAuthStore';
import { useSessionStore } from './useSessionStore';

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
};
const user = (perms: Record<string, boolean>, role = 'modeler') =>
  ({ username: 'ana', name: 'Ana', role, projectIds: [], permissions: perms });

let clock = Date.parse('2026-09-30T10:00:00Z');
beforeEach(() => {
  vi.useFakeTimers();
  clock += ME_GAP_MS * 10;                  // el tope es por módulo: cada prueba arranca lejos de la anterior
  vi.setSystemTime(clock);
  store.clear();
  store.set('dmh.token', 'tok');
  vi.stubGlobal('localStorage', fakeStorage);
  vi.stubGlobal('window', { sessionStorage: fakeStorage });
  vi.mocked(auth.fetchMe).mockReset();
  useAuthStore.setState({ status: 'authed', user: user({ 'model.edit': true, 'model.view': true }) as never });
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('refreshMe (doc 105, F5)', () => {
  it('dos pedidos a la vez = UNA lectura; el rol quitado se ve sin recargar', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(user({ 'model.view': true }, 'viewer') as never);
    await Promise.all([useAuthStore.getState().refreshMe(), useAuthStore.getState().refreshMe()]);
    expect(auth.fetchMe).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().has('model.edit')).toBe(false);
    expect(useAuthStore.getState().has('model.view')).toBe(true);
    // NO degrada la sesión de edición por permisos (eso lo decide el backend en cada escritura).
    expect(useSessionStore.getState().openMode).toBe('editing');
  });

  it('sin tormenta: dentro del tope no vuelve a leer; pasado el tope, sí', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(user({ 'model.edit': true, 'model.view': true }) as never);
    await useAuthStore.getState().refreshMe();
    for (let i = 0; i < 50; i += 1) await useAuthStore.getState().refreshMe();
    expect(auth.fetchMe).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + ME_GAP_MS);
    await useAuthStore.getState().refreshMe();
    expect(auth.fetchMe).toHaveBeenCalledTimes(2);
  });

  it('sin cambios de rol ni permisos no toca el usuario (cero re-renders)', async () => {
    const before = useAuthStore.getState().user;
    vi.mocked(auth.fetchMe).mockResolvedValue(user({ 'model.view': true, 'model.edit': true }) as never);
    await useAuthStore.getState().refreshMe();
    expect(useAuthStore.getState().user).toBe(before);
  });

  it('un fallo de /me no cambia nada ni rechaza', async () => {
    vi.mocked(auth.fetchMe).mockRejectedValue(new Error('proxy 403'));
    await expect(useAuthStore.getState().refreshMe()).resolves.toBeUndefined();
    expect(useAuthStore.getState().has('model.edit')).toBe(true);
    expect(useAuthStore.getState().status).toBe('authed');
  });

  it('usuario deshabilitado (/me sin permisos): cierra la sesión, igual que restore()', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue({ username: 'ana' } as never);
    await useAuthStore.getState().refreshMe();
    expect(useAuthStore.getState().status).toBe('anon');
    expect(useAuthStore.getState().user).toBeNull();
    expect(store.has('dmh.token')).toBe(false);
    expect(useSessionStore.getState().openMode).toBeNull();          // resetAppState
  });

  it('sin sesión no lee /me', async () => {
    useAuthStore.setState({ status: 'anon', user: null });
    await useAuthStore.getState().refreshMe();
    expect(auth.fetchMe).not.toHaveBeenCalled();
  });

  it('un 403 de otra URL pide /me; un 403 de /api/auth/ no (sin bucle)', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(user({ 'model.view': true }, 'viewer') as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    await expect(apiGet('/api/auth/me')).rejects.toMatchObject({ status: 403 });
    expect(auth.fetchMe).not.toHaveBeenCalled();
    await expect(apiGet('/api/changesets/cs1/changes')).rejects.toMatchObject({ status: 403 });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.fetchMe).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().has('model.edit')).toBe(false);
  });
});

describe('por qué terminó la sesión (doc 105, verificación en navegador O4)', () => {
  it('deshabilitado en Admin: el login explica que el acceso se quitó', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue({ username: 'ana' } as never);
    await useAuthStore.getState().refreshMe();
    expect(useAuthStore.getState().status).toBe('anon');
    expect(useAuthStore.getState().notice).toBe(SESSION_REVOKED_TEXT);
    expect(SESSION_REVOKED_TEXT).toMatch(/access .*(removed|disabled).*administrator/i);
  });

  it('un 401 de cualquier pedido (sesión vencida o revocada): el login lo dice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    await expect(apiGet('/api/changesets/cs1')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().status).toBe('anon');
    expect(useAuthStore.getState().notice).toBe(SESSION_ENDED_TEXT);
    expect(SESSION_ENDED_TEXT).toMatch(/session ended.*sign in again/i);
  });

  it('salir a propósito no deja aviso; entrar de nuevo lo borra', async () => {
    useAuthStore.setState({ notice: SESSION_ENDED_TEXT });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().notice).toBeNull();
    useAuthStore.setState({ notice: SESSION_ENDED_TEXT });
    vi.mocked(auth.login).mockResolvedValue({ token: 't2', user: user({ 'model.view': true }) } as never);
    await useAuthStore.getState().login('admin', 'x');
    expect(useAuthStore.getState().notice).toBeNull();
  });
});

describe('al abrir la app (restore) también se dice por qué no hay sesión (doc 105, ronda 3)', () => {
  beforeEach(() => { useAuthStore.setState({ status: 'loading', user: null, notice: null }); });

  it('token vencido (401): «Your session ended…» y el token se descarta', async () => {
    vi.mocked(auth.fetchMe).mockRejectedValue(new ApiError('Not authenticated', 401));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_ENDED_TEXT });
    expect(store.has('dmh.token')).toBe(false);
  });

  it('usuario deshabilitado (/me sin permisos): el acceso se quitó', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue({ username: 'ana' } as never);
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_REVOKED_TEXT });
    expect(store.has('dmh.token')).toBe(false);
  });

  it('sin respuesta del servidor: NO se pierde la sesión (el token queda para recargar) y se dice por qué', async () => {
    vi.mocked(auth.fetchMe).mockRejectedValue(new ApiError(NETWORK_ERROR_TEXT, 0));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: NETWORK_ERROR_TEXT });
    expect(store.get('dmh.token')).toBe('tok');
  });

  it('una falla del SERVIDOR (500, respuesta inválida) no cierra la sesión: el token queda y se avisa', async () => {
    vi.mocked(auth.fetchMe).mockRejectedValue(new ApiError('Internal server error.', 500));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SERVER_CHECK_TEXT });
    expect(store.get('dmh.token')).toBe('tok');
    expect(SERVER_CHECK_TEXT).toMatch(/server.*reload/i);
  });

  it('con sesión válida no hay aviso', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(user({ 'model.view': true }) as never);
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
  });
});

// Doc 105 (ronda 5): un restore() que responde DESPUÉS de que el usuario entró
// de nuevo (SSO en el login mientras /me del token viejo demoraba) cerraba la
// sesión nueva: con red caída → anon; con 401 → además borraba el token nuevo.
describe('restore tardío: no toca una sesión que empezó después (doc 105, ronda 5)', () => {
  beforeEach(() => { useAuthStore.setState({ status: 'loading', user: null, notice: null }); });
  function slowMe() {
    let settle!: { ok: (u: unknown) => void; fail: (e: unknown) => void };
    vi.mocked(auth.fetchMe).mockImplementationOnce(() => new Promise((ok, fail) => { settle = { ok, fail }; }) as never);
    return () => settle;
  }
  async function signInMeanwhile() {
    vi.mocked(auth.ssoLogin).mockResolvedValue({ token: 'tok2', user: user({ 'model.view': true }) } as never);
    await useAuthStore.getState().loginSso();
  }

  it('un 401 tardío del token viejo no borra la sesión nueva ni su token', async () => {
    const settle = slowMe();
    const restoring = useAuthStore.getState().restore();
    await signInMeanwhile();
    settle().fail(new ApiError('Not authenticated', 401));
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
    expect(useAuthStore.getState().user?.username).toBe('ana');
    expect(store.get('dmh.token')).toBe('tok2');
  });

  it('una falla de red tardía tampoco', async () => {
    const settle = slowMe();
    const restoring = useAuthStore.getState().restore();
    await signInMeanwhile();
    settle().fail(new ApiError(NETWORK_ERROR_TEXT, 0));
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
    expect(store.get('dmh.token')).toBe('tok2');
  });

  it('otra pestaña cambió el token mientras se verificaba: se verifica el vigente (sin splash eterno ni borrarlo)', async () => {
    const settle = slowMe();
    const restoring = useAuthStore.getState().restore();
    store.set('dmh.token', 'tok2');                          // la otra pestaña entró (localStorage es compartido)
    vi.mocked(auth.fetchMe).mockResolvedValueOnce(user({ 'model.view': true }) as never);
    settle().fail(new ApiError('Not authenticated', 401));   // el token viejo ya no vale
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
    expect(store.get('dmh.token')).toBe('tok2');
    expect(auth.fetchMe).toHaveBeenCalledTimes(2);
  });

  it('un /me tardío del token viejo no reemplaza al usuario que entró', async () => {
    const settle = slowMe();
    const restoring = useAuthStore.getState().restore();
    await signInMeanwhile();
    settle().ok({ ...user({ 'admin.manage': true }, 'admin'), username: 'otro' });
    await restoring;
    expect(useAuthStore.getState().user?.username).toBe('ana');
    expect(useAuthStore.getState().has('admin.manage')).toBe(false);
  });
});
