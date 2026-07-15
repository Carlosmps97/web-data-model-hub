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
import { setAuthToken, setOnUnauthorized } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { resetAppState } from '@/store/resetAppState';
import * as auth from '@/features/auth/auth.service';
import type { Permission, SessionUser } from '@/features/auth/auth.service';

const TOKEN_KEY = 'dmh.token';

interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  user: SessionUser | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  has: (perm: Permission) => boolean;
}

/** Espeja el usuario real a useSessionStore (actor legacy) + header X-Dev-User. */
function mirror(user: SessionUser): void {
  useSessionStore.getState().setSessionUser({
    id: user.username,
    name: user.name ?? user.username,
    initials: user.initials ?? user.username.slice(0, 2).toUpperCase(),
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  error: null,

  login: async (username, password) => {
    set({ error: null });
    const { token, user } = await auth.login(username.trim(), password);
    // Defensa en profundidad: si la sesión anterior murió sin logout (token
    // expirado, tab reusada), el nuevo actor arranca SIN estado heredado.
    resetAppState();
    localStorage.setItem(TOKEN_KEY, token);
    setAuthToken(token);
    mirror(user);
    set({ user, status: 'authed', error: null });
  },

  logout: async () => {
    try { await auth.logout(); } catch { /* best-effort */ }
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    // El logout es navegación SPA (sin reload): sin esto, los stores singleton
    // conservan openMode/activeSaId y el siguiente usuario heredaba el canvas.
    resetAppState();
    set({ user: null, status: 'anon' });
  },

  restore: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { set({ status: 'anon', user: null }); return; }
    setAuthToken(token);
    try {
      const user = await auth.fetchMe();
      // /me degrada al Principal básico si el actor no está registrado; sin
      // `permissions` no es una sesión válida de la auth propia.
      if (!user || !('permissions' in user)) throw new Error('sesión inválida');
      mirror(user);
      set({ user, status: 'authed' });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken('');
      set({ status: 'anon', user: null });
    }
  },

  has: (perm) => Boolean(get().user?.permissions?.[perm]),
}));

// 401 global → cerrar sesión (el guard de ruta redirige a /login).
setOnUnauthorized(() => {
  if (useAuthStore.getState().status === 'authed') {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    resetAppState();
    useAuthStore.setState({ status: 'anon', user: null });
  }
});
