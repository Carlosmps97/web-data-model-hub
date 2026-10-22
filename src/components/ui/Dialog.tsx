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
  /** Ícono lucide al inicio, en el chip del encabezado. */
  icon?: LucideIcon;
  onClose: () => void;
  children: React.ReactNode;
  /** Acciones del pie, alineadas a la derecha. El contenido alineado a la izquierda va en <div className="dmh-dialog-foot-left">. */
  footer?: React.ReactNode;
  /** Ancho del diálogo en px. Por defecto 560. */
  width?: number;
  /**
   * Cobertura del fondo:
   *  - 'screen' (por defecto): oscurece todo el viewport.
   *  - 'canvas': oscurece solo la región del canvas (debajo del chrome) y deja
   *    nítidos el TopNav (y la barra del canvas): el patrón de popup del diseño.
   */
  backdrop?: DialogBackdrop;
  /**
   * Con backdrop='canvas': px desde el borde superior del viewport donde empieza
   * el scrim (el alto del chrome nítido sobre el canvas). Por defecto 52 (solo el
   * TopNav); 116 cuando además hay una barra de canvas de 64px.
   */
  canvasTop?: number;
}

/**
 * Dialog: modal del sistema de diseño. Admite el patrón de **scrim solo sobre el
 * canvas**: con `backdrop="canvas"` el scrim (`rgba(16,27,48,.42)`) cubre solo la
 * región del canvas debajo del chrome, así el TopNav y la barra de herramientas
 * quedan nítidos y las tarjetas de las tablas siguen visibles a través de él. Sin
 * blur de `backdrop-filter`: volver a difuminar el canvas en cada cuadro vuelve
 * lento todo el navegador en equipos sin aceleración por GPU.
 *
 * Esc y el botón de cierre lo cierran (el clic en el fondo no). Se renderiza con
 * un portal en document.body para quedar encima sin importar dónde se monte.
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
  // Esc lo consume solo el diálogo del tope: con el popup de Esquemas abierto
  // encima del editor de vistas, un Esc cierra solo el de arriba. El token es
  // estable por instancia y el efecto depende solo de `open`: si dependiera de
  // `onClose` (quienes lo usan pasan arrows inline), cada render del diálogo de
  // abajo lo volvería a registrar en el tope y le robaría el Esc.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('dmh-dialog');
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al abrirse: se lee en el render en que `open` pasa a
  // true, antes de la fase de commit, cuando ningún `autoFocus` de adentro tomó el foco.
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
    // El foco entra a la caja (abierto con el mouse, quedaría en la página de
    // atrás y Tab la recorrería); al cerrar vuelve a quien lo abrió.
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
  }, [open]);
  // Tras cada render, si el diálogo del tope perdió el foco (un botón suyo entró
  // en busy o desapareció), el foco vuelve a la caja (ver `keepFocusIn`).
  useEffect(() => {
    if (open && isTopDialog(tokenRef.current as symbol)) keepFocusIn(boxRef.current);
  });

  if (!open) return null;

  const isCanvas = backdrop === 'canvas';
  // El borde superior del canvas se mide del DOM cuando existe: con la barra de
  // herramientas colapsada (o envuelta en 2 filas) un valor fijo no coincidiría;
  // `canvasTop` queda como respaldo.
  const measuredTop = isCanvas && typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('.wk-canvas')?.getBoundingClientRect().top
    : undefined;
  const scrimTop = measuredTop != null && measuredTop > 0 ? Math.round(measuredTop) : canvasTop;
  const overlayStyle: React.CSSProperties = isCanvas
    ? { top: scrimTop, left: 0, right: 0, bottom: 0 }
    : { inset: 0 };
  // Debajo de la barra el alto disponible es menor que el 86vh del CSS
  // (descontando el padding del fondo): sin este límite, un contenido alto
  // dejaría el pie (Cancel/Save) fuera de la pantalla en vez de hacer scroll en
  // el cuerpo.
  const boxHeight: React.CSSProperties = isCanvas ? { maxHeight: `min(86vh, calc(100vh - ${scrimTop + 60}px))` } : {};

  return createPortal(
    // El fondo no cierra al hacer clic: solo X, acciones o Esc.
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
        onKeyDown={(e) => trapTab(e, boxRef.current)}   // Tab no sale del diálogo
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
