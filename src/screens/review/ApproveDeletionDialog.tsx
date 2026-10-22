import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui';
import { criticalDeletionText, nameMatches } from '@/features/modeler/lib/projectDeletion';
import type { DiffImpact } from '@/types/versioning';

/** Confirmación tipeada del aprobador antes de publicar un borrado de proyecto. */
export default function ApproveDeletionDialog({ open, deletes, onCancel, onConfirm }: {
  open: boolean;
  deletes: NonNullable<DiffImpact['deletesProject']>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  const t = criticalDeletionText(deletes.name, deletes.counts);
  const ok = nameMatches(typed, deletes.name);
  return (
    <Dialog open={open} onClose={onCancel} title="Approve and delete project?" icon={AlertTriangle} width={540}
      footer={<>
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" disabled={!ok} onClick={onConfirm}>Approve and delete project</button>
      </>}>
      <div className="dmh-rv-critical" role="alert">
        <AlertTriangle size={18} strokeWidth={1.8} aria-hidden />
        <div><strong>{t.title}</strong> {t.body}</div>
      </div>
      <label className="dmh-delproj-label">Type the project name to confirm
        <input className="rd-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={deletes.name} autoFocus />
      </label>
    </Dialog>
  );
}
