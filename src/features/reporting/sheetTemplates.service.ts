/**
 * sheetTemplates.service — plantillas de hoja Excel del proyecto.
 * Backend `/api/projects/{pid}/sheet-templates` (envelope `{success,data}`).
 */
import { apiDelete, apiGet, apiPost, apiPut } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import type { SheetTemplate, SheetTemplateBody } from './lib/sheetTemplates';

const TEMPLATES = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}/sheet-templates`;

export const listSheetTemplates = (projectId: string) => apiGet<SheetTemplate[]>(`${TEMPLATES(projectId)}`);
export const createSheetTemplate = (projectId: string, body: SheetTemplateBody) =>
  apiPost<SheetTemplate>(`${TEMPLATES(projectId)}`, body);
export const updateSheetTemplate = (projectId: string, id: string, body: SheetTemplateBody) =>
  apiPut<SheetTemplate>(`${TEMPLATES(projectId)}/${encodeURIComponent(id)}`, body);
export const deleteSheetTemplate = (projectId: string, id: string) =>
  apiDelete<{ deleted: boolean }>(`${TEMPLATES(projectId)}/${encodeURIComponent(id)}`);
/** Crea la built-in «QA_MODELO» en el proyecto (409 si ya la tiene). */
export const createDefaultSheetTemplate = (projectId: string) =>
  apiPost<SheetTemplate>(`${TEMPLATES(projectId)}/default`, {});
