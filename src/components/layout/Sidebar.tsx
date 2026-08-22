'use client';

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon, { type IconName } from '@/components/ui/Icon';

// Single top-level nav — no second sidebar anywhere.
// MVP abierto: sin identidad ni gating por rol (la "Usuarios" admin vuelve con
// la matriz de permisos al final).
const NAV: { icon: IconName; label: string; href: string; match: (p: string) => boolean }[] = [
  { icon: 'grid', label: 'Modeler', href: '/', match: (p) => p === '/' },
  { icon: 'layers', label: 'Governance', href: '/governance', match: (p) => p.startsWith('/governance') },
];

const Sidebar: React.FC = () => {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();

  return (
    <div className="dmh-rail">
      <button
        type="button"
        className="dmh-rail-logo"
        title="Data Model Hub"
        onClick={() => navigate('/')}
        style={{ border: 'none', cursor: 'pointer', background: 'var(--primary-soft)', overflow: 'hidden', padding: 0 }}
      >
        <img src="/logo-dog.png" alt="Data Model Hub" width={30} height={30} style={{ objectFit: 'contain' }} />
      </button>

      {NAV.map((n) => (
        <button
          key={n.href}
          type="button"
          className={`dmh-rail-btn${n.match(pathname) ? ' active' : ''}`}
          title={n.label}
          onClick={() => navigate(n.href)}
        >
          <Icon name={n.icon} size={20} />
        </button>
      ))}
    </div>
  );
};

export default Sidebar;
