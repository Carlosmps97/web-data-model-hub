import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { relationshipDrift } from '@/features/modeler/lib/relationshipPairs';
import { phraseEdits } from '../lib/relationshipLabel';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import RelationshipPhraseFields, { type PhraseKey } from './RelationshipPhraseFields';

/**
 * Popup de gestión de un grupo de subcategoría: doble clic en el símbolo o en
 * cualquiera de sus aristas. Muestra supertipo + subtipos (con estado de drift
 * de llave), permite quitar un subtipo o borrar el grupo completo. Los borrados
 * van por el mismo camino que el resto (store → changeset + Undo por relación);
 * quitar la última arista elimina el símbolo solo (es derivado, regla de
 * Erwin). Limitación: un drift se repara quitando el subtipo y volviéndolo a
 * agregar. Cada subtipo es una relación con sus propias frases (la etiqueta de
 * su rama); se editan por fila, con su Apply.
 */
export default function SubcategoryPopup({ symbolId, onClose, pushToast }: {
  symbolId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  const updateRelationship = useModelerStore((s) => s.updateRelationship);
  const viewMode = useModelerStore((s) => s.viewMode);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  const [busy, setBusy] = useState(false);
  // Borradores de frases por relación (ausente = sin tocar).
  const [phraseDrafts, setPhraseDrafts] = useState<Record<string, Partial<Record<PhraseKey, string>>>>({});

  const rels = useMemo(
    () => (diagram?.relationships ?? []).filter((r) => r.subcategory && r.subtypeSymbolId === symbolId),
    [diagram, symbolId],
  );
  // El grupo dejó de existir (se quitó la última arista o el diagrama se actualizó sin él): cerrar.
  useEffect(() => { if (!rels.length) onClose(); }, [rels.length, onClose]);

  const tables = diagram?.tables ?? [];
  const cols = useMemo(() => diagram?.columns ?? [], [diagram]);   // estable: dep del memo de abajo
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

  // El fallo de una escritura espera la revalidación y calla si la sesión
  // cambia (`reportWriteError`: el aviso lo da la revalidación).
  const removeOne = async (relId: string, childName: string) => {
    setBusy(true);
    const onError = reportWriteError(() => pushToast("Couldn't remove the subtype", 'err'));
    try {
      const ok = await confirmDialog({
        title: 'Remove subtype',
        message: `"${childName}" will no longer be a subtype of "${parent ? nameOf(parent.id) : ''}". Its columns keep their current state.`,
        confirmLabel: 'Remove', cancelLabel: 'Cancel', variant: 'danger',
        action: () => deleteRelationship(relId),
      });
      if (ok) pushToast(`Subtype removed: ${childName}`);
    } catch (e) { await onError(e); }
    finally { setBusy(false); }
  };

  // Frases de una rama: un guardado con lo modificado, por el store
  // (changeset + Undo). Si falla, el borrador queda en las cajas.
  const applyPhrases = async (relId: string) => {
    const r = rels.find((x) => x.id === relId);
    const edits = r ? phraseEdits(r, phraseDrafts[relId] ?? {}) : null;
    if (!r || !edits) return;
    setBusy(true);
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't update", 'err'));
    try {
      await updateRelationship({ ...r, ...edits });
      setPhraseDrafts((d) => { const rest = { ...d }; delete rest[relId]; return rest; });
    } catch (e) {
      await onError(e);
    } finally { setBusy(false); }
  };

  const removeAll = async () => {
    setBusy(true);
    const onError = reportWriteError(() => pushToast("Couldn't delete the subcategory", 'err'));
    try {
      const ids = rels.map((r) => ({ id: r.id }));
      const ok = await confirmDialog({
        title: 'Delete subcategory',
        message: `The ${rels.length} subtype relationship(s) of this symbol will be removed. The tables and their columns stay in the model.`,
        confirmLabel: 'Delete subcategory', cancelLabel: 'Cancel', variant: 'danger',
        // Secuencial por el mismo camino changeset-aware (cada quitada deja su
        // propia entrada de Undo), todas en la sesión en que se confirmó: si
        // cambia en el medio, las que faltan no se borran.
        action: async () => {
          const pin = pinSession();
          for (const r of ids) { pin.check(); await deleteRelationship(r.id); }
        },
      });
      if (ok) { pushToast('Subcategory deleted'); onClose(); }
    } catch (e) { await onError(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Subcategory" icon="link" size="lg" onClose={() => { if (!busy) onClose(); }}>
      <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="wk-pp-role parent">SUPERTYPE</span>
        <span className="rd-mono">{parent ? nameOf(parent.id) : '—'}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          {rels.length} subtype{rels.length === 1 ? '' : 's'} · is-a · 1:1
        </span>
      </div>

      <div className="wk-props-field">
        <label>Subtypes · each one has its own verb phrases (the label on its branch)</label>
        <div className="wk-relpairs">
          {rels.map((r) => {
            const drifted = relationshipDrift(r, parentPkIds) != null;
            const childName = nameOf(r.childTableId);
            const drafts = phraseDrafts[r.id] ?? {};
            return (
              <div key={r.id} className="wk-relpair">
              <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" disabled={busy}
                    onClick={() => void removeOne(r.id, childName)}>
                    Remove
                  </button>
                )}
              </div>
              <RelationshipPhraseFields
                bare
                values={{
                  parentToChildPhrase: drafts.parentToChildPhrase ?? r.parentToChildPhrase ?? '',
                  childToParentPhrase: drafts.childToParentPhrase ?? r.childToParentPhrase ?? '',
                }}
                onChange={(key, value) => setPhraseDrafts((d) => ({ ...d, [r.id]: { ...(d[r.id] ?? {}), [key]: value } }))}
                onApply={canEdit ? () => void applyPhrases(r.id) : undefined}
                canApply={phraseEdits(r, drafts) != null}
                locked={!canEdit || busy}
              />
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
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
