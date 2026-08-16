import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useModelerStore } from '@/store/useModelerStore';
import * as gov from '@/features/governance/services/governance.service';
import type { Cardinality } from '@/features/governance/services/governance.service';
import {
  buildKeyMapping, mappingToBulk, type MappingResolution,
} from '@/features/modeler/lib/relationshipPairs';
import { pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { syncNewColumnToMirrorViews } from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import KeyMappingRows, { type KeyRowState } from './KeyMappingRows';
import { CARDS } from './RelationshipPopup';

export interface RelDraft {
  parentTableId: string; childTableId: string; dropColumnId: string | null;
  identifying: boolean; parentCardinality: Cardinality; childCardinality: Cardinality;
  ghostId: string;
}

/**
 * Popup de CONFIRMACIÓN de relación (doc 47): staging local — nada persiste
 * hasta Confirm. N filas fijas = PKs del padre (orden de llave); Confirm arma
 * UN PUT /changes/bulk (columnas + relación). Cancel = cero requests.
 */
export default function RelationshipCreatePopup({ draft, onClose, pushToast }: {
  draft: RelDraft; onClose: (created: boolean) => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const [saving, setSaving] = useState(false);
  const [inherit, setInherit] = useState(true);
  const [cards, setCards] = useState({ parent: draft.parentCardinality, child: draft.childCardinality });

  const cols = useMemo(() => diagram?.columns ?? [], [diagram]);
  const parentTable = diagram?.tables.find((t) => t.id === draft.parentTableId);
  const childTable = diagram?.tables.find((t) => t.id === draft.childTableId);
  const parentPks = useMemo(() => pkInKeyOrder(cols.filter((c) => c.tableId === draft.parentTableId)), [cols, draft.parentTableId]);
  const childCols = useMemo(() => cols.filter((c) => c.tableId === draft.childTableId), [cols, draft.childTableId]);
  const pkById = useMemo(() => new Map(parentPks.map((c) => [c.id, c])), [parentPks]);
  const colById = useMemo(() => new Map(childCols.map((c) => [c.id, c])), [childCols]);

  const [rows, setRows] = useState<KeyRowState[]>(() =>
    buildKeyMapping(parentPks, childCols, draft.dropColumnId).map((r) => ({ ...r, roleName: '' })));

  const confirm = async () => {
    setSaving(true);
    try {
      const resolutions: MappingResolution[] = await Promise.all(rows.map(async (r) => {
        const parentCol = pkById.get(r.parentColumnId);
        if (!parentCol) throw new Error('Parent key changed — reopen the popup');
        if (r.target.kind === 'existing') {
          const c = colById.get(r.target.columnId);
          if (!c) throw new Error('Child column no longer exists');
          return { parentCol, target: { kind: 'existing' as const, col: c } };
        }
        const logical = (r.roleName.trim() || parentCol.logicalName).trim();
        const { physical } = await gov.physicalize(logical);
        return {
          parentCol,
          target: { kind: 'create' as const, id: crypto.randomUUID(), logicalName: logical, physicalName: physical },
          ...(r.roleName.trim() ? { roleName: r.roleName.trim() } : {}),
        };
      }));
      const { changes, createdCols } = mappingToBulk({
        relId: crypto.randomUUID(),
        parentTableId: draft.parentTableId, childTableId: draft.childTableId,
        identifying: draft.identifying, parentCardinality: cards.parent, childCardinality: cards.child,
        inherit, rows: resolutions, childCols,
      });
      await gov.recordChangesBulk(changes);
      // V1: las columnas migradas entran también a las vistas ESPEJO del hijo.
      for (const c of createdCols) {
        try {
          await syncNewColumnToMirrorViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            draft.childTableId, c.physicalName, childCols);
        } catch { /* best-effort */ }
      }
      useModelerStore.getState().markDirty();
      await useModelerStore.getState().reload();
      pushToast(`Relationship created — ${resolutions.length} key column(s) migrated`);
      onClose(true);
    } catch (e) {
      pushToast(e instanceof Error && e.message ? e.message : "Couldn't create the relationship", 'err');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Create relationship" icon="link" onClose={() => { if (!saving) onClose(false); }}>
      <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="wk-pp-role parent">PARENT</span>
        <span className="rd-mono">{parentTable?.physicalName ?? draft.parentTableId}</span>
        <span style={{ color: 'var(--text-muted-3)' }}>→</span>
        <span className="wk-pp-role child">CHILD</span>
        <span className="rd-mono">{childTable?.physicalName ?? draft.childTableId}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          {draft.identifying ? 'Identifying (solid)' : 'Non-identifying (dashed)'}
        </span>
      </div>

      <div className="wk-props-field"><label>Cardinality — parent</label>
        <select className="rd-input" disabled={saving} value={cards.parent}
          onChange={(e) => setCards((c) => ({ ...c, parent: e.target.value as Cardinality }))}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>
      <div className="wk-props-field"><label>Cardinality — child</label>
        <select className="rd-input" disabled={saving} value={cards.child}
          onChange={(e) => setCards((c) => ({ ...c, child: e.target.value as Cardinality }))}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>

      <div className="wk-props-field">
        <label>Key migration · parent key has {parentPks.length} column{parentPks.length === 1 ? '' : 's'}</label>
        <KeyMappingRows parentPks={parentPks} childCols={childCols} rows={rows} onChange={setRows} locked={saving} />
      </div>

      <div className="wk-props-field"><label>Inherit parent definition?</label>
        <select className="rd-input" disabled={saving} value={inherit ? 'yes' : 'no'}
          onChange={(e) => setInherit(e.target.value === 'yes')}>
          <option value="yes">Yes — copy definition, UDPs and metadata from the parent</option>
          <option value="no">No — keep existing metadata / leave new columns blank</option>
        </select>
      </div>

      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={saving} onClick={() => onClose(false)}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={saving} onClick={() => void confirm()}>
          {saving && <span className="rd-spin" aria-hidden />}
          {saving ? 'Creating…' : 'Create relationship'}
        </button>
      </div>
    </Modal>
  );
}
