'use client';

import React from 'react';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle, actions }) => {
  return (
    <header className="app-header">
      <div className="app-header-title">
        {title && (
          <h4 style={{
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </h4>
        )}
        {subtitle && (
          <p style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginTop: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="app-header-actions">
          {actions}
        </div>
      )}
    </header>
  );
};

export default Header;
