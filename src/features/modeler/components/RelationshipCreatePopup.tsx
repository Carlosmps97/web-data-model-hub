import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useModelerStore } from '@/store/useModelerStore';
import { pushUndo } from '@/store/useUndoStore';
import * as gov from '@/services/governance.service';
import type { Cardinality } from '@/services/governance.service';
import {
  buildKeyMapping, mappingToBulk, type MappingResolution,
} from '@/features/modeler/lib/relationshipPairs';
import { pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { invertBulk, preKey } from '@/features/modeler/lib/undoInvert';
import { syncNewColumnsToMirrorViews, syncRenamedColumnInViews } from '@/features/modeler/lib/viewSync';
import { bestEffort, pinnedViewDeps, undoColumnsBatch } from '../lib/pinnedWrites';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import KeyMappingRows, { type KeyRowState } from './KeyMappingRows';
import RelationshipPhraseFields, { type PhraseValues } from './RelationshipPhraseFields';
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
 * Doc 98: las frases de relación (opcionales) nacen en ese mismo lote.
 */
export default function RelationshipCreatePopup({ draft, onClose, pushToast }: {
  draft: RelDraft; onClose: (created: boolean) => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const [saving, setSaving] = useState(false);
  const [cards, setCards] = useState({ parent: draft.parentCardinality, child: draft.childCardinality });
  const [phrases, setPhrases] = useState<PhraseValues>({ parentToChildPhrase: '', childToParentPhrase: '' });

  const cols = useMemo(() => diagram?.columns ?? [], [diagram]);
  const parentTable = diagram?.tables.find((t) => t.id === draft.parentTableId);
  const childTable = diagram?.tables.find((t) => t.id === draft.childTableId);
  const parentPks = useMemo(() => pkInKeyOrder(cols.filter((c) => c.tableId === draft.parentTableId)), [cols, draft.parentTableId]);
  const childCols = useMemo(() => cols.filter((c) => c.tableId === draft.childTableId), [cols, draft.childTableId]);
  const pkById = useMemo(() => new Map(parentPks.map((c) => [c.id, c])), [parentPks]);
  const colById = useMemo(() => new Map(childCols.map((c) => [c.id, c])), [childCols]);

  const [rows, setRows] = useState<KeyRowState[]>(() =>
    buildKeyMapping(parentPks, childCols, draft.dropColumnId).map((r) => ({ ...r, roleName: '', inherit: true })));

  const confirm = async () => {
    setSaving(true);
    // Doc 105 (H1): la acción es de la sesión donde empezó (sus escrituras y su
    // inversa cortan si cambió); un fallo espera la revalidación (H7).
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't create the relationship", 'err'));
    try {
      const resolutions: MappingResolution[] = await Promise.all(rows.map(async (r) => {
        const parentCol = pkById.get(r.parentColumnId);
        if (!parentCol) throw new Error('Parent key changed — reopen the popup');
        const role = r.roleName.trim();
        if (r.target.kind === 'existing') {
          const c = colById.get(r.target.columnId);
          if (!c) throw new Error('Child column no longer exists');
          // Role name sobre existente = rename in place (semántica del Apply
          // del popup de edición); mismo nombre lógico → no-op.
          const rename = role && role !== c.logicalName
            ? { logicalName: role, physicalName: (await gov.physicalize(role)).physical }
            : undefined;
          return { parentCol, inherit: r.inherit,
            target: { kind: 'existing' as const, col: c, ...(rename ? { rename } : {}) },
            ...(role ? { roleName: role } : {}) };
        }
        const logical = (role || parentCol.logicalName).trim();
        const { physical } = await gov.physicalize(logical);
        return {
          parentCol, inherit: r.inherit,
          target: { kind: 'create' as const, id: crypto.randomUUID(), logicalName: logical, physicalName: physical },
          ...(role ? { roleName: role } : {}),
        };
      }));
      const { changes, createdCols } = mappingToBulk({
        relId: crypto.randomUUID(),
        parentTableId: draft.parentTableId, childTableId: draft.childTableId,
        identifying: draft.identifying, parentCardinality: cards.parent, childCardinality: cards.child,
        rows: resolutions, childCols,
        ...phrases,   // doc 98: mappingToBulk las limpia (en blanco no viajan)
      });
      pin.check();
      await gov.recordChangesBulk(changes);
      // Undo (doc 50): inversa genérica del lote — cae la relación, se borran
      // las columnas CREADAS y las existentes modificadas vuelven a su
      // pre-imagen (snapshot por valor de las columnas del hijo); las vistas
      // espejo se corrigen best-effort (retiro de creadas + renames de vuelta).
      const pre = new Map(childCols.map((c) => [
        preKey('canonical_columns', c.id),
        { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) } as Record<string, unknown>,
      ]));
      const inverse = invertBulk(changes, pre);
      const renamesBack: { from: string; to: string }[] = [];
      for (const r of resolutions) {
        if (r.target.kind === 'existing' && r.target.rename) {
          renamesBack.push({ from: r.target.rename.physicalName, to: r.target.col.physicalName });
        }
      }
      const undoCreated = createdCols.map((c) => c.physicalName);
      const undoChildId = draft.childTableId;
      pushUndo('Create relationship', undoColumnsBatch({
        inverse, tableId: undoChildId, created: undoCreated, renamesBack,
        after: () => useModelerStore.getState().reload(),
      }), pin);
      // V1: las columnas migradas entran también a las vistas ESPEJO del hijo;
      // los renames por role name re-apuntan los sources de las vistas.
      // Doc 94 D4: en una identificante las nuevas son PK y entran tras las PK.
      await syncNewColumnsToMirrorViews(pinnedViewDeps(pin), draft.childTableId, createdCols, childCols);
      for (const r of resolutions) {
        if (r.target.kind !== 'existing' || !r.target.rename) continue;
        const { col, rename } = r.target;
        await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), draft.childTableId, col.physicalName, rename.physicalName));
      }
      useModelerStore.getState().markDirty();
      await useModelerStore.getState().reload();
      pushToast(`Relationship created — ${resolutions.length} key column(s) migrated`);
      onClose(true);
    } catch (e) {
      await onError(e);
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Create relationship" icon="link" size="lg" onClose={() => { if (!saving) onClose(false); }}>
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

      <RelationshipPhraseFields
        values={phrases}
        onChange={(key, value) => setPhrases((p) => ({ ...p, [key]: value }))}
        locked={saving}
      />

      <div className="wk-props-field">
        <label>Key migration · parent key has {parentPks.length} column{parentPks.length === 1 ? '' : 's'} · "Inherit" copies the parent's definition, UDPs and metadata</label>
        <KeyMappingRows parentPks={parentPks} childCols={childCols} rows={rows} onChange={setRows} locked={saving} />
      </div>

      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={saving} onClick={() => onClose(false)}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={saving} onClick={() => void confirm()}>
          {saving && <span className="rd-spin" aria-hidden />}
          {saving ? 'Creating…' : 'Create relationship'}
        </button>
      </div>
    </Modal>
  );
}
