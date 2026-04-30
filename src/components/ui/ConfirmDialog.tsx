'use client';

/**
 * ConfirmDialog — styled replacement for `window.confirm`.
 *
 * Why this exists:
 *   `window.confirm` renders a native browser modal that ignores the
 *   product's design system, can't host rich content, and — crucially —
 *   has no "don't ask again" affordance. This component provides a small,
 *   keyboard-accessible dialog with optional skip-for-this-session memory.
 *
 * Skip behaviour:
 *   When a `dontAskKey` is supplied, the user can tick "Don't ask again
 *   this session". The choice is stored in `sessionStorage` (NOT
 *   localStorage) so it survives within the current tab but resets after
 *   a refresh, navigation away from the origin, or new tab — exactly the
 *   semantics requested.
 *
 * Public helpers:
 *   - `shouldSkipConfirm(key)` — read the flag (use before opening the
 *     dialog to short-circuit straight to the action).
 *   - `clearSkipConfirm(key)` — manually clear a flag (rarely needed).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SKIP_PREFIX = 'confirm-skip:';

/** Returns true when the user previously chose to skip this confirmation
 *  this session. Always false on the server. */
export function shouldSkipConfirm(key: string | undefined): boolean {
  if (!key) return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SKIP_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

/** Wipe the skip flag so the dialog re-appears next time. */
export function clearSkipConfirm(key: string | undefined): void {
  if (!key) return;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SKIP_PREFIX + key);
  } catch {
    /* sessionStorage may be disabled — ignore */
  }
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body text. Use a single string for the simple case, or pass any node
   *  for richer content (e.g. a list of items being deleted). */
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` → red confirm button (delete-style); `primary` → indigo. */
  variant?: 'danger' | 'primary';
  /** When set, shows a "Don't ask again this session" checkbox and
   *  persists the choice in `sessionStorage` keyed by this id. */
  dontAskKey?: string;
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [skipNext, setSkipNext] = useState(false);
  // Reset the checkbox every time the dialog transitions from closed
  // to open. We use the "Adjusting state on prop change" pattern (React
  // docs) instead of `useEffect` — it avoids the cascading-render issue
  // flagged by `react-hooks/set-state-in-effect`. The setState calls
  // here are conditional and only fire on the actual transition.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSkipNext(false);
  }
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  // Auto-focus the confirm button on open + ESC closes via cancel.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  const handleConfirm = useCallback(() => {
    if (dontAskKey && skipNext) {
      try {
        window.sessionStorage.setItem(SKIP_PREFIX + dontAskKey, '1');
      } catch {
        /* ignore quota / disabled storage */
      }
    }
    onConfirm();
  }, [dontAskKey, skipNext, onConfirm]);

  const confirmClass = useMemo(
    () => `btn btn-sm confirm-dialog-confirm ${variant === 'danger' ? 'is-danger' : 'is-primary'}`,
    [variant],
  );

  if (!open) return null;

  return (
    <div className="confirm-dialog-overlay" onClick={onCancel} role="presentation">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`confirm-dialog-icon ${variant === 'danger' ? 'is-danger' : 'is-primary'}`}>
          {variant === 'danger' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>

        <h3 id="confirm-dialog-title" className="confirm-dialog-title">{title}</h3>
        <div className="confirm-dialog-message">{message}</div>

        {dontAskKey && (
          <label className="confirm-dialog-skip">
            <input
              type="checkbox"
              checked={skipNext}
              onChange={(e) => setSkipNext(e.target.checked)}
            />
            <span>Don&apos;t ask again this session</span>
          </label>
        )}

        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={confirmClass}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
