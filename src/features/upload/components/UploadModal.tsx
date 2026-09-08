import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, FileSpreadsheet, ListChecks, TriangleAlert, UploadCloud } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import { apiErrorMessage } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useUndoStore } from '@/store/useUndoStore';
import { parseWorkbook, type ParsedWorkbook } from '../lib/parseWorkbook';
import {
  applyUpload, discardUpload, pollUploadJob, startUpload, type UploadJob, type UploadSummary,
} from '../upload.service';
import { arrangeCanvases } from '../arrangeCanvases';
import UploadDropzone, { type DropzoneFile } from './UploadDropzone';
import UploadReportView from './UploadReport';
import '../upload.css';

/**
 * Popup «Upload from Excel» (doc 55 §8). Máquina de estados:
 *   idle → parsed → validating → validated → applying → arranging → done
 *                                  ↘ failed (reporte fresco + motivo)
 * Validate manda el workbook parseado y hace polling del job; Upload solo se
 * habilita con 0 errores; al aplicar, el backend RE-valida, y al terminar el
 * front arregla (ELK) los canvases tocados, refresca el explorer y vacía la
 * pila de Undo (los cambios del lote no están en ella). Cerrar el popup
 * descarta el job si aún no se aplicó; mientras aplica/arregla no se cierra.
 */
type Phase = 'idle' | 'parsed' | 'validating' | 'validated' | 'applying' | 'arranging' | 'done' | 'failed';

const STEPS = ['Choose file', 'Validate', 'Upload'] as const;

function stepState(phase: Phase): { current: number; done: number } {
  switch (phase) {
    case 'idle': return { current: 0, done: 0 };
    case 'parsed': return { current: 1, done: 1 };
    case 'validating': case 'failed': return { current: 1, done: 1 };
    case 'validated': return { current: 2, done: 2 };
    case 'applying': case 'arranging': return { current: 2, done: 2 };
    case 'done': return { current: 3, done: 3 };
  }
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function summaryLine(c: UploadSummary | undefined): string {
  if (!c) return '';
  const parts: string[] = [];
  const n = (k: keyof UploadSummary) => (c[k]?.create ?? 0) + (c[k]?.update ?? 0);
  if (n('tables')) parts.push(plural(n('tables'), 'table'));
  if (n('columns')) parts.push(plural(n('columns'), 'column'));
  if (n('canvases')) parts.push(plural(n('canvases'), 'canvas').replace('canvass', 'canvases'));
  if (n('projects')) parts.push(plural(n('projects'), 'project'));
  if (n('folders')) parts.push(plural(n('folders'), 'folder'));
  if (n('schemas')) parts.push(plural(n('schemas'), 'schema'));
  return parts.length ? parts.join(', ') : 'no changes';
}

export default function UploadModal({ onClose, pushToast }: { onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const csId = useSessionStore((s) => s.activeChangesetId);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<DropzoneFile | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrange, setArrange] = useState<{ done: number; total: number } | null>(null);
  const [arrangeFailed, setArrangeFailed] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<UploadJob | null>(null);

  const busy = phase === 'applying' || phase === 'arranging';
  const working = busy || phase === 'validating';

  const dropJob = useCallback(() => {
    abortRef.current?.abort();
    const j = jobRef.current;
    jobRef.current = null;
    if (j && csId && j.status !== 'applied' && j.status !== 'applying') void discardUpload(csId, j.id).catch(() => {});
  }, [csId]);

  // Al desmontar (navegación) se corta el polling y se descarta el job no aplicado.
  useEffect(() => () => dropJob(), [dropJob]);

  const pickFile = async (f: File) => {
    dropJob();
    setJob(null); setError(null); setArrange(null); setArrangeFailed([]);
    try {
      const p = parseWorkbook(await f.arrayBuffer(), f.name);
      setFile({ name: f.name, size: f.size });
      setParsed(p);
      setPhase('parsed');
    } catch (e) {
      setFile(null); setParsed(null); setPhase('idle');
      setError(`Couldn't read ${f.name}: ${e instanceof Error && e.message ? e.message : 'the file is not a valid .xlsx workbook'}.`);
    }
  };

  const track = (j: UploadJob) => { jobRef.current = j; setJob(j); };

  const validate = async () => {
    if (!csId || !parsed || parsed.problems.length || working) return;
    dropJob();
    setError(null); setJob(null); setPhase('validating');
    const ac = new AbortController(); abortRef.current = ac;
    try {
      track(await startUpload(csId, parsed.body));
      const final = await pollUploadJob(csId, jobRef.current!.id, { onTick: track, signal: ac.signal });
      if (final.status === 'validated') setPhase('validated');
      else { setPhase('failed'); setError(final.error ?? 'Validation failed.'); }
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase('failed'); setError(apiErrorMessage(e, "Couldn't validate the workbook."));
    }
  };

  const upload = async () => {
    const j = jobRef.current;
    if (!csId || !j || j.status !== 'validated' || (j.report?.errorCount ?? 0) > 0 || working) return;
    setError(null); setPhase('applying');
    const ac = new AbortController(); abortRef.current = ac;
    try {
      track(await applyUpload(csId, j.id));
      const final = await pollUploadJob(csId, j.id, { onTick: track, signal: ac.signal });
      if (final.status !== 'applied') { setPhase('failed'); setError(final.error ?? 'Upload failed.'); return; }
      const ids = final.result?.affectedCanvasIds ?? [];
      setPhase('arranging'); setArrange({ done: 0, total: ids.length });
      const { failed } = await arrangeCanvases(ids, useModelerStore.getState().viewMode, (done, total) => setArrange({ done, total }));
      setArrangeFailed(failed);
      // Los cambios del lote no están en la pila de Undo: una inversa vieja
      // podría pisarlos. Misma política que cambiar de changeset.
      useUndoStore.getState().clear();
      try { await useModelerStore.getState().refreshExplorer(); } catch { /* el explorer se refresca al navegar */ }
      jobRef.current = null;
      setPhase('done');
      pushToast(`Uploaded ${summaryLine(final.result?.counts)}`);
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase('failed'); setError(apiErrorMessage(e, "Couldn't upload the workbook."));
    }
  };

  const close = () => { if (busy) return; dropJob(); onClose(); };

  const report = job?.report ?? null;
  const errors = report?.errorCount ?? 0;
  const warnings = report?.warningCount ?? 0;
  const problems = parsed?.problems ?? [];
  const canValidate = !!csId && !!parsed && problems.length === 0 && !working && phase !== 'done';
  const canUpload = phase === 'validated' && errors === 0 && !working;
  const { current, done } = stepState(phase);

  let status: { text: string; tone?: 'error' | 'ok' | 'warn' } = { text: 'Pick a workbook to start.' };
  if (!csId) status = { text: 'Open a version in editing mode to upload.', tone: 'error' };
  else if (phase === 'parsed' && parsed) {
    status = problems.length
      ? { text: problems[0], tone: 'error' }
      : { text: `${plural(parsed.counts.tables, 'table row')} · ${plural(parsed.counts.columns, 'column row')} — ready to validate.` };
  } else if (phase === 'validating') status = { text: `${job?.progress.phase ?? 'Validating'}…` };
  else if (phase === 'validated') {
    status = errors
      ? { text: `${plural(errors, 'error')} block the upload — fix the workbook and validate again.`, tone: 'error' }
      : warnings
        ? { text: `${plural(warnings, 'warning')} — existing objects will be updated. Ready to upload.`, tone: 'warn' }
        : { text: 'No issues — ready to upload.', tone: 'ok' };
  } else if (phase === 'applying') status = { text: `${job?.progress.phase ?? 'Uploading'}…` };
  else if (phase === 'arranging') status = { text: `Arranging canvases ${arrange?.done ?? 0}/${arrange?.total ?? 0}…` };
  else if (phase === 'done') status = { text: 'Upload complete.', tone: 'ok' };
  else if (phase === 'failed') status = { text: error ?? 'Something went wrong.', tone: 'error' };

  const progress = (() => {
    if (phase === 'validating' || phase === 'applying') {
      const p = job?.progress;
      const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
      return { label: p?.phase ?? (phase === 'validating' ? 'Starting validation' : 'Starting upload'), pct };
    }
    if (phase === 'arranging' && arrange) {
      return { label: `Arranging canvas ${Math.min(arrange.done + 1, Math.max(arrange.total, 1))} of ${arrange.total}`, pct: arrange.total ? Math.round((arrange.done / arrange.total) * 100) : 100 };
    }
    return null;
  })();

  const footer = (
    <>
      <span className={`dmh-dialog-foot-left up-status${status.tone ? ` is-${status.tone}` : ''}`}>
        {status.tone === 'error' && <CircleAlert size={14} strokeWidth={1.8} aria-hidden />}
        {status.tone === 'warn' && <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />}
        {status.tone === 'ok' && <CircleCheck size={14} strokeWidth={1.8} aria-hidden />}
        {status.text}
      </span>
      <Button variant="secondary" onClick={close} disabled={busy}>{phase === 'done' ? 'Done' : 'Close'}</Button>
      {phase !== 'done' && (
        <Button
          variant={canUpload ? 'secondary' : 'primary'} icon={ListChecks}
          onClick={() => void validate()} disabled={!canValidate}
        >
          {phase === 'validating' ? 'Validating…' : phase === 'validated' || phase === 'failed' ? 'Validate again' : 'Validate'}
        </Button>
      )}
      {phase !== 'done' && (
        <Button variant="primary" icon={UploadCloud} onClick={() => void upload()} disabled={!canUpload}>
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
      )}
    </>
  );

  return (
    <Dialog
      open title="Upload from Excel"
      subtitle={`Create or update tables, columns and structure in ${versionLabel ? `version ${versionLabel}` : 'this version'}`}
      icon={FileSpreadsheet} onClose={close} footer={footer} width={920} backdrop="canvas" canvasTop={136}
    >
      <div className="up">
        <div className="up-steps" aria-label="Upload steps">
          {STEPS.map((label, i) => (
            <span key={label} style={{ display: 'contents' }}>
              {i > 0 && <span className="up-step-line" aria-hidden />}
              <span className={`up-step${i < done ? ' is-done' : ''}${i === current ? ' is-current' : ''}`}>
                <span className="up-step-n">{i < done ? <CircleCheck size={13} strokeWidth={2.2} aria-hidden /> : i + 1}</span>
                {label}
              </span>
            </span>
          ))}
        </div>

        {phase === 'done' ? (
          <div className="up-done">
            <span className="up-done-ico"><CircleCheck size={22} strokeWidth={1.8} aria-hidden /></span>
            <div>
              <div className="up-done-title">Upload complete</div>
              <div className="up-done-line">{file?.name} → {summaryLine(job?.result?.counts)} recorded in the working copy.</div>
              {arrange && arrange.total > 0 && (
                <div className="up-done-line">{plural(arrange.total - arrangeFailed.length, 'canvas').replace('canvass', 'canvases')} auto-arranged.</div>
              )}
              {arrangeFailed.length > 0 && (
                <div className="up-done-line">Couldn't arrange {plural(arrangeFailed.length, 'canvas').replace('canvass', 'canvases')} — open them and use Autoarrange.</div>
              )}
            </div>
          </div>
        ) : (
          <UploadDropzone file={file} counts={parsed && !problems.length ? parsed.counts : null} disabled={working} onFile={(f) => void pickFile(f)} />
        )}

        {problems.length > 0 && phase === 'parsed' && (
          <div className="up-alert up-alert--error" role="alert"><CircleAlert size={15} strokeWidth={1.8} aria-hidden /><span>{problems.join(' ')}</span></div>
        )}
        {error && phase === 'failed' && (
          <div className="up-alert up-alert--error" role="alert"><CircleAlert size={15} strokeWidth={1.8} aria-hidden /><span>{error}</span></div>
        )}
        {error && phase === 'idle' && (
          <div className="up-alert up-alert--error" role="alert"><CircleAlert size={15} strokeWidth={1.8} aria-hidden /><span>{error}</span></div>
        )}

        {progress && (
          <div className="up-progress" aria-live="polite">
            <div className="up-progress-track">
              <div className={`up-progress-fill${progress.pct == null ? ' is-indeterminate' : ''}`} style={progress.pct == null ? undefined : { width: `${progress.pct}%` }} />
            </div>
            <div className="up-progress-label"><strong>{progress.label}</strong>{progress.pct != null && <span>{progress.pct}%</span>}</div>
          </div>
        )}

        {report && phase !== 'done' && phase !== 'validating' && <UploadReportView report={report} />}
      </div>
    </Dialog>
  );
}
