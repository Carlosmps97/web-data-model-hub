'use client';

import React, { useEffect, useRef } from 'react';
import Icon, { type IconName } from './Icon';
import { isTopDialog, pushDialog, removeDialog } from './dialogStack';
import { activeElementNow, focusInto, keepFocusIn, recoverTab, trapTab } from './focusTrap';

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
 * Aurora prototype (`app.css`). ESC closes — only the topmost dialog (doc 105:
 * with «Inherit from domain» open over «New column», one ESC closed both and the
 * new column was lost; same stack as `Dialog`, doc 80 §1). Focus enters the box
 * on open (unless an `autoFocus` control already has it), Tab stays inside, and
 * on close focus returns to the opener (doc 105, F6 — `focusInto`/`trapTab`).
 */
export default function Modal({ title, subtitle, icon, onClose, children, footer, size = 'md' }: ModalProps) {
  // Token estable por instancia y efecto sólo al montar (patrón de `Dialog`):
  // re-registrar en cada render (los callers pasan arrows inline) pondría en
  // el tope al Modal de ABAJO y le robaría el ESC.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('dmh-modal');
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al abrirse: se lee en el PRIMER render, antes del
  // commit — un `autoFocus` de adentro todavía no lo tomó (init perezoso).
  const openerRef = useRef<Element | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = activeElementNow();

  useEffect(() => {
    const token = tokenRef.current as symbol;
    pushDialog(token);
    // Doc 105 (F6): el foco entra al popup (abierto con el mouse quedaba en la
    // página de atrás); al cerrar vuelve a quien lo abrió. Ver `focusInto`.
    const restoreFocus = focusInto(boxRef.current, openerRef.current);
    const onKey = (e: KeyboardEvent) => {
      if (!isTopDialog(token)) return;
      if (e.key === 'Escape') onCloseRef.current();
      else recoverTab(e, boxRef.current);           // doc 105 (R6): Tab con el foco perdido
    };
    window.addEventListener('keydown', onKey);
    return () => {
      removeDialog(token);
      window.removeEventListener('keydown', onKey);
      restoreFocus();
    };
  }, []);
  // Doc 105 (R6): tras cada render, si el popup del tope perdió el foco —un
  // botón suyo pasó a busy o desapareció—, vuelve a la caja (ver `keepFocusIn`).
  useEffect(() => { if (isTopDialog(tokenRef.current as symbol)) keepFocusIn(boxRef.current); });

  return (
    // El scrim NO cierra al click (pedido owner 07-17: un click afuera perdía
    // lo tipeado). Cerrar = X / acción del footer / ESC.
    <div className="dmh-backdrop" role="presentation">
      <div
        className={`dmh-modal${size === 'lg' ? ' lg' : ''}`}
        style={{ outline: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, boxRef.current)}   // doc 105: Tab no sale del popup
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
