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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

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
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'primary',
  dontAskKey,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [skipNext, setSkipNext] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSkipNext(false);
  }
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onCancel]);

  const handleConfirm = useCallback(() => {
    if (dontAskKey && skipNext) {
      try { window.sessionStorage.setItem(SKIP_PREFIX + dontAskKey, '1'); } catch { /* ignore */ }
    }
    onConfirm();
  }, [dontAskKey, skipNext, onConfirm]);

  if (!open) return null;

  const danger = variant === 'danger';

  return (
    <div className="dmh-backdrop" onClick={onCancel} role="presentation">
      <div
        className="dmh-modal"
        style={{ width: 440 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
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
            <h3 id="confirm-dialog-title" className="rd-h3" style={{ marginBottom: 6 }}>{title}</h3>
            <div className="rd-small" style={{ lineHeight: 1.6 }}>{message}</div>
            {dontAskKey && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} />
                <span className="rd-small">No volver a preguntar en esta sesión</span>
              </label>
            )}
          </div>
        </div>
        <div className="m-foot">
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`rd-btn rd-btn-sm ${danger ? 'rd-btn-danger' : 'rd-btn-primary'}`}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
