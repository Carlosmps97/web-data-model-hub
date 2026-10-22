/**
 * explorer.service — fuente de datos del Explorer unificado con el mismo
 * patrón changeset-aware que estructura/vistas: con versión activa (draft o
 * `asof:`) el backend aplica el overlay vía `changesetId`; sin versión,
 * producción publicada. El componente solo consume las filas `Dbx*`.
 *
 * El inventario del proyecto (tablas con `columnCount` + vistas de esas
 * tablas) llega en una sola request server-side
 * (`GET /api/projects/{id}/catalog/inventory`): componerlo en el cliente por
 * tandas de ids costaría, en draft, una request por tabla (miles en un modelo
 * grande) y saturaría el navegador y el log del backend.
 *
 * El inventario trae solo lo que el árbol dibuja. Tablas y vistas llegan con
 * el conteo de columnas, nunca con las columnas, y las de un objeto se piden
 * al expandirlo (`explorerColumns` / `explorerViewColumns`). En un modelo
 * grande la respuesta baja de ~37 MB a ~1.3 MB (el `sql` de las vistas, ~22 MB,
 * no lo pinta nadie; sus columnas, ~13 MB, solo al expandir).
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
  /** Id de la columna (el Explorer la centra y abre su Properties). */
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
  /** Nombres físicos de las tablas fuente (resueltos con el inventario). */
  sourceTables: string[];
  sourceTableIds: string[];
  /** Badge de la fila. Las columnas en sí se piden al expandir la vista
   *  (`explorerViewColumns`), igual que las de una tabla: en un modelo grande
   *  las columnas de las vistas pesarían cerca de un tercio del inventario. */
  columnCount: number;
  /** La vista tiene User-Defined SQL (texto informativo; sus columnas son igual
   *  las de `sources`). */
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

/** Fila slim de vista tal como llega en el inventario. */
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

// ── Columnas de una vista (perezosas al expandir, como las de una tabla) ────

/** Crudo de `GET /api/projects/{id}/catalog/views/{vid}/columns` — forma
 *  uniforme para toda vista: las columnas de `sources`. */
export interface RawViewColumn {
  outputAlias?: string | null; column?: string | null; tableId?: string | null;
  table?: string | null; castType?: string | null; expression?: string | null;
}

/** Columnas crudas → filas del Explorer; `nameOf` resuelve la tabla fuente con
 *  el inventario ya cargado (igual que `mapView`). Pura. */
export function mapViewCols(raw: RawViewColumn[], nameOf: (id: string) => string | undefined): DbxViewCol[] {
  return raw.map((s) => ({
    outputAlias: s.outputAlias ?? null,
    sourceColumn: s.column ?? null,
    sourceTable: s.tableId ? (nameOf(s.tableId) ?? s.tableId) : (s.table ?? null),
    castType: s.castType ?? null,
    expression: s.expression ?? null,
  }));
}

/** Columnas de salida de una vista. Draft o publicado los resuelve el backend
 *  (mismo `changesetId` que el resto del Explorer). */
export async function explorerViewColumns(viewId: string): Promise<RawViewColumn[]> {
  const pid = encodeURIComponent(sessionProjectId());
  return apiGet<RawViewColumn[]>(
    `${API_BASE}/api/projects/${pid}/catalog/views/${encodeURIComponent(viewId)}/columns${csQuery()}`,
  );
}

// ── Columnas de una tabla (perezosas al expandir) ───────────────────────────

/** Orden único de una tabla: PK primero y cada bloque por ordinal. */
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

// ── Inventario por proyecto: una sola request ──────────────────────────────

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
 *  catalog». El backend filtra las vistas por `projectId`, así que esto es solo
 *  margen, no la vía normal. */
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
