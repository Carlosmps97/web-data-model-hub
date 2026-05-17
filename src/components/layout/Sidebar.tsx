'use client';

import React, { useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';

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
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);

  // "Projects" stays active for the project index (/), any project detail or
  // deeper routes (/projects/...). Dashboard only matches its own route.
  const isProjects = pathname === '/' || pathname.startsWith('/projects');
  const isDashboard = pathname === '/dashboard';
  const isDocs = pathname === '/docs' || pathname.startsWith('/docs');
  const isAdminUsers = pathname.startsWith('/admin/users');

  const handleLogout = useCallback(async () => {
    await logout();
    router.replace('/login');
  }, [logout, router]);

  const toggleLabel = collapsed ? 'Expandir sidebar' : 'Colapsar sidebar';

  return (
    <aside className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={toggleCollapsed}
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        title={toggleLabel}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
        </svg>
      </button>

      <Link
        href="/"
        className="sidebar-logo"
        style={{ textDecoration: 'none' }}
        title={collapsed ? 'Data Model Hub' : undefined}
      >
        <div className="sidebar-logo-icon">
          <Image src="/logo-dog.png" alt="Data Model Hub" width={34} height={34} style={{ objectFit: 'contain' }} priority />
        </div>
        <div className="sidebar-logo-meta">
          <div className="sidebar-logo-text">Data Model Hub</div>
          <div className="sidebar-logo-subtitle">ER Design Platform</div>
        </div>
      </Link>

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Navigation</div>

          <Link
            href="/dashboard"
            className={`sidebar-item ${isDashboard ? 'active' : ''}`}
            title={collapsed ? 'Dashboard' : undefined}
          >
            <span className="sidebar-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l3-9 4 18 3-9h4" />
              </svg>
            </span>
            <span className="sidebar-item-label">Dashboard</span>
          </Link>

          <Link
            href="/"
            className={`sidebar-item ${isProjects ? 'active' : ''}`}
            title={collapsed ? 'Projects' : undefined}
          >
            <span className="sidebar-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </span>
            <span className="sidebar-item-label">Projects</span>
          </Link>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Resources</div>

          <Link
            href="/docs"
            className={`sidebar-item ${isDocs ? 'active' : ''}`}
            title={collapsed ? 'Documentation' : undefined}
          >
            <span className="sidebar-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </span>
            <span className="sidebar-item-label">Documentation</span>
          </Link>

          {user?.role === 'admin' && (
            <Link
              href="/admin/users"
              className={`sidebar-item ${isAdminUsers ? 'active' : ''}`}
              title={collapsed ? 'Usuarios' : undefined}
            >
              <span className="sidebar-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <span className="sidebar-item-label">Usuarios</span>
            </Link>
          )}
        </div>
      </nav>

      <div className="sidebar-footer">
        {user ? (
          <div className="sidebar-user">
            <div
              className="sidebar-user-avatar"
              title={collapsed ? `${user.username} · ${ROLE_LABELS[user.role]}` : undefined}
            >
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="sidebar-user-meta">
              <div className="sidebar-user-name" title={user.username}>
                {user.username}
              </div>
              <div className="sidebar-user-role">{ROLE_LABELS[user.role]}</div>
            </div>
            <button
              type="button"
              className="sidebar-user-logout"
              onClick={handleLogout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="sidebar-version" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
            Data Model Hub v1.0.0
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
