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
import { GovernanceScreen } from '@/features/governance';
import { StandardsScreen } from '@/features/standards';
import { AdminScreen } from '@/features/admin';
import { useAuthStore } from '@/store/useAuthStore';
import { DialogHost } from '@/components/ui/dialogs';
import { installSessionChangesetBridge } from '@/store/sessionChangesetBridge';

// Espeja `useSessionStore.activeChangesetId` → `useChangesetStore.activeId` para
// que el changeset que elige Open model (R2) alimente a TODOS los lectores del
// changeset activo (escrituras de governance.service + gates del canvas).
installSessionChangesetBridge();

/**
 * Global shell: the persistent <TopNav/> over the routed page (<Outlet/>).
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
  // Restaura la sesión (token en localStorage → /api/auth/me) UNA vez al boot;
  // el guard `RequireAuth` muestra un splash mientras `status === 'loading'`.
  const restore = useAuthStore((s) => s.restore);
  useEffect(() => { void restore(); }, [restore]);

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
            {/* Legacy (parkeada, fuera del rail). */}
            <Route path="/governance" element={<GovernanceScreen />} />
          </Route>
        </Route>
      </Routes>
      {/* Host global de confirm/prompt estilizados. */}
      <DialogHost />
      {/* Toaster GLOBAL. */}
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </BrowserRouter>
  );
}
