'use client';

import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import { useAuthStore } from '@/store/useAuthStore';

interface AppLayoutProps {
  children: React.ReactNode;
  /**
   * Si `true`, fuerza al `<main>` a ocupar exactamente `100vh` y recorta el
   * overflow. Usar en páginas con layouts tipo workbench (editor de modelo)
   * donde el scroll debe ser interno a cada panel y NO global. Dejar en
   * `false` (default) en páginas con contenido vertical largo que sí debe
   * hacer scroll (listas, formularios extensos).
   */
  fixedViewport?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, fixedViewport = false }) => {
  // Hydrate the auth store on first mount. The middleware already
  // blocks unauthenticated traffic, so by the time this effect runs
  // we expect a valid session — but the client needs the user object
  // to drive role-dependent UI (admin link, viewer disables, etc.).
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    if (status === 'idle') hydrate();
  }, [status, hydrate]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className={`app-main${fixedViewport ? ' app-main--fixed' : ''}`}>
        {children}
      </main>
    </div>
  );
};

export default AppLayout;
