import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { facetNouns, type Facet } from '@/lib/facets';
import { getUdpDefs } from '@/features/standards/standards.service';
import * as gov from '@/services/governance.service';
import { getNamingConfig } from '@/services/naming.service';
import { listThemes } from '@/services/themes.service';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import { tableNamesTaken, useModelerStore } from '@/store/useModelerStore';
import { GROUP_PASTE_FOREIGN } from '../lib/canvasMenu';
import { groupPasteNames } from '../lib/copyTable';
import { ALL_COPY, reviewPaste, type PasteOptions, type PasteTarget } from '../lib/pasteReview';
import { reportWriteError } from '../lib/sessionGuard';
import * as schemasSvc from '../services/schemas.service';
import PasteDetails, { PasteChecks } from './PasteDetails';

/**
 * «Paste N tables» (doc 134 §3.7): la revisión de «Paste table» para un grupo
 * copiado en este proyecto. Los nombres finales sin repetir entre las tablas del
 * grupo (`groupPasteNames`), los checks una sola vez para todas, el detalle de
 * cada tabla al desplegarla, y un bloqueo de cualquiera deshabilita Paste.
 * Confirmar graba exactamente lo que se mostró, en un solo lote (`pasteTables`).
 */
export default function PasteTablesPopup({ onClose, pushToast }: {
  onClose: () => void; pushToast: (m: string, k?: 'err') => void;
}) {
  const clip = useModelerStore((s) => s.groupClipboard);
  const viewMode = useModelerStore((s) => s.viewMode);
  const sessionPid = useSessionStore((s) => s.activeProjectId);
  const n = facetNouns(viewMode);
  const [facet, setFacet] = useState<Facet>(viewMode);
  const [options, setOptions] = useState<PasteOptions>(ALL_COPY);
  const [data, setData] = useState<{ target: PasteTarget; taken: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const pasteRef = useRef<HTMLButtonElement>(null);

  // Sin portapapeles de grupo (se vació al cerrar sesión) no hay nada que revisar.
  const missing = !clip;
  useEffect(() => { if (missing) onClose(); }, [missing, onClose]);
  const foreign = !!clip?.source.projectId && clip.source.projectId !== sessionPid;

  useEffect(() => {
    if (!clip || foreign) return undefined;
    let alive = true;
    setData(null);
    setError(null);
    (async () => {
      const pid = sessionProjectId();
      const [udpDefs, domains, themes, schemas, naming, taken] = await Promise.all([
        getUdpDefs(pid), gov.listDomains(), listThemes(pid), schemasSvc.listSchemas(), getNamingConfig(pid),
        Promise.all(clip.tables.map((t) => tableNamesTaken(t.table.physicalName))).then((all) => all.flat()),
      ]);
      if (alive) setData({ target: { udpDefs, domains, themes, schemas, naming }, taken });
    })().catch((e: unknown) => { if (alive) setError(e instanceof Error && e.message ? e.message : 'Unknown error'); });
    return () => { alive = false; };
  }, [clip, foreign, attempt]);

  const names = useMemo(() => (clip && data ? groupPasteNames(clip.tables.map((t) => t.table), data.taken) : null), [clip, data]);
  const reviews = useMemo(() => (clip && data && names
    ? clip.tables.map((t, i) => reviewPaste({
      table: { ...t.table, physicalName: names[i].physicalName, logicalName: names[i].logicalName },
      cols: t.cols, source: data.target, target: data.target, sameProject: true, options, nouns: n,
    }))
    : null), [clip, data, names, options, n]);

  const ready = !!reviews && !error && !foreign;
  const blocked = reviews?.some((r) => r.blockers.length > 0) ?? false;
  useEffect(() => { if (ready) pasteRef.current?.focus(); }, [ready]);

  if (missing) return null;
  const what = `${clip.tables.length} ${n.many}`;
  const counts = (reviews ?? []).reduce((acc, r) => ({
    logicalUdps: acc.logicalUdps + r.counts.logicalUdps, physicalUdps: acc.physicalUdps + r.counts.physicalUdps, domains: acc.domains + r.counts.domains,
  }), { logicalUdps: 0, physicalUdps: 0, domains: 0 });

  const confirm = async () => {
    if (!reviews || blocked || saving) return;
    setSaving(true);
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : `Couldn't paste the ${what}`, 'err'));
    try {
      const pasted = await useModelerStore.getState().pasteTables(reviews.map((r) => ({
        table: r.payload.table!, cols: r.payload.cols, ...(r.payload.createSchema ? { createSchema: r.payload.createSchema } : {}),
      })));
      if (pasted) pushToast(`${what} pasted`);
      onClose();
    } catch (e) {
      await onError(e);
      // Lo que falló (otro usuario tomó un nombre, un tope de largo) se revisa de nuevo.
      setAttempt((a) => a + 1);
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Paste ${what}`} icon="columns" size="lg" subtitle="→ this canvas"
      onClose={() => { if (!saving) onClose(); }}>
      {foreign ? (
        <div className="wk-paste-note err" role="alert"><strong>{GROUP_PASTE_FOREIGN}</strong></div>
      ) : error ? (
        <div className="wk-paste-note err" role="alert">
          <strong>Couldn&apos;t read the standards</strong>
          <ul><li>{error}</li></ul>
        </div>
      ) : !ready || !names || !reviews ? (
        <p className="wk-pp-cap"><span className="rd-spin" aria-hidden /> Checking names and standards…</p>
      ) : (
        <>
          {PasteChecks({ counts, options, onOptions: setOptions })}
          <div className="wk-paste-group" role="list" aria-label={n.Many}>
            {clip.tables.map((t, i) => {
              const open = openIdx === i;
              const r = reviews[i];
              const name = facet === 'logical' ? names[i].logicalName || names[i].physicalName : names[i].physicalName;
              return (
                <div key={t.table.id} role="listitem">
                  <button type="button" className={`wk-paste-group-row${r.blockers.length ? ' blocked' : ''}`} aria-expanded={open}
                    onClick={() => setOpenIdx(open ? null : i)}>
                    {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                    <span className="rd-mono">{name}</span>
                    {names[i].renamed && <span className="wk-paste-tag warn" title={`Already in this project: ${t.table.physicalName}`}>renamed</span>}
                    {r.blockers.length > 0 && <span className="wk-paste-tag blocked">Fix before pasting</span>}
                  </button>
                  {open && (
                    <PasteDetails review={r} options={options} onOptions={setOptions} facet={facet} onFacet={setFacet} checks={false} />
                  )}
                </div>
              );
            })}
          </div>
          {blocked && (
            <div className="wk-paste-note err" role="alert">
              <strong>Fix before pasting</strong>
              <ul>{reviews.flatMap((r, i) => r.blockers.map((b) => <li key={`${i}:${b}`}>{names[i].physicalName}: {b}</li>))}</ul>
            </div>
          )}
        </>
      )}
      <div className="m-foot">
        <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" disabled={saving} onClick={onClose}>Cancel</button>
        {error ? (
          <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => setAttempt(attempt + 1)}>Retry</button>
        ) : (
          <button type="button" ref={pasteRef} className="rd-btn rd-btn-primary rd-btn-sm"
            disabled={!ready || saving || blocked} onClick={() => void confirm()}>
            {saving && <span className="rd-spin" aria-hidden />}
            {saving ? 'Pasting…' : `Paste ${what}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
