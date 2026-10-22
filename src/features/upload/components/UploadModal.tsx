import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, FileSpreadsheet, FolderTree, ListChecks, Plus, Settings2, TriangleAlert, UploadCloud, Wand2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import SearchSelect from '@/features/modeler/components/SearchSelect';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import { ApiError, apiErrorMessage, errorReason, isTransientError } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useUndoStore } from '@/store/useUndoStore';
import { useAuthStore } from '@/store/useAuthStore';
import { findSheet, readWorkbook, sheetRowCount, type RawWorkbook } from '../lib/parseWorkbook';
import {
  applyUpload, createDefaultProfile, discardUpload, getProfileCatalog, getUploadTargets, listProfiles, pollUploadJob, startUpload,
  type ProfileCatalog, type UploadJob, type UploadProfile, type UploadSummary, type UploadTargets,
} from '../upload.service';
import { placeUploadedObjects } from '../placeUploaded';
import { canvasView } from '@/features/modeler/lib/canvasFocus';
// eslint-disable-next-line no-restricted-imports -- a propósito: por el barrel de modeler sería un ciclo (Toolbar → UploadModal → modeler); ver docs/02-arquitectura.md
import { SessionChangedError, afterRevalidation, pinSession, touchesVersion, type SessionPin } from '@/features/modeler/lib/sessionGuard';
import { needsTarget, pickTarget, targetHint } from '../lib/uploadTarget';
import { notPlacedNotice } from '../lib/arrangeNotice';
import UploadDropzone, { type DropzoneFile, type DropzoneSheet } from './UploadDropzone';
import UploadReportView from './UploadReport';
import ProfileManagerModal from './ProfileManagerModal';
import '../upload.css';

/**
 * Popup «Upload from Excel». Máquina de estados:
 *   idle → parsed → validating → validated → applying → arranging → done
 *                                  ↘ failed (reporte fresco + motivo)
 * El workbook se lee crudo (todas las hojas) y viaja con el perfil de carga
 * elegido; el backend aplica el perfil. Validate hace polling del job; Upload
 * solo se habilita con 0 errores; al aplicar, el backend vuelve a validar, y al
 * terminar el front ubica lo nuevo y refresca el explorer. No reacomoda (ELK)
 * los canvases completos: en la fase `arranging` ubica solo lo que entró a cada
 * canvas, en el centro de lo que se ve si es el canvas abierto, y lo marca para
 * pintarlo encima (lo existente no se mueve).
 * La pila de Undo se vacía al empezar el apply y queda cerrada (por versión)
 * hasta que termine; si el polling se rinde ante fallos transitorios la fase es
 * `unconfirmed` (la carga pudo quedar aplicada). Cerrar el popup descarta el
 * job no aplicado; mientras aplica o ubica, su botón no lo cierra, y si
 * otra cosa lo desmonta la carga sigue y avisa con un toast.
 *
 * Si el proyecto tiene una capa de «proyectos internos» (2+ carpetas raíz con
 * subcarpetas) la fila Target project exige elegir una antes de validar; con
 * una sola se muestra dónde caerá la carga; sin capa la fila no aparece. La
 * regla la decide el backend.
 */
// `unconfirmed`: el polling del apply se rindió ante fallos transitorios; la
// carga pudo terminar (no es `failed`).
type Phase = 'idle' | 'parsed' | 'validating' | 'validated' | 'applying' | 'arranging' | 'done' | 'failed' | 'unconfirmed';

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
    case 'applying': case 'arranging': case 'unconfirmed': return { current: 2, done: 2 };
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

/** Un POST del apply sin respuesta pudo llegar tarde: si el job sigue
 *  «validated», se relee tras estas pausas antes de darlo por no llegado. */
const LATE_POST_REREADS_MS = [2000, 4000];
const wait = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

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
  // ¿El popup sigue abierto? Si no, lo que no puede mostrar (canvases sin
  // ubicar, un fallo de la carga) se avisa con un toast.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

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

  // Capa de proyectos internos de la versión (estructura efectiva del draft).
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

  // Nombre de un canvas para los avisos (el árbol del Explorer, si ya lo tiene).
  const canvasName = (id: string) => {
    const s = useModelerStore.getState();
    return [...(projectId ? s.trees[projectId]?.subjectAreas ?? [] : []), ...s.subjectAreas].find((sa) => sa.id === id)?.name;
  };

  const upload = async () => {
    const j = jobRef.current;
    if (!csId || !j || j.status !== 'validated' || (j.report?.errorCount ?? 0) > 0 || working) return;
    // Con una inversa del Undo en vuelo no se empieza: la carga cierra la pila al
    // empezar, y esa inversa (si fallara) no podría volver a la pila.
    if (useUndoStore.getState().busy) { pushToast('Undo is still running — upload when it finishes.', 'err'); return; }
    // La carga es de la versión donde se pidió: el arrange corre con su pin y lo
    // que sigue no toca otra versión. Cerrar el popup (Logical/Physical cierra
    // los modales; el TopNav lo desmonta) no corta la carga pedida. Lo que el
    // popup cerrado no puede mostrar (canvases sin ubicar, un fallo) se avisa
    // con un toast.
    const pin = pinSession();
    const who = useAuthStore.getState().user?.username ?? null;
    setError(null); setPhase('applying');
    // Desde que empieza el apply, la pila de Undo queda vacía y cerrada hasta
    // que la carga termine (en su versión): la carga no está en ella, y una
    // inversa previa (o de lo editado con el popup ya cerrado: botón del
    // toolbar, Ctrl+Z) pisaría lo cargado.
    let finished!: () => void;
    useUndoStore.getState().clear({ until: new Promise<void>((r) => { finished = r; }) });
    // Al desmontar se descarta el job no aplicado; este ya se está aplicando.
    jobRef.current = { ...j, status: 'applying' };
    // ¿Sigue abierta (en edición) la versión de la carga? Cuenta la versión, no
    // la época de la sesión: ir a otra y volver a esta sigue siendo esta.
    const ours = () => { const s = useSessionStore.getState(); return s.activeChangesetId === csId && s.openMode !== 'readonly'; };
    // Para leer (refrescar el Explorer) basta con que se vea la versión, en cualquier modo.
    const shown = () => useSessionStore.getState().activeChangesetId === csId;
    // Tras un logout (o con otro usuario) nada de esta carga se avisa.
    const sameUser = () => (useAuthStore.getState().user?.username ?? null) === who;
    // El arrange sigue la versión de la carga, como `ours()`, no la época de la
    // sesión: ir a otra y volver a esta (A → B → A) no deja canvases sin ubicar.
    // Con otra abierta (u otro usuario) corta antes de escribir.
    const inVersion: SessionPin = {
      holds: () => ours() && sameUser(),
      check: () => { if (!ours() || !sameUser()) throw new SessionChangedError(); },
    };
    const to = versionLabel ? `to “${versionLabel}”` : 'to the version where it started';
    /** El Explorer, refrescado si la versión abierta es la de la carga (en
     *  edición o como visor) y sigue el mismo usuario (tras un logout, nada de
     *  esta carga toca la pantalla). Si el refresco falla, lo dice: el refresco
     *  vacía el árbol al empezar. */
    const refresh = async () => {
      if (!shown() || !sameUser()) return;
      try { await useModelerStore.getState().refreshExplorer(); } catch (e) {
        if (touchesVersion(e, csId)) await afterRevalidation();
        if (shown() && sameUser()) pushToast(`Couldn't reload the explorer: ${errorReason(e, 'unknown error')}. Use Refresh to try again.`, 'err');
      }
    };
    /** El resultado de la carga, donde corresponde. `mine`: con la versión de la
     *  carga abierta; `other`: con otra abierta, nombrándola. */
    const report = async (to: 'failed' | 'unconfirmed', mine: string, other: string, e?: unknown) => {
      // Un 401 (sesión vencida, logout) u otro usuario: nada.
      if (!sameUser() || (e instanceof ApiError && e.status === 401)) return;
      // Un error de la versión abierta en la misma sesión: pudo cambiar de manos —
      // lo avisa la revalidación (si la cambia); si no, es real (p. ej. rol perdido).
      if (e !== undefined && ours() && pin.holds() && touchesVersion(e, csId)) {
        await afterRevalidation();
        if (!pin.holds()) return;
      }
      // Con el popup ya cerrado, el toast dice que fue la carga y en qué versión
      // (`mine` es la línea de estado del popup: «Couldn't reach the server…» solo no basta).
      if (ours()) { setPhase(to); setError(mine); if (!mounted.current) pushToast(other, 'err'); return; }
      // Con otra versión abierta la revalidación no mira esta: se avisa siempre.
      pushToast(other, 'err');
    };
    const fail = (msg: string, e?: unknown) =>
      report('failed', msg, `The upload ${to} failed: ${msg.replace(/[.\s]+$/, '')}.`, e);
    // El polling se rindió (o respondió 401/403): el servidor pudo terminar la
    // carga, así que no es «failed».
    const unconfirmed = async (e: unknown) => {
      const reason = errorReason(e, 'no response');
      await report('unconfirmed',
        `Couldn't confirm the result of the upload: ${reason}. It may still be applied — check the model before continuing.`,
        `Couldn't confirm the result of the upload ${to}: ${reason}. It may still be applied — check that version before continuing.`, e);
      await refresh();
    };
    try {
      let postError: unknown = null;
      try { track(await applyUpload(csId, j.id)); } catch (e) {
        // Una respuesta de error: sigue validado y cerrar lo descarta.
        if (!isTransientError(e)) { jobRef.current = j; throw e; }
        // Sin respuesta (red, timeout, 5xx) el servidor pudo reclamarlo: lo dice
        // el polling («validated» es que no llegó).
        postError = e;
      }
      // El polling solo pinta el progreso; `jobRef` (lo que desmontar el popup
      // descarta) lo decide el estado final: una foto «validated» de un POST
      // pendiente lo dejaría descartable y lo cortaría si llega tarde.
      const progress = (job: UploadJob) => setJob(job);
      let final: UploadJob;
      let discarded = false;
      try {
        final = await pollUploadJob(csId, j.id, { onTick: progress });
        // Sin respuesta, el POST pudo llegar tarde: «validated» en la primera
        // lectura no alcanza para darlo por no llegado.
        for (const pause of postError ? LATE_POST_REREADS_MS : []) {
          if (final.status !== 'validated') break;
          await wait(pause);
          final = await pollUploadJob(csId, j.id, { onTick: progress });
        }
        // «No llegó» se vuelve cierto descartando el job (y esperando la
        // respuesta): un POST que llegue después no lo encuentra. Solo si sigue
        // validado: un 409 indica que la carga empezó (o terminó), es decir, que
        // el POST sí llegó, y se sigue su polling. Sin respuesta (o 401/403):
        // «unconfirmed».
        if (postError && final.status === 'validated') {
          discarded = await discardUpload(csId, j.id, { onlyIfValidated: true }).then(() => true, (e: unknown) => {
            if (e instanceof ApiError && e.status === 404) return true;     // el job no existe: tampoco se aplicará
            if (e instanceof ApiError && e.status === 409) return false;
            throw e;
          });
          if (!discarded) final = await pollUploadJob(csId, j.id, { onTick: progress });
        }
      } catch (e) {
        if (isTransientError(e) || (e instanceof ApiError && (e.status === 401 || e.status === 403))) { await unconfirmed(e); return; }
        throw e;
      }
      if (final.status === 'validated') {
        // Nada se aplicó: el job sigue (o seguía, si se descartó arriba) validado.
        const reason = discarded ? ` (${errorReason(postError, 'no response')})` : '';
        const notStarted = new Error(`Nothing was applied — the upload didn't start${reason}. Validate the workbook and upload it again.`);
        if (discarded) { jobRef.current = null; throw notStarted; }
        // El servidor lo devolvió a «validated»: sigue validado y cerrar lo
        // descarta (con el popup ya cerrado, se descarta aquí: su limpieza ya corrió).
        jobRef.current = j;
        if (!mounted.current) void discardUpload(csId, j.id).catch(() => {});
        throw notStarted;
      }
      jobRef.current = final;
      if (final.status !== 'applied') {
        // Pudo fallar a mitad (con tandas ya grabadas): se refresca.
        await fail(final.error ?? 'Upload failed.');
        await refresh();
        return;
      }
      const ids = final.result?.affectedCanvasIds ?? [];
      // Qué entró a cada canvas (si el backend no lo manda, nada se mueve y lo
      // nuevo queda en su posición provisional).
      const members = final.result?.newMembers;
      const toPlace = ids.filter((id) => (members?.[id]?.length ?? 0) > 0);
      // El canvas abierto (de esta carga) ubica lo nuevo en el centro de lo que se
      // ve, medido como quedará: el refresco lo reabre sin selección y el panel
      // de Properties, si estaba abierto, se cierra.
      const m = useModelerStore.getState();
      const openId = ours() && sameUser() && m.activeSaId && m.diagram?.subjectArea.id === m.activeSaId && ids.includes(m.activeSaId)
        ? m.activeSaId : null;
      const center = openId ? canvasView(m.flow, { panel: 'closes' })?.center : null;
      setPhase('arranging'); setArrange({ done: 0, total: toPlace.length });
      const { failed, skipped } = await placeUploadedObjects(ids, members, openId && center ? { saId: openId, point: center } : null,
        (done, total) => setArrange({ done, total }), { pin: inVersion });
      const missing = [...failed, ...skipped];
      const counts = final.result?.counts;
      /** El aviso de la carga aplicada, según la sesión del momento del aviso
       *  (también después del refresco: entretanto pudo haber un logout u otra versión). */
      const announce = () => {
        // Tras un logout (u otro usuario en el tab) nada de esta carga se avisa.
        if (!sameUser()) return;
        if (!ours()) {
          // Otra versión abierta: la carga se aplicó en la suya y se avisa
          // nombrándola, en un solo aviso con lo que no se pudo ubicar; sin
          // refrescar ni tocar la abierta.
          if (missing.length) pushToast(notPlacedNotice(missing, canvasName, { version: versionLabel }), 'err');
          else pushToast(`Uploaded ${summaryLine(counts)} ${to}`);
          return;
        }
        pushToast(`Uploaded ${summaryLine(counts)}`);
        // Con el popup ya cerrado, los que no se ubicaron no se ven en él.
        if (!mounted.current && missing.length) pushToast(notPlacedNotice(missing, canvasName), 'err');
      };
      // Otra versión abierta, u otro usuario en el tab (aun con la misma versión):
      // solo el aviso que corresponda, sin vaciar la pila de Undo de esa sesión (la
      // de la versión de la carga estuvo cerrada mientras aplicaba). Con la versión
      // de la carga abierta como visor, su Explorer sí se refresca.
      if (!ours() || !sameUser()) { await refresh(); announce(); return; }
      setArrangeFailed(missing);
      // Lo ubicado se pinta encima de lo que ya había (se marca antes de
      // refrescar: el canvas abierto lo toma al recargarse).
      useModelerStore.getState().markFresh(Object.fromEntries(
        toPlace.filter((id) => !missing.includes(id)).map((id) => [id, members![id]])));
      // Los cambios del lote no están en la pila de Undo: una inversa previa
      // podría pisarlos. Misma política que cambiar de changeset.
      useUndoStore.getState().clear();
      // El popup sigue ocupado hasta que el Explorer y el canvas abierto muestran
      // lo cargado: editar el diagrama previo a la carga lo revertiría.
      await refresh();
      jobRef.current = null;
      setPhase('done');
      announce();
    } catch (e) {
      await fail(apiErrorMessage(e, "Couldn't upload the workbook."), e);
    } finally { finished(); }
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
  else if (phase === 'arranging') {
    // Ubicados todos (o nada que ubicar), falta el refresco del Explorer.
    status = { text: arrange && arrange.done < arrange.total ? `Placing the new objects ${arrange.done}/${arrange.total}…` : 'Updating the explorer…' };
  }
  else if (phase === 'done') status = { text: 'Upload complete.', tone: 'ok' };
  else if (phase === 'failed') status = { text: error ?? 'Something went wrong.', tone: 'error' };
  else if (phase === 'unconfirmed') status = { text: error ?? "Couldn't confirm the result of the upload.", tone: 'warn' };

  const progress = (() => {
    if (phase === 'validating' || phase === 'applying') {
      const p = job?.progress;
      const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
      return { label: p?.phase ?? (phase === 'validating' ? 'Starting validation' : 'Starting upload'), pct };
    }
    if (phase === 'arranging' && arrange) {
      if (arrange.done >= arrange.total) return { label: 'Updating the explorer', pct: 100 };
      return { label: `Placing the new objects on canvas ${arrange.done + 1} of ${arrange.total}`, pct: Math.round((arrange.done / arrange.total) * 100) };
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
              {arrange && arrange.total - arrangeFailed.length > 0 && (
                <div className="up-done-line">New objects placed on {plural(arrange.total - arrangeFailed.length, 'canvas').replace('canvass', 'canvases')} — existing blocks were not moved.</div>
              )}
              {arrangeFailed.length > 0 && (
                <div className="up-done-line">Couldn't place the new objects on {plural(arrangeFailed.length, 'canvas').replace('canvass', 'canvases')} — they were left below the existing blocks.</div>
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
