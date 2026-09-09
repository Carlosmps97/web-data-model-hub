/**
 * explorer.service (docs 25 · 71 · 72) — fuente de datos del Explorer unificado
 * con el MISMO patrón changeset-aware que estructura/vistas: con versión activa
 * (draft o `asof:`) el backend aplica el overlay vía `changesetId`; sin versión,
 * producción publicada. El componente sólo consume las filas `Dbx*`.
 *
 * Doc 72 §1: el inventario del proyecto (tablas con `columnCount` + vistas de
 * esas tablas) llega en UNA request server-side
 * (`GET /api/projects/{id}/catalog/inventory`). Antes se componía en el cliente
 * por tandas de ids — en draft eran miles de requests (una por tabla) para
 * «Modelo DDV», saturaban el navegador y el log del backend.
 */
import { apiGet } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import { listReportColumns, type ReportColumnRow } from '@/services/reporting.service';
import * as csvc from '@/services/changeset.service';
import type { View } from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { sessionProjectId } from '@/store/useSessionStore';

export interface DbxTable {
  id: string; physicalName: string; logicalName?: string; columnCount?: number;
  schema?: string | null; description?: string | null;
}
export interface DbxColumn {
  /** Doc 71: id de la columna (para centrar + abrir su Properties desde el Explorer). */
  id?: string;
  physicalName: string; logicalName?: string; dataType: string;
  isPrimaryKey?: boolean; isForeignKey?: boolean; description?: string; ordinal: number;
}
export interface DbxViewCol {
  outputAlias?: string | null; sourceTable?: string | null; sourceColumn?: string | null;
  castType?: string | null; expression?: string | null;
}
export interface DbxView {
  id: string; name: string; schema?: string | null;
  /** Nombres físicos de las tablas fuente (resueltos desde el inventario). */
  sourceTables: string[];
  sourceTableIds: string[];
  columns: DbxViewCol[];
  /** Doc 61: vista Personalizada (custom SQL) — sus columnas salen del parse. */
  custom: boolean;
}

// Doc crudo de `/effective` (subconjunto que usa el Explorer).
interface RawColumn {
  id: string; tableId: string; physicalName: string; logicalName?: string; dataType: string;
  isPrimaryKey?: boolean | null; isForeignKey?: boolean | null; description?: string | null; ordinal?: number;
}

/** Versión activa (draft o `asof:`) o `null` en producción. */
const activeVersion = (): string | null => useSessionStore.getState().activeChangesetId;
const csQuery = (): string => {
  const a = activeVersion();
  return a ? `?changesetId=${encodeURIComponent(a)}` : '';
};

// ── Mappers ────────────────────────────────────────────────────────────────
const mapReportCol = (c: ReportColumnRow): DbxColumn => ({
  id: c.id,
  physicalName: c.physicalName, logicalName: c.logicalName, dataType: c.dataType,
  isPrimaryKey: c.isPrimaryKey, isForeignKey: c.isForeignKey, description: c.description, ordinal: c.ordinal,
});
const mapRawCol = (c: RawColumn): DbxColumn => ({
  id: c.id,
  physicalName: c.physicalName, logicalName: c.logicalName, dataType: c.dataType,
  isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey,
  description: c.description ?? undefined, ordinal: c.ordinal ?? 0,
});

/** Vista de la API → fila del Explorer. `nameOf` resuelve ids de tablas fuente
 *  a su nombre físico (del propio inventario: cero lookups extra). Personalizada
 *  (doc 61) → columnas derivadas del parse; Regular → `sources`. Pura. */
export function mapView(v: View, nameOf: (id: string) => string | undefined): DbxView {
  const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
  const custom = !!(v.customSql && v.customSql.trim());
  const columns: DbxViewCol[] = custom
    ? (v.customColumns ?? []).map((c) => ({ outputAlias: c.name, expression: c.expression ?? null, sourceTable: null, sourceColumn: null, castType: null }))
    : (v.sources ?? []).map((s) => ({
      outputAlias: s.outputAlias ?? null,
      sourceColumn: s.column ?? null,
      sourceTable: s.tableId ? (nameOf(s.tableId) ?? s.tableId) : (s.table ?? null),
      castType: s.castType ?? null,
      expression: s.expression ?? null,
    }));
  return {
    id: v.id, name: v.name, schema: v.schema ?? null,
    sourceTables: srcIds.map((id) => nameOf(id) ?? id), sourceTableIds: srcIds, columns, custom,
  };
}

// ── Columnas de una tabla (perezosas al expandir) ───────────────────────────

/** Columnas de una tabla. Draft → efectivo (overlay); producción → reporting. */
export async function explorerColumns(tableId: string): Promise<DbxColumn[]> {
  const cs = activeVersion();
  if (!cs) return (await listReportColumns(sessionProjectId(), tableId)).map(mapReportCol);
  const docs = await csvc.effective<RawColumn>(cs, 'canonical_columns', { tableId });
  return docs.map(mapRawCol).sort((a, b) => a.ordinal - b.ordinal);
}

// ── Inventario por PROYECTO (doc 72 §1): UNA request ────────────────────────

export interface InventoryTableRow {
  id: string; physicalName: string; logicalName: string; schema?: string | null;
  description?: string | null; columnCount: number;
}
/** Respuesta cruda de `GET /api/projects/{id}/catalog/inventory`. */
export interface RawInventory {
  tables: InventoryTableRow[];
  views: View[];
  canvases: number;
  total: { tables: number; views: number };
}
export interface ProjectInventory { tables: DbxTable[]; views: DbxView[]; canvases: number }

/** Inventario crudo → filas del Explorer (nombres de fuentes desde la misma respuesta). Pura. */
export function mapInventory(raw: RawInventory): ProjectInventory {
  const tables: DbxTable[] = raw.tables.map((t) => ({
    id: t.id, physicalName: t.physicalName, logicalName: t.logicalName,
    schema: t.schema ?? null, description: t.description ?? null, columnCount: t.columnCount,
  }));
  const names = new Map(tables.map((t) => [t.id, t.physicalName]));
  return { tables, views: raw.views.map((v) => mapView(v, (id) => names.get(id))), canvases: raw.canvases };
}

/** Colchón de timeout del inventario: un proyecto grande (miles de tablas/vistas)
 *  puede tardar más que el default de 30 s y disparar «Couldn't load the project
 *  catalog». Con el fix server-side (vistas por `projectId`) esto es sólo margen,
 *  no la vía normal. */
const INVENTORY_TIMEOUT_MS = 60_000;

/** Tablas (con `columnCount`) y vistas de los canvases del proyecto — efectivo
 *  con versión activa, publicado sin ella. */
export async function projectInventory(projectId: string): Promise<ProjectInventory> {
  const raw = await apiGet<RawInventory>(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/catalog/inventory${csQuery()}`,
    { timeoutMs: INVENTORY_TIMEOUT_MS },
  );
  return mapInventory(raw);
}
