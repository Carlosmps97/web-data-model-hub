import { Trash2 } from 'lucide-react';
import type { Project } from '@/types/model';

/** Ocupa el lugar del canvas mientras la working copy borra su proyecto. */
export default function DeletionPendingPanel({ project, onUndo, onSend }: {
  project: Project; onUndo: () => void; onSend: () => void;
}) {
  return (
    <div className="dmh-delpending" role="status">
      <div className="dmh-delpending-card">
        <span className="dmh-delpending-ico"><Trash2 size={22} strokeWidth={1.5} aria-hidden /></span>
        <div className="dmh-delpending-title">Deletion pending</div>
        <div className="dmh-delpending-text">
          This working copy deletes project «{project.name}». Undo the deletion to keep editing, or send it for approval.
        </div>
        <div className="dmh-delpending-actions">
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onUndo}>Undo deletion</button>
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={onSend}>Send for approval</button>
        </div>
      </div>
    </div>
  );
}
