import { useEffect, useMemo, useState } from 'react';
import { facetNouns } from '@/lib/facets';
import { KeyRound, Link2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import * as gov from '@/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
import { pushUndo } from '@/store/useUndoStore';
import { collapseComplexType, isComplexType } from '../lib/complexTypes';
import { pasteColumnsToBulk, pastePlan, pastePreImages } from '../lib/pasteColumns';
import { pinnedViewDeps, undoColumnsBatch } from '../lib/pinnedWrites';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { invertBulk } from '../lib/undoInvert';
import { syncNewColumnsToMirrorViews } from '../lib/viewSync';

/**
 * Confirmación del PASTE de columnas (doc 48): staging local — nada persiste
 * hasta Confirm. Las filas con nombre FÍSICO duplicado en el destino quedan
 * bloqueadas automáticamente (se excluyen del lote — regla owner, espejo del
 * guard 409 del backend); el duplicado solo-lógico es warning y se pega igual.
 * Confirm = UN PUT /changes/bulk + vistas espejo best-effort (mismo patrón
 * que RelationshipCreatePopup).
 */
export default function PasteColumnsPopup({ targetId, onClose, pushToast }: {
  targetId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const clipboard = useModelerStore((s) => s.colClipboard);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // doc 85: Entity/Attribute vs Table/Column
  // Doc 105 (ronda 6, R17a-11): el nombre según la faceta (en Lógico mostraba el físico).
  const shown = (t: { logicalName?: string; physicalName: string }) => (viewMode === 'logical' ? t.logicalName || t.physicalName : t.physicalName);
  const [saving, setSaving] = useState(false);

  const target = diagram?.tables.find((t) => t.id === targetId);
  const targetCols = useMemo(
    () => (diagram?.columns ?? []).filter((c) => c.tableId === targetId),
    [diagram, targetId]);
  const plan = useMemo(() => pastePlan(clipboard?.cols ?? [], targetCols), [clipboard, targetCols]);
  const pasteable = useMemo(() => plan.filter((r) => !r.blocked), [plan]);
  const bringsPk = pasteable.some((r) => r.col.isPrimaryKey);
  const targetIsParent = (diagram?.relationships ?? []).some((r) => r.parentTableId === targetId);

  // Un reload concurrente pudo llevarse el destino (o el clipboard murió por
  // cambio de contexto): cerrar en vez de quedar montado en vacío.
  const missing = !clipboard?.cols.length || !target;
  useEffect(() => { if (missing) onClose(); }, [missing, onClose]);
  if (missing || !target) return null;

  const confirm = async () => {
    setSaving(true);
    // Doc 105 (H1): la acción es de la sesión donde empezó (sus escrituras y su
    // inversa cortan si cambió); un fallo espera la revalidación (H7).
    const pin = pinSession();
    // 409 por carrera multiusuario u otro error: el lote es atómico (nada
    // quedó a medias) — mensaje visible y el popup NO se cierra.
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : `Couldn't paste the ${n.members}`, 'err'));
    try {
      const cols = pasteable.map((r) => r.col);
      const changes = pasteColumnsToBulk({
        targetTableId: targetId, cols, targetCols,
        // Procedencia (doc 51): la tabla fuente viaja en el clipboard.
        sourceTable: clipboard.source.physicalName || clipboard.source.logicalName || undefined,
      });
      await gov.recordChangesBulk(changes);
      // Undo (doc 50): las columnas pegadas se borran y las del destino que el
      // lote corrió (doc 94: PK pegadas ⇒ PK primero) vuelven a su ordinal
      // (+ retirar las pegadas de las vistas espejo, best-effort).
      const inverse = invertBulk(changes, pastePreImages(targetCols));
      pushUndo(`Paste ${cols.length} ${cols.length === 1 ? n.member : n.members}`, undoColumnsBatch({
        inverse, tableId: targetId, created: cols.map((c) => c.physicalName),
        after: () => useModelerStore.getState().reload(),
      }), pin);
      // V1 (decisión owner i): las columnas pegadas entran también a las
      // vistas ESPEJO del destino — misma baseline para todas las columnas
      // del lote (patrón RelationshipCreatePopup), best-effort.
      // Doc 94 D4: las PK pegadas entran tras las PK del destino, en su orden.
      await syncNewColumnsToMirrorViews(pinnedViewDeps(pin), targetId, cols, targetCols);
      useModelerStore.getState().markDirty();
      await useModelerStore.getState().reload();
      pushToast(`${cols.length} ${cols.length === 1 ? n.member : n.members} pasted into ${shown(target)}`);
      onClose();
    } catch (e) {
      await onError(e);
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Paste ${n.members}`} icon="columns" size="lg"
      subtitle={`${shown(clipboard.source)} → ${shown(target)}`}
      onClose={() => { if (!saving) onClose(); }}>
      <p className="wk-pp-cap" style={{ marginTop: 0 }}>
        Each {n.member} is pasted with its full metadata — definition, PK/FK/nullable/partition flags,
        UDPs, domain and type. Relationships are not copied. Rows whose physical name already
        exists in the target are skipped automatically.
      </p>
      <div className="wk-paste-list">
        {plan.map((r) => (
          <div key={r.col.id} className={`wk-paste-row${r.blocked ? ' blocked' : ''}`}>
            <span className="wk-node-key" aria-hidden>
              {r.col.isPrimaryKey ? (
                <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)' }} />
              ) : r.col.isForeignKey ? (
                <Link2 size={11} strokeWidth={2} style={{ color: 'var(--k-fk)' }} />
              ) : null}
            </span>
            <span className="wk-paste-name" title={`${r.col.logicalName} · ${r.col.physicalName}`}>
              <span>{r.col.logicalName}</span>
              <span className="rd-mono wk-paste-phys">{r.col.physicalName}</span>
            </span>
            <span className="wk-paste-dt rd-mono" title={isComplexType(r.col.dataType) ? r.col.dataType : undefined}>
              {collapseComplexType(r.col.dataType)}
            </span>
            {r.blocked ? (
              <span className="wk-paste-tag blocked">Name exists — skipped</span>
            ) : r.logicalDup ? (
              <span className="wk-paste-tag warn"
                title={`${n.aMember[0].toUpperCase()}${n.aMember.slice(1)} with the same logical name already exists in the target — it will be pasted anyway`}>
                Logical name exists
              </span>
            ) : (
              <span className="wk-paste-tag ok">New</span>
            )}
          </div>
        ))}
      </div>
      {bringsPk && (
        <p className="wk-pp-cap" style={{ marginBottom: 0 }}>
          Includes key {n.members} — they join the end of the target&apos;s primary key.
          {targetIsParent ? ' Relationships born from this table will show drift (amber) until synced.' : ''}
        </p>
      )}
      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="button" className="rd-btn rd-btn-primary rd-btn-sm"
          disabled={saving || pasteable.length === 0} onClick={() => void confirm()}>
          {saving && <span className="rd-spin" aria-hidden />}
          {saving ? 'Pasting…' : `Paste ${pasteable.length} ${pasteable.length === 1 ? n.member : n.members}`}
        </button>
      </div>
    </Modal>
  );
}
