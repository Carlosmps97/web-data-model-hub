/**
 * dialogs — reemplazo promise-based de `window.confirm` / `window.prompt` con
 * popups propios de la web (mismo shell `.dmh-backdrop`/`.dmh-modal` que Modal).
 *
 * Uso (drop-in en cualquier handler):
 *   if (!(await confirmDialog({ title: 'Delete column', message: '…', variant: 'danger' }))) return;
 *   const name = await promptDialog({ title: 'New changeset', label: 'Title' });  // null = cancelado
 *
 * Con `action` el diálogo NO se cierra al confirmar: queda bloqueado con spinner
 * hasta que la promesa termina (feedback de "en proceso") y recién ahí cierra.
 *   await confirmDialog({ …, action: () => deleteRelationship(id) });  // true al terminar
 *   // si `action` lanza, la promesa del diálogo RECHAZA → catch del caller (toast).
 *
 * `<DialogHost/>` se monta UNA vez al final de `App.tsx` (después del router)
 * para pintar por encima de cualquier modal abierto (mismo z-index, DOM
 * posterior). Los pedidos se encolan: se muestra de a uno.
 */
import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import ConfirmDialog from './ConfirmDialog';

export interface ConfirmOpts {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  /** Trabajo a ejecutar al confirmar; el diálogo muestra busy hasta que resuelve. */
  action?: () => Promise<unknown>;
}

export interface PromptOpts {
  title: string;
  /** Label sobre el input (opcional). */
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Trabajo a ejecutar al aceptar (recibe el valor); busy hasta que resuelve. */
  action?: (value: string) => Promise<unknown>;
}

type Pending =
  | { id: number; kind: 'confirm'; opts: ConfirmOpts; resolve: (ok: boolean) => void; reject: (e: unknown) => void }
  | { id: number; kind: 'prompt'; opts: PromptOpts; resolve: (value: string | null) => void; reject: (e: unknown) => void };

interface DialogQueueState {
  queue: Pending[];
  push: (p: Pending) => void;
  shift: () => void;
}

const useDialogQueue = create<DialogQueueState>((set) => ({
  queue: [],
  push: (p) => set((s) => ({ queue: [...s.queue, p] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

let seq = 0;

/** Confirmación estilizada. Resuelve `true` si el usuario confirma (y `action`, si hay, terminó OK). */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve, reject) => useDialogQueue.getState().push({ id: ++seq, kind: 'confirm', opts, resolve, reject }));
}

/** Prompt estilizado. Resuelve el texto ingresado, o `null` si cancela (ESC/backdrop/Cancel). */
export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve, reject) => useDialogQueue.getState().push({ id: ++seq, kind: 'prompt', opts, resolve, reject }));
}

function ConfirmHostView({ p, shift }: { p: Extract<Pending, { kind: 'confirm' }>; shift: () => void }) {
  const [busy, setBusy] = useState(false);
  const o = p.opts;
  return (
    <ConfirmDialog
      open
      busy={busy}
      title={o.title}
      message={o.message}
      confirmLabel={o.confirmLabel ?? 'OK'}
      cancelLabel={o.cancelLabel ?? 'Cancel'}
      variant={o.variant ?? 'primary'}
      onConfirm={() => {
        if (!o.action) { p.resolve(true); shift(); return; }
        setBusy(true);
        o.action()
          .then(() => { p.resolve(true); shift(); })
          .catch((e) => { p.reject(e); shift(); });
      }}
      onCancel={() => { if (!busy) { p.resolve(false); shift(); } }}
    />
  );
}

function PromptHostView({ p, shift }: { p: Extract<Pending, { kind: 'prompt' }>; shift: () => void }) {
  const opts = p.opts;
  const [value, setValue] = useState(opts.initial ?? '');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cancel = () => { if (!busy) { p.resolve(null); shift(); } };
  const submit = () => {
    if (busy) return;
    if (!opts.action) { p.resolve(value); shift(); return; }
    setBusy(true);
    opts.action(value)
      .then(() => { p.resolve(value); shift(); })
      .catch((e) => { p.reject(e); shift(); });
  };

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    // Capture + stopPropagation: el ESC cierra SOLO este diálogo, no el modal
    // que pueda estar debajo (Modal escucha keydown en bubble).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }); // sin deps: cancel/submit capturan estado fresco; listener barato

  return (
    // --top: por encima de cualquier modal abierto (incl. Dialog, z-index 300).
    // El scrim NO cierra al click (pedido owner 07-17): sólo botones / ESC.
    <div className="dmh-backdrop dmh-backdrop--top" role="presentation">
      <div className="dmh-modal" style={{ width: 440 }} role="dialog" aria-modal="true">
        <div className="m-body">
          <h3 className="rd-h3" style={{ marginBottom: 10 }}>{opts.title}</h3>
          {opts.label && <label className="rd-label">{opts.label}</label>}
          <input
            ref={inputRef}
            className="rd-input"
            disabled={busy}
            placeholder={opts.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </div>
        <div className="m-foot">
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={busy} onClick={cancel}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={submit}>
            {busy && <span className="rd-spin" aria-hidden />}{opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Host global de diálogos — montar una sola vez en App. */
export function DialogHost() {
  const current = useDialogQueue((s) => s.queue[0]);
  const shift = useDialogQueue((s) => s.shift);
  if (!current) return null;
  if (current.kind === 'confirm') return <ConfirmHostView key={current.id} p={current} shift={shift} />;
  return <PromptHostView key={current.id} p={current} shift={shift} />;
}
