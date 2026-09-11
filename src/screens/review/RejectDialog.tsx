import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';

/**
 * Doc 88 §5: rechazar una solicitud EXIGE el motivo (el backend lo valida
 * también: 422 sin nota). El motivo queda en el historial de la solicitud y la
 * versión vuelve a draft para su owner (doc 88 §6).
 */
export default function RejectDialog({ open, title, busy, onCancel, onConfirm }: {
  open: boolean;
  title?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  if (!open) return null;
  const text = note.trim();
  const footer = (
    <>
      <span className="dmh-dialog-foot-left dmh-rv-reject-hint">The reason is recorded in the request history and shown to the owner.</span>
      <button type="button" className="dmh-rv-act" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="dmh-rv-act dmh-rv-act--reject" onClick={() => onConfirm(text)} disabled={!text || busy}>
        <X size={14} strokeWidth={1.7} aria-hidden />
        {busy ? 'Rejecting…' : 'Reject request'}
      </button>
    </>
  );
  return (
    <Dialog
      open title="Reject request"
      subtitle={`${title ?? 'This request'} goes back to draft so its owner can fix it and resubmit`}
      icon={X} onClose={onCancel} footer={footer} width={520}
    >
      <label className="dmh-rv-reject-label" htmlFor="dmh-rv-reject-note">
        Reason for the rejection <span className="req">(required)</span>
      </label>
      <textarea
        id="dmh-rv-reject-note" className="dmh-rv-reject-text" rows={5} autoFocus value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Tell the owner what to fix before resubmitting…"
      />
    </Dialog>
  );
}
