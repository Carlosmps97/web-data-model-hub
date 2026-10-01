'use client';

/**
 * ConfirmDialog — styled replacement for `window.confirm`.
 *
 * Keyboard-accessible (ESC cancels, confirm auto-focuses) with an optional
 * "don't ask again this session" affordance persisted in `sessionStorage`.
 *
 * Public helpers:
 *   - `shouldSkipConfirm(key)` — read the flag before opening the dialog.
 *   - `clearSkipConfirm(key)`  — clear a flag.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';
import { isTopDialog, pushDialog, removeDialog } from './dialogStack';
import { activeElementNow, focusInto, recoverTab, trapTab } from './focusTrap';

const SKIP_PREFIX = 'confirm-skip:';

export function shouldSkipConfirm(key: string | undefined): boolean {
  if (!key || typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(SKIP_PREFIX + key) === '1'; } catch { return false; }
}

export function clearSkipConfirm(key: string | undefined): void {
  if (!key || typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(SKIP_PREFIX + key); } catch { /* ignore */ }
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  dontAskKey?: string;
  /** Acción en curso: deshabilita botones/ESC/backdrop y muestra spinner en confirmar. */
  busy?: boolean;
  /** Botón con el foco al abrir (default «confirm»). «cancel» para lo que no
   *  se deshace (doc 104: eliminar una versión) — un Enter doble no confirma. */
  initialFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  dontAskKey,
  busy = false,
  initialFocus = 'confirm',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [skipNext, setSkipNext] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSkipNext(false);
  }
  // Doc 105 (R11): ids propios (dos confirms a la vez —el inline de un Dialog y
  // el del DialogHost— compartían «confirm-dialog-title»); el mensaje es la
  // descripción accesible (el lector sólo decía el título).
  const titleId = useId();
  const messageId = useId();
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al ABRIRSE: se lee en el render en que `open` pasa a
  // true, antes del commit (sirve montado abierto o abierto después).
  const openerRef = useRef<Element | null>(null);
  const shownRef = useRef(false);
  if (open !== shownRef.current) {
    shownRef.current = open;
    if (open) openerRef.current = activeElementNow();
  }

  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('dmh-confirm');

  // Doc 105 (F6): el foco entra a la caja al abrirse (a los 30 ms lo toma su
  // botón) y, al cerrarse, vuelve a quien lo abrió — sobre un Dialog o un Modal
  // quedaba en <body> y Tab escapaba a la página de atrás. Ver `focusInto`.
  // R6: entra a la pila de diálogos (es el tope mientras está abierto) y un Tab
  // con el foco perdido lo retoma su caja (`recoverTab`).
  useEffect(() => {
    if (!open) return undefined;
    const token = tokenRef.current as symbol;
    pushDialog(token);
    const restoreFocus = focusInto(boxRef.current, openerRef.current);
    const onTab = (e: KeyboardEvent) => { if (isTopDialog(token)) recoverTab(e, boxRef.current); };
    window.addEventListener('keydown', onTab);
    return () => {
      removeDialog(token);
      window.removeEventListener('keydown', onTab);
      restoreFocus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => (initialFocus === 'cancel' ? cancelBtnRef : confirmBtnRef).current?.focus(), 30);
    // Capture + stopPropagation: si el confirm se abre SOBRE un Modal (que
    // también escucha ESC en window), el ESC cierra sólo este diálogo.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }, [open, busy, onCancel, initialFocus]);

  const handleConfirm = useCallback(() => {
    if (dontAskKey && skipNext) {
      try { window.sessionStorage.setItem(SKIP_PREFIX + dontAskKey, '1'); } catch { /* ignore */ }
    }
    // Doc 105 (F6): confirmar suele pasar a busy, que deshabilita los dos
    // botones; el enfocado soltaba el foco a <body> y Tab salía a la página de
    // atrás. El foco queda en la caja (como en TransferVersionDialog).
    boxRef.current?.focus();
    onConfirm();
  }, [dontAskKey, skipNext, onConfirm]);

  if (!open) return null;

  const danger = variant === 'danger';

  return (
    // --top: una confirmación SIEMPRE pinta por encima de cualquier modal,
    // incluido el Dialog del design-system (z-index 300 > .dmh-backdrop 200).
    // El scrim NO cierra al click (pedido owner 07-17): sólo botones / ESC.
    <div className="dmh-backdrop dmh-backdrop--top" role="presentation">
      <div
        className="dmh-modal"
        style={{ width: 440, outline: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, boxRef.current)}   // doc 105: Tab no sale del diálogo
      >
        <div className="m-body" style={{ display: 'flex', gap: 14 }}>
          <span
            className="ins-ico"
            style={{
              background: danger ? 'var(--error-soft)' : 'var(--primary-soft)',
              color: danger ? 'var(--error)' : 'var(--primary-700)',
            }}
          >
            <Icon name={danger ? 'trash' : 'info'} size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id={titleId} className="rd-h3" style={{ marginBottom: 6 }}>{title}</h3>
            <div id={messageId} className="rd-small" style={{ lineHeight: 1.6 }}>{message}</div>
            {dontAskKey && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} />
                <span className="rd-small">Don't ask again this session</span>
              </label>
            )}
          </div>
        </div>
        <div className="m-foot">
          <button ref={cancelBtnRef} type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`rd-btn rd-btn-sm ${danger ? 'rd-btn-danger' : 'rd-btn-primary'}`}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy && <span className="rd-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
