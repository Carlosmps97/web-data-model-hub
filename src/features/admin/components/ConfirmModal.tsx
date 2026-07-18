/**
 * ConfirmModal — confirmación de borrado (usuarios y roles). `onConfirm` es async;
 * si resuelve, cierra; si lanza, muestra toast y mantiene el modal abierto.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import ModalShell from './Modal';
import { C, dangerBtn, ghostBtn } from './helpers';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't complete the action");
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={title}
      width={420}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" style={{ ...dangerBtn, opacity: busy ? 0.6 : 1 }} onClick={run} disabled={busy}>{busy ? 'Deleting…' : confirmLabel}</button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: C.text2 }}>{message}</p>
    </ModalShell>
  );
}
