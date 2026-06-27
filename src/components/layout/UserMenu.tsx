import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useSessionStore } from '@/store/useSessionStore';

/**
 * UserMenu — avatar trigger in the TopNav that opens a dropdown to switch the
 * **simulated** current user (sim auth). Reads/writes `useSessionStore`, which
 * propagates the `X-Dev-User` header. Closes on outside click / ESC.
 */
export default function UserMenu() {
  const user = useSessionStore((s) => s.user);
  const users = useSessionStore((s) => s.users);
  const setUser = useSessionStore((s) => s.setUser);
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

  return (
    <div className="dmh-usermenu" ref={ref}>
      <button
        type="button"
        className="dmh-usermenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current user: ${user.name}. Switch user.`}
        title={user.name}
      >
        <Avatar initials={user.initials} size={30} />
      </button>

      {open && (
        <div className="dmh-usermenu-pop" role="menu">
          <div className="dmh-usermenu-label">Switch user (simulated)</div>
          {users.map((u) => {
            const active = u.id === user.id;
            return (
              <button
                key={u.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`dmh-usermenu-item${active ? ' is-active' : ''}`}
                onClick={() => { setUser(u.id); setOpen(false); }}
              >
                <Avatar initials={u.initials} size={26} />
                <span className="dmh-usermenu-item-name">{u.name}</span>
                <span className="dmh-usermenu-item-id">{u.id}</span>
                <span className="dmh-usermenu-check"><Check size={15} strokeWidth={2} aria-hidden /></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
