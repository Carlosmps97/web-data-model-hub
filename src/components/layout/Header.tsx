'use client';

import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/Icon';

export interface BreadcrumbItem {
  label: string;
  /** Internal href to navigate to. Omit for the current (last) segment. */
  href?: string;
  /** Custom click handler (takes precedence over href). */
  onClick?: () => void;
}

interface HeaderProps {
  crumbs: BreadcrumbItem[];
  /** Right-aligned actions (buttons, badges). */
  actions?: React.ReactNode;
  /**
   * Inline content placed immediately after the breadcrumbs (before the
   * flex spacer) — e.g. the editor's Scope control.
   */
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ crumbs, actions, children }) => {
  const navigate = useNavigate();
  return (
    <div className="dmh-top">
      <nav className="dmh-crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          const clickable = !isLast && (crumb.href || crumb.onClick);
          return (
            <React.Fragment key={i}>
              {i > 0 && <Icon name="chevR" size={12} style={{ color: 'var(--subtle)' }} />}
              <span
                className={`dmh-crumb${isLast ? ' current' : ''}`}
                title={crumb.label}
                onClick={
                  clickable
                    ? () => (crumb.onClick ? crumb.onClick() : navigate(crumb.href!))
                    : undefined
                }
              >
                {crumb.label}
              </span>
            </React.Fragment>
          );
        })}
      </nav>
      {children}
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );
};

export default Header;
