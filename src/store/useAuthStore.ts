/**
 * useAuthStore — identidad autoritativa de la sesión (auth propia por token).
 *
 * Fuente de verdad del usuario logueado + sus permisos. El token de sesión no
 * pasa por el JavaScript: el servidor del front lo guarda en una cookie
 * HttpOnly. Solo cuando el backend lo entrega en el cuerpo (front apuntado a
 * otro origen con VITE_API_URL, o la cookie apagada en server.mjs) queda en
 * memoria del cliente HTTP (`setAuthToken`), sin sobrevivir a una recarga.
 * `sessionKeeper` renueva la sesión mientras hay actividad y la cierra sin uso.
 * Espeja el actor a `useSessionStore` (sus lectores leen `user.id` == username).
 *
 * `status`: 'loading' (restaurando al boot) · 'anon' (sin sesión) · 'authed'.
 */
import { create } from 'zustand';
import { ApiError, NETWORK_ERROR_TEXT, setAuthToken, setOnForbidden, setOnUnauthorized } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { resetAppState } from '@/store/resetAppState';
import * as auth from '@/features/auth/auth.service';
import type { LoginResult, Permission, SessionUser } from '@/features/auth/auth.service';
import { clearMark, readMark, startSessionKeeper, stopSessionKeeper, type SessionEnd } from '@/features/auth/sessionKeeper';

interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  user: SessionUser | null;
  error: string | null;
  /** Por qué terminó la sesión sin que el usuario saliera (se muestra en el
   *  login); null tras un logout propio o un login. */
  notice: string | null;
  loginSso: () => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  /** Re-lee /me para tener rol y permisos al día sin recargar (foco de la
   *  pestaña, un 403). Una lectura en vuelo y como mucho una cada `ME_GAP_MS`;
   *  nunca rechaza. Solo actualiza el usuario si su rol o sus permisos son
   *  distintos; deshabilitado en Admin → cierra la sesión, como `restore()`.
   *  `force`: tras un cambio propio de permisos, lee igual (sin el tope y
   *  después de la lectura en vuelo, que puede traer los permisos de antes). */
  refreshMe: (opts?: { force?: boolean }) => Promise<void>;
  has: (perm: Permission) => boolean;
}

/** Avisos del login que explican por qué terminó la sesión. */
export const SESSION_REVOKED_TEXT =
  'Your access to Data Model Hub was removed or disabled. Ask an administrator if you think this is a mistake.';
export const SESSION_ENDED_TEXT = 'Your session ended. Please sign in again.';
export const SESSION_IDLE_TEXT = 'Your session expired due to inactivity. Please sign in again.';
export const SESSION_SWITCHED_TEXT = 'You signed in with another account in another tab. Sign in again to continue here.';
export const SERVER_CHECK_TEXT = "The server couldn't check your session right now — reload the page to try again.";

const END_TEXT: Record<SessionEnd, string> = {
  idle: SESSION_IDLE_TEXT, ended: SESSION_ENDED_TEXT, switched: SESSION_SWITCHED_TEXT,
};

/** ¿El backend dice que el acceso del usuario se quitó? (renovación de un
 *  usuario deshabilitado o eliminado). */
const isRevoked = (e: unknown): boolean =>
  e instanceof ApiError && (e.detail as { code?: unknown } | null)?.code === 'access_revoked';

/** Separación mínima entre dos lecturas de /me pedidas por el foco o por un
 *  403 (un proxy que responde 403 a todo no genera una tormenta). */
export const ME_GAP_MS = 10_000;
let meInflight: Promise<void> | null = null;
let meLastAt = -Infinity;
/** ¿Los mismos permisos? (una llave ausente = false). */
const samePerms = (a: Record<string, boolean> = {}, b: Record<string, boolean> = {}): boolean =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => !!a[k] === !!b[k]);

/** Espeja el usuario real a useSessionStore (actor de la sesión) + header X-Dev-User. */
function mirror(user: SessionUser): void {
  useSessionStore.getState().setSessionUser({
    id: user.username,
    name: user.name ?? user.username,
    initials: user.initials ?? user.username.slice(0, 2).toUpperCase(),
  });
}

/** Cierra la sesión en esta pestaña: sin keeper, sin token en memoria y sin el
 *  estado de trabajo del usuario; `notice` explica por qué en el login. */
function endSession(notice: string | null): void {
  void stopSessionKeeper();
  setAuthToken('');
  resetAppState();
  useAuthStore.setState({ status: 'anon', user: null, notice });
}

export const useAuthStore = create<AuthState>((set, get) => {
  /** Arranca el keeper de la sesión que empieza (login) o se restaura. */
  const keep = (res: LoginResult): void => {
    const username = res.user.username;
    const mine = () => get().status === 'authed' && get().user?.username === username;
    startSessionKeeper({
      username,
      expiresIn: res.expiresIn,
      shared: !res.token,
      renew: async (signal) => {
        try {
          const next = await auth.refreshSession(signal);
          // La cookie ya es de otra cuenta (entró en otra pestaña): esta pestaña no
          // sigue como `username`, y esa cookie no se toca.
          if (next.user.username !== username) {
            if (mine()) endSession(SESSION_SWITCHED_TEXT);
            throw new Error('session belongs to another account');
          }
          if (next.token && mine()) setAuthToken(next.token);
          return next.expiresIn;
        } catch (e) {
          // El 401 ya cerró la sesión (handler global); si el acceso se quitó, el aviso lo dice.
          if (isRevoked(e) && get().status === 'anon') set({ notice: SESSION_REVOKED_TEXT });
          throw e;
        }
      },
      onEnd: (reason) => { if (mine()) endSession(END_TEXT[reason]); },
      onStale: () => auth.logout(),
    });
  };

  /** Entrada a la sesión tras el login SSO: el actor que entra arranca sin estado
   *  heredado (defensa en profundidad: sesión vencida, tab reusada), queda
   *  espejado en useSessionStore y con su keeper. */
  const enterSession = (res: LoginResult): void => {
    resetAppState();
    setAuthToken(res.token ?? '');
    mirror(res.user);
    set({ user: res.user, status: 'authed', error: null, notice: null });
    keep(res);
  };

  return {
  status: 'loading',
  user: null,
  error: null,
  notice: null,

  loginSso: async () => {
    set({ error: null });
    await stopSessionKeeper();
    enterSession(await auth.ssoLogin());
  },

  logout: async () => {
    // La renovación en vuelo termina antes: su respuesta volvería a dejar la cookie.
    await stopSessionKeeper();
    try { await auth.logout(); } catch { /* best-effort: el servidor del front borra la cookie aunque el backend falle */ }
    clearMark();   // las otras pestañas de este navegador también salen
    setAuthToken('');
    // El logout es navegación SPA (sin reload): sin esto, los stores singleton
    // conservarían openMode/activeSaId y el siguiente usuario heredaría el canvas.
    resetAppState();
    set({ user: null, status: 'anon', notice: null });
  },

  restore: async () => {
    // La sesión vive en la cookie (el JavaScript no la ve): renovarla dice si
    // sigue viva y trae el usuario. La marca de las pestañas dice si había una
    // sesión y cuándo vencía, para explicar en el login por qué ya no está.
    const mark = readMark();
    // Si mientras se verificaba el usuario entró de nuevo, la respuesta de la
    // sesión anterior no decide nada: si decidiera, cerraría la sesión nueva.
    const superseded = () => get().status !== 'loading';
    try {
      const res = await auth.refreshSession();
      if (superseded()) return;
      setAuthToken(res.token ?? '');
      mirror(res.user);
      set({ user: res.user, status: 'authed', notice: null });
      keep(res);
    } catch (e) {
      if (superseded()) return;
      // Solo un 401 dice que la sesión terminó: vencida, cerrada o con el acceso
      // quitado. Sin respuesta (0), una falla del servidor (5xx, respuesta
      // inválida) o del proxy: la cookie puede seguir siendo buena — recargar
      // restaura la sesión — y se avisa.
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) {
        clearMark();
        const notice = isRevoked(e) ? SESSION_REVOKED_TEXT
          : !mark ? null
            : mark.exp <= Date.now() ? SESSION_IDLE_TEXT : SESSION_ENDED_TEXT;
        set({ status: 'anon', user: null, notice });
        return;
      }
      set({ status: 'anon', user: null, notice: status === 0 ? NETWORK_ERROR_TEXT : SERVER_CHECK_TEXT });
    }
  },

  refreshMe: (opts) => {
    if (get().status !== 'authed') return Promise.resolve();
    const force = Boolean(opts?.force);
    if (meInflight) return force ? meInflight.then(() => get().refreshMe({ force: true })) : meInflight;
    const now = Date.now();
    if (!force && now - meLastAt < ME_GAP_MS) return Promise.resolve();
    meLastAt = now;   // también si falla: el tope vale igual (sin tormenta)
    const asked = get().user?.username;
    meInflight = auth.fetchMe()
      .then((user) => {
        const cur = get();
        if (cur.status !== 'authed' || cur.user?.username !== asked) return;   // otra sesión en el medio
        if (!user || !('permissions' in user)) {
          // Deshabilitado en Admin (el backend revoca la sesión y /me degrada al
          // Principal básico): el mismo cierre que el 401 global.
          endSession(SESSION_REVOKED_TEXT);
          return;
        }
        // La cookie ya es de otra cuenta (entró en otra pestaña).
        if (user.username !== asked) {
          endSession(SESSION_SWITCHED_TEXT);
          return;
        }
        // Solo si cambia algo que decide qué se puede hacer: sin cambios, el
        // usuario no se toca (cero re-renders). La sesión de edición no se
        // degrada por permisos: cada escritura la decide el backend.
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

// Un 403 (permiso perdido, o el proxy) → rol y permisos al día (con el tope de
// refreshMe).
setOnForbidden(() => { void useAuthStore.getState().refreshMe(); });

// 401 global → cerrar la sesión de esta pestaña (el guard de ruta redirige a /login).
setOnUnauthorized(() => {
  if (useAuthStore.getState().status === 'authed') endSession(SESSION_ENDED_TEXT);
});
