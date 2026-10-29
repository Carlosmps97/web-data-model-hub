import { useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { distinctNames, facetName, facetNouns } from '@/lib/facets';
import { useSessionStore } from '@/store/useSessionStore';
import { historyAction, pushUndo } from '@/store/useUndoStore';
import * as gov from '@/services/governance.service';
import type { Cardinality, CanonicalColumn } from '@/services/governance.service';
import {
  buildKeyMapping, demotablePkChildren, mappingToBulk, relationshipDrift, roleNamePlan, syncMappingInput,
  type MappingResolution,
} from '@/features/modeler/lib/relationshipPairs';
import { pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { pkFirstOrdinals } from '../lib/columnOrder';
import { keyLayoutBulk } from '../lib/keyLayout';
import { syncNewColumnToMirrorViews, syncNewColumnsToMirrorViews, syncRenamedColumnInViews } from '@/features/modeler/lib/viewSync';
import { bestEffort, pinnedViewDeps, relationshipTypeStep } from '../lib/pinnedWrites';
import { phraseEdits, roleAppliedText } from '../lib/relationshipLabel';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import KeyMappingRows, { type KeyRowState } from './KeyMappingRows';
import RelationshipPhraseFields, { type PhraseKey } from './RelationshipPhraseFields';

export const CARDS: { v: Cardinality; lbl: string }[] = [
  { v: 'one', lbl: 'One' }, { v: 'many', lbl: 'Many' }, { v: 'one-only', lbl: 'Exactly one' },
  { v: 'zero-one', lbl: 'Zero or one' }, { v: 'one-many', lbl: 'One or more' }, { v: 'zero-many', lbl: 'Zero or more' },
];

/**
 * Popup de edición de relación: tipo Identifying/Non-identifying (con
 * propagación de flags PK), cardinalidades, mapa de solo lectura de pares (N=N
 * por construcción; no hay alta manual de pares) con Role name por par (rename
 * in place, o split si la columna está unificada), el banner de drift con
 * "Sync with parent key" cuando la llave del padre no coincide con la migrada, y las frases de
 * relación (la etiqueta del wire), con su botón Apply.
 */
export default function RelationshipPopup({ relId, onClose, pushToast }: { relId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const diagram = useModelerStore((s) => s.diagram);
  const updateRelationship = useModelerStore((s) => s.updateRelationship);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  const reload = useModelerStore((s) => s.reload);
  // Nombres del modelo del canvas (entidades/atributos en el lógico).
  const viewMode = useModelerStore((s) => s.viewMode);
  const nouns = facetNouns(viewMode);
  // En modo visor puede haber changeset activo (viendo un request): reader-only.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  const [saving, setSaving] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<number, string>>({});
  // Borradores de las frases (ausente = sin tocar → se ve la vigente).
  const [phraseDrafts, setPhraseDrafts] = useState<Partial<Record<PhraseKey, string>>>({});
  // Modo sync: re-mapeo de la llave tras un drift del padre.
  const [syncing, setSyncing] = useState(false);
  const [syncRows, setSyncRows] = useState<KeyRowState[]>([]);

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
  // Por tabla: los lógicos repetidos se distinguen por su físico.
  const shownCol = new Map([
    ...distinctNames(cols.filter((c) => c.tableId === rel.parentTableId), viewMode),
    ...distinctNames(childOpts, viewMode),
  ]);
  const colName = (id: string) => shownCol.get(id) ?? (colById.has(id) ? facetName(colById.get(id), viewMode) : id);
  // El fallo de una escritura espera la revalidación y calla si la sesión
  // cambia (`reportWriteError`: el aviso lo da la revalidación).
  const run = async (fn: () => Promise<void>, err: string) => {
    setSaving(true);
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : err, 'err'));
    try { await fn(); } catch (e) { await onError(e); }
    finally { setSaving(false); }
  };

  // ── Tipo (identifying ↔ non-identifying) con propagación de flags PK ──
  const setType = (identifying: boolean) => {
    if (identifying === rel.identifying) return;
    void run(() => historyAction(async () => {
      // La acción pertenece a la sesión donde empezó.
      const pin = pinSession();
      // Pre-imágenes para el Undo: la relación + las columnas hijas
      // de sus pares (la propagación de abajo solo toca esas: promoción a PK
      // o demote conservador).
      const relPre = { ...rel, pairs: rel.pairs.map((p) => ({ ...p })) };
      const colPres = rel.pairs
        .map((p) => colById.get(p.childColumnId))
        .filter((c): c is CanonicalColumn => !!c)
        .map((c) => ({ ...c }));
      await gov.updateRelationship({ ...rel, identifying });
      // Los hijos que entran/salen de la llave quedan en la frontera del bloque
      // de PK y las columnas que se corren viajan en el mismo lote.
      const patches: Record<string, Partial<CanonicalColumn>> = {};
      if (identifying) {
        // Como en Erwin, la FK entra a la PK del hijo: se promueven todos los pares.
        for (const p of rel.pairs) {
          const c = colById.get(p.childColumnId);
          if (c && (!c.isPrimaryKey || c.isNullable !== false)) patches[c.id] = { isForeignKey: true, isPrimaryKey: true, isNullable: false };
        }
      } else {
        // Demote conservador: no pisa PKs sostenidas por otra rel identifying.
        const near = await gov.listRelationships(rel.childTableId);
        for (const cid of demotablePkChildren(rel, near.filter((r) => r.id !== rel.id))) {
          if (colById.get(cid)?.isPrimaryKey) patches[cid] = { isPrimaryKey: false };
        }
      }
      const { changes: keyChanges, pres: keyPres } = keyLayoutBulk(childOpts, patches);
      pin.check();
      if (keyChanges.length) await gov.recordChangesBulk(keyChanges);
      const n = Object.keys(patches).length;
      pushToast(identifying ? `Identifying: child ${nouns.members} promoted to PK`
        : n ? `Non-identifying: ${n} child ${nouns.member}(s) leave the PK` : 'Non-identifying');
      const undoCols = [...colPres, ...keyPres.filter((p) => !colPres.some((c) => c.id === p.id))];
      // Deshacer en un lote (la relación y las columnas como estaban); rehacer en
      // un lote, o como esta acción si la relación es recursiva.
      pushUndo('Edit relationship', relationshipTypeStep(
        [...undoCols.map((c) => gov.bulk.createColumn(c)), gov.bulk.upsertRelationship(relPre)],
        { ...relPre, identifying }, keyChanges, reload,
      ), pin);
      await reload();
    }), "Couldn't update");
  };

  const setCard = (end: 'parent' | 'child', v: Cardinality) =>
    void run(async () => {
      await updateRelationship(end === 'parent'
        ? { ...rel, parentCardinality: v } : { ...rel, childCardinality: v });
    }, "Couldn't update");

  // ── Frases de relación: Apply graba las dos en un solo guardado ──
  const pendingPhrases = phraseEdits(rel, phraseDrafts);
  const applyPhrases = () => {
    if (!pendingPhrases) return;               // sin cambio real: cero requests
    void run(async () => {
      // Por el store: marca dirty, deja el Undo y recarga el diagrama. Si
      // falla, los borradores quedan en las cajas y Apply sigue activo.
      await updateRelationship({ ...rel, ...pendingPhrases });
      setPhraseDrafts({});
    }, "Couldn't update");
  };

  // ── Role name (como en Erwin): rename in place, o split si está unificada ──
  const applyRole = (i: number) => {
    const name = (roleDrafts[i] ?? '').trim();
    if (!name) { pushToast('Type the role name', 'err'); return; }
    void run(async () => {
      // Lee y después escribe varias veces, todo en la sesión donde empezó:
      // cada escritura verifica el pin.
      const pin = pinSession();
      // Plan con el slice global de la tabla hija (la unificación puede venir
      // de una relación de otro canvas).
      const near = await gov.listRelationships(rel.childTableId);
      const inNear = near.find((r) => r.id === rel.id);
      const plan = roleNamePlan(inNear ?? rel, i, near.length ? near : [rel]);
      const cur = colById.get(rel.pairs[i].childColumnId);
      if (!cur) throw new Error(`Child ${nouns.member} no longer exists`);
      const physical = (await gov.physicalize(name)).physical;
      if (plan.kind === 'rename') {
        pin.check();
        await gov.updateColumn({ ...cur, logicalName: name, physicalName: physical });
        // Las vistas referencian por nombre: re-apuntar sources al nuevo físico.
        await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), rel.childTableId, cur.physicalName, physical));
        pin.check();
        await gov.updateRelationship({
          ...rel,
          pairs: rel.pairs.map((p, k) => (k === i ? { ...p, roleName: name } : p)),
        });
        pushToast(roleAppliedText(cur, name, physical, viewMode));
      } else {
        // Split: la columna está compartida (unificada); se crea otra con el
        // role name y este par se repunta; la original queda para el resto. En
        // una identificante la columna creada es PK y entra tras la última PK
        // del hijo (las no-PK se corren en el mismo lote).
        const newId = crypto.randomUUID();
        const layout = rel.identifying ? pkFirstOrdinals(childOpts, { toKey: [newId], add: [{ id: newId }] }) : null;
        const created: CanonicalColumn = {
          ...cur, id: newId, logicalName: name, physicalName: physical,
          isForeignKey: true, isPrimaryKey: rel.identifying,
          isNullable: rel.identifying ? false : cur.isNullable,
          ordinal: layout ? layout.get(newId)! : childOpts.length,
        };
        const shifts = childOpts.filter((c) => layout?.has(c.id)).map((c) => gov.bulk.createColumn({ ...c, ordinal: layout!.get(c.id)! }));
        pin.check();
        if (shifts.length) await gov.recordChangesBulk([gov.bulk.createColumn(created), ...shifts]);
        else await gov.createColumn(created);
        // La columna del split entra también a las vistas espejo del hijo.
        await bestEffort(() => syncNewColumnToMirrorViews(pinnedViewDeps(pin), rel.childTableId, physical, childOpts, rel.identifying));
        pin.check();
        await gov.updateRelationship({
          ...rel,
          pairs: rel.pairs.map((p, k) => (k === i ? { ...p, childColumnId: newId, roleName: name } : p)),
        });
        pushToast(`Split: created "${facetName({ logicalName: name, physicalName: physical }, viewMode)}" in ${childTable ? facetName(childTable, viewMode) : 'the child'} — this pair now points there`);
      }
      setRoleDrafts((d) => ({ ...d, [i]: '' }));
      await reload();
    }, "Couldn't apply the role name");
  };

  // ── Sync con la llave del padre ──
  const startSync = () => {
    const pkIdSet = new Set(parentPksNow.map((c) => c.id));
    const kept = rel.pairs.filter((p) => pkIdSet.has(p.parentColumnId));
    const claimed = new Set(kept.map((p) => p.childColumnId));
    const free = childOpts.filter((c) => !claimed.has(c.id));
    setSyncRows(parentPksNow.map((pk) => {
      const pair = kept.find((p) => p.parentColumnId === pk.id);
      if (pair) return { parentColumnId: pk.id, target: { kind: 'existing' as const, columnId: pair.childColumnId }, roleName: '', inherit: true, locked: true };
      const [auto] = buildKeyMapping([pk], free);
      return { parentColumnId: pk.id, target: auto.target, roleName: '', inherit: true };
    }));
    setSyncing(true);
  };

  const applySync = () => void run(async () => {
    const pin = pinSession();   // lee y después escribe varias veces
    const pkIdSet = new Set(parentPksNow.map((c) => c.id));
    const pkById = new Map(parentPksNow.map((c) => [c.id, c]));
    const keptRole = new Map(rel.pairs.map((p) => [p.parentColumnId, p.roleName ?? undefined]));
    const resolutions: MappingResolution[] = await Promise.all(syncRows.map(async (r) => {
      const parentCol = pkById.get(r.parentColumnId);
      if (!parentCol) throw new Error('Parent key changed — reopen the popup');
      if (r.target.kind === 'existing') {
        const c = colById.get(r.target.columnId);
        if (!c) throw new Error(`Child ${nouns.member} no longer exists`);
        if (r.locked) {
          const role = keptRole.get(r.parentColumnId);
          return { parentCol, inherit: r.inherit, target: { kind: 'existing' as const, col: c, preexisting: true },
                   ...(role ? { roleName: role } : {}) };
        }
        // Role name sobre existente = rename in place (semántica del Apply).
        const role = r.roleName.trim();
        const rename = role && role !== c.logicalName
          ? { logicalName: role, physicalName: (await gov.physicalize(role)).physical }
          : undefined;
        return { parentCol, inherit: r.inherit,
          target: { kind: 'existing' as const, col: c, ...(rename ? { rename } : {}) },
          ...(role ? { roleName: role } : {}) };
      }
      const logical = (r.roleName.trim() || parentCol.logicalName).trim();
      const { physical } = await gov.physicalize(logical);
      return { parentCol, inherit: r.inherit,
               target: { kind: 'create' as const, id: crypto.randomUUID(), logicalName: logical, physicalName: physical },
               ...(r.roleName.trim() ? { roleName: r.roleName.trim() } : {}) };
    }));
    // El Sync re-emite la relación campo por campo: syncMappingInput lleva
    // todo lo que vive a nivel de relación (frases incluidas).
    const { changes, createdCols } = mappingToBulk(syncMappingInput(rel, resolutions, childOpts));
    // Pares que se quitan (su PK dejó de existir en el padre): limpieza
    // conservadora del flag FK, misma regla que el delete de relación.
    const near = await gov.listRelationships(rel.childTableId);
    for (const p of rel.pairs.filter((pp) => !pkIdSet.has(pp.parentColumnId))) {
      const c = colById.get(p.childColumnId);
      if (!c?.isForeignKey) continue;
      const still = near.some((r2) => r2.id !== rel.id && r2.pairs.some((q) => q.childColumnId === c.id));
      if (still) continue;
      // Una columna viaja una sola vez por lote: si el orden único ya la
      // corrió, el flag se suma a ese mismo cambio.
      const prev = changes.find((ch) => ch.collection === 'canonical_columns' && ch.entityId === c.id);
      if (prev) prev.payload = { ...prev.payload, isForeignKey: false };
      else changes.push(gov.bulk.createColumn({ ...c, isForeignKey: false }));
    }
    pin.check();
    await gov.recordChangesBulk(changes);
    await syncNewColumnsToMirrorViews(pinnedViewDeps(pin), rel.childTableId, createdCols, childOpts);
    for (const r of resolutions) {
      if (r.target.kind !== 'existing' || !r.target.rename) continue;
      const { col, rename } = r.target;
      await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), rel.childTableId, col.physicalName, rename.physicalName,
        { createdIds: createdCols.map((c) => c.id) }));
    }
    setSyncing(false);
    useModelerStore.getState().markDirty();
    await reload();
    pushToast('Relationship synced with the parent key');
  }, "Couldn't sync the relationship");

  const remove = async () => {
    const onError = reportWriteError(() => pushToast("Couldn't delete the relationship", 'err'));
    try {
      const ok = await confirmDialog({
        title: 'Delete relationship',
        message: 'This relationship will be removed from the model.',
        confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger',
        action: () => deleteRelationship(relId),
      });
      if (ok) { pushToast('Relationship deleted'); onClose(); }
    } catch (e) { await onError(e); }
  };

  const removedPairs = rel.pairs.filter((p) => !parentPksNow.some((c) => c.id === p.parentColumnId));

  return (
    <Modal title="Relationship" icon="link" size="lg" onClose={onClose}>
      {/* Parent → Child */}
      <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="wk-pp-role parent">PARENT</span>
        <span className="rd-mono">{parentTable ? facetName(parentTable, viewMode) : rel.parentTableId}</span>
        <span style={{ color: 'var(--text-muted-3)' }}>→</span>
        <span className="wk-pp-role child">CHILD</span>
        <span className="rd-mono">{childTable ? facetName(childTable, viewMode) : rel.childTableId}</span>
      </div>

      {/* Drift: la llave migrada no calza con la PK actual del padre.
          En rojo: es una incongruencia a corregir. Sin PK en el padre no hay
          contra qué sincronizar: el Sync se oculta. */}
      {drift && canEdit && !syncing && (
        <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          background: 'var(--red-tint)', border: '1px solid var(--red-border)', borderRadius: 8, padding: '8px 12px' }}>
          <span style={{ flex: 1 }}>
            {parentPksNow.length > 0 ? (
              <>Key drift — this relationship is out of sync with the parent key
                ({drift.missing.length} missing / {drift.extra.length} stale pair{drift.extra.length === 1 ? '' : 's'}).</>
            ) : (
              <>Key drift — the parent {nouns.one} has NO primary key. Define the parent&apos;s key first, then sync.</>
            )}
          </span>
          {parentPksNow.length > 0 && (
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={locked} onClick={startSync}>Sync with parent key</button>
          )}
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

      <RelationshipPhraseFields
        values={{
          parentToChildPhrase: phraseDrafts.parentToChildPhrase ?? rel.parentToChildPhrase ?? '',
          childToParentPhrase: phraseDrafts.childToParentPhrase ?? rel.childToParentPhrase ?? '',
        }}
        onChange={(key, value) => setPhraseDrafts((d) => ({ ...d, [key]: value }))}
        onApply={applyPhrases}
        canApply={pendingPhrases != null}
        locked={locked}
      />

      {syncing ? (
        /* ── Modo sync: re-mapeo N=N contra la llave vigente del padre ── */
        <div className="wk-props-field">
          <label>Sync with parent key · parent key has {parentPksNow.length} {parentPksNow.length === 1 ? nouns.member : nouns.members} · "Inherit" copies the parent's definition, UDPs and metadata</label>
          <KeyMappingRows parentPks={parentPksNow} childCols={childOpts} rows={syncRows} onChange={setSyncRows} locked={locked} mode={viewMode} />
          {removedPairs.map((p) => (
            <div key={p.childColumnId} className="rd-small" style={{ color: 'var(--red)', padding: '4px 2px' }}>
              {colName(p.parentColumnId)} → {colName(p.childColumnId)} — will be removed
            </div>
          ))}
          <div className="m-foot">
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={locked} onClick={() => setSyncing(false)}>Cancel</button>
            <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" disabled={locked} onClick={applySync}>
              {saving && <span className="rd-spin" aria-hidden />}
              {saving ? 'Syncing…' : 'Apply sync'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Mapa de solo lectura de pares (N=N) + role name por par ── */
        <div className="wk-props-field"><label>Key migration · {rel.pairs.length} pair{rel.pairs.length === 1 ? '' : 's'}</label>
          <div className="wk-relpairs">
            {rel.pairs.map((p, i) => (
              <div className="wk-relpair" key={`${p.parentColumnId}-${p.childColumnId}`}>
                <div className="wk-relpair-cols">
                  <span className="rd-mono" title={colName(p.parentColumnId)}>{colName(p.parentColumnId)}</span>
                  <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                  <span className="rd-mono" title={colName(p.childColumnId)}>{colName(p.childColumnId)}</span>
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
                    <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={locked || !(roleDrafts[i] ?? '').trim()}
                      title={`Apply role name: renames the child FK (or creates a new ${nouns.member} if it is shared)`}
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
