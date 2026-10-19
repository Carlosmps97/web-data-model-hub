import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { facetNouns, type Facet } from '@/lib/facets';
import { getUdpDefs } from '@/features/standards/standards.service';
import * as gov from '@/services/governance.service';
import { getNamingConfig } from '@/services/naming.service';
import { listThemes } from '@/services/themes.service';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import { tableNamesTaken, useModelerStore } from '@/store/useModelerStore';
import { copyNameBase, pasteNames } from '../lib/copyTable';
import { ALL_COPY, reviewPaste, type PasteOptions, type PasteStandards, type PasteTarget } from '../lib/pasteReview';
import { reportWriteError } from '../lib/sessionGuard';
import { loadSourceStandards } from '../services/pasteSource.service';
import * as schemasSvc from '../services/schemas.service';
import PasteDetails from './PasteDetails';

/** Los físicos tomados que son la tabla o una de sus copias (`X`, `X_copy_n`),
 *  sin repetir y en orden natural — el aviso de duplicado los nombra. Pura. */
export function existingCopies(physicalName: string, taken: string[]): string[] {
  const base = copyNameBase(physicalName, 'physical').toLowerCase();
  const mine = (t: string) => {
    const low = t.trim().toLowerCase();
    return low === base || (low.startsWith(`${base}_copy_`) && /^\d+$/.test(low.slice(base.length + 6)));
  };
  const byLow = new Map<string, string>();
  for (const t of taken) if (mine(t) && !byLow.has(t.trim().toLowerCase())) byLow.set(t.trim().toLowerCase(), t.trim());
  return [...byLow.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * «Paste table» (doc 118): antes de pegar muestra el nombre final (con el aviso
 * si ya existe y se crea como copy n), qué viaja de cada faceta y qué no se
 * puede copiar; los checks deciden UDPs y parent domains. Lo copiado en OTRO
 * proyecto se revisa contra los estándares de los dos (los del origen, de su
 * snapshot). Confirmar graba exactamente lo que se mostró (`pasteTable(prepared)`).
 */
export default function PasteTablePopup({ onClose, pushToast }: {
  onClose: () => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const clip = useModelerStore((s) => s.tblClipboard);
  const viewMode = useModelerStore((s) => s.viewMode);
  const sessionPid = useSessionStore((s) => s.activeProjectId);
  const n = facetNouns(viewMode);
  // Copiado en otro proyecto: el origen se nombra y sus estándares se leen aparte.
  const fromName = clip?.source?.projectId && clip.source.projectId !== sessionPid ? clip.source.projectName || 'another project' : '';
  const [facet, setFacet] = useState<Facet>(viewMode);
  const [options, setOptions] = useState<PasteOptions>(ALL_COPY);
  const [data, setData] = useState<{ target: PasteTarget; taken: string[]; same: boolean; source: PasteStandards | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const pasteRef = useRef<HTMLButtonElement>(null);

  // Sin clipboard (se vació al cerrar sesión) no hay nada que revisar.
  const missing = !clip;
  useEffect(() => { if (missing) onClose(); }, [missing, onClose]);

  useEffect(() => {
    if (!clip) return undefined;
    let alive = true;
    setData(null);
    setError(null);
    (async () => {
      const pid = sessionProjectId();
      const srcPid = clip.source?.projectId ?? pid;
      const same = srcPid === pid;
      const [udpDefs, domains, themes, schemas, naming, taken, source] = await Promise.all([
        getUdpDefs(pid), gov.listDomains(), listThemes(pid), schemasSvc.listSchemas(), getNamingConfig(pid),
        tableNamesTaken(clip.table.physicalName), same ? null : loadSourceStandards(srcPid),
      ]);
      if (alive) setData({ target: { udpDefs, domains, themes, schemas, naming }, taken, same, source });
    })().catch((e: unknown) => { if (alive) setError(e instanceof Error && e.message ? e.message : 'Unknown error'); });
    return () => { alive = false; };
  }, [clip, attempt]);

  const names = useMemo(() => (clip && data ? pasteNames(clip.table, data.taken) : null), [clip, data]);
  const review = useMemo(() => (clip && data && names
    ? reviewPaste({
      table: { ...clip.table, physicalName: names.physicalName, logicalName: names.logicalName },
      cols: clip.cols, source: data.source ?? data.target, target: data.target, sameProject: data.same, options, nouns: n,
      sourceUnavailable: !data.same && !data.source, sourceName: clip.source?.projectName,
    })
    : null), [clip, data, names, options, n]);

  const ready = !!review && !error;
  // Listo para pegar: Enter pega (el foco va al botón; en el buscador, Enter no pega).
  useEffect(() => { if (ready) pasteRef.current?.focus(); }, [ready]);

  if (missing) return null;
  const copies = names?.renamed && data ? existingCopies(clip.table.physicalName, data.taken) : [];

  const confirm = async () => {
    if (!review?.payload.table || saving) return;
    setSaving(true);
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : `Couldn't paste the ${n.one}`, 'err'));
    try {
      const name = await useModelerStore.getState().pasteTable({
        table: review.payload.table, cols: review.payload.cols, createSchema: review.payload.createSchema,
      });
      if (name) pushToast(`${n.One} pasted as ${name}`);
      onClose();
    } catch (e) {
      await onError(e);
      // Lo que falló (otro tomó el nombre o el esquema, un tope de largo) se
      // revisa de nuevo con los datos de ahora.
      setAttempt((a) => a + 1);
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Paste ${n.one}`} icon="columns" size="lg"
      subtitle={`${viewMode === 'logical' ? clip.table.logicalName || clip.table.physicalName : clip.table.physicalName}${fromName ? ` from «${fromName}»` : ''} → this canvas`}
      onClose={() => { if (!saving) onClose(); }}>
      {error ? (
        <div className="wk-paste-note err" role="alert">
          <strong>Couldn&apos;t read the standards</strong>
          <ul><li>{error}</li></ul>
        </div>
      ) : !ready || !names ? (
        <p className="wk-pp-cap"><span className="rd-spin" aria-hidden /> Checking names and standards…</p>
      ) : (
        <>
          <div className="wk-paste-head">
            {names.renamed ? (
              <span>
                Already in this project: {copies.slice(0, 4).join(', ')}{copies.length > 4 ? ` +${copies.length - 4} more` : ''} —
                it will be created as <span className="rd-mono">{names.physicalName}</span>
              </span>
            ) : (
              <span>Keeps its name <span className="rd-mono">{names.physicalName}</span></span>
            )}
            <span className="wk-pp-cap">Logical name: {names.logicalName || '—'}</span>
          </div>
          <PasteDetails review={review} options={options} onOptions={setOptions} facet={facet} onFacet={setFacet} />
        </>
      )}
      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={saving} onClick={onClose}>Cancel</button>
        {error ? (
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => setAttempt(attempt + 1)}>Retry</button>
        ) : (
          <button type="button" ref={pasteRef} className="rd-btn rd-btn-primary rd-btn-sm"
            disabled={!ready || saving || (review?.blockers.length ?? 0) > 0} onClick={() => void confirm()}>
            {saving && <span className="rd-spin" aria-hidden />}
            {saving ? 'Pasting…' : `Paste ${n.one}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
