'use client';

import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import HelpDrawer from '@/features/help/HelpDrawer';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * App shell: the slim 64px icon rail + the routed page content. Pages render
 * their own `.dmh-main` (top bar + scrollable page), so this layout only owns
 * the flex container and one-time auth hydration.
 */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    if (status === 'idle') hydrate();
  }, [status, hydrate]);

  return (
    <div className="dmh">
      <Sidebar />
      {children}
      <HelpDrawer />
    </div>
  );
};

export default AppLayout;
