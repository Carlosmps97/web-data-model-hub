/**
 * explorer.service (doc 25) — fuente de datos del Database Explorer, con el
 * MISMO patrón changeset-aware que schemas/estructura/vistas:
 *   - CON versión activa (draft) → estado EFECTIVO (publicado + overlay del
 *     changeset), vía los endpoints `/effective`. Así una tabla/vista/columna
 *     creada, renombrada o borrada en la versión aparece al instante en el
 *     Explorer (pedido del owner: "el Explorer muestra la versión en que trabajo").
 *   - SIN versión (producción) → endpoints de reporting/catálogo (como antes).
 *
 * El componente sólo consume las filas `Dbx*` de acá y no sabe de qué fuente
 * vienen. El doc crudo del `/effective` NO trae `columnCount` (lo agrega el
 * reporting con un $group); en draft el badge se rellena perezosamente al
 * expandir la tabla (ver DatabaseExplorer).
 */
import { apiGet } from '@/services/http';
import {
  listReportColumns, listReportTables, listReportViews,
  type ReportColumnRow,
} from '@/services/reporting.service';
import { listSchemas, type DbSchema } from '@/features/modeler/services/schemas.service';
import * as csvc from '@/features/governance/services/changeset.service';
import type { View } from '@/services/views.service';
import { useChangesetStore } from '@/store/useChangesetStore';

import { API_BASE } from '@/services/apiBase';
/** Tope de tablas por esquema (igual que el reporting per-schema del Explorer). */
const TABLES_CAP = 500;

export type DbxSchema = DbSchema;
export interface DbxTable { id: string; physicalName: string; logicalName?: string; columnCount?: number }
export interface DbxColumn {
  physicalName: string; logicalName?: string; dataType: string;
  isPrimaryKey?: boolean; isForeignKey?: boolean; description?: string; ordinal: number;
}
export interface DbxViewCol {
  outputAlias?: string | null; sourceTable?: string | null; sourceColumn?: string | null;
  castType?: string | null; expression?: string | null;
}
export interface DbxView { id: string; name: string; schema?: string | null; sourceTables: string[]; columns: DbxViewCol[] }
export interface DbxHit { id: string; physicalName: string; logicalName?: string; schema?: string }

// Docs crudos que devuelve `/effective` (subconjunto que usa el Explorer).
interface RawTable { id: string; physicalName: string; logicalName?: string; schema?: string }
interface RawColumn {
  id: string; tableId: string; physicalName: string; logicalName?: string; dataType: string;
  isPrimaryKey?: boolean | null; isForeignKey?: boolean | null; description?: string | null; ordinal?: number;
}

/** Versión activa (draft) o `null` en producción. */
const activeVersion = (): string | null => useChangesetStore.getState().activeId;

/** ¿El Explorer está mostrando una versión (draft) en vez de producción? */
export const explorerIsDraft = (): boolean => activeVersion() !== null;

// ── Mappers ────────────────────────────────────────────────────────────────
const mapReportCol = (c: ReportColumnRow): DbxColumn => ({
  physicalName: c.physicalName, logicalName: c.logicalName, dataType: c.dataType,
  isPrimaryKey: c.isPrimaryKey, isForeignKey: c.isForeignKey, description: c.description, ordinal: c.ordinal,
});
const mapRawCol = (c: RawColumn): DbxColumn => ({
  physicalName: c.physicalName, logicalName: c.logicalName, dataType: c.dataType,
  isPrimaryKey: !!c.isPrimaryKey, isForeignKey: !!c.isForeignKey,
  description: c.description ?? undefined, ordinal: c.ordinal ?? 0,
});
const mapDraftView = (v: View): DbxView => ({
  id: v.id, name: v.name, schema: v.schema ?? null,
  // En draft no resolvemos ids→"esquema.tabla" (evita N lookups); el tooltip de
  // fuentes se omite. Las columnas salen de `sources` (editor de vista).
  sourceTables: [],
  columns: (v.sources ?? []).map((s) => ({
    outputAlias: s.outputAlias ?? null,
    sourceColumn: s.column ?? null,
    sourceTable: s.tableId ?? s.table ?? null,
    castType: s.castType ?? null,
    expression: s.expression ?? null,
  })),
});

// ── API del Explorer (conmuta efectivo/publicado) ───────────────────────────

/** Esquemas: `listSchemas` ya conmuta efectivo/publicado según la versión activa. */
export const explorerSchemas = (): Promise<DbxSchema[]> => listSchemas();

/** Tablas de un esquema. Draft → efectivo (overlay); producción → reporting. */
export async function explorerTables(schema: string): Promise<DbxTable[]> {
  const cs = activeVersion();
  if (!cs) {
    const rows = await listReportTables({ schema, limit: TABLES_CAP });
    return rows.map((t) => ({ id: t.id, physicalName: t.physicalName, logicalName: t.logicalName, columnCount: t.columnCount }));
  }
  const docs = await csvc.effective<RawTable>(cs, 'canonical_tables', { schema, limit: TABLES_CAP });
  // columnCount lo rellena el Explorer al expandir (no viene en el doc crudo).
  return docs.map((t) => ({ id: t.id, physicalName: t.physicalName, logicalName: t.logicalName }));
}

/** Vistas de un esquema. Draft → efectivo (overlay); producción → reporting. */
export async function explorerViews(schema: string): Promise<DbxView[]> {
  const cs = activeVersion();
  if (!cs) {
    const rows = await listReportViews(undefined, schema);
    return rows.map((v) => ({ id: v.id, name: v.name, schema: v.schema, sourceTables: v.sourceTables, columns: v.columns }));
  }
  const docs = await csvc.effective<View>(cs, 'views', { schema });
  return docs.map(mapDraftView);
}

/** Columnas de una tabla. Draft → efectivo (overlay); producción → reporting. */
export async function explorerColumns(tableId: string): Promise<DbxColumn[]> {
  const cs = activeVersion();
  if (!cs) return (await listReportColumns(tableId)).map(mapReportCol);
  const docs = await csvc.effective<RawColumn>(cs, 'canonical_columns', { tableId });
  return docs.map(mapRawCol).sort((a, b) => a.ordinal - b.ordinal);
}

/** Búsqueda por nombre. Draft → efectivo (overlay); producción → catálogo. */
export async function explorerSearch(q: string, limit = 50): Promise<DbxHit[]> {
  const cs = activeVersion();
  if (!cs) return apiGet<DbxHit[]>(`${API_BASE}/api/catalog/tables?q=${encodeURIComponent(q)}&limit=${limit}`);
  const docs = await csvc.effective<RawTable>(cs, 'canonical_tables', { q, limit });
  return docs.map((t) => ({ id: t.id, physicalName: t.physicalName, logicalName: t.logicalName, schema: t.schema }));
}
