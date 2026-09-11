import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, FileSpreadsheet, FolderTree, ListChecks, Plus, Settings2, TriangleAlert, UploadCloud, Wand2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import SearchSelect from '@/features/modeler/components/SearchSelect';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import { apiErrorMessage } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useUndoStore } from '@/store/useUndoStore';
import { findSheet, readWorkbook, sheetRowCount, type RawWorkbook } from '../lib/parseWorkbook';
import {
  applyUpload, createDefaultProfile, discardUpload, getProfileCatalog, getUploadTargets, listProfiles, pollUploadJob, startUpload,
  type ProfileCatalog, type UploadJob, type UploadProfile, type UploadSummary, type UploadTargets,
} from '../upload.service';
import { arrangeCanvases } from '../arrangeCanvases';
import { needsTarget, pickTarget, targetHint } from '../lib/uploadTarget';
import UploadDropzone, { type DropzoneFile, type DropzoneSheet } from './UploadDropzone';
import UploadReportView from './UploadReport';
import ProfileManagerModal from './ProfileManagerModal';
import '../upload.css';

/**
 * Popup «Upload from Excel» (doc 55 §8 · doc 78 §8). Máquina de estados:
 *   idle → parsed → validating → validated → applying → arranging → done
 *                                  ↘ failed (reporte fresco + motivo)
 * El workbook se lee CRUDO (todas las hojas) y viaja con el perfil de carga
 * elegido; el backend aplica el perfil. Validate hace polling del job; Upload
 * solo se habilita con 0 errores; al aplicar, el backend RE-valida, y al
 * terminar el front arregla (ELK) los canvases tocados, refresca el explorer
 * y vacía la pila de Undo. Cerrar el popup descarta el job si aún no se
 * aplicó; mientras aplica/arregla no se cierra.
 *
 * Doc 87 §3.5: si el proyecto tiene una capa de «proyectos internos» (2+
 * carpetas raíz con subcarpetas — DDV: CPYBCA / Otros) la fila Target project
 * exige elegir una antes de validar; con una sola (UDV) se muestra dónde caerá
 * la carga; sin capa la fila no aparece. La regla la decide el backend.
 */
type Phase = 'idle' | 'parsed' | 'validating' | 'validated' | 'applying' | 'arranging' | 'done' | 'failed';

const STEPS = ['Choose file', 'Validate', 'Upload'] as const;
const LAST_PROFILE_KEY = (pid: string) => `dmh.upload.profile.${pid}`;
const LAST_TARGET_KEY = (pid: string) => `dmh.upload.target.${pid}`;

function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }   // storage bloqueado o ausente
}
function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage bloqueado o ausente */ }
}

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
  if (n('views')) parts.push(plural(n('views'), 'view'));
  if (n('canvases')) parts.push(plural(n('canvases'), 'canvas').replace('canvass', 'canvases'));
  if (n('projects')) parts.push(plural(n('projects'), 'project'));
  if (n('folders')) parts.push(plural(n('folders'), 'folder'));
  if (n('schemas')) parts.push(plural(n('schemas'), 'schema'));
  return parts.length ? parts.join(', ') : 'no changes';
}

/** Perfil preseleccionado: el último usado en el proyecto (si sigue), el default, o el primero. */
function pickProfile(profiles: UploadProfile[], projectId: string, current: string | null): string | null {
  if (current && profiles.some((p) => p.id === current)) return current;
  let remembered: string | null = null;
  try { remembered = localStorage.getItem(LAST_PROFILE_KEY(projectId)); } catch { /* storage bloqueado o ausente */ }
  if (remembered && profiles.some((p) => p.id === remembered)) return remembered;
  return profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? null;
}

export default function UploadModal({ onClose, pushToast }: { onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const csId = useSessionStore((s) => s.activeChangesetId);
  const projectId = useSessionStore((s) => s.activeProjectId);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<DropzoneFile | null>(null);
  const [raw, setRaw] = useState<RawWorkbook | null>(null);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrange, setArrange] = useState<{ done: number; total: number } | null>(null);
  const [arrangeFailed, setArrangeFailed] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<UploadProfile[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [targets, setTargets] = useState<UploadTargets | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null);
  const [udpDefs, setUdpDefs] = useState<UdpDefinition[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [manager, setManager] = useState<null | 'list' | 'new'>(null);
  const [creatingDefault, setCreatingDefault] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<UploadJob | null>(null);

  const busy = phase === 'applying' || phase === 'arranging';
  const working = busy || phase === 'validating';

  // Perfiles + catálogo + defs UDP del proyecto (una vez por apertura).
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    Promise.all([listProfiles(projectId), getProfileCatalog(projectId), getUdpDefs(projectId)])
      .then(([list, cat, defs]) => {
        if (!alive) return;
        setProfiles(list); setCatalog(cat); setUdpDefs(defs);
        setProfileId((cur) => pickProfile(list, projectId, cur));
      })
      .catch((e) => { if (alive) setSetupError(apiErrorMessage(e, "Couldn't load the upload profiles.")); });
    return () => { alive = false; };
  }, [projectId]);

  // Doc 87: capa de proyectos internos de la versión (estructura EFECTIVA del draft).
  useEffect(() => {
    if (!csId || !projectId) return;
    let alive = true;
    getUploadTargets(csId)
      .then((t) => {
        if (!alive) return;
        setTargets(t);
        setTargetId((cur) => pickTarget(t, remembered(LAST_TARGET_KEY(projectId)), cur));
      })
      .catch((e) => { if (alive) setSetupError(apiErrorMessage(e, "Couldn't load the project structure.")); });
    return () => { alive = false; };
  }, [csId, projectId]);

  const dropJob = useCallback(() => {
    abortRef.current?.abort();
    const j = jobRef.current;
    jobRef.current = null;
    if (j && csId && j.status !== 'applied' && j.status !== 'applying') void discardUpload(csId, j.id).catch(() => {});
  }, [csId]);

  // Al desmontar (navegación) se corta el polling y se descarta el job no aplicado.
  useEffect(() => () => dropJob(), [dropJob]);

  const resetToParsed = () => { dropJob(); setJob(null); setError(null); setArrange(null); setArrangeFailed([]); };

  const pickFile = async (f: File) => {
    resetToParsed();
    try {
      const wb = readWorkbook(await f.arrayBuffer(), f.name);
      setFile({ name: f.name, size: f.size });
      setRaw(wb);
      setPhase('parsed');
    } catch (e) {
      setFile(null); setRaw(null); setPhase('idle');
      setError(`Couldn't read ${f.name}: ${e instanceof Error && e.message ? e.message : 'the file is not a valid .xlsx workbook'}.`);
    }
  };

  const chooseProfile = (id: string) => {
    setProfileId(id);
    if (projectId) remember(LAST_PROFILE_KEY(projectId), id);
    if (phase === 'validated' || phase === 'failed') { resetToParsed(); setPhase(raw ? 'parsed' : 'idle'); }
  };

  // Cambiar el destino después de validar obliga a validar de nuevo (el plan
  // de carpetas/canvases depende de él), igual que cambiar de perfil.
  const chooseTarget = (id: string) => {
    setTargetId(id || null);
    if (projectId && id) remember(LAST_TARGET_KEY(projectId), id);
    if (phase === 'validated' || phase === 'failed') { resetToParsed(); setPhase(raw ? 'parsed' : 'idle'); }
  };

  const track = (j: UploadJob) => { jobRef.current = j; setJob(j); };

  const validate = async () => {
    if (!csId || !raw || !profileId || working) return;
    dropJob();
    setError(null); setJob(null); setPhase('validating');
    const ac = new AbortController(); abortRef.current = ac;
    try {
      track(await startUpload(csId, {
        fileName: raw.fileName, profileId, sheets: raw.sheets,
        targetFolderId: needsTarget(targets) ? targetId : null,
      }));
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

  const createDefault = async () => {
    if (!projectId) return;
    setCreatingDefault(true);
    try {
      const { profile, warnings } = await createDefaultProfile(projectId);
      const list = await listProfiles(projectId);
      setProfiles(list); setProfileId(profile.id);
      pushToast(warnings.length ? `'${profile.name}' created with ${plural(warnings.length, 'unmapped column')} — review it in Manage profiles` : `'${profile.name}' created`);
    } catch (e) { pushToast(apiErrorMessage(e, "Couldn't create the default profile."), 'err'); }
    finally { setCreatingDefault(false); }
  };

  const onProfilesChanged = (list: UploadProfile[]) => {
    setProfiles(list);
    setProfileId((cur) => pickProfile(list, projectId ?? '', cur));
    if (phase === 'validated' || phase === 'failed') { resetToParsed(); setPhase(raw ? 'parsed' : 'idle'); }
  };

  const close = () => { if (busy) return; dropJob(); onClose(); };

  const profile = profiles?.find((p) => p.id === profileId) ?? null;
  const sheetsInfo = useMemo<DropzoneSheet[] | null>(() => {
    if (!raw || !profile) return null;
    return (['tables', 'columns'] as const).map((role) => {
      const spec = profile.sheets?.[role];
      const name = spec?.name || (role === 'tables' ? 'Tables sheet' : 'Columns sheet');
      const sheet = spec?.name ? findSheet(raw.sheets, spec.name) : undefined;
      return { name, found: !!sheet, rows: sheet ? sheetRowCount(sheet, spec?.headerRow ?? null) : 0 };
    });
  }, [raw, profile]);

  const report = job?.report ?? null;
  const errors = report?.errorCount ?? 0;
  const warnings = report?.warningCount ?? 0;
  const target = targets?.candidates.find((c) => c.id === targetId) ?? null;
  const targetPending = !targets || (needsTarget(targets) && !target);
  const canValidate = !!csId && !!raw && !!profileId && !targetPending && !working && phase !== 'done';
  const canUpload = phase === 'validated' && errors === 0 && !working;
  const { current, done } = stepState(phase);

  let status: { text: string; tone?: 'error' | 'ok' | 'warn' } = { text: 'Pick a profile and a workbook to start.' };
  if (!csId) status = { text: 'Open a version in editing mode to upload.', tone: 'error' };
  else if (setupError) status = { text: setupError, tone: 'error' };
  else if (profiles && profiles.length === 0) status = { text: 'This project has no upload profiles yet.', tone: 'warn' };
  else if (targets && needsTarget(targets) && !target && (phase === 'idle' || phase === 'parsed')) {
    status = { text: 'Pick the target project to validate.', tone: 'warn' };
  } else if (phase === 'parsed' && raw) {
    const missing = sheetsInfo?.filter((s) => !s.found) ?? [];
    status = missing.length
      ? { text: `Sheet ${missing.map((s) => `'${s.name}'`).join(', ')} not found in the workbook — validate to see the details.`, tone: 'warn' }
      : { text: `${sheetsInfo?.map((s) => `${s.name} · ${plural(s.rows, 'row')}`).join(' · ') ?? ''} — ready to validate.` };
  } else if (phase === 'validating') status = { text: `${job?.progress.phase ?? 'Validating'}…` };
  else if (phase === 'validated') {
    status = errors
      ? { text: `${plural(errors, 'error')} block the upload — fix the workbook (or the profile) and validate again.`, tone: 'error' }
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

  const profileOptions = (profiles ?? []).map((p) => ({ value: p.id, label: p.name, detail: p.isDefault ? 'default' : undefined }));
  const targetOptions = (targets?.candidates ?? []).map((c) => ({
    value: c.id, label: c.name,
    detail: `${plural(c.folders, 'folder')} · ${plural(c.canvases, 'canvas').replace('canvass', 'canvases')}`,
  }));
  const hint = targetHint(targets);

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

        {phase !== 'done' && (
          <div className="up-profile-row">
            <span className="up-profile-label">Upload profile</span>
            {profiles && profiles.length > 0 ? (
              <SearchSelect
                options={profileOptions} valueLabel={profile ? `${profile.name}${profile.isDefault ? ' · default' : ''}` : ''}
                placeholder="Pick an upload profile…" onPick={chooseProfile} disabled={working || !projectId}
                emptyLabel="No profile matches" inputClassName="up-profile-select"
              />
            ) : (
              <span className="up-profile-empty">{profiles === null && !setupError ? 'Loading profiles…' : 'No profiles in this project'}</span>
            )}
            {profiles && profiles.length === 0 && (
              <Button size="sm" variant="primary" icon={Wand2} disabled={creatingDefault || working || !projectId} onClick={() => void createDefault()}>
                {creatingDefault ? 'Creating…' : 'Create default profile'}
              </Button>
            )}
            {profiles && profiles.length === 0 && (
              <Button size="sm" variant="secondary" icon={Plus} disabled={working || !projectId || !catalog} onClick={() => setManager('new')}>New profile</Button>
            )}
            <Button size="sm" variant="secondary" icon={Settings2} disabled={working || !projectId || !catalog} onClick={() => setManager('list')}>Manage profiles</Button>
          </div>
        )}
        {profile?.description && phase !== 'done' && <div className="up-profile-desc">{profile.description}</div>}

        {phase !== 'done' && targets && targets.mode !== 'none' && (
          <div className="up-profile-row">
            <span className="up-profile-label">Target project</span>
            {needsTarget(targets) ? (
              <SearchSelect
                options={targetOptions} valueLabel={target?.name ?? ''}
                placeholder="Pick the internal project to load into…" onPick={chooseTarget} disabled={working}
                emptyLabel="No project matches" inputClassName="up-profile-select"
              />
            ) : (
              <span className="up-target-hint"><FolderTree size={14} strokeWidth={1.8} aria-hidden />{hint}</span>
            )}
          </div>
        )}

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
          <UploadDropzone file={file} sheets={sheetsInfo} disabled={working} onFile={(f) => void pickFile(f)} />
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

      {manager && projectId && catalog && (
        <ProfileManagerModal
          projectId={projectId} profiles={profiles ?? []} catalog={catalog} udpDefs={udpDefs} initial={manager}
          onClose={() => setManager(null)} onChanged={onProfilesChanged} pushToast={pushToast}
        />
      )}
    </Dialog>
  );
}
