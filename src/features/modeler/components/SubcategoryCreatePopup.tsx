import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useModelerStore } from '@/store/useModelerStore';
import { pushUndo } from '@/store/useUndoStore';
import * as gov from '@/services/governance.service';
import {
  buildKeyMapping, mappingToBulk, type MappingResolution,
} from '@/features/modeler/lib/relationshipPairs';
import { pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { symbolsOfParent } from '@/features/modeler/lib/subtypeGraph';
import { invertBulk, preKey } from '@/features/modeler/lib/undoInvert';
import { syncNewColumnToMirrorViews, syncRemovedColumnFromViews, syncRenamedColumnInViews } from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import KeyMappingRows, { type KeyRowState } from './KeyMappingRows';

export interface SubcatDraft {
  parentTableId: string; childTableId: string; dropColumnId: string | null;
  /** Símbolo preseleccionado cuando el drag nació en el círculo; null = elegir. */
  symbolId: string | null;
  ghostId: string;
}

const NEW_SYMBOL = '__new__';

/**
 * Popup de CONFIRMACIÓN de subcategoría (doc 53): mismo staging local que el
 * de relación (doc 47) — nada persiste hasta Confirm, que arma UN
 * PUT /changes/bulk (columnas migradas + relación con `subcategory=true` y el
 * símbolo del grupo). ES-UN: identifying + 1:1 fijos (sin selects de
 * cardinalidad). Guard Erwin: una tabla es subtipo en UN solo grupo — el
 * chequeo corre draft-aware contra el pool global, no solo este canvas.
 */
export default function SubcategoryCreatePopup({ draft, onClose, pushToast }: {
  draft: SubcatDraft; onClose: (created: boolean) => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const [saving, setSaving] = useState(false);
  // null = chequeo global en vuelo; '' = libre; string = mensaje de bloqueo.
  const [blocked, setBlocked] = useState<string | null>(null);

  const cols = useMemo(() => diagram?.columns ?? [], [diagram]);
  const tables = useMemo(() => diagram?.tables ?? [], [diagram]);
  const parentTable = tables.find((t) => t.id === draft.parentTableId);
  const childTable = tables.find((t) => t.id === draft.childTableId);
  const parentPks = useMemo(() => pkInKeyOrder(cols.filter((c) => c.tableId === draft.parentTableId)), [cols, draft.parentTableId]);
  const childCols = useMemo(() => cols.filter((c) => c.tableId === draft.childTableId), [cols, draft.childTableId]);
  const pkById = useMemo(() => new Map(parentPks.map((c) => [c.id, c])), [parentPks]);
  const colById = useMemo(() => new Map(childCols.map((c) => [c.id, c])), [childCols]);

  // Grupos EXISTENTES del supertipo en este canvas: la nueva arista puede
  // sumarse a uno o estrenar símbolo (flujo Erwin). Con un único grupo, ese es
  // el default (intención más común); el drag desde el círculo lo trae fijado.
  const groups = useMemo(
    () => symbolsOfParent(diagram?.relationships ?? [], draft.parentTableId),
    [diagram, draft.parentTableId],
  );
  const tableName = (id: string) => {
    const t = tables.find((x) => x.id === id);
    return t ? t.logicalName || t.physicalName : id;
  };
  const [groupChoice, setGroupChoice] = useState<string>(
    draft.symbolId ?? (groups.length === 1 ? groups[0].symbolId : NEW_SYMBOL));

  const [rows, setRows] = useState<KeyRowState[]>(() =>
    buildKeyMapping(parentPks, childCols, draft.dropColumnId).map((r) => ({ ...r, roleName: '', inherit: true })));

  // Regla Erwin (doc 53): una entidad NO es subtipo en dos grupos. El slice es
  // GLOBAL y draft-aware (effective) — cubre grupos visibles solo en otros
  // canvases. Best-effort: si el chequeo falla, no bloquea (el flujo sigue).
  useEffect(() => {
    let alive = true;
    setBlocked(null);
    gov.listRelationships(draft.childTableId)
      .then((rels) => {
        if (!alive) return;
        const hit = rels.find((r) => r.subcategory && r.childTableId === draft.childTableId);
        setBlocked(hit
          ? `"${childTable?.logicalName ?? draft.childTableId}" is already a subtype in another subcategory group — a table can belong to only one.`
          : '');
      })
      .catch(() => { if (alive) setBlocked(''); });
    // StrictMode (doc 43): el cuerpo repone el guard; el cleanup solo lo apaga.
    return () => { alive = false; };
  }, [draft.childTableId, childTable?.logicalName]);

  const confirm = async () => {
    setSaving(true);
    try {
      const resolutions: MappingResolution[] = await Promise.all(rows.map(async (r) => {
        const parentCol = pkById.get(r.parentColumnId);
        if (!parentCol) throw new Error('Parent key changed — reopen the popup');
        const role = r.roleName.trim();
        if (r.target.kind === 'existing') {
          const c = colById.get(r.target.columnId);
          if (!c) throw new Error('Child column no longer exists');
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
      const symbolId = groupChoice === NEW_SYMBOL ? crypto.randomUUID() : groupChoice;
      // ES-UN (doc 53): la PK del supertipo ES la PK del subtipo → identifying
      // con cardinalidades one/one; el backend re-normaliza igual.
      const { changes, createdCols } = mappingToBulk({
        relId: crypto.randomUUID(),
        parentTableId: draft.parentTableId, childTableId: draft.childTableId,
        identifying: true, parentCardinality: 'one', childCardinality: 'one',
        rows: resolutions, childCols,
        subcategory: { symbolId },
      });
      await gov.recordChangesBulk(changes);
      // Undo (doc 50): misma inversa genérica del popup de relación (doc 47) —
      // cae la relación (y el símbolo, que es derivado), se borran las columnas
      // creadas y las existentes vuelven a su pre-imagen.
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
      pushUndo('Create subcategory', async () => {
        await gov.recordChangesBulk(inverse);
        for (const name of undoCreated) {
          try {
            await syncRemovedColumnFromViews(
              { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView }, undoChildId, name);
          } catch { /* best-effort */ }
        }
        for (const r of renamesBack) {
          try {
            await syncRenamedColumnInViews(
              { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView }, undoChildId, r.from, r.to);
          } catch { /* best-effort */ }
        }
        await useModelerStore.getState().reload();
      });
      // V1: las columnas migradas entran también a las vistas ESPEJO del hijo.
      for (const c of createdCols) {
        try {
          await syncNewColumnToMirrorViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            draft.childTableId, c.physicalName, childCols);
        } catch { /* best-effort */ }
      }
      for (const r of resolutions) {
        if (r.target.kind !== 'existing' || !r.target.rename) continue;
        try {
          await syncRenamedColumnInViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            draft.childTableId, r.target.col.physicalName, r.target.rename.physicalName);
        } catch { /* best-effort */ }
      }
      useModelerStore.getState().markDirty();
      await useModelerStore.getState().reload();
      pushToast(`Subcategory created — ${resolutions.length} key column(s) migrated`);
      onClose(true);
    } catch (e) {
      pushToast(e instanceof Error && e.message ? e.message : "Couldn't create the subcategory", 'err');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Create subcategory" icon="link" size="lg" onClose={() => { if (!saving) onClose(false); }}>
      <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="wk-pp-role parent">SUPERTYPE</span>
        <span className="rd-mono">{parentTable?.physicalName ?? draft.parentTableId}</span>
        <span style={{ color: 'var(--text-muted-3)' }}>→</span>
        <span className="wk-pp-role child">SUBTYPE</span>
        <span className="rd-mono">{childTable?.physicalName ?? draft.childTableId}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          Subcategory (is-a) · 1:1 · logical model
        </span>
      </div>

      {blocked && (
        <div className="rd-small" role="alert" style={{
          background: 'var(--error-soft)', color: 'var(--error)',
          border: '1px solid rgba(220,38,38,.25)', borderRadius: 8, padding: '8px 10px', marginBottom: 10,
        }}>
          {blocked}
        </div>
      )}

      <div className="wk-props-field">
        <label>Subcategory symbol</label>
        <div style={{ display: 'grid', gap: 4 }}>
          {groups.map((g) => (
            <label key={g.symbolId} className="rd-small" style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
              <input
                type="radio" name="subcat-group" disabled={saving}
                checked={groupChoice === g.symbolId}
                onChange={() => setGroupChoice(g.symbolId)}
              />
              <span>
                Add to the existing symbol — subtypes:{' '}
                <span className="rd-mono">{g.rels.map((r) => tableName(r.childTableId)).join(', ')}</span>
              </span>
            </label>
          ))}
          <label className="rd-small" style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
            <input
              type="radio" name="subcat-group" disabled={saving}
              checked={groupChoice === NEW_SYMBOL}
              onChange={() => setGroupChoice(NEW_SYMBOL)}
            />
            <span>New subcategory symbol</span>
          </label>
        </div>
      </div>

      <div className="wk-props-field">
        <label>Key migration · the supertype's key becomes the subtype's key ({parentPks.length} column{parentPks.length === 1 ? '' : 's'}) · "Inherit" copies the parent's definition, UDPs and metadata</label>
        <KeyMappingRows parentPks={parentPks} childCols={childCols} rows={rows} onChange={setRows} locked={saving} />
      </div>

      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={saving} onClick={() => onClose(false)}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={saving || blocked !== ''} onClick={() => void confirm()}>
          {saving && <span className="rd-spin" aria-hidden />}
          {saving ? 'Creating…' : blocked === null ? 'Checking…' : 'Create subcategory'}
        </button>
      </div>
    </Modal>
  );
}
