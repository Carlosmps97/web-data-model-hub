import Modal from '@/components/ui/Modal';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import type { Cardinality } from '@/features/governance/services/governance.service';

const CARDS: { v: Cardinality; lbl: string }[] = [
  { v: 'one', lbl: 'Uno' }, { v: 'many', lbl: 'Muchos' }, { v: 'one-only', lbl: 'Uno y sólo uno' },
  { v: 'zero-one', lbl: 'Cero o uno' }, { v: 'one-many', lbl: 'Uno o muchos' }, { v: 'zero-many', lbl: 'Cero o muchos' },
];

export default function RelationshipPopup({ relId, onClose, pushToast }: { relId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const { diagram, updateRelationship } = useModelerStore();
  const canEdit = useChangesetStore((s) => s.activeId) != null;
  const rel = diagram?.relationships.find((r) => r.id === relId);
  if (!rel) return null;

  const set = async (patch: Partial<typeof rel>) => { try { await updateRelationship({ ...rel, ...patch }); } catch { pushToast('No se pudo actualizar', 'err'); } };

  return (
    <Modal title="Relación" icon="link" onClose={onClose}>
      <label className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <input type="checkbox" disabled={!canEdit} checked={rel.identifying} onChange={(e) => set({ identifying: e.target.checked })} />
        Identificadora (línea sólida, FK→PK)
      </label>
      <div className="wk-props-field"><label>Cardinalidad — origen</label>
        <select className="rd-input" disabled={!canEdit} value={rel.sourceCardinality} onChange={(e) => set({ sourceCardinality: e.target.value as Cardinality })}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>
      <div className="wk-props-field"><label>Cardinalidad — destino</label>
        <select className="rd-input" disabled={!canEdit} value={rel.targetCardinality} onChange={(e) => set({ targetCardinality: e.target.value as Cardinality })}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>
      {!canEdit && <div className="rd-small" style={{ color: 'var(--muted)', marginTop: 8 }}>Activá un changeset para editar.</div>}
    </Modal>
  );
}
