import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { confirmDialog } from '@/components/ui/dialogs';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { relationshipDrift } from '@/features/modeler/lib/relationshipPairs';

/**
 * Popup de GESTIÓN de un grupo de subcategoría (doc 53) — doble click en el
 * símbolo o en cualquiera de sus aristas. Muestra supertipo + subtipos (con
 * estado de drift de llave), permite quitar un subtipo o borrar el grupo
 * completo. Los borrados van por el MISMO camino que el resto (store →
 * changeset + Undo por relación); quitar la última arista elimina el símbolo
 * solo (es derivado — regla Erwin). Reparar drift v1 = quitar y re-agregar.
 */
export default function SubcategoryPopup({ symbolId, onClose, pushToast }: {
  symbolId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  const viewMode = useModelerStore((s) => s.viewMode);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  const [busy, setBusy] = useState(false);

  const rels = useMemo(
    () => (diagram?.relationships ?? []).filter((r) => r.subcategory && r.subtypeSymbolId === symbolId),
    [diagram, symbolId],
  );
  // El grupo murió (se quitó la última arista o cambió el diagrama): cerrar.
  useEffect(() => { if (!rels.length) onClose(); }, [rels.length, onClose]);

  const tables = diagram?.tables ?? [];
  const cols = diagram?.columns ?? [];
  const parent = tables.find((t) => t.id === rels[0]?.parentTableId);
  const parentPkIds = useMemo(
    () => pkInKeyOrder(cols.filter((c) => c.tableId === parent?.id)).map((c) => c.id),
    [cols, parent?.id],
  );
  const nameOf = (id: string) => {
    const t = tables.find((x) => x.id === id);
    if (!t) return id;
    return viewMode === 'logical' ? (t.logicalName || t.physicalName) : t.physicalName;
  };

  const removeOne = async (relId: string, childName: string) => {
    setBusy(true);
    try {
      const ok = await confirmDialog({
        title: 'Remove subtype',
        message: `"${childName}" will no longer be a subtype of "${parent ? nameOf(parent.id) : ''}". Its columns keep their current state.`,
        confirmLabel: 'Remove', cancelLabel: 'Cancel', variant: 'danger',
        action: () => deleteRelationship(relId),
      });
      if (ok) pushToast(`Subtype removed: ${childName}`);
    } catch { pushToast("Couldn't remove the subtype", 'err'); }
    finally { setBusy(false); }
  };

  const removeAll = async () => {
    setBusy(true);
    try {
      const ids = rels.map((r) => ({ id: r.id }));
      const ok = await confirmDialog({
        title: 'Delete subcategory',
        message: `The ${rels.length} subtype relationship(s) of this symbol will be removed. The tables and their columns stay in the model.`,
        confirmLabel: 'Delete subcategory', cancelLabel: 'Cancel', variant: 'danger',
        // Secuencial por el mismo camino changeset-aware (cada quitada deja su
        // propia entrada de Undo, doc 50).
        action: async () => { for (const r of ids) await deleteRelationship(r.id); },
      });
      if (ok) { pushToast('Subcategory deleted'); onClose(); }
    } catch { pushToast("Couldn't delete the subcategory", 'err'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Subcategory" icon="link" onClose={() => { if (!busy) onClose(); }}>
      <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="wk-pp-role parent">SUPERTYPE</span>
        <span className="rd-mono">{parent ? nameOf(parent.id) : '—'}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          {rels.length} subtype{rels.length === 1 ? '' : 's'} · is-a · 1:1
        </span>
      </div>

      <div className="wk-props-field">
        <label>Subtypes</label>
        <div style={{ display: 'grid', gap: 6 }}>
          {rels.map((r) => {
            const drifted = relationshipDrift(r, parentPkIds) != null;
            const childName = nameOf(r.childTableId);
            return (
              <div key={r.id} className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="rd-mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {childName}
                </span>
                {drifted && (
                  <span title="Key out of sync with the supertype — remove and re-add this subtype to repair"
                    style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={13} aria-hidden /> key drift
                  </span>
                )}
                <span style={{ color: 'var(--text-muted-3)' }}>
                  {r.pairs.length} key col{r.pairs.length === 1 ? '' : 's'}
                </span>
                {canEdit && (
                  <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={busy}
                    onClick={() => void removeOne(r.id, childName)}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="m-foot">
        {canEdit && (
          <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" disabled={busy} onClick={() => void removeAll()}>
            Delete subcategory ({rels.length})
          </button>
        )}
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
