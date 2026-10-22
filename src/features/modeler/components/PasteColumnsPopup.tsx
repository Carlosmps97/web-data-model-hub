import { useEffect, useMemo, useRef, useState } from 'react';
import { facetNouns, type Facet } from '@/lib/facets';
import Modal from '@/components/ui/Modal';
import { getUdpDefs } from '@/features/standards/standards.service';
import * as gov from '@/services/governance.service';
import { getNamingConfig } from '@/services/naming.service';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { pushUndo } from '@/store/useUndoStore';
import { pasteColumnsToBulk, pastePlan, pastePreImages } from '../lib/pasteColumns';
import { ALL_COPY, reviewPaste, type PasteColumnItem, type PasteOptions, type PasteStandards, type PasteTarget } from '../lib/pasteReview';
import { applyNamingCase } from '../lib/physicalCase';
import { pinnedViewDeps, undoColumnsBatch } from '../lib/pinnedWrites';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { invertBulk } from '../lib/undoInvert';
import { syncNewColumnsToMirrorViews } from '../lib/viewSync';
import { loadSourceStandards } from '../services/pasteSource.service';
import PasteDetails from './PasteDetails';

/**
 * Confirmación del paste de columnas: staging local, nada persiste hasta
 * Confirm. Muestra qué viaja de cada faceta (checks de UDPs y parent domains,
 * detalle por columna) y qué no se puede copiar; lo copiado en otro proyecto se
 * revisa contra los estándares de los dos. Las filas con nombre físico
 * duplicado en el destino (con el case del proyecto) se omiten automáticamente
 * (espejo del guard 409 del backend); el duplicado solo lógico es warning y se
 * pega igual. Confirm = un solo PUT /changes/bulk + vistas espejo best-effort
 * (mismo patrón que RelationshipCreatePopup).
 */
export default function PasteColumnsPopup({ targetId, onClose, pushToast }: {
  targetId: string; onClose: () => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const clipboard = useModelerStore((s) => s.colClipboard);
  const viewMode = useModelerStore((s) => s.viewMode);
  const sessionPid = useSessionStore((s) => s.activeProjectId);
  const n = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  // El nombre según la faceta activa.
  const shown = (t: { logicalName?: string; physicalName: string }) => (viewMode === 'logical' ? t.logicalName || t.physicalName : t.physicalName);
  const [facet, setFacet] = useState<Facet>(viewMode);
  const [options, setOptions] = useState<PasteOptions>(ALL_COPY);
  const [target, setTarget] = useState<PasteTarget | null>(null);
  const [source, setSource] = useState<{ same: boolean; standards: PasteStandards | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const pasteRef = useRef<HTMLButtonElement>(null);

  const table = diagram?.tables.find((t) => t.id === targetId);
  const targetCols = useMemo(
    () => (diagram?.columns ?? []).filter((c) => c.tableId === targetId),
    [diagram, targetId]);

  // Copiado en otro proyecto: el origen se nombra y sus estándares se leen aparte.
  const srcPid = clipboard?.source.projectId ?? null;
  const fromName = srcPid && srcPid !== sessionPid ? clipboard?.source.projectName || 'another project' : '';
  useEffect(() => {
    let alive = true;
    setTarget(null);
    setSource(null);
    setError(null);
    (async () => {
      const pid = sessionProjectId();
      const same = !srcPid || srcPid === pid;
      const [udpDefs, domains, naming, standards] = await Promise.all([
        getUdpDefs(pid), gov.listDomains(), getNamingConfig(pid), same ? null : loadSourceStandards(srcPid),
      ]);
      if (!alive) return;
      setSource({ same, standards });
      setTarget({ udpDefs, domains, themes: [], schemas: [], naming });
    })().catch((e: unknown) => { if (alive) setError(e instanceof Error && e.message ? e.message : 'Unknown error'); });
    return () => { alive = false; };
  }, [attempt, srcPid]);

  // Duplicados contra el destino con el físico definitivo (case del proyecto).
  const plan = useMemo(() => {
    const columnCase = target?.naming?.column?.case;
    const cased = (clipboard?.cols ?? []).map((c) => ({ ...c, physicalName: applyNamingCase(c.physicalName, columnCase) }));
    return pastePlan(cased, targetCols);
  }, [clipboard, targetCols, target]);
  const review = useMemo(() => (clipboard && target && source
    ? reviewPaste({
      cols: clipboard.cols, source: source.standards ?? target, target, sameProject: source.same, options, nouns: n,
      skip: new Set(plan.filter((r) => r.blocked).map((r) => r.col.id)),
      sourceUnavailable: !source.same && !source.standards, sourceName: clipboard.source.projectName,
    })
    : null), [clipboard, target, source, plan, options, n]);
  const status = useMemo(() => new Map(plan.map((r) => [r.col.id, r])), [plan]);
  const pasteable = review?.payload.cols ?? [];
  const bringsPk = pasteable.some((c) => c.isPrimaryKey);
  const targetIsParent = (diagram?.relationships ?? []).some((r) => r.parentTableId === targetId);
  const ready = !!review && !error;
  useEffect(() => { if (ready) pasteRef.current?.focus(); }, [ready]);

  // Un reload concurrente pudo llevarse el destino (o el clipboard se vació al
  // cerrar sesión): cerrar en vez de quedar montado en vacío.
  const missing = !clipboard?.cols.length || !table;
  useEffect(() => { if (missing) onClose(); }, [missing, onClose]);
  if (missing || !table) return null;

  const rowTag = (c: PasteColumnItem) => {
    const r = status.get(c.sourceId);
    if (r?.blocked) return <span className="wk-paste-tag blocked">Name exists — skipped</span>;
    if (r?.logicalDup) {
      return (
        <span className="wk-paste-tag warn"
          title={`${n.aMember[0].toUpperCase()}${n.aMember.slice(1)} with the same logical name already exists in the target — it will be pasted anyway`}>
          Logical name exists
        </span>
      );
    }
    return <span className="wk-paste-tag ok">New</span>;
  };

  const confirm = async () => {
    if (!review || saving) return;
    setSaving(true);
    // La acción pertenece a la sesión donde empezó (sus escrituras y su inversa
    // cortan si la sesión cambia); un fallo espera la revalidación.
    const pin = pinSession();
    // 409 por carrera multiusuario u otro error: el lote es atómico (nada queda
    // a medias); mensaje visible y el popup no se cierra.
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : `Couldn't paste the ${n.members}`, 'err'));
    try {
      const cols = review.payload.cols;
      const changes = pasteColumnsToBulk({
        targetTableId: targetId, cols, targetCols,
        // Procedencia: la tabla fuente viaja en el clipboard, y el físico de
        // origen de cada columna (la pegada sale con el case del destino).
        sourceTable: clipboard.source.physicalName || clipboard.source.logicalName || undefined,
        sourceColumns: new Map(clipboard.cols.map((c) => [c.id, c.physicalName])),
        sourceProject: source && !source.same ? clipboard.source.projectName || clipboard.source.projectId || undefined : undefined,
      });
      await gov.recordChangesBulk(changes);
      // Undo: las columnas pegadas se borran y las del destino que el lote
      // corrió (PK pegadas ⇒ PK primero) vuelven a su ordinal (+ retirar las
      // pegadas de las vistas espejo, best-effort).
      const inverse = invertBulk(changes, pastePreImages(targetCols));
      pushUndo(`Paste ${cols.length} ${cols.length === 1 ? n.member : n.members}`, undoColumnsBatch({
        inverse, tableId: targetId, created: cols.map((c) => c.physicalName),
        after: () => useModelerStore.getState().reload(),
      }), pin);
      // Las columnas pegadas entran también a las vistas espejo del destino:
      // misma baseline para todas las columnas del lote (patrón
      // RelationshipCreatePopup), best-effort. Las PK pegadas entran tras las
      // PK del destino, en su orden.
      await syncNewColumnsToMirrorViews(pinnedViewDeps(pin), targetId, cols, targetCols);
      // Lo que sigue pertenece a la sesión donde se pegó (patrón del CTAS): en
      // otra, ni marca cambios ni recarga ni avisa.
      if (pin.holds()) {
        useModelerStore.getState().markDirty();
        await useModelerStore.getState().reload();
        if (pin.holds()) pushToast(`${cols.length} ${cols.length === 1 ? n.member : n.members} pasted into ${shown(table)}`);
      }
      onClose();
    } catch (e) {
      await onError(e);
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Paste ${n.members}`} icon="columns" size="lg"
      subtitle={`${shown(clipboard.source)}${fromName ? ` from «${fromName}»` : ''} → ${shown(table)}`}
      onClose={() => { if (!saving) onClose(); }}>
      {error ? (
        <div className="wk-paste-note err" role="alert">
          <strong>Couldn&apos;t read the standards</strong>
          <ul><li>{error}</li></ul>
        </div>
      ) : !review ? (
        <p className="wk-pp-cap"><span className="rd-spin" aria-hidden /> Checking names and standards…</p>
      ) : (
        <>
          <p className="wk-pp-cap" style={{ marginTop: 0 }}>
            {n.Members} whose physical name already exists in the target are skipped automatically.
          </p>
          <PasteDetails review={review} options={options} onOptions={setOptions} facet={facet} onFacet={setFacet} rowTag={rowTag} />
          {bringsPk && (
            <p className="wk-pp-cap" style={{ marginBottom: 0 }}>
              Includes key {n.members} — they join the end of the target&apos;s primary key.
              {targetIsParent ? ' Relationships born from this table will show drift (amber) until synced.' : ''}
            </p>
          )}
        </>
      )}
      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={saving} onClick={onClose}>Cancel</button>
        {error ? (
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => setAttempt(attempt + 1)}>Retry</button>
        ) : (
          <button type="button" ref={pasteRef} className="rd-btn rd-btn-primary rd-btn-sm"
            disabled={!ready || saving || pasteable.length === 0 || (review?.blockers.length ?? 0) > 0}
            onClick={() => void confirm()}>
            {saving && <span className="rd-spin" aria-hidden />}
            {saving ? 'Pasting…' : !ready ? `Paste ${n.members}` : `Paste ${pasteable.length} ${pasteable.length === 1 ? n.member : n.members}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
