/**
 * dialogs: reemplazo promise-based de `window.confirm` / `window.prompt` con
 * popups propios de la web (mismo shell `.dmh-backdrop`/`.dmh-modal` que Modal).
 *
 * Uso (drop-in en cualquier handler):
 *   if (!(await confirmDialog({ title: 'Delete column', message: '…', variant: 'danger' }))) return;
 *   const name = await promptDialog({ title: 'New changeset', label: 'Title' });  // null = cancelado
 *
 * Con `action` el diálogo no se cierra al confirmar: queda bloqueado con spinner
 * hasta que la promesa termina (feedback de "en proceso") y recién ahí cierra.
 *   await confirmDialog({ …, action: () => deleteRelationship(id) });  // true al terminar
 *   // si `action` lanza, la promesa del diálogo se rechaza → catch de quien lo llama (toast).
 *
 * `<DialogHost/>` se monta una sola vez al final de `App.tsx` (después del router)
 * para pintar por encima de cualquier modal abierto (capa `--top`). Los pedidos
 * se encolan: se muestra de a uno.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { create } from 'zustand';
import ConfirmDialog from './ConfirmDialog';
import { isTopDialog, pushDialog, removeDialog } from './dialogStack';
import { activeElementNow, focusInto, recoverTab, trapTab } from './focusTrap';

export interface ConfirmOpts {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  /** Botón con el foco al abrir (por defecto «confirm»; «cancel» para lo irreversible). */
  initialFocus?: 'confirm' | 'cancel';
  /** Trabajo a ejecutar al confirmar; el diálogo muestra busy hasta que resuelve. */
  action?: () => Promise<unknown>;
}

export interface PromptOpts {
  title: string;
  /** Etiqueta sobre el input (opcional). */
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
      initialFocus={o.initialFocus}
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Quién tenía el foco al abrirse: primer render, antes de la fase de commit (init perezoso).
  const openerRef = useRef<Element | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = activeElementNow();
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('dmh-prompt');
  // La caja se nombra con su título; el <label> nombra al input.
  const titleId = useId();
  const inputId = useId();

  const cancel = () => { if (!busy) { p.resolve(null); shift(); } };
  const submit = () => {
    if (busy) return;
    if (!opts.action) { p.resolve(value); shift(); return; }
    // Busy deshabilita el input y los botones: el foco caería a <body> y Tab
    // saldría a la página de atrás, así que queda en la caja (como en ConfirmDialog).
    boxRef.current?.focus();
    setBusy(true);
    opts.action(value)
      .then(() => { p.resolve(value); shift(); })
      .catch((e) => { p.reject(e); shift(); });
  };

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    // Capture + stopPropagation: Esc cierra solo este diálogo, no el modal
    // que pueda estar debajo (Modal escucha keydown en bubble).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }); // sin deps: cancel/submit capturan estado fresco; listener barato

  // El foco entra a la caja al abrirse (a los 30 ms lo toma el input) y, al
  // cerrarse, vuelve a quien abrió el prompt. Ver `focusInto`. Además entra a la
  // pila de diálogos y un Tab con el foco perdido lo retoma su caja.
  useEffect(() => {
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
  }, []);

  return (
    // --top: por encima de cualquier modal abierto (incl. Dialog, z-index 300).
    // El scrim no cierra al hacer clic: solo los botones o Esc.
    <div className="dmh-backdrop dmh-backdrop--top" role="presentation">
      <div className="dmh-modal" style={{ width: 440, outline: 'none' }} role="dialog" aria-modal="true" ref={boxRef}
        aria-labelledby={titleId} tabIndex={-1} onKeyDown={(e) => trapTab(e, boxRef.current)}>
        <div className="m-body">
          <h3 id={titleId} className="rd-h3" style={{ marginBottom: 10 }}>{opts.title}</h3>
          {opts.label && <label className="rd-label" htmlFor={inputId}>{opts.label}</label>}
          <input
            ref={inputRef}
            id={inputId}
            aria-labelledby={opts.label ? undefined : titleId}
            className="rd-input"
            disabled={busy}
            placeholder={opts.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // Sin preventDefault, el keypress de este Enter «clicaría» al botón
            // que abrió el prompt (y aparecería otro).
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>
        <div className="m-foot">
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={cancel}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={submit}>
            {busy && <span className="rd-spin" aria-hidden />}{opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Host global de diálogos; se monta una sola vez en App. */
export function DialogHost() {
  const current = useDialogQueue((s) => s.queue[0]);
  const shift = useDialogQueue((s) => s.shift);
  if (!current) return null;
  if (current.kind === 'confirm') return <ConfirmHostView key={current.id} p={current} shift={shift} />;
  return <PromptHostView key={current.id} p={current} shift={shift} />;
}
