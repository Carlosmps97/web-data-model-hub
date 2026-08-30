/**
 * Servicio de la carga masiva desde Excel (doc 55 §7-8). Los jobs viven en el
 * backend bajo el changeset destino; el front sube el workbook ya parseado
 * (`parseWorkbook`), hace polling del job y, con el reporte limpio, dispara el
 * apply. Un 404 en el polling = el job expiró (reinicio del backend): el
 * popup pide validar de nuevo.
 */
import { apiGet, apiPost, apiDelete } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import type { UploadWorkbookBody } from './lib/parseWorkbook';

export type { UploadWorkbookBody } from './lib/parseWorkbook';

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
export interface UploadReport {
  summary: UploadSummary;
  tables: UploadTableRow[];
  errors: UploadIssue[];
  warnings: UploadIssue[];
  errorCount: number;
  warningCount: number;
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
