import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isTopDialog, pushDialog, removeDialog } from './dialogStack';
import { activeElementNow, focusInto, keepFocusIn, recoverTab, trapTab } from './focusTrap';

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
   *  - 'canvas': dims ONLY the canvas region (below the chrome), leaving
   *    the TopNav (and the canvas toolbar) sharp — the design's popup pattern.
   */
  backdrop?: DialogBackdrop;
  /**
   * For backdrop='canvas': px from the top of the viewport where the scrim
   * starts (the height of the sharp chrome above the canvas). Defaults to 52
   * (TopNav only). Pass 116 when a 64px canvas toolbar is also present.
   */
  canvasTop?: number;
}

/**
 * Dialog — design-system modal (DMH-Erwin). Supports the **canvas-only scrim**
 * pattern: with `backdrop="canvas"` the scrim (`rgba(16,27,48,.42)`) covers
 * ONLY the canvas region below the chrome, so the TopNav and toolbar stay crisp
 * and the table cards remain visible through it. No `backdrop-filter` blur
 * (2026-09-29): re-blurring the canvas on every frame made the whole browser
 * slow on machines without GPU acceleration.
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al ABRIRSE: se lee en el render en que `open` pasa a
  // true, antes del commit — un `autoFocus` de adentro todavía no lo tomó.
  const openerRef = useRef<Element | null>(null);
  const shownRef = useRef(false);
  if (open !== shownRef.current) {
    shownRef.current = open;
    if (open) openerRef.current = activeElementNow();
  }

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current as symbol;
    pushDialog(token);
    // Doc 105 (F6): el foco entra a la caja (abierto con el mouse quedaba en la
    // página de atrás y Tab la recorría); al cerrar vuelve a quien lo abrió.
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
  }, [open]);
  // Doc 105 (R6): tras cada render, si el diálogo del tope perdió el foco —un
  // botón suyo pasó a busy o desapareció—, vuelve a la caja (ver `keepFocusIn`).
  useEffect(() => {
    if (open && isTopDialog(tokenRef.current as symbol)) keepFocusIn(boxRef.current);
  });

  if (!open) return null;

  const isCanvas = backdrop === 'canvas';
  // Doc 92 D7: el borde superior del canvas se MIDE del DOM cuando existe —
  // con la barra de herramientas colapsada (o envuelta en 2 filas, doc 64 §5)
  // el 136 fijo de los callers ya no coincide; `canvasTop` queda de fallback.
  const measuredTop = isCanvas && typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('.wk-canvas')?.getBoundingClientRect().top
    : undefined;
  const scrimTop = measuredTop != null && measuredTop > 0 ? Math.round(measuredTop) : canvasTop;
  const overlayStyle: React.CSSProperties = isCanvas
    ? { top: scrimTop, left: 0, right: 0, bottom: 0 }
    : { inset: 0 };
  // Doc 112: debajo de la barra el alto disponible es menor que el 86vh del CSS
  // (descontando el padding del fondo): sin esto, un contenido alto dejaba el
  // pie (Cancel/Save) fuera de la pantalla en vez de hacer scroll en el cuerpo.
  const boxHeight: React.CSSProperties = isCanvas ? { maxHeight: `min(86vh, calc(100vh - ${scrimTop + 60}px))` } : {};

  return createPortal(
    // El backdrop NO cierra al click (pedido owner 07-17): sólo X / acciones / ESC.
    <div
      className={`dmh-dialog-backdrop${isCanvas ? ' dmh-dialog-backdrop--canvas' : ''}`}
      style={overlayStyle}
      role="presentation"
    >
      <div
        className="dmh-dialog"
        style={{ width, outline: 'none', ...boxHeight }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, boxRef.current)}   // doc 105: Tab no sale del diálogo
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
