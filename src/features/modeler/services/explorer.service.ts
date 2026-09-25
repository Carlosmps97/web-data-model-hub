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
 *
 * Perf 2026-09-08: el inventario trae SÓLO lo que el árbol dibuja. Tablas y
 * vistas llegan con el CONTEO de columnas, nunca con las columnas, y las de un
 * objeto se piden al expandirlo (`explorerColumns` / `explorerViewColumns`).
 * Medido en «Modelo DDV»: 36.73 MB → 1.33 MB (el `sql` de las vistas, 22.2 MB,
 * no lo pinta nadie; sus columnas, 12.6 MB, sólo al expandir).
 */
import { apiGet } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import { listReportColumns, type ReportColumnRow } from '@/services/reporting.service';
import * as csvc from '@/services/changeset.service';
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
  /** Badge de la fila. Las columnas EN SÍ se piden al expandir la vista
   *  (`explorerViewColumns`), igual que las de una tabla: en «Modelo DDV» las
   *  columnas de las 1 932 vistas eran 12.6 MB de los 36.7 MB del inventario. */
  columnCount: number;
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

/** Fila SLIM de vista tal como llega en el inventario. */
export interface InventoryViewRow {
  id: string; name: string; schema?: string | null;
  sourceTableIds?: string[]; columnCount?: number; custom?: boolean;
}

/** Fila de vista del inventario → fila del Explorer. `nameOf` resuelve ids de
 *  tablas fuente a su nombre físico (del propio inventario: cero lookups
 *  extra). Pura. */
export function mapView(v: InventoryViewRow, nameOf: (id: string) => string | undefined): DbxView {
  const srcIds = v.sourceTableIds ?? [];
  return {
    id: v.id, name: v.name, schema: v.schema ?? null,
    sourceTables: srcIds.map((id) => nameOf(id) ?? id), sourceTableIds: srcIds,
    columnCount: v.columnCount ?? 0, custom: !!v.custom,
  };
}

// ── Columnas de una VISTA (perezosas al expandir, como las de una tabla) ────

/** Crudo de `GET /api/projects/{id}/catalog/views/{vid}/columns` — forma
 *  uniforme para vistas Regular y Personalizada (doc 61). */
export interface RawViewColumn {
  outputAlias?: string | null; column?: string | null; tableId?: string | null;
  table?: string | null; castType?: string | null; expression?: string | null;
}

/** Columnas crudas → filas del Explorer; `nameOf` resuelve la tabla fuente con
 *  el inventario ya cargado (igual que antes lo hacía `mapView`). Pura. */
export function mapViewCols(raw: RawViewColumn[], nameOf: (id: string) => string | undefined): DbxViewCol[] {
  return raw.map((s) => ({
    outputAlias: s.outputAlias ?? null,
    sourceColumn: s.column ?? null,
    sourceTable: s.tableId ? (nameOf(s.tableId) ?? s.tableId) : (s.table ?? null),
    castType: s.castType ?? null,
    expression: s.expression ?? null,
  }));
}

/** Columnas de salida de UNA vista. Draft o publicado los resuelve el backend
 *  (mismo `changesetId` que el resto del Explorer). */
export async function explorerViewColumns(viewId: string): Promise<RawViewColumn[]> {
  const pid = encodeURIComponent(sessionProjectId());
  return apiGet<RawViewColumn[]>(
    `${API_BASE}/api/projects/${pid}/catalog/views/${encodeURIComponent(viewId)}/columns${csQuery()}`,
  );
}

// ── Columnas de una tabla (perezosas al expandir) ───────────────────────────

/** Doc 94: el orden único de una tabla — PK primero y cada bloque por ordinal. */
const pkFirst = (cols: DbxColumn[]): DbxColumn[] =>
  [...cols].sort((a, b) => Number(!!b.isPrimaryKey) - Number(!!a.isPrimaryKey) || a.ordinal - b.ordinal);

/** Columnas de una tabla en el orden único (en ambos modos). Draft → efectivo
 *  (overlay); producción → reporting. */
export async function explorerColumns(tableId: string): Promise<DbxColumn[]> {
  const cs = activeVersion();
  if (!cs) return pkFirst((await listReportColumns(sessionProjectId(), tableId)).map(mapReportCol));
  const docs = await csvc.effective<RawColumn>(cs, 'canonical_columns', { tableId });
  return pkFirst(docs.map(mapRawCol));
}

// ── Inventario por PROYECTO (doc 72 §1): UNA request ────────────────────────

export interface InventoryTableRow {
  id: string; physicalName: string; logicalName: string; schema?: string | null;
  description?: string | null; columnCount: number;
}
/** Respuesta cruda de `GET /api/projects/{id}/catalog/inventory`. */
export interface RawInventory {
  tables: InventoryTableRow[];
  views: InventoryViewRow[];
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
