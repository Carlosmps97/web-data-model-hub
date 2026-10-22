/**
 * viewDdl — el DDL de una vista tal como lo escribe el Export DDL: sale de sus
 * columnas (`sources`; con 2+ fuentes `FROM t1, t2` sin JOIN), nunca de la
 * User-Defined SQL, que es texto informativo. Un solo armado para Properties,
 * el Inspector y el export HTML.
 */
import { DEFAULT_DATABRICKS_OPTS, viewDDL, type DdlView } from '@/features/ddl';

export interface ViewDdlInput {
  id: string; name: string; schema?: string | null;
  tableId?: string | null; sourceTableIds?: string[] | null;
  sources?: DdlView['sources'] | null; sql?: string | null; description?: string | null;
}
export interface ViewDdlTable { id: string; physicalName: string; logicalName?: string | null; schema?: string | null }

export function generatedViewDdl(view: ViewDdlInput, tables: Iterable<ViewDdlTable>): string {
  const byId = new Map<string, { id: string; physicalName: string; logicalName?: string; schema?: string }>();
  for (const t of tables) {
    byId.set(t.id, { id: t.id, physicalName: t.physicalName, logicalName: t.logicalName ?? undefined, schema: t.schema ?? undefined });
  }
  const dv: DdlView = {
    id: view.id, name: view.name, schema: view.schema ?? undefined,
    tableId: view.tableId ?? undefined, sourceTableIds: view.sourceTableIds ?? undefined,
    sources: view.sources ?? undefined, sql: view.sql ?? undefined, description: view.description ?? undefined,
  };
  return viewDDL(dv, { ...DEFAULT_DATABRICKS_OPTS, includeComments: false }, byId).trim();
}
