import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import type { Permission } from '@/features/auth/auth.service';

/** Splash mientras se restaura la sesión (evita parpadeo login→app al boot). */
export function Splash() {
  return (
    <div className="dmh-splash"><span className="rd-spin" aria-hidden /></div>
  );
}

/** Gate de autenticación: sin sesión → /login (recordando el destino). */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Gate por permiso: sin el permiso → Home (el módulo ni se ve en el nav). */
export function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const has = useAuthStore((s) => s.has(perm));
  if (!has) return <Navigate to="/" replace />;
  return <>{children}</>;
}
