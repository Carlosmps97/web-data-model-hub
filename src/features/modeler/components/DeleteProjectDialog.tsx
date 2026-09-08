import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui';
import { getProjectCounts } from '@/services/projects.service';
import { runBlocking } from '@/store/useBusyStore';
import { useModelerStore } from '@/store/useModelerStore';
import type { Project } from '@/types/model';
import type { ScopeCounts } from '@/types/versioning';
import { deletionSummary, nameMatches } from '../lib/projectDeletion';

/**
 * DeleteProjectDialog (doc 75 D5) — el borrado se GRABA en la working copy y
 * sólo ocurre al aprobarla; el revisor lo ve como cambio crítico. Confirmación
 * tipeada con el nombre exacto del proyecto.
 */
export default function DeleteProjectDialog({ open, project, onClose, onDeleted }: {
  open: boolean; project: Project; onClose: () => void; onDeleted: () => void;
}) {
  const [counts, setCounts] = useState<ScopeCounts | null>(null);
  const [typed, setTyped] = useState('');
  const deleteProject = useModelerStore((s) => s.deleteProject);

  useEffect(() => {
    if (!open) return;
    setTyped(''); setCounts(null);
    void getProjectCounts(project.id).then(setCounts).catch(() => setCounts(null));
  }, [open, project.id]);

  const ok = counts != null && nameMatches(typed, project.name);
  const confirm = async () => {
    await runBlocking('Recording project deletion…', () => deleteProject(project.id));
    onDeleted();
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Delete project «${project.name}»?`} icon={AlertTriangle} width={520}
      footer={<>
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" disabled={!ok} onClick={() => void confirm()}>Delete project</button>
      </>}>
      <p className="dmh-delproj-text">{counts ? deletionSummary(project.name, counts) : 'Counting project contents…'}</p>
      <p className="dmh-delproj-text">The deletion only happens when this working copy is approved; the approver will see it as a critical change.</p>
      <label className="dmh-delproj-label">Type the project name to confirm
        <input className="rd-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={project.name} autoFocus />
      </label>
    </Dialog>
  );
}
