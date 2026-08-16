import { useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/features/governance/services/governance.service';
import type { Cardinality } from '@/features/governance/services/governance.service';
import {
  buildKeyMapping, demotablePkChildren, mappingToBulk, relationshipDrift, roleNamePlan,
  type MappingResolution,
} from '@/features/modeler/lib/relationshipPairs';
import { nextPkPosition, pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { syncNewColumnToMirrorViews, syncRenamedColumnInViews } from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import KeyMappingRows, { type KeyRowState } from './KeyMappingRows';

export const CARDS: { v: Cardinality; lbl: string }[] = [
  { v: 'one', lbl: 'One' }, { v: 'many', lbl: 'Many' }, { v: 'one-only', lbl: 'Exactly one' },
  { v: 'zero-one', lbl: 'Zero or one' }, { v: 'one-many', lbl: 'One or more' }, { v: 'zero-many', lbl: 'Zero or more' },
];

/**
 * Popup de EDICIÓN de relación (docs 19 + 47): tipo Identifying/Non-identifying
 * (con propagación de flags PK), cardinalidades, mapa READ-ONLY de pares
 * (N=N por construcción — el alta manual de pares murió con doc 47) con Role
 * name por par (rename in place, o SPLIT si la columna está unificada), y el
 * banner de DRIFT con "Sync with parent key" cuando la llave del padre cambió.
 */
export default function RelationshipPopup({ relId, onClose, pushToast }: { relId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const diagram = useModelerStore((s) => s.diagram);
  const updateRelationship = useModelerStore((s) => s.updateRelationship);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  const reload = useModelerStore((s) => s.reload);
  // En modo visor puede haber changeset activo (viendo un request): reader-only.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  const [saving, setSaving] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<number, string>>({});
  // Modo SYNC (doc 47): re-mapeo de la llave tras un drift del padre.
  const [syncing, setSyncing] = useState(false);
  const [syncRows, setSyncRows] = useState<KeyRowState[]>([]);
  const [syncInherit, setSyncInherit] = useState(true);

  const rel = diagram?.relationships.find((r) => r.id === relId);
  const cols = useMemo(() => diagram?.columns ?? [], [diagram]);
  const parentTable = diagram?.tables.find((t) => t.id === rel?.parentTableId);
  const childTable = diagram?.tables.find((t) => t.id === rel?.childTableId);
  const colById = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols]);
  const childOpts = useMemo(() => cols.filter((c) => c.tableId === rel?.childTableId), [cols, rel?.childTableId]);
  const parentPksNow = useMemo(() => pkInKeyOrder(cols.filter((c) => c.tableId === rel?.parentTableId)), [cols, rel?.parentTableId]);
  if (!rel) return null;

  const drift = relationshipDrift(rel, parentPksNow.map((c) => c.id));
  const locked = !canEdit || saving;
  const colName = (id: string) => colById.get(id)?.physicalName ?? id;
  const run = async (fn: () => Promise<void>, err: string) => {
    setSaving(true);
    try { await fn(); } catch (e) { pushToast(e instanceof Error && e.message ? e.message : err, 'err'); }
    finally { setSaving(false); }
  };

  // ── Tipo (identifying ↔ non-identifying) con propagación de flags PK ──
  const setType = (identifying: boolean) => {
    if (identifying === rel.identifying) return;
    void run(async () => {
      await gov.updateRelationship({ ...rel, identifying });
      if (identifying) {
        // Erwin: la FK entra a la PK del hijo — se promueven TODOS los pares,
        // entrando AL FINAL de la llave si el hijo maneja orden explícito.
        let nextPos = nextPkPosition(childOpts);
        for (const p of rel.pairs) {
          const c = colById.get(p.childColumnId);
          if (c && (!c.isPrimaryKey || c.isNullable !== false)) {
            const pos = !c.isPrimaryKey && nextPos != null ? nextPos++ : undefined;
            await gov.markForeignKey(c, true, pos);
          }
        }
        pushToast('Identifying: child columns promoted to PK');
      } else {
        // Demote conservador: no pisa PKs sostenidas por OTRA rel identifying.
        const near = await gov.listRelationships(rel.childTableId);
        const demote = demotablePkChildren(rel, near.filter((r) => r.id !== rel.id));
        let n = 0;
        for (const cid of demote) {
          const c = colById.get(cid);
          if (c?.isPrimaryKey) { await gov.updateColumn({ ...c, isPrimaryKey: false, pkPosition: null }); n += 1; }
        }
        pushToast(n ? `Non-identifying: ${n} child column(s) leave the PK` : 'Non-identifying');
      }
      await reload();
    }, "Couldn't update");
  };

  const setCard = (end: 'parent' | 'child', v: Cardinality) =>
    void run(async () => {
      await updateRelationship(end === 'parent'
        ? { ...rel, parentCardinality: v } : { ...rel, childCardinality: v });
    }, "Couldn't update");

  // ── Role name (Erwin): rename in place, o SPLIT si está unificada ──
  const applyRole = (i: number) => {
    const name = (roleDrafts[i] ?? '').trim();
    if (!name) { pushToast('Type the role name', 'err'); return; }
    void run(async () => {
      // Plan con el slice GLOBAL de la tabla hija (la unificación puede venir
      // de una relación de OTRO canvas).
      const near = await gov.listRelationships(rel.childTableId);
      const inNear = near.find((r) => r.id === rel.id);
      const plan = roleNamePlan(inNear ?? rel, i, near.length ? near : [rel]);
      const cur = colById.get(rel.pairs[i].childColumnId);
      if (!cur) throw new Error('Child column no longer exists');
      const physical = (await gov.physicalize(name)).physical;
      if (plan.kind === 'rename') {
        await gov.updateColumn({ ...cur, logicalName: name, physicalName: physical });
        // Las vistas referencian por nombre: re-apuntar sources al nuevo físico.
        try {
          await syncRenamedColumnInViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            rel.childTableId, cur.physicalName, physical);
        } catch { /* best-effort */ }
        await gov.updateRelationship({
          ...rel,
          pairs: rel.pairs.map((p, k) => (k === i ? { ...p, roleName: name } : p)),
        });
        pushToast(`Role name applied: "${cur.physicalName}" renamed to "${physical}"`);
      } else {
        // SPLIT: la columna está compartida (unificada) — se crea una nueva
        // con el role name y ESTE par se repunta; la vieja queda para el resto.
        // pkPosition NO se hereda del spread (posición propia al final de la llave).
        const newId = crypto.randomUUID();
        await gov.createColumn({
          ...cur, id: newId, logicalName: name, physicalName: physical,
          isForeignKey: true, isPrimaryKey: rel.identifying,
          pkPosition: rel.identifying ? nextPkPosition(childOpts) : null,
          isNullable: rel.identifying ? false : cur.isNullable,
          ordinal: childOpts.length,
        });
        // V1: la columna del split entra también a las vistas ESPEJO del hijo.
        try {
          await syncNewColumnToMirrorViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            rel.childTableId, physical, childOpts);
        } catch { /* best-effort */ }
        await gov.updateRelationship({
          ...rel,
          pairs: rel.pairs.map((p, k) => (k === i ? { ...p, childColumnId: newId, roleName: name } : p)),
        });
        pushToast(`Split: created "${physical}" in ${childTable?.physicalName ?? 'the child'} — this pair now points there`);
      }
      setRoleDrafts((d) => ({ ...d, [i]: '' }));
      await reload();
    }, "Couldn't apply the role name");
  };

  // ── Sync con la llave del padre (doc 47) ──
  const startSync = () => {
    const pkIdSet = new Set(parentPksNow.map((c) => c.id));
    const kept = rel.pairs.filter((p) => pkIdSet.has(p.parentColumnId));
    const claimed = new Set(kept.map((p) => p.childColumnId));
    const free = childOpts.filter((c) => !claimed.has(c.id));
    setSyncRows(parentPksNow.map((pk) => {
      const pair = kept.find((p) => p.parentColumnId === pk.id);
      if (pair) return { parentColumnId: pk.id, target: { kind: 'existing' as const, columnId: pair.childColumnId }, roleName: '', locked: true };
      const [auto] = buildKeyMapping([pk], free);
      return { parentColumnId: pk.id, target: auto.target, roleName: '' };
    }));
    setSyncInherit(true);
    setSyncing(true);
  };

  const applySync = () => void run(async () => {
    const pkIdSet = new Set(parentPksNow.map((c) => c.id));
    const pkById = new Map(parentPksNow.map((c) => [c.id, c]));
    const keptRole = new Map(rel.pairs.map((p) => [p.parentColumnId, p.roleName ?? undefined]));
    const resolutions: MappingResolution[] = await Promise.all(syncRows.map(async (r) => {
      const parentCol = pkById.get(r.parentColumnId);
      if (!parentCol) throw new Error('Parent key changed — reopen the popup');
      if (r.target.kind === 'existing') {
        const c = colById.get(r.target.columnId);
        if (!c) throw new Error('Child column no longer exists');
        const role = r.locked ? keptRole.get(r.parentColumnId) : undefined;
        return { parentCol, target: { kind: 'existing' as const, col: c, preexisting: !!r.locked },
                 ...(role ? { roleName: role } : {}) };
      }
      const logical = (r.roleName.trim() || parentCol.logicalName).trim();
      const { physical } = await gov.physicalize(logical);
      return { parentCol, target: { kind: 'create' as const, id: crypto.randomUUID(), logicalName: logical, physicalName: physical },
               ...(r.roleName.trim() ? { roleName: r.roleName.trim() } : {}) };
    }));
    const { changes, createdCols } = mappingToBulk({
      relId: rel.id, parentTableId: rel.parentTableId, childTableId: rel.childTableId,
      identifying: rel.identifying, parentCardinality: rel.parentCardinality, childCardinality: rel.childCardinality,
      inherit: syncInherit, rows: resolutions, childCols: childOpts,
    });
    // Pares retirados (su PK ya no existe en el padre): limpieza conservadora
    // del flag FK — misma regla que el delete de relación.
    const near = await gov.listRelationships(rel.childTableId);
    for (const p of rel.pairs.filter((pp) => !pkIdSet.has(pp.parentColumnId))) {
      const c = colById.get(p.childColumnId);
      if (!c?.isForeignKey) continue;
      const still = near.some((r2) => r2.id !== rel.id && r2.pairs.some((q) => q.childColumnId === c.id));
      if (!still) changes.push(gov.bulk.createColumn({ ...c, isForeignKey: false }));
    }
    await gov.recordChangesBulk(changes);
    for (const c of createdCols) {
      try {
        await syncNewColumnToMirrorViews(
          { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
          rel.childTableId, c.physicalName, childOpts);
      } catch { /* best-effort */ }
    }
    setSyncing(false);
    useModelerStore.getState().markDirty();
    await reload();
    pushToast('Relationship synced with the parent key');
  }, "Couldn't sync the relationship");

  const remove = async () => {
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

  const removedPairs = rel.pairs.filter((p) => !parentPksNow.some((c) => c.id === p.parentColumnId));

  return (
    <Modal title="Relationship" icon="link" onClose={onClose}>
      {/* Parent → Child */}
      <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="wk-pp-role parent">PARENT</span>
        <span className="rd-mono">{parentTable?.physicalName ?? rel.parentTableId}</span>
        <span style={{ color: 'var(--text-muted-3)' }}>→</span>
        <span className="wk-pp-role child">CHILD</span>
        <span className="rd-mono">{childTable?.physicalName ?? rel.childTableId}</span>
      </div>

      {/* Drift (doc 47): la llave del padre cambió después de crear la relación. */}
      {drift && canEdit && !syncing && (
        <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 8, padding: '8px 12px' }}>
          <span style={{ flex: 1 }}>
            Parent key changed — this relationship is out of sync
            ({drift.missing.length} missing / {drift.extra.length} stale pair{drift.extra.length === 1 ? '' : 's'}).
          </span>
          <button type="button" className="rd-btn rd-btn-sm" disabled={locked} onClick={startSync}>Sync with parent key</button>
        </div>
      )}

      {/* Tipo: identifying / non-identifying */}
      <div className="wk-props-field"><label>Type</label>
        <div style={{ display: 'flex', gap: 14 }}>
          <label className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="rel-type" disabled={locked} checked={rel.identifying} onChange={() => setType(true)} />
            Identifying <span style={{ color: 'var(--muted)' }}>(solid, FK ⊂ child PK)</span>
          </label>
          <label className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="rel-type" disabled={locked} checked={!rel.identifying} onChange={() => setType(false)} />
            Non-identifying <span style={{ color: 'var(--muted)' }}>(dashed)</span>
          </label>
        </div>
      </div>

      <div className="wk-props-field"><label>Cardinality — parent</label>
        <select className="rd-input" disabled={locked} value={rel.parentCardinality} onChange={(e) => setCard('parent', e.target.value as Cardinality)}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>
      <div className="wk-props-field"><label>Cardinality — child</label>
        <select className="rd-input" disabled={locked} value={rel.childCardinality} onChange={(e) => setCard('child', e.target.value as Cardinality)}>
          {CARDS.map((c) => <option key={c.v} value={c.v}>{c.lbl}</option>)}
        </select>
      </div>

      {syncing ? (
        /* ── Modo SYNC: re-mapeo N=N contra la llave vigente del padre ── */
        <div className="wk-props-field">
          <label>Sync with parent key · parent key has {parentPksNow.length} column{parentPksNow.length === 1 ? '' : 's'}</label>
          <KeyMappingRows parentPks={parentPksNow} childCols={childOpts} rows={syncRows} onChange={setSyncRows} locked={locked} />
          {removedPairs.map((p) => (
            <div key={p.childColumnId} className="rd-small" style={{ color: 'var(--red)', padding: '4px 2px' }}>
              {colName(p.parentColumnId)} → {colName(p.childColumnId)} — will be removed
            </div>
          ))}
          <div className="wk-props-field" style={{ marginTop: 10 }}><label>Inherit parent definition?</label>
            <select className="rd-input" disabled={locked} value={syncInherit ? 'yes' : 'no'}
              onChange={(e) => setSyncInherit(e.target.value === 'yes')}>
              <option value="yes">Yes — copy definition, UDPs and metadata from the parent</option>
              <option value="no">No — keep existing metadata / leave new columns blank</option>
            </select>
          </div>
          <div className="m-foot">
            <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={locked} onClick={() => setSyncing(false)}>Cancel</button>
            <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={locked} onClick={applySync}>
              {saving && <span className="rd-spin" aria-hidden />}
              {saving ? 'Syncing…' : 'Apply sync'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Mapa READ-ONLY de pares (N=N) + role name por par ── */
        <div className="wk-props-field"><label>Key migration · {rel.pairs.length} pair{rel.pairs.length === 1 ? '' : 's'}</label>
          <div className="wk-relpairs">
            {rel.pairs.map((p, i) => (
              <div className="wk-relpair" key={`${p.parentColumnId}-${p.childColumnId}`}>
                <div className="wk-relpair-cols">
                  <span className="rd-mono">{colName(p.parentColumnId)}</span>
                  <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                  <span className="rd-mono">{colName(p.childColumnId)}</span>
                  {p.roleName && <span className="rd-small" style={{ color: 'var(--muted)', marginLeft: 'auto' }}>role: {p.roleName}</span>}
                </div>
                {canEdit && (
                  <div className="wk-relpair-role">
                    <input
                      className="rd-input rd-mono"
                      disabled={locked}
                      placeholder={`Role name… (e.g. ${colName(p.childColumnId)})`}
                      value={roleDrafts[i] ?? p.roleName ?? ''}
                      onChange={(e) => setRoleDrafts((d) => ({ ...d, [i]: e.target.value }))}
                    />
                    <button type="button" className="rd-btn rd-btn-sm" disabled={locked || !(roleDrafts[i] ?? '').trim()}
                      title="Apply role name: renames the child FK (or creates a new column if it is shared)"
                      onClick={() => applyRole(i)}>
                      <Check size={13} /> Apply
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
