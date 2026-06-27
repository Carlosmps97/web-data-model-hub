import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import TopNav from '@/components/layout/TopNav';
import HomeScreen from '@/screens/HomeScreen';
import ReportingScreen from '@/screens/ReportingScreen';
import ReviewScreen from '@/screens/ReviewScreen';
import { WorkspaceScreen } from '@/features/modeler';
import { GovernanceScreen } from '@/features/governance';
import { useIdentity } from '@/hooks/useIdentity';
import { installSessionChangesetBridge } from '@/store/sessionChangesetBridge';

// Espeja `useSessionStore.activeChangesetId` → `useChangesetStore.activeId` para
// que el changeset que elige Open model (R2) alimente a TODOS los lectores del
// changeset activo (escrituras de governance.service + gates del canvas).
// Idempotente; se invoca a nivel de módulo para correr antes de cualquier render.
installSessionChangesetBridge();

/**
 * Global shell: the persistent <TopNav/> over the routed page (<Outlet/>).
 * The model route lives under the same chrome — its existing WorkspaceScreen is
 * wrapped so it fills the region below the TopNav (re-styled into the canvas
 * shell in R3).
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
  useIdentity(); // carga /api/me al iniciar — disponible app-wide (atribución futura)
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/reporting" element={<ReportingScreen />} />
          <Route path="/model" element={<div className="dmh-model-route"><WorkspaceScreen /></div>} />
          <Route path="/review" element={<ReviewScreen />} />
          {/* Legacy (parkeada, fuera del rail): accesible por URL hasta que el
              flujo de versiones la reemplace en R2. No está en el TopNav. */}
          <Route path="/governance" element={<GovernanceScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
