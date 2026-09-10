import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isTopDialog, pushDialog, removeDialog } from './dialogStack';

export type DialogBackdrop = 'screen' | 'canvas';

export interface DialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Leading lucide icon shown in the header chip. */
  icon?: LucideIcon;
  onClose: () => void;
  children: React.ReactNode;
  /** Right-aligned footer actions. Wrap left-aligned content in <div className="dmh-dialog-foot-left">. */
  footer?: React.ReactNode;
  /** Dialog width in px. Default 560. */
  width?: number;
  /**
   * Backdrop coverage:
   *  - 'screen' (default): dims the whole viewport.
   *  - 'canvas': dims+blurs ONLY the canvas region (below the chrome), leaving
   *    the TopNav (and the canvas toolbar) sharp — the design's popup pattern.
   */
  backdrop?: DialogBackdrop;
  /**
   * For backdrop='canvas': px from the top of the viewport where the blur
   * starts (the height of the sharp chrome above the canvas). Defaults to 52
   * (TopNav only). Pass 116 when a 64px canvas toolbar is also present.
   */
  canvasTop?: number;
}

/**
 * Dialog — design-system modal (DMH-Erwin). Supports the **canvas-only blur**
 * pattern: with `backdrop="canvas"` the scrim (`rgba(16,27,48,.42)` +
 * `blur(2px)`) covers ONLY the canvas region below the chrome, so the TopNav and
 * toolbar stay crisp and faint table cards remain visible through the blur.
 *
 * ESC, backdrop click and the close button all dismiss. Rendered via a portal
 * to document.body so it overlays regardless of where it's mounted.
 */
export default function Dialog({
  open,
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  footer,
  width = 560,
  backdrop = 'screen',
  canvasTop = 52,
}: DialogProps) {
  // ESC: lo consume SÓLO el diálogo del tope (doc 80 §1). Con el popup de
  // Esquemas abierto encima del editor de vistas, un ESC cerraba los dos.
  // El token es estable por instancia y el efecto depende sólo de `open`: si
  // dependiera de `onClose` (los callers pasan arrows inline), cada render del
  // diálogo de ABAJO lo re-registraría en el tope y le robaría el ESC.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('dmh-dialog');

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current as symbol;
    pushDialog(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopDialog(token)) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      removeDialog(token);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  const isCanvas = backdrop === 'canvas';
  const overlayStyle: React.CSSProperties = isCanvas
    ? { top: canvasTop, left: 0, right: 0, bottom: 0 }
    : { inset: 0 };

  return createPortal(
    // El backdrop NO cierra al click (pedido owner 07-17): sólo X / acciones / ESC.
    <div
      className={`dmh-dialog-backdrop${isCanvas ? ' dmh-dialog-backdrop--canvas' : ''}`}
      style={overlayStyle}
      role="presentation"
    >
      <div
        className="dmh-dialog"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dmh-dialog-head">
          {Icon && (
            <span className="dmh-dialog-ico">
              <Icon size={16} strokeWidth={1.6} aria-hidden />
            </span>
          )}
          <div className="dmh-dialog-titles">
            <div className="dmh-dialog-title">{title}</div>
            {subtitle && <div className="dmh-dialog-sub">{subtitle}</div>}
          </div>
          <button type="button" className="dmh-dialog-close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.6} aria-hidden />
          </button>
        </div>
        <div className="dmh-dialog-body">{children}</div>
        {footer && <div className="dmh-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
