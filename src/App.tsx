import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import TopNav from '@/components/layout/TopNav';
import HomeScreen from '@/screens/HomeScreen';
import ReportingScreen from '@/screens/ReportingScreen';
import ReviewScreen from '@/screens/ReviewScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import { RequireAuth, RequirePermission } from '@/features/auth/guards';
import { WorkspaceScreen } from '@/features/modeler';
import { StandardsScreen } from '@/features/standards';
import { AdminScreen } from '@/features/admin';
import { useAuthStore } from '@/store/useAuthStore';
import { DialogHost } from '@/components/ui/dialogs';
import BusyOverlay from '@/components/BusyOverlay';

/**
 * Shell global: el <TopNav/> persistente sobre la página enrutada (<Outlet/>).
 */
function ShellLayout() {
  return (
    <div className="dmh-app">
      <TopNav />
      <div className="dmh-app-main">
        <Outlet />
      </div>
    </div>
  );
}

export default function App() {
  // Restaura la sesión (cookie de sesión → /api/auth/refresh) una vez al arrancar;
  // la guarda `RequireAuth` muestra un splash mientras `status === 'loading'`.
  const restore = useAuthStore((s) => s.restore);
  useEffect(() => { void restore(); }, [restore]);
  // Rol y permisos al día sin recargar: al volver a la pestaña se vuelve a leer
  // /me (refreshMe tiene su propio tope: una en vuelo, como mucho una cada 10 s).
  // El otro disparador es un 403 (lo registra el store de auth).
  useEffect(() => {
    const refresh = () => { void useAuthStore.getState().refreshMe(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Público */}
        <Route path="/login" element={<LoginScreen />} />
        {/* Todo lo demás exige sesión */}
        <Route element={<RequireAuth />}>
          <Route element={<ShellLayout />}>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/reporting" element={<ReportingScreen />} />
            <Route path="/model" element={<div className="dmh-model-route"><WorkspaceScreen /></div>} />
            <Route path="/review" element={<ReviewScreen />} />
            {/* Data Standards — restringido a quien puede editar estándares o verlos */}
            <Route path="/standards" element={<RequirePermission perm="model.view"><StandardsScreen /></RequirePermission>} />
            {/* Admin — solo Administradores */}
            <Route path="/admin" element={<RequirePermission perm="admin.manage"><AdminScreen /></RequirePermission>} />
          </Route>
        </Route>
      </Routes>
      {/* Host global de confirm/prompt estilizados. */}
      <DialogHost />
      {/* Overlay bloqueante de acciones largas de esta sesión. */}
      <BusyOverlay />
      {/* Toaster global. closeButton = la "x" para cerrarlo sin esperar. */}
      <Toaster richColors closeButton position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </BrowserRouter>
  );
}
