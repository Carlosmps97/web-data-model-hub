/**
 * Lecturas por LOTE del Reporting (doc 102): columnas y vistas de muchas tablas
 * con los ids en el CUERPO (POST) — antes viajaban en la URL y con 300 ids el
 * servidor del front respondía 431. Columnas en tandas de `COLUMN_BATCH` (300:
 * respuestas de tamaño razonable, en paralelo); vistas en tandas de
 * `VIEW_BATCH` (2 000), sin repetir una vista cuyas fuentes caen en dos tandas.
 */
import {
  queryReportColumns, queryReportViews, type ReportColumnRow, type ReportViewRow,
} from '@/services/reporting.service';
import { chunk, COLUMN_BATCH, VIEW_BATCH } from './reportRows';

export async function fetchColumnsFor(projectId: string, ids: string[], changesetId: string | null): Promise<ReportColumnRow[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunk(ids, COLUMN_BATCH).map((part) => queryReportColumns(projectId, part, changesetId)));
  return parts.flat();
}

export async function fetchViewsFor(projectId: string, ids: string[], changesetId: string | null): Promise<ReportViewRow[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunk(ids, VIEW_BATCH).map((part) => queryReportViews(projectId, part, changesetId)));
  const byId = new Map<string, ReportViewRow>();
  parts.flat().forEach((v) => byId.set(v.id, v));
  return [...byId.values()].sort((a, b) => (a.schema ?? '').localeCompare(b.schema ?? '')
    || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
