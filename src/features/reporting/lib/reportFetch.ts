/**
 * Lecturas por LOTE del Reporting (doc 102): columnas y vistas de muchas tablas
 * con los ids en el CUERPO (POST) — antes viajaban en la URL y con 300 ids el
 * servidor del front respondía 431. Columnas en tandas de `COLUMN_BATCH` (300:
 * respuestas de tamaño razonable); vistas en tandas de `VIEW_BATCH` (2 000), sin
 * repetir una vista cuyas fuentes caen en dos tandas.
 * Doc 105 (B8): a lo sumo `LOTS_IN_FLIGHT` lotes en vuelo (`mapPool`): el timeout
 * de cada pedido corre desde que sale, y 50 a la vez se vencían en cola; el
 * primer lote que falla corta la lectura.
 */
import { mapPool } from '@/lib/pool';
import {
  queryReportColumns, queryReportViews, type ReportColumnRow, type ReportViewRow,
} from '@/services/reporting.service';
import { queryRelationshipsReport, type RelationshipRow } from '../query.service';
import { chunk, COLUMN_BATCH, RELATIONSHIP_BATCH, VIEW_BATCH } from './reportRows';

/** Lotes en vuelo a la vez por lectura. */
export const LOTS_IN_FLIGHT = 4;

export async function fetchColumnsFor(projectId: string, ids: string[], changesetId: string | null): Promise<ReportColumnRow[]> {
  if (ids.length === 0) return [];
  const parts = await mapPool(chunk(ids, COLUMN_BATCH), LOTS_IN_FLIGHT,
    (part) => queryReportColumns(projectId, part, changesetId));
  return parts.flat();
}

export async function fetchViewsFor(projectId: string, ids: string[], changesetId: string | null): Promise<ReportViewRow[]> {
  if (ids.length === 0) return [];
  const parts = await mapPool(chunk(ids, VIEW_BATCH), LOTS_IN_FLIGHT,
    (part) => queryReportViews(projectId, part, changesetId));
  const byId = new Map<string, ReportViewRow>();
  parts.flat().forEach((v) => byId.set(v.id, v));
  return [...byId.values()].sort((a, b) => (a.schema ?? '').localeCompare(b.schema ?? '')
    || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Doc 105 (A3-o1): relaciones de las tablas del export, por lotes de
 *  `RELATIONSHIP_BATCH` ids — antes se pedían las primeras 5 000 del PROYECTO
 *  y se filtraban en el navegador (en proyectos grandes faltaban). Una relación
 *  con el padre en un lote y el hijo en otro llega en ambos: queda la del
 *  PRIMER lote, con todas sus filas de par (una FK compuesta repite `id`). */
export async function fetchRelationshipsFor(projectId: string, ids: string[], changesetId: string | null): Promise<RelationshipRow[]> {
  if (ids.length === 0) return [];
  const parts = await mapPool(chunk(ids, RELATIONSHIP_BATCH), LOTS_IN_FLIGHT,
    (part) => queryRelationshipsReport(projectId, part, changesetId));
  const seen = new Set<string>();
  const out: RelationshipRow[] = [];
  for (const rows of parts) {
    const fresh = rows.filter((r) => !seen.has(r.id));   // los pares del MISMO lote se quedan todos
    fresh.forEach((r) => seen.add(r.id));
    out.push(...fresh);
  }
  return out;
}
