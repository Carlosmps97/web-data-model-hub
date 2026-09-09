/**
 * Servicio de la carga masiva desde Excel (doc 55 §7-8 · doc 78). Los jobs
 * viven en el backend bajo el changeset destino; el front manda el workbook
 * CRUDO (`readWorkbook`) + el perfil de carga elegido, hace polling del job
 * y, con el reporte limpio, dispara el apply. Un 404 en el polling = el job
 * expiró (reinicio del backend): el popup pide validar de nuevo.
 *
 * Perfiles de carga (doc 78 §7.1): CRUD por proyecto + catálogo del editor +
 * validación sin guardar + sugerencia de mapeo por nombre + built-in.
 */
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '@/services/http';
import { API_BASE } from '@/services/apiBase';

// ── Workbook crudo ────────────────────────────────────────────────────────
export interface RawSheetRow { row: number; cells: string[] }
export interface RawSheet { name: string; rows: RawSheetRow[] }
export interface UploadWorkbookBody { fileName: string; profileId: string; sheets: RawSheet[] }

// ── Perfiles ──────────────────────────────────────────────────────────────
export type SheetRole = 'tables' | 'columns';
export type RuleType = 'required' | 'maxLength' | 'pattern' | 'allowedValues' | 'uniqueInFile' | 'mustExist';
export type RuleSeverity = 'error' | 'warning';
export interface ProfileRule { type: RuleType; value?: number | string | string[] | null; severity: RuleSeverity }
export interface ProfileTarget { kind: 'field' | 'udp' | 'ignore'; field?: string | null; udpIds?: string[] }
export interface ProfileMapping { header: string; target: ProfileTarget; rules: ProfileRule[]; defaultValue?: string | null }
export interface ProfileSheet { name: string; required: boolean; headerRow: number | null; mappings: ProfileMapping[] }
export interface ProfilePolicies {
  onExistingTable: 'update' | 'reject';
  onExistingColumn: 'update' | 'reject';
  unknownHeaders: 'warn' | 'ignore' | 'reject';
}
export interface UploadProfileBody {
  name: string;
  description?: string | null;
  isDefault: boolean;
  sheets: Record<SheetRole, ProfileSheet>;
  policies: ProfilePolicies;
}
export interface UploadProfile extends UploadProfileBody {
  id: string;
  projectId: string;
  origin: string;                 // 'user' | 'builtin:plantilla-bcp'
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
export interface ProfileProblem { path: string; code: string; message: string }
export interface FieldTarget { field: string; label: string; attr: string; required: boolean; key: boolean; mustExist: boolean }
export interface RuleTypeInfo { type: RuleType; label: string; valueKind: 'int' | 'regex' | 'list' | null; appliesTo: 'any' | 'mustExist' }
export interface ProfileCatalog {
  fields: Record<SheetRole, FieldTarget[]>;
  ruleTypes: RuleTypeInfo[];
  policies: Record<keyof ProfilePolicies, string[]>;
}
export interface Suggestion { header: string; target: ProfileTarget; matched: 'field' | 'udp' | null }

export const BUILTIN_ORIGIN = 'builtin:plantilla-bcp';

// ── Jobs ──────────────────────────────────────────────────────────────────
export type UploadJobStatus = 'validating' | 'validated' | 'applying' | 'applied' | 'failed';
export type UploadSeverity = 'error' | 'warning';

export interface UploadIssue {
  severity: UploadSeverity;
  sheet: string;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
}
export interface UploadCounts { create: number; update: number; unchanged: number; }
export type UploadSummary = Record<'projects' | 'folders' | 'canvases' | 'schemas' | 'tables' | 'columns', UploadCounts>;
export interface UploadTableRow {
  row: number | null;
  logicalName: string;
  physicalName: string;
  schema: string | null;
  action: 'create' | 'update' | 'unchanged' | 'error';
  canvas: string | null;
  columns: UploadCounts;
  issues: number;
}
export interface UploadReportSheet { role: SheetRole; name: string; found: boolean; headerRow: number | null; rows: number }
export interface UploadReport {
  summary: UploadSummary;
  tables: UploadTableRow[];
  errors: UploadIssue[];
  warnings: UploadIssue[];
  errorCount: number;
  warningCount: number;
  profile?: { id: string; name: string } | null;
  sheets?: UploadReportSheet[];
}
export interface UploadResult { affectedCanvasIds: string[]; counts: UploadSummary; }
export interface UploadJob {
  id: string;
  csId: string;
  fileName: string;
  status: UploadJobStatus;
  progress: { phase: string; done: number; total: number };
  report: UploadReport | null;
  result: UploadResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const base = (csId: string) => `${API_BASE}/api/changesets/${encodeURIComponent(csId)}/uploads`;
const jobUrl = (csId: string, jobId: string) => `${base(csId)}/${encodeURIComponent(jobId)}`;

export const startUpload = (csId: string, body: UploadWorkbookBody) => apiPost<UploadJob>(base(csId), body);
export const getUploadJob = (csId: string, jobId: string) => apiGet<UploadJob>(jobUrl(csId, jobId));
export const applyUpload = (csId: string, jobId: string) => apiPost<UploadJob>(`${jobUrl(csId, jobId)}/apply`);
export const discardUpload = (csId: string, jobId: string) => apiDelete<{ deleted: boolean }>(jobUrl(csId, jobId));

const PROFILES = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}/upload-profiles`;
const profileUrl = (pid: string, id: string) => `${PROFILES(pid)}/${encodeURIComponent(id)}`;

export const listProfiles = (pid: string) => apiGet<UploadProfile[]>(PROFILES(pid));
export const getProfile = (pid: string, id: string) => apiGet<UploadProfile>(profileUrl(pid, id));
export const createProfile = (pid: string, body: UploadProfileBody) => apiPost<UploadProfile>(PROFILES(pid), body);
export const updateProfile = (pid: string, id: string, body: UploadProfileBody) => apiPut<UploadProfile>(profileUrl(pid, id), body);
export const deleteProfile = (pid: string, id: string) => apiDelete<{ deleted: boolean }>(profileUrl(pid, id));
export const setDefaultProfile = (pid: string, id: string) => apiPost<UploadProfile>(`${profileUrl(pid, id)}/default`);
export const getProfileCatalog = (pid: string) => apiGet<ProfileCatalog>(`${PROFILES(pid)}/catalog`);
export const validateProfile = (pid: string, body: UploadProfileBody) =>
  apiPost<{ problems: ProfileProblem[] }>(`${PROFILES(pid)}/validate`, body);
export const suggestMappings = (pid: string, sheet: SheetRole, headers: string[]) =>
  apiPost<Suggestion[]>(`${PROFILES(pid)}/suggest`, { sheet, headers });
export const createDefaultProfile = (pid: string) =>
  apiPost<{ profile: UploadProfile; warnings: string[] }>(`${PROFILES(pid)}/default`);

/** 422 del backend al guardar/validar un perfil: `detail = {message, problems}`
 *  (viaja en `ApiError.detail`). Cualquier otro error → lista vacía. */
export function profileProblemsOf(e: unknown): ProfileProblem[] {
  if (!(e instanceof ApiError) || e.status !== 422) return [];
  const detail = e.detail as { problems?: unknown } | null | undefined;
  const problems = detail && typeof detail === 'object' ? detail.problems : undefined;
  return Array.isArray(problems)
    ? problems.filter((p): p is ProfileProblem => !!p && typeof p === 'object' && typeof (p as ProfileProblem).code === 'string')
    : [];
}

const TERMINAL: ReadonlySet<UploadJobStatus> = new Set(['validated', 'applied', 'failed']);
export const isTerminal = (s: UploadJobStatus) => TERMINAL.has(s);

const DEFAULT_INTERVAL_MS = 800;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('Polling aborted')); return; }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(t); reject(new Error('Polling aborted')); }
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** Consulta el job hasta un estado terminal (validated / applied / failed).
 *  `onTick` recibe cada foto (progreso para la barra); `signal` corta el
 *  polling (cerrar el popup); los errores de API se propagan tal cual. */
export async function pollUploadJob(
  csId: string,
  jobId: string,
  opts: { onTick?: (job: UploadJob) => void; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<UploadJob> {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  for (;;) {
    if (opts.signal?.aborted) throw new Error('Polling aborted');
    const job = await getUploadJob(csId, jobId);
    opts.onTick?.(job);
    if (isTerminal(job.status)) return job;
    await sleep(interval, opts.signal);
  }
}
