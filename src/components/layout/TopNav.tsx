import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Database, Search } from 'lucide-react';
import UserMenu from './UserMenu';

interface NavItem {
  label: string;
  to: string;
  /** Returns true when the link is the active route. */
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { label: 'Home', to: '/', match: (p) => p === '/' },
  { label: 'Reporting', to: '/reporting', match: (p) => p.startsWith('/reporting') },
  { label: 'Model', to: '/model', match: (p) => p.startsWith('/model') },
];

/**
 * TopNav — global top navigation (52px, white, bottom border #EAEDF2).
 * Pattern "A" of the design:
 *   left  : navy logo square (database glyph) + "Data Model Hub" wordmark
 *   center: Home · Reporting · Model (canvas)  — active = blue tint / blue text
 *   right : 200px search field + UserMenu avatar (switch simulated user)
 *
 * Persistent chrome — rendered on every screen above the routed <Outlet/>.
 */
export default function TopNav() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  return (
    <header className="dmh-topnav">
      <button type="button" className="dmh-brand" onClick={() => navigate('/')} aria-label="Data Model Hub — Home">
        <span className="dmh-brand-logo"><Database size={16} strokeWidth={1.6} aria-hidden /></span>
        <span className="dmh-brand-word">Data Model Hub</span>
      </button>

      <nav className="dmh-nav" aria-label="Primary">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`dmh-nav-link${item.match(pathname) ? ' is-active' : ''}`}
            aria-current={item.match(pathname) ? 'page' : undefined}
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
    </header>
  );
}
