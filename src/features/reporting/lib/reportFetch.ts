/**
 * Lecturas por lote del Reporting: columnas y vistas de muchas tablas con los
 * ids en el cuerpo (POST); en la URL, con 300 ids el servidor del front
 * respondería 431. Columnas en tandas de `COLUMN_BATCH` (300: respuestas de
 * tamaño razonable); vistas en tandas de `VIEW_BATCH` (2 000), sin repetir una
 * vista cuyas fuentes caen en dos tandas.
 * A lo sumo `LOTS_IN_FLIGHT` lotes en vuelo (`mapPool`): el timeout de cada
 * pedido corre desde que sale, y 50 a la vez se vencerían en cola; el primer
 * lote que falla corta la lectura.
 */
import { mapPool } from '@/lib/pool';
import {
  queryRelationshipsReport, queryReportColumns, queryReportViews, type RelationshipRow, type ReportColumnRow,
  type ReportViewRow,
} from '@/services/reporting.service';
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

/** Relaciones de las tablas del export, por lotes de `RELATIONSHIP_BATCH` ids
 *  (pedir las primeras 5 000 del proyecto y filtrarlas en el navegador dejaría
 *  fuera relaciones en proyectos grandes). Una relación con el padre en un lote
 *  y el hijo en otro llega en ambos: queda la del primer lote, con todas sus
 *  filas de par (una FK compuesta repite `id`). */
export async function fetchRelationshipsFor(projectId: string, ids: string[], changesetId: string | null): Promise<RelationshipRow[]> {
  if (ids.length === 0) return [];
  const parts = await mapPool(chunk(ids, RELATIONSHIP_BATCH), LOTS_IN_FLIGHT,
    (part) => queryRelationshipsReport(projectId, part, changesetId));
  const seen = new Set<string>();
  const out: RelationshipRow[] = [];
  for (const rows of parts) {
    const fresh = rows.filter((r) => !seen.has(r.id));   // los pares del mismo lote se quedan todos
    fresh.forEach((r) => seen.add(r.id));
    out.push(...fresh);
  }
  return out;
}
