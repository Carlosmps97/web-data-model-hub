'use client';

import React, { useEffect } from 'react';
import Icon, { type IconName } from './Icon';

interface ModalProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  onClose: () => void;
  children: React.ReactNode;
  /** Right-aligned footer actions. The caller wraps any "left" content in `.left`. */
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
}

/**
 * Shared modal shell — dimmed scrim (no blur, see Dialog) + header (icon · title · subtitle · close)
 * + scrollable body + right-aligned footer. Mirrors `.dmh-modal` from the
 * Aurora prototype (`app.css`). ESC closes.
 */
export default function Modal({ title, subtitle, icon, onClose, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // El scrim NO cierra al click (pedido owner 07-17: un click afuera perdía
    // lo tipeado). Cerrar = X / acción del footer / ESC.
    <div className="dmh-backdrop" role="presentation">
      <div
        className={`dmh-modal${size === 'lg' ? ' lg' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="m-head">
          {icon && <span className="ico"><Icon name={icon} size={16} /></span>}
          <div className="m-title">
            <div className="t">{title}</div>
            {subtitle && <div className="s">{subtitle}</div>}
          </div>
          <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="m-body">{children}</div>
        {footer && <div className="m-foot">{footer}</div>}
      </div>
    </div>
  );
}
