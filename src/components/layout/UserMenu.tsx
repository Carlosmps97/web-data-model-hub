import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * UserMenu — avatar en el TopNav que abre un dropdown con la identidad REAL de
 * la sesión (auth propia) + Cerrar sesión. Cierra al click afuera / ESC.
 */
export default function UserMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const doLogout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user) return null;
  const initials = user.initials ?? (user.name ?? user.username).slice(0, 2).toUpperCase();

  const onLogout = async () => {
    setOpen(false);
    await doLogout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="dmh-usermenu" ref={ref}>
      <button
        type="button"
        className="dmh-usermenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Usuario: ${user.name ?? user.username}`}
        title={user.name ?? user.username}
      >
        <Avatar initials={initials} size={30} />
      </button>

      {open && (
        <div className="dmh-usermenu-pop" role="menu">
          <div className="dmh-usermenu-me">
            <Avatar initials={initials} size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="dmh-usermenu-me-name">{user.name ?? user.username}</div>
              <div className="dmh-usermenu-me-sub">{user.email ?? user.username}</div>
              {user.roleName && <span className="dmh-usermenu-role">{user.roleName}</span>}
            </div>
          </div>
          <div className="dmh-usermenu-sep" />
          <button type="button" role="menuitem" className="dmh-usermenu-item" onClick={onLogout}>
            <LogOut size={16} strokeWidth={1.8} aria-hidden />
            <span className="dmh-usermenu-item-name">Cerrar sesión</span>
          </button>
        </div>
      )}
    </div>
  );
}
