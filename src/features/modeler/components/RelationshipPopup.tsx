import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { Cardinality } from '@/features/governance/services/governance.service';

const CARDS: { v: Cardinality; lbl: string }[] = [
  { v: 'one', lbl: 'One' }, { v: 'many', lbl: 'Many' }, { v: 'one-only', lbl: 'Exactly one' },
  { v: 'zero-one', lbl: 'Zero or one' }, { v: 'one-many', lbl: 'One or more' }, { v: 'zero-many', lbl: 'Zero or more' },
];

export default function RelationshipPopup({ relId, onClose, pushToast }: { relId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const diagram = useModelerStore((s) => s.diagram);
  const updateRelationship = useModelerStore((s) => s.updateRelationship);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  // En modo visor puede haber changeset activo (viendo un request): reader-only.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  // Guardado en curso (cardinalidad/identifying): bloquea los controles para
  // que se sienta que la acción está en proceso (el overlay tarda en recargar).
  const [saving, setSaving] = useState(false);
  const rel = diagram?.relationships.find((r) => r.id === relId);
  if (!rel) return null;

  const locked = !canEdit || saving;
  const set = async (patch: Partial<typeof rel>) => {
    setSaving(true);
    try { await updateRelationship({ ...rel, ...patch }); }
    catch { pushToast("Couldn't update", 'err'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    // `action`: el diálogo queda bloqueado con spinner hasta que el borrado
    // termina; recién ahí se cierra todo (nada de popups "vivos" a medias).
    try {
      const ok = await confirmDialog({
        title: 'Delete relationship',
        message: 'This relationship will be removed from the model.',
        confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger',
        action: () => deleteRelationship(relId),
      });
      if (ok) { pushToast('Relationship deleted'); onClose(); }
    } catch { pushToast("Couldn't delete the relationship", 'err'); }
  };

  return (
    <Modal title="Relationship" icon="link" onClose={onClose}>
      <label className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <input type="checkbox" disabled={locked} checked={rel.identifying} onChange={(e) => set({ identifying: e.target.checked })} />
        Identifying (solid line, FK→PK)
      </label>
      <div className="wk-props-field"><label>Cardinality — source</label>
        <select className="rd-input" disabled={locked} value={rel.sourceCardinality} onChange={(e) => set({ sourceCardinality: e.target.value as Cardinality })}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>
      <div className="wk-props-field"><label>Cardinality — target</label>
        <select className="rd-input" disabled={locked} value={rel.targetCardinality} onChange={(e) => set({ targetCardinality: e.target.value as Cardinality })}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>
      {saving && <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', marginTop: 8 }}><span className="rd-spin" /> Saving…</div>}
      {!canEdit && <div className="rd-small" style={{ color: 'var(--muted)', marginTop: 8 }}>Read-only — open the model in editing mode to change it.</div>}
      <button
        type="button"
        disabled={locked}
        onClick={remove}
        style={{
          marginTop: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
          height: 34, borderRadius: 8, cursor: locked ? 'not-allowed' : 'pointer',
          border: '1px solid var(--red-border)', background: 'var(--red-tint)', color: 'var(--red)',
          fontFamily: 'var(--ui)', fontSize: 12.5, fontWeight: 600, opacity: locked ? 0.5 : 1,
        }}
      >
        <Trash2 size={14} /> Delete relationship
      </button>
    </Modal>
  );
}
