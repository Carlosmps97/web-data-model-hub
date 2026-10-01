/**
 * useAuthStore — identidad autoritativa de la sesión (auth propia por token).
 *
 * Fuente de verdad del usuario logueado + sus permisos. Persiste el token en
 * localStorage y lo empuja al cliente HTTP (`setAuthToken`). Espeja el actor a
 * `useSessionStore` (lectores legacy leen `user.id` == username).
 *
 * `status`: 'loading' (restaurando al boot) · 'anon' (sin sesión) · 'authed'.
 */
import { create } from 'zustand';
import { ApiError, NETWORK_ERROR_TEXT, setAuthToken, setOnForbidden, setOnUnauthorized } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { resetAppState } from '@/store/resetAppState';
import * as auth from '@/features/auth/auth.service';
import type { Permission, SessionUser } from '@/features/auth/auth.service';

const TOKEN_KEY = 'dmh.token';

interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  user: SessionUser | null;
  error: string | null;
  /** Doc 105 (O4): por qué terminó la sesión SIN que el usuario saliera (se
   *  muestra en el login); null tras un logout propio o un login. */
  notice: string | null;
  login: (username: string, password: string) => Promise<void>;
  loginSso: () => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  /** Doc 105 (F5): re-lee /me para tener rol y permisos al día sin recargar
   *  (foco de la pestaña, un 403). Una lectura en vuelo y como mucho una cada
   *  `ME_GAP_MS`; nunca rechaza. Sólo cambia el usuario si cambió su rol o sus
   *  permisos; deshabilitado en Admin → cierra la sesión, como `restore()`. */
  refreshMe: () => Promise<void>;
  has: (perm: Permission) => boolean;
}

/** Doc 105 (O4): antes la sesión terminaba en /login sin decir por qué. */
export const SESSION_REVOKED_TEXT =
  'Your access to Data Model Hub was removed or disabled. Ask an administrator if you think this is a mistake.';
export const SESSION_ENDED_TEXT = 'Your session ended. Please sign in again.';
export const SERVER_CHECK_TEXT = "The server couldn't check your session right now — reload the page to try again.";

/** Doc 105 (F5): separación mínima entre dos lecturas de /me pedidas por el
 *  foco o por un 403 (un proxy que responde 403 a todo no genera una tormenta). */
export const ME_GAP_MS = 10_000;
let meInflight: Promise<void> | null = null;
let meLastAt = -Infinity;
/** ¿Los mismos permisos? (una llave ausente = false). */
const samePerms = (a: Record<string, boolean> = {}, b: Record<string, boolean> = {}): boolean =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => !!a[k] === !!b[k]);

/** Espeja el usuario real a useSessionStore (actor legacy) + header X-Dev-User. */
function mirror(user: SessionUser): void {
  useSessionStore.getState().setSessionUser({
    id: user.username,
    name: user.name ?? user.username,
    initials: user.initials ?? user.username.slice(0, 2).toUpperCase(),
  });
}

export const useAuthStore = create<AuthState>((set, get) => {
  /** Pipeline común a ambos logins: el nuevo actor arranca SIN estado heredado
   *  (defensa en profundidad: token expirado, tab reusada), persiste el token
   *  y espeja al actor legacy. */
  const enterSession = (token: string, user: SessionUser): void => {
    resetAppState();
    localStorage.setItem(TOKEN_KEY, token);
    setAuthToken(token);
    mirror(user);
    set({ user, status: 'authed', error: null, notice: null });
  };

  return {
  status: 'loading',
  user: null,
  error: null,
  notice: null,

  login: async (username, password) => {
    set({ error: null });
    const { token, user } = await auth.login(username.trim(), password);
    enterSession(token, user);
  },

  loginSso: async () => {
    set({ error: null });
    const { token, user } = await auth.ssoLogin();
    enterSession(token, user);
  },

  logout: async () => {
    try { await auth.logout(); } catch { /* best-effort */ }
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    // El logout es navegación SPA (sin reload): sin esto, los stores singleton
    // conservan openMode/activeSaId y el siguiente usuario heredaba el canvas.
    resetAppState();
    set({ user: null, status: 'anon', notice: null });
  },

  restore: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { set({ status: 'anon', user: null }); return; }
    setAuthToken(token);
    // Doc 105 (ronda 3): al abrir la app también se dice por qué no hay sesión.
    const drop = (notice: string) => {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken('');
      set({ status: 'anon', user: null, notice });
    };
    // Doc 105 (ronda 5): si mientras /me demoraba el usuario entró de nuevo, la
    // respuesta del token viejo ya no decide nada — antes cerraba la sesión nueva
    // (y con un 401 borraba su token). Si fue OTRA pestaña la que cambió el token
    // (localStorage es compartido), se verifica el vigente.
    const superseded = () => get().status !== 'loading';
    const moved = () => localStorage.getItem(TOKEN_KEY) !== token;
    try {
      const user = await auth.fetchMe();
      if (superseded()) return;
      if (moved()) return get().restore();
      // /me degrada al Principal básico si el actor no está registrado; sin
      // `permissions` no es una sesión válida de la auth propia (deshabilitado).
      if (!user || !('permissions' in user)) { drop(SESSION_REVOKED_TEXT); return; }
      mirror(user);
      set({ user, status: 'authed', notice: null });
    } catch (e) {
      if (superseded()) return;
      if (moved()) return get().restore();
      // Sólo un 401 dice que la sesión terminó. Sin respuesta (0), una falla del
      // servidor (5xx, respuesta inválida) o del proxy: el token puede seguir
      // siendo bueno — se conserva (recargar restaura la sesión) y se avisa.
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) { drop(SESSION_ENDED_TEXT); return; }
      setAuthToken('');
      set({ status: 'anon', user: null, notice: status === 0 ? NETWORK_ERROR_TEXT : SERVER_CHECK_TEXT });
    }
  },

  refreshMe: () => {
    if (get().status !== 'authed') return Promise.resolve();
    if (meInflight) return meInflight;
    const now = Date.now();
    if (now - meLastAt < ME_GAP_MS) return Promise.resolve();
    meLastAt = now;   // también si falla: el tope vale igual (sin tormenta)
    const asked = get().user?.username;
    meInflight = auth.fetchMe()
      .then((user) => {
        const cur = get();
        if (cur.status !== 'authed' || cur.user?.username !== asked) return;   // otra sesión en el medio
        if (!user || !('permissions' in user)) {
          // Deshabilitado en Admin (el backend revoca la sesión y /me degrada al
          // Principal básico): el mismo camino que restore() y el 401 global.
          localStorage.removeItem(TOKEN_KEY);
          setAuthToken('');
          resetAppState();
          set({ status: 'anon', user: null, notice: SESSION_REVOKED_TEXT });
          return;
        }
        // Sólo si cambió algo que decide qué se puede hacer: sin cambios, el
        // usuario no se toca (cero re-renders). La sesión de edición NO se
        // degrada por permisos: cada escritura la sigue decidiendo el backend.
        if (cur.user?.role !== user.role || !samePerms(cur.user?.permissions, user.permissions)) {
          mirror(user);
          set({ user });
        }
      })
      .catch(() => { /* 401: lo cierra el handler global; red/proxy: el próximo foco reintenta */ })
      .finally(() => { meInflight = null; });
    return meInflight;
  },

  has: (perm) => Boolean(get().user?.permissions?.[perm]),
  };
});

// Doc 105 (F5): un 403 (permiso perdido, o el proxy) → rol y permisos al día
// (con el tope de refreshMe).
setOnForbidden(() => { void useAuthStore.getState().refreshMe(); });

// 401 global → cerrar sesión (el guard de ruta redirige a /login).
setOnUnauthorized(() => {
  if (useAuthStore.getState().status === 'authed') {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    resetAppState();
    useAuthStore.setState({ status: 'anon', user: null, notice: SESSION_ENDED_TEXT });
  }
});
