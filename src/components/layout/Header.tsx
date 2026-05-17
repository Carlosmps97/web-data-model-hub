'use client';

import React from 'react';
import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  /** Internal href for <Link>. Omit for the current (last) segment. */
  href?: string;
}

interface HeaderProps {
  crumbs: BreadcrumbItem[];
  actions?: React.ReactNode;
}

const ChevronSep = () => (
  <svg
    className="app-header-crumb-sep"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const Header: React.FC<HeaderProps> = ({ crumbs, actions }) => {
  return (
    <header className="app-header">
      <nav className="app-header-crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronSep />}
            {crumb.href ? (
              <Link href={crumb.href} className="app-header-crumb-link" title={crumb.label}>
                {crumb.label}
              </Link>
            ) : (
              <span className="app-header-crumb-current" title={crumb.label}>
                {crumb.label}
              </span>
            )}
          </React.Fragment>
        ))}
      </nav>
      {actions && (
        <div className="app-header-actions">
          {actions}
        </div>
      )}
    </header>
  );
};

export default Header;
