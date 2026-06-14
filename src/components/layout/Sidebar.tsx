'use client';

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Icon, { type IconName } from '@/components/ui/Icon';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';

// Single top-level nav — no second sidebar anywhere.
const NAV: { icon: IconName; label: string; href: string; match: (p: string) => boolean; adminOnly?: boolean }[] = [
  { icon: 'layers', label: 'Model Center', href: '/', match: (p) => p === '/' },
  { icon: 'grid', label: 'Projects', href: '/projects', match: (p) => p === '/projects' || p.startsWith('/projects/') },
  { icon: 'book', label: 'Documentación', href: '/docs', match: (p) => p.startsWith('/docs') },
  { icon: 'users', label: 'Usuarios', href: '/admin/users', match: (p) => p.startsWith('/admin'), adminOnly: true },
];

const ROLE_LABELS: Record<'admin' | 'editor' | 'viewer', string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Solo lectura',
};

const Sidebar: React.FC = () => {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const toggleHelp = useUIStore((s) => s.toggleHelp);
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    router.replace('/login');
  };

  return (
    <div className="dmh-rail">
      <button
        type="button"
        className="dmh-rail-logo"
        title="Data Model Hub"
        onClick={() => router.push('/')}
        style={{ border: 'none', cursor: 'pointer' }}
      >
        <Icon name="database" size={19} />
      </button>

      {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => (
        <button
          key={n.href}
          type="button"
          className={`dmh-rail-btn${n.match(pathname) ? ' active' : ''}`}
          title={n.label}
          onClick={() => router.push(n.href)}
        >
          <Icon name={n.icon} size={20} />
        </button>
      ))}

      <div className="dmh-rail-spacer" />

      <button type="button" className="dmh-rail-btn" title="Ayuda rápida" onClick={toggleHelp}>
        <Icon name="info" size={20} />
      </button>

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="dmh-rail-avatar"
          title={user ? `${user.username} · ${ROLE_LABELS[user.role]}` : 'Cuenta'}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {initials}
        </button>
        {menuOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setMenuOpen(false)} />
            <div className="rd-menu" style={{ position: 'absolute', bottom: 0, left: 'calc(100% + 10px)', zIndex: 60, width: 210 }}>
              {user && (
                <div style={{ padding: '6px 10px 8px' }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{user.username}</div>
                  <div className="rd-small">{ROLE_LABELS[user.role]}</div>
                </div>
              )}
              <div className="rd-menu-sep" />
              <button type="button" className="rd-menu-item danger" onClick={handleLogout}>
                <Icon name="logout" size={15} />
                Cerrar sesión
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
