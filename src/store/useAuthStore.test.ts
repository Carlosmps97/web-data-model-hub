// Permisos al día sin recargar: `refreshMe()` re-lee /me al
// volver el foco a la pestaña o ante un 403, con tope (una en vuelo, como
// mucho una cada ME_GAP_MS). Un usuario deshabilitado en Admin cierra sesión
// (mismo camino que el 401 global). Nunca degrada la sesión de edición por permisos.
// La sesión vive en una cookie HttpOnly: al abrir la app, `restore()` la
// renueva; `sessionKeeper` la renueva con actividad y la cierra sin uso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/auth.service', () => ({
  fetchMe: vi.fn(), login: vi.fn(), ssoLogin: vi.fn(), logout: vi.fn(), refreshSession: vi.fn(),
}));
vi.mock('../features/modeler/services/modeler.service', () => ({}));

import * as auth from '../features/auth/auth.service';
import { SESSION_MARK_KEY, stopSessionKeeper } from '../features/auth/sessionKeeper';
import { ApiError, apiGet, apiPost, NETWORK_ERROR_TEXT } from '@/services/http';
import {
  ME_GAP_MS, SERVER_CHECK_TEXT, SESSION_ENDED_TEXT, SESSION_IDLE_TEXT, SESSION_REVOKED_TEXT,
  SESSION_SWITCHED_TEXT, useAuthStore,
} from './useAuthStore';
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
  vi.stubGlobal('localStorage', fakeStorage);
  vi.stubGlobal('window', { sessionStorage: fakeStorage });
  vi.mocked(auth.fetchMe).mockReset();
  vi.mocked(auth.refreshSession).mockReset();
  vi.mocked(auth.logout).mockReset();
  useAuthStore.setState({ status: 'authed', user: user({ 'model.edit': true, 'model.view': true }) as never });
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
});
afterEach(async () => { await stopSessionKeeper(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('refreshMe', () => {
  it('dos pedidos a la vez = una lectura; el rol quitado se ve sin recargar', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(user({ 'model.view': true }, 'viewer') as never);
    await Promise.all([useAuthStore.getState().refreshMe(), useAuthStore.getState().refreshMe()]);
    expect(auth.fetchMe).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().has('model.edit')).toBe(false);
    expect(useAuthStore.getState().has('model.view')).toBe(true);
    // No degrada la sesión de edición por permisos (eso lo decide el backend en cada escritura).
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

  it('force lee aunque esté dentro del tope y después de una lectura en vuelo con los permisos de antes', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValueOnce(user({ 'model.view': true, 'admin.manage': true }) as never);
    await useAuthStore.getState().refreshMe();                      // dentro del tope desde acá
    let release: (v: unknown) => void = () => {};
    vi.mocked(auth.fetchMe).mockImplementationOnce(() => new Promise((r) => { release = r; }) as never);
    vi.setSystemTime(Date.now() + ME_GAP_MS);
    const inflight = useAuthStore.getState().refreshMe();           // lectura en vuelo (permisos de antes)
    vi.mocked(auth.fetchMe).mockResolvedValueOnce(user({ 'model.view': true }) as never);
    const forced = useAuthStore.getState().refreshMe({ force: true });
    release(user({ 'model.view': true, 'admin.manage': true }));
    await Promise.all([inflight, forced]);
    expect(auth.fetchMe).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().has('admin.manage')).toBe(false);
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
    expect(useSessionStore.getState().openMode).toBeNull();          // resetAppState
  });

  it('/me de otra cuenta (la cookie cambió en otra pestaña): esta pestaña sale', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue({ ...user({ 'model.view': true }), username: 'otro' } as never);
    await useAuthStore.getState().refreshMe();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', user: null, notice: SESSION_SWITCHED_TEXT });
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

describe('por qué terminó la sesión', () => {
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
    vi.mocked(auth.login).mockResolvedValue({ user: user({ 'model.view': true }), expiresIn: 3600 } as never);
    await useAuthStore.getState().login('admin', 'x');
    expect(useAuthStore.getState().notice).toBeNull();
  });
});

describe('al abrir la app (restore) también se dice por qué no hay sesión', () => {
  beforeEach(() => { useAuthStore.setState({ status: 'loading', user: null, notice: null }); });
  const mark = (exp: number) => store.set(SESSION_MARK_KEY, JSON.stringify({ u: 'ana', exp }));
  const expired = () => new ApiError('Invalid or expired session. Sign in again.', 401);

  it('sin una sesión previa en este navegador: el login, sin aviso', async () => {
    vi.mocked(auth.refreshSession).mockRejectedValue(new ApiError('Authentication required. Sign in.', 401));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: null });
  });

  it('la sesión venció sin uso: lo dice, una sola vez', async () => {
    mark(Date.now() - 1000);
    vi.mocked(auth.refreshSession).mockRejectedValue(expired());
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_IDLE_TEXT });
    expect(SESSION_IDLE_TEXT).toMatch(/inactivity.*sign in again/i);
    expect(store.has(SESSION_MARK_KEY)).toBe(false);                 // al recargar ya no se repite
  });

  it('la sesión terminó antes de vencer (401): «Your session ended…»', async () => {
    mark(Date.now() + 60_000);
    vi.mocked(auth.refreshSession).mockRejectedValue(expired());
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_ENDED_TEXT });
  });

  it('usuario deshabilitado o eliminado (401 access_revoked): el acceso se quitó', async () => {
    mark(Date.now() + 60_000);
    vi.mocked(auth.refreshSession).mockRejectedValue(new ApiError('Your access to Data Model Hub was removed or disabled.', 401,
      { code: 'access_revoked', message: 'Your access to Data Model Hub was removed or disabled.' }));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_REVOKED_TEXT });
  });

  it('sin respuesta del servidor: la sesión no se da por perdida (recargar la restaura) y se dice por qué', async () => {
    mark(Date.now() + 60_000);
    vi.mocked(auth.refreshSession).mockRejectedValue(new ApiError(NETWORK_ERROR_TEXT, 0));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: NETWORK_ERROR_TEXT });
    expect(store.has(SESSION_MARK_KEY)).toBe(true);
  });

  it('una falla del servidor (500, respuesta inválida) tampoco cierra la sesión: se avisa', async () => {
    vi.mocked(auth.refreshSession).mockRejectedValue(new ApiError('Internal server error.', 500));
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SERVER_CHECK_TEXT });
    expect(SERVER_CHECK_TEXT).toMatch(/server.*reload/i);
  });

  it('con sesión válida: entra sin aviso y deja la marca de las pestañas (usuario y vencimiento, sin token)', async () => {
    vi.mocked(auth.refreshSession).mockResolvedValue({ user: user({ 'model.view': true }), expiresIn: 3600 } as never);
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
    expect(JSON.parse(store.get(SESSION_MARK_KEY) ?? 'null')).toEqual({ u: 'ana', exp: Date.now() + 3600_000 });
    expect([...store.keys()]).toEqual([SESSION_MARK_KEY]);           // ningún token en el navegador
  });
});

// Un restore() que responde después de que el usuario entró de nuevo (SSO en el
// login mientras la renovación de la sesión anterior demoraba) no debe cerrar la
// sesión nueva ni cambiar su usuario.
describe('restore tardío: no toca una sesión que empezó después', () => {
  beforeEach(() => { useAuthStore.setState({ status: 'loading', user: null, notice: null }); });
  function slowRefresh() {
    let settle!: { ok: (u: unknown) => void; fail: (e: unknown) => void };
    vi.mocked(auth.refreshSession).mockImplementationOnce(() => new Promise((ok, fail) => { settle = { ok, fail }; }) as never);
    return () => settle;
  }
  async function signInMeanwhile() {
    vi.mocked(auth.ssoLogin).mockResolvedValue({ user: user({ 'model.view': true }), expiresIn: 3600 } as never);
    await useAuthStore.getState().loginSso();
  }

  it('un 401 tardío de la sesión anterior no cierra la sesión nueva', async () => {
    const settle = slowRefresh();
    const restoring = useAuthStore.getState().restore();
    await signInMeanwhile();
    settle().fail(new ApiError('Not authenticated', 401));
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
    expect(useAuthStore.getState().user?.username).toBe('ana');
  });

  it('una falla de red tardía tampoco', async () => {
    const settle = slowRefresh();
    const restoring = useAuthStore.getState().restore();
    await signInMeanwhile();
    settle().fail(new ApiError(NETWORK_ERROR_TEXT, 0));
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authed', notice: null });
  });

  it('una renovación tardía de otra cuenta no sustituye al usuario que entró', async () => {
    const settle = slowRefresh();
    const restoring = useAuthStore.getState().restore();
    await signInMeanwhile();
    settle().ok({ user: { ...user({ 'admin.manage': true }, 'admin'), username: 'otro' }, expiresIn: 3600 });
    await restoring;
    expect(useAuthStore.getState().user?.username).toBe('ana');
    expect(useAuthStore.getState().has('admin.manage')).toBe(false);
  });
});

// Sesión de una hora: se renueva con actividad y se cierra sin uso
// (`sessionKeeper`); el login dice por qué terminó.
describe('sesión de una hora', () => {
  let win: EventTarget & { sessionStorage: typeof fakeStorage };
  const signIn = async (res: object) => {
    vi.mocked(auth.ssoLogin).mockResolvedValue(res as never);
    useAuthStore.setState({ status: 'anon', user: null });
    await useAuthStore.getState().loginSso();
  };
  const minutes = (m: number) => vi.advanceTimersByTimeAsync(m * 60_000);
  const act = (type = 'pointerdown') => { win.dispatchEvent(new Event(type)); };
  const okJson = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  beforeEach(() => {
    win = Object.assign(new EventTarget(), { sessionStorage: fakeStorage });
    vi.stubGlobal('window', win);
  });

  it('sin uso, al vencer el token la sesión se cierra y el login lo explica', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    useSessionStore.setState({ openMode: 'editing' });
    await minutes(59.5);
    expect(useAuthStore.getState().status).toBe('authed');
    await minutes(0.5);
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', user: null, notice: SESSION_IDLE_TEXT });
    expect(useSessionStore.getState().openMode).toBeNull();          // resetAppState
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('con actividad se renueva (como mucho una vez cada 5 minutos) y no vence', async () => {
    vi.mocked(auth.refreshSession).mockImplementation(async () => ({ user: user({ 'model.view': true }), expiresIn: 3600 }) as never);
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    for (let m = 0; m < 120; m += 1) { await minutes(1); act(); }
    expect(useAuthStore.getState().status).toBe('authed');
    expect(auth.refreshSession).toHaveBeenCalledTimes(24);
  });

  it('la renovación de un usuario deshabilitado cierra la sesión con el aviso de acceso quitado', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { code: 'access_revoked', message: 'Your access to Data Model Hub was removed or disabled.' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } })));
    vi.mocked(auth.refreshSession).mockImplementation(() => apiPost('/api/auth/refresh'));
    await minutes(5);
    act('keydown');
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_REVOKED_TEXT });
  });

  it('logout: no sale antes de que la renovación en vuelo termine o se cancele (su respuesta volvería a dejar la cookie) y avisa a las otras pestañas', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    expect(store.has(SESSION_MARK_KEY)).toBe(true);
    let release: (v: unknown) => void = () => {};
    vi.mocked(auth.refreshSession).mockImplementation(() => new Promise((r) => { release = r; }) as never);
    await minutes(5);
    act();                                                          // renovación en vuelo
    const out = useAuthStore.getState().logout();
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.logout).not.toHaveBeenCalled();
    release({ user: user({ 'model.view': true }), expiresIn: 3600 });
    await out;
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(store.has(SESSION_MARK_KEY)).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: null });
  });

  it('otra pestaña entra con otra cuenta: esta pide entrar de nuevo; otra pestaña sale: esta también', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    const other = JSON.stringify({ u: 'otro', exp: Date.now() + 3600_000 });
    store.set(SESSION_MARK_KEY, other);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_MARK_KEY, newValue: other }));
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_SWITCHED_TEXT });
    expect(SESSION_SWITCHED_TEXT).toMatch(/another account.*another tab/i);

    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    store.delete(SESSION_MARK_KEY);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_MARK_KEY, newValue: null }));
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_ENDED_TEXT });
  });

  it('la renovación trae otra cuenta (la cookie cambió en otra pestaña): esta pestaña sale y la cookie ajena queda', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    vi.mocked(auth.refreshSession).mockResolvedValue({ user: { ...user({ 'model.view': true }), username: 'otro' }, expiresIn: 3600 } as never);
    await minutes(5);
    act();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_SWITCHED_TEXT });
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('una renovación que responde después del logout de otra pestaña borra la cookie que volvió a dejar', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    let release: (v: unknown) => void = () => {};
    vi.mocked(auth.refreshSession).mockImplementation(() => new Promise((r) => { release = r; }) as never);
    vi.mocked(auth.logout).mockResolvedValue({ ok: true } as never);
    await minutes(5);
    act();                                                          // renovación en vuelo
    store.delete(SESSION_MARK_KEY);                                 // la otra pestaña salió
    win.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_MARK_KEY, newValue: null }));
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_ENDED_TEXT });
    expect(auth.logout).not.toHaveBeenCalled();
    release({ user: user({ 'model.view': true }), expiresIn: 3600 });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it('una renovación que salió con la cookie de la cuenta que entró en otra pestaña no cierra esa sesión', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    let release: (v: unknown) => void = () => {};
    vi.mocked(auth.refreshSession).mockImplementation(() => new Promise((r) => { release = r; }) as never);
    await minutes(5);
    act();                                                          // renovación en vuelo
    const other = JSON.stringify({ u: 'otro', exp: Date.now() + 3600_000 });
    store.set(SESSION_MARK_KEY, other);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_MARK_KEY, newValue: other }));
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: SESSION_SWITCHED_TEXT });
    release({ user: { ...user({ 'model.view': true }), username: 'otro' }, expiresIn: 3600 });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('el logout propio cancela la renovación en vuelo y sale enseguida', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    vi.mocked(auth.refreshSession).mockImplementation((signal?: AbortSignal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new ApiError('Aborted', 0)));
    }) as never);
    await minutes(5);
    act();
    await useAuthStore.getState().logout();
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ status: 'anon', notice: null });
  });

  it('con cookie: ningún token en memoria ni en el navegador; las llamadas llevan X-Requested-With', async () => {
    await signIn({ user: user({ 'model.view': true }), expiresIn: 3600 });
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return okJson([]); }));
    await apiGet('/api/projects');
    const headers = calls[0].headers as Record<string, string>;
    expect(headers['X-Session-Token']).toBeUndefined();
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect([...store.keys()]).toEqual([SESSION_MARK_KEY]);
  });

  it('token en el cuerpo (otro origen o cookie apagada): queda solo en memoria, viaja en X-Session-Token y se renueva', async () => {
    await signIn({ token: 'jwt-tab', user: user({ 'model.view': true }), expiresIn: 3600 });
    expect(store.size).toBe(0);                                     // ni token ni marca en el navegador
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return okJson([]); }));
    await apiGet('/api/projects');
    expect((calls[0].headers as Record<string, string>)['X-Session-Token']).toBe('jwt-tab');
    vi.mocked(auth.refreshSession).mockResolvedValue({ token: 'jwt-tab-2', user: user({ 'model.view': true }), expiresIn: 3600 } as never);
    await minutes(5);
    act();
    await vi.advanceTimersByTimeAsync(0);
    await apiGet('/api/projects');
    expect((calls[1].headers as Record<string, string>)['X-Session-Token']).toBe('jwt-tab-2');
    await useAuthStore.getState().logout();
    await apiGet('/api/projects');
    expect((calls.at(-1)?.headers as Record<string, string>)['X-Session-Token']).toBeUndefined();
  });
});
