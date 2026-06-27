'use client';

import React from 'react';
import Sidebar from './Sidebar';

/**
 * App shell: el rail de iconos + el contenido ruteado. MVP sin auth — no hay
 * hidratación de sesión (la identidad y los permisos se reintroducen al final).
 */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="dmh">
      <Sidebar />
      {children}
    </div>
  );
};

export default AppLayout;
