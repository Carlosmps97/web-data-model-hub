import { useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/features/governance/services/governance.service';
import type { Cardinality } from '@/features/governance/services/governance.service';
import {
  childCandidates, demotablePkChildren, pairError, parentCandidates, roleNamePlan,
} from '@/features/modeler/lib/relationshipPairs';
import { nextPkPosition } from '@/features/modeler/lib/keyOrder';
import { syncNewColumnToMirrorViews, syncRenamedColumnInViews } from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';

const CARDS: { v: Cardinality; lbl: string }[] = [
  { v: 'one', lbl: 'One' }, { v: 'many', lbl: 'Many' }, { v: 'one-only', lbl: 'Exactly one' },
  { v: 'zero-one', lbl: 'Zero or one' }, { v: 'one-many', lbl: 'One or more' }, { v: 'zero-many', lbl: 'Zero or more' },
];
const NEW_COL = '__new__';

/**
 * Popup de relación v2 (doc 19, estilo editor de Erwin): tipo Identifying /
 * Non-identifying (con propagación de flags PK), cardinalidad Parent/Child,
 * grid de pares migrados (PK compuesta) con Role name por par (rename in
 * place, o SPLIT si la columna hija está "unificada" con otra relación).
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
  // Par nuevo (staging local) + drafts de role name por índice de par.
  const [addParent, setAddParent] = useState('');
  const [addChild, setAddChild] = useState('');
  const [roleDrafts, setRoleDrafts] = useState<Record<number, string>>({});

  const rel = diagram?.relationships.find((r) => r.id === relId);
  const cols = diagram?.columns ?? [];
  const parentTable = diagram?.tables.find((t) => t.id === rel?.parentTableId);
  const childTable = diagram?.tables.find((t) => t.id === rel?.childTableId);
  const colById = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols]);
  const parentOpts = useMemo(() => (rel ? parentCandidates(cols, rel.parentTableId) : []), [cols, rel]);
  const childOpts = useMemo(() => (rel ? childCandidates(cols, rel.childTableId) : []), [cols, rel]);
  if (!rel) return null;

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

  // ── Pares (PK compuesta) ──
  const addPair = () => {
    const err = addChild === NEW_COL ? (addParent ? null : 'Pick both columns') : pairError(rel, addParent, addChild);
    if (err) { pushToast(err, 'err'); return; }
    void run(async () => {
      let childId = addChild;
      if (addChild === NEW_COL) {
        // "Migrar" la columna del padre: crea la FK en el hijo copiando
        // nombre/tipo/dominio (unificación manual: elegí una existente).
        // OJO: el spread copia campos del PADRE — pkPosition se fija aparte
        // (posición en la llave del HIJO, no la del padre).
        const src = colById.get(addParent);
        if (!src) throw new Error('Parent column does not exist');
        childId = crypto.randomUUID();
        const physical = (await gov.physicalize(src.logicalName)).physical;
        await gov.createColumn({
          ...src, id: childId, tableId: rel.childTableId,
          logicalName: src.logicalName, physicalName: physical,
          isForeignKey: true, isPrimaryKey: rel.identifying,
          pkPosition: rel.identifying ? nextPkPosition(childOpts) : null,
          isNullable: rel.identifying ? false : true,
          ordinal: childOpts.length,
        });
        // V1: la columna migrada entra también a las vistas ESPEJO del hijo.
        try {
          await syncNewColumnToMirrorViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            rel.childTableId, physical, childOpts);
        } catch { /* best-effort */ }
      }
      await gov.updateRelationship({
        ...rel, pairs: [...rel.pairs, { parentColumnId: addParent, childColumnId: childId }],
      });
      const child = childId === addChild ? colById.get(childId) : null;
      if (child) {
        await gov.markForeignKey(child, rel.identifying,
          rel.identifying ? nextPkPosition(childOpts, child.id) : undefined);
      }
      setAddParent(''); setAddChild('');
      await reload();
      pushToast('Pair added to the relationship');
    }, "Couldn't add the pair");
  };

  const removePair = (i: number) => {
    if (rel.pairs.length <= 1) return; // el último par = borrar la relación
    void run(async () => {
      const removed = rel.pairs[i];
      await gov.updateRelationship({ ...rel, pairs: rel.pairs.filter((_, k) => k !== i) });
      // Limpieza del flag FK de la columna hija sacada, si ya no es hija en
      // ninguna relación (mismo criterio conservador que al borrar la relación).
      const col = colById.get(removed.childColumnId);
      if (col?.isForeignKey) {
        // `near` es el estado efectivo POST-update (el par ya no está).
        const near = await gov.listRelationships(col.tableId);
        const still = near.some((r) => r.pairs.some((p) => p.childColumnId === col.id));
        if (!still) await gov.updateColumn({ ...col, isForeignKey: false });
      }
      await reload();
      pushToast('Par quitado');
    }, "Couldn't remove the pair");
  };

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
      if (!cur) throw new Error('Columna hija inexistente');
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
        pushToast(`Role name aplicado: “${cur.physicalName}” renombrada a “${physical}”`);
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
        pushToast(`Split: created “${physical}” in ${childTable?.physicalName ?? 'the child'} — this pair now points there`);
      }
      setRoleDrafts((d) => ({ ...d, [i]: '' }));
      await reload();
    }, "Couldn't apply the role name");
  };

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

      {/* Pares migrados (PK compuesta) + role name por par */}
      <div className="wk-props-field"><label>Migrated columns · {rel.pairs.length} par{rel.pairs.length === 1 ? '' : 'es'}</label>
        <div className="wk-relpairs">
          {rel.pairs.map((p, i) => (
            <div className="wk-relpair" key={`${p.parentColumnId}-${p.childColumnId}`}>
              <div className="wk-relpair-cols">
                <span className="rd-mono">{colName(p.parentColumnId)}</span>
                <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                <span className="rd-mono">{colName(p.childColumnId)}</span>
                {canEdit && (
                  <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }}
                    disabled={locked || rel.pairs.length <= 1}
                    title={rel.pairs.length <= 1 ? "It's the last pair: delete the relationship instead" : 'Remove pair'}
                    onClick={() => removePair(i)}>
                    <Trash2 size={12} />
                  </button>
                )}
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
          {canEdit && (
            <div className="wk-relpair-add">
              <select className="rd-input" disabled={locked} value={addParent} onChange={(e) => setAddParent(e.target.value)}>
                <option value="">parent PK column…</option>
                {parentOpts.map((c) => <option key={c.id} value={c.id}>{c.physicalName}</option>)}
              </select>
              <span style={{ color: 'var(--text-muted-3)' }}>→</span>
              <select className="rd-input" disabled={locked} value={addChild} onChange={(e) => setAddChild(e.target.value)}>
                <option value="">child column…</option>
                <option value={NEW_COL}>➕ create new column (migrate the parent one)</option>
                {childOpts.map((c) => <option key={c.id} value={c.id}>{c.physicalName}</option>)}
              </select>
              <button type="button" className="rd-btn rd-btn-sm" disabled={locked || !addParent || !addChild} onClick={addPair}>
                <Plus size={13} /> Par
              </button>
            </div>
          )}
        </div>
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
