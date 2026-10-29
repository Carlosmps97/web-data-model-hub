import { useMemo, useState } from 'react';
import { Folder as FolderIcon, FolderInput, LayoutGrid } from 'lucide-react';
import { Dialog } from '@/components/ui';
import { nameKey } from '@/lib/nameKey';
import { moveTargets, type MoveItem } from '../lib/explorerMove';
import type { Folder, SubjectArea } from '../services/modeler.service';

/**
 * «Move to…» del Explorer: elige la carpeta destino (o la raíz del proyecto) de
 * un canvas o una carpeta. Los destinos que no se pueden elegir (la carpeta misma,
 * una subcarpeta suya, donde ya está, junto a un homónimo) se ven deshabilitados
 * con su motivo; el buscador filtra por nombre sin tildes ni mayúsculas.
 */
export default function MoveToDialog({ item, name, folders, canvases, onMove, onClose }: {
  item: MoveItem; name: string; folders: Folder[]; canvases: SubjectArea[];
  onMove: (target: string | null) => Promise<void>; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  // undefined = todavía no se eligió; null = la raíz del proyecto.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const targets = useMemo(() => moveTargets(item, folders, canvases), [item, folders, canvases]);
  const needle = nameKey(q);
  const shown = needle ? targets.filter((t) => t.id === null || nameKey(t.label).includes(needle)) : targets;
  const chosen = picked === undefined ? null : targets.find((t) => t.id === picked && t.ok) ?? null;

  const run = async (id: string | null) => {
    if (busy) return;
    setBusy(true);
    try { await onMove(id); } finally { setBusy(false); }
  };
  const move = () => { if (chosen) void run(chosen.id); };

  return (
    <Dialog open title={`Move “${name}”`} icon={FolderInput} width={480}
      onClose={() => { if (!busy) onClose(); }}
      footer={(
        <>
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || !chosen} onClick={move}>
            {busy && <span className="rd-spin" aria-hidden />}
            Move
          </button>
        </>
      )}>
      <input className="rd-input" autoFocus placeholder="Search folders" value={q} style={{ width: '100%' }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); move(); } }} />
      <div className="wk-move-list" role="listbox" aria-label="Destination">
        {shown.map((t) => (
          <button key={t.id ?? '__root__'} type="button" role="option" aria-selected={picked === t.id}
            className={`wk-move-row${picked === t.id ? ' active' : ''}`}
            style={{ paddingLeft: 8 + t.depth * 14 }}
            disabled={busy || !t.ok} title={t.ok ? undefined : t.why}
            onClick={() => setPicked(t.id)}
            onDoubleClick={() => { if (t.ok) { setPicked(t.id); void run(t.id); } }}>
            {t.id === null ? <LayoutGrid size={14} aria-hidden /> : <FolderIcon size={14} aria-hidden />}
            {t.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
