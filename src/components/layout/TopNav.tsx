import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Database, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Permission } from '@/features/auth/auth.service';
import UserMenu from './UserMenu';

interface NavItem {
  label: string;
  to: string;
  /** Returns true when the link is the active route. */
  match: (pathname: string) => boolean;
  /** Permiso requerido para VER el ítem (undefined = visible siempre). */
  perm?: Permission;
}

// Data Standards visible a quien puede ver el modelo (los estándares se ven
// read-only; editar exige `standards.edit`). Admin solo con `admin.manage`.
const NAV: NavItem[] = [
  { label: 'Home', to: '/', match: (p) => p === '/' },
  { label: 'Reporting', to: '/reporting', match: (p) => p.startsWith('/reporting') },
  { label: 'Model', to: '/model', match: (p) => p.startsWith('/model') },
  { label: 'Data Standards', to: '/standards', match: (p) => p.startsWith('/standards'), perm: 'model.view' },
  { label: 'Admin', to: '/admin', match: (p) => p.startsWith('/admin'), perm: 'admin.manage' },
];

/**
 * TopNav — global top navigation (52px, white, bottom border #EAEDF2).
 * Pattern "A" of the design:
 *   left  : navy logo square (database glyph) + "Data Model Hub" wordmark
 *   center: Home · Reporting · Model (canvas)  — active = blue tint / blue text
 *   right : 200px search field + UserMenu avatar (switch simulated user)
 *
 * Persistent chrome — rendered on every screen above the routed <Outlet/>.
 *
 * Guard de cambios sin guardar: si se navega FUERA de /model con una versión en
 * edición y `dirty`, se intercepta la navegación y se ofrece Guardar y salir /
 * Salir sin guardar / Cancelar. (El cierre de pestaña lo cubre el beforeunload
 * de WorkspaceScreen con el aviso nativo del browser.)
 */
export default function TopNav() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // Permisos del usuario en sesión (reactivo: filtra los ítems del nav por rol).
  const perms = useAuthStore((s) => s.user?.permissions);
  // Destino de navegación interceptado por el guard (null = sin popup).
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [savingLeave, setSavingLeave] = useState(false);

  /** true si interceptó la navegación (hay cambios sin guardar en /model). */
  const intercept = (to: string): boolean => {
    const dirtyEditing = pathname.startsWith('/model')
      && !to.startsWith('/model')
      && useSessionStore.getState().openMode === 'editing'
      && useModelerStore.getState().dirty;
    if (!dirtyEditing) return false;
    setLeaveTo(to);
    return true;
  };

  const stay = () => { if (!savingLeave) setLeaveTo(null); };
  const leaveAnyway = () => {
    const to = leaveTo; setLeaveTo(null);
    useModelerStore.getState().clearDirty();
    if (to) navigate(to);
  };
  const saveAndLeave = async () => {
    const to = leaveTo;
    setSavingLeave(true);
    try {
      await useModelerStore.getState().saveAll();
      setLeaveTo(null);
      if (to) navigate(to);
    } catch {
      toast.error('No se pudo guardar — seguís en el canvas');
    } finally {
      setSavingLeave(false);
    }
  };

  return (
    <header className="dmh-topnav">
      <button type="button" className="dmh-brand" onClick={() => { if (!intercept('/')) navigate('/'); }} aria-label="Data Model Hub — Home">
        <span className="dmh-brand-logo"><Database size={16} strokeWidth={1.6} aria-hidden /></span>
        <span className="dmh-brand-word">Data Model Hub</span>
      </button>

      <nav className="dmh-nav" aria-label="Primary">
        {NAV.filter((item) => !item.perm || perms?.[item.perm]).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`dmh-nav-link${item.match(pathname) ? ' is-active' : ''}`}
            aria-current={item.match(pathname) ? 'page' : undefined}
            onClick={(e) => { if (intercept(item.to)) e.preventDefault(); }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="dmh-nav-spacer" />

      <div className="dmh-topnav-right">
        <div className="dmh-topnav-search">
          <Search aria-hidden />
          <input
            type="search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
          />
        </div>
        <UserMenu />
      </div>

      {/* ── Popup de cambios sin guardar (guard de salida del modeler) ── */}
      {leaveTo !== null && (
        <div className="dmh-backdrop" onClick={stay} role="presentation">
          <div className="dmh-modal" style={{ width: 470 }} role="dialog" aria-modal="true" aria-labelledby="unsaved-title" onClick={(e) => e.stopPropagation()}>
            <div className="m-body" style={{ display: 'flex', gap: 14 }}>
              <span className="ins-ico" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                <TriangleAlert size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 id="unsaved-title" className="rd-h3" style={{ marginBottom: 6 }}>Cambios sin guardar</h3>
                <div className="rd-small" style={{ lineHeight: 1.6 }}>
                  Estás editando una versión y hay cambios sin guardar. Si salís sin guardar, se perderán.
                </div>
              </div>
            </div>
            <div className="m-foot">
              <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={savingLeave} onClick={stay}>Cancelar</button>
              <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" disabled={savingLeave} onClick={leaveAnyway}>Salir sin guardar</button>
              <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={savingLeave} onClick={saveAndLeave}>
                {savingLeave && <span className="rd-spin" aria-hidden />}
                {savingLeave ? 'Guardando…' : 'Guardar y salir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
