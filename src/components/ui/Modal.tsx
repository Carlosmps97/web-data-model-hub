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
  /** Acciones del pie, alineadas a la derecha. Quien lo usa envuelve el contenido «de la izquierda» en `.left`. */
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
}

/**
 * Shell de modal compartido: scrim oscurecido (sin blur, ver Dialog) + encabezado
 * (ícono · título · subtítulo · cerrar) + cuerpo con scroll + pie alineado a la
 * derecha, con la clase `.dmh-modal` del sistema de diseño Aurora. Esc cierra solo
 * el diálogo del tope (misma pila que `Dialog`): con «Inherit from domain» abierto
 * sobre «New column», un Esc cierra solo el de arriba y la columna en edición no se
 * pierde. El foco entra a la caja al abrirse (salvo que un control con `autoFocus`
 * ya lo tenga), Tab no sale de ella y, al cerrarse, el foco vuelve a quien lo abrió
 * (`focusInto`/`trapTab`).
 */
export default function Modal({ title, subtitle, icon, onClose, children, footer, size = 'md' }: ModalProps) {
  // Token estable por instancia y efecto solo al montar (patrón de `Dialog`):
  // volver a registrar en cada render (quienes lo usan pasan arrows inline)
  // pondría en el tope al Modal de abajo y le robaría el Esc.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('dmh-modal');
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al abrirse: se lee en el primer render, antes de la fase
  // de commit, cuando ningún `autoFocus` de adentro tomó el foco (init perezoso).
  const openerRef = useRef<Element | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = activeElementNow();

  useEffect(() => {
    const token = tokenRef.current as symbol;
    pushDialog(token);
    // El foco entra al popup (abierto con el mouse, quedaría en la página de
    // atrás); al cerrar vuelve a quien lo abrió. Ver `focusInto`.
    const restoreFocus = focusInto(boxRef.current, openerRef.current);
    const onKey = (e: KeyboardEvent) => {
      if (!isTopDialog(token)) return;
      if (e.key === 'Escape') onCloseRef.current();
      else recoverTab(e, boxRef.current);           // Tab con el foco perdido
    };
    window.addEventListener('keydown', onKey);
    return () => {
      removeDialog(token);
      window.removeEventListener('keydown', onKey);
      restoreFocus();
    };
  }, []);
  // Tras cada render, si el popup del tope perdió el foco (un botón suyo entró en
  // busy o desapareció), el foco vuelve a la caja (ver `keepFocusIn`).
  useEffect(() => { if (isTopDialog(tokenRef.current as symbol)) keepFocusIn(boxRef.current); });

  return (
    // El scrim no cierra al hacer clic (un clic afuera perdería lo tipeado). Se
    // cierra con X, una acción del footer o Esc.
    <div className="dmh-backdrop" role="presentation">
      <div
        className={`dmh-modal${size === 'lg' ? ' lg' : ''}`}
        style={{ outline: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, boxRef.current)}   // Tab no sale del popup
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
