/**
 * Column identity helpers.
 *
 * Since the column-ID migration, `Relationship.sourceColumn` /
 * `targetColumn` store `TableColumn.id` — not `TableColumn.name`. This
 * module centralises the two translations everyone needs:
 *
 *   - `findColumnId(tables, tableRef, columnName)`
 *       When you only have a column *name* (e.g. parsed from DBML or
 *       from a user-typed `foreignKeyRef`) and need to produce a
 *       relationship that points at the right `id`.
 *
 *   - `resolveColumnName(tables, tableRef, columnRef)`
 *       When you have a column *id* (e.g. `rel.sourceColumn`) and need
 *       to emit a human-readable identifier for DDL, DBML, SQL, etc.
 *       Falls back to treating the input as a name when no id matches,
 *       so legacy pre-migration relationships still render correctly
 *       in read-only views.
 *
 *   - `ensureColumnId(col)`
 *       Idempotent: returns the column unchanged if it already has an
 *       `id`, otherwise clones it and stamps a fresh UUID. Used by
 *       importers (Excel, DBML, SQL) and the agent-response mapper to
 *       keep all three ingestion paths consistent.
 *
 * Keeping this logic in one file means the frontend can adopt the
 * migration gradually: as soon as a component starts calling these
 * helpers it becomes ID-aware without needing to know the backfill
 * story.
 */

import { v4 as uuidv4 } from 'uuid';
import type { TableColumn, Table } from '@/types/model';

/**
 * Find a table by either id or physical name. Order matters: id match
 * wins so that after the migration any lingering name collisions don't
 * mis-resolve.
 */
function findTable(tables: Table[], tableRef: string): Table | undefined {
  return tables.find((t) => t.id === tableRef) ?? tables.find((t) => t.name === tableRef);
}

/**
 * Look up a column by its physical name and return its stable id.
 * Returns `null` when the table or column cannot be found — callers
 * should decide whether to surface an error or fall back.
 */
export function findColumnId(
  tables: Table[],
  tableRef: string,
  columnName: string,
): string | null {
  const t = findTable(tables, tableRef);
  if (!t) return null;
  const c = t.columns.find((c) => c.name === columnName);
  return c?.id ?? null;
}

/**
 * Look up a column by its stable id and return the current physical
 * name. If the ref doesn't match any id, falls back to a name match so
 * legacy (pre-migration) relationships whose `sourceColumn` still holds
 * a column name keep rendering. Returns `null` when neither matches.
 */
export function resolveColumnName(
  tables: Table[],
  tableRef: string,
  columnRef: string,
): string | null {
  const t = findTable(tables, tableRef);
  if (!t) return null;
  const byId = t.columns.find((c) => c.id === columnRef);
  if (byId) return byId.name;
  const byName = t.columns.find((c) => c.name === columnRef);
  return byName?.name ?? null;
}

/**
 * Same as `resolveColumnName` but returns the full `TableColumn` so
 * callers can inspect `dataType`, `logicalName`, etc. (Used by the
 * canvas to highlight related columns on hover.)
 */
export function resolveColumn(
  tables: Table[],
  tableRef: string,
  columnRef: string,
): TableColumn | null {
  const t = findTable(tables, tableRef);
  if (!t) return null;
  return (
    t.columns.find((c) => c.id === columnRef) ??
    t.columns.find((c) => c.name === columnRef) ??
    null
  );
}

/**
 * Stamp a UUID on the column if it doesn't have one yet. Importers
 * (Excel, DBML, SQL, agent) should pipe every freshly-constructed
 * column through this so the invariant "every persisted column has an
 * id" holds regardless of source.
 *
 * Does NOT mutate the input — returns the same reference when the id
 * was already present, otherwise a shallow clone.
 */
export function ensureColumnId<T extends Partial<TableColumn>>(col: T): T & { id: string } {
  if (typeof col.id === 'string' && col.id.length > 0) {
    return col as T & { id: string };
  }
  return { ...col, id: uuidv4() };
}

/**
 * Walks a `Table`'s columns and stamps ids on any that are
 * missing. Returns the same table reference when nothing changed,
 * otherwise a shallow clone with a fresh `columns` array. Cheap enough
 * to call during `loadModel` as a last-resort backfill for any records
 * the backend migration didn't reach.
 */
export function ensureTableColumnIds(table: Table): Table {
  let mutated = false;
  const columns = table.columns.map((c) => {
    if (typeof c.id === 'string' && c.id.length > 0) return c;
    mutated = true;
    return { ...c, id: uuidv4() };
  });
  return mutated ? { ...table, columns } : table;
}
