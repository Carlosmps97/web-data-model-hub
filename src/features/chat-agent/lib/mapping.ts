// ─────────────────────────────────────────────────────────────────────────
//  Adaptadores entre el contrato del agente (app-agents-modeler) y los tipos
//  project-centric del editor (`@/types/model`).
//
//  El agente devuelve un modelo agnóstico a la jerarquía del proyecto: no
//  conoce `layer` (model level), `domain`, `subdomain`, `color`, `views`, ni
//  la geometría del canvas. Esos campos se asignan en la UI al "Aplicar al
//  canvas" (ver `ApplyToCanvasDialog`) y se inyectan acá vía `placement`.
//
//  Reglas:
//
//  1. Cada columna recibe un `id` estable (`ensureColumnId`). Las relaciones
//     del editor referencian `TableColumn.id`, nunca el nombre.
//
//  2. El agente declara FKs a nivel de columna (`is_fk` + `fk_references` con
//     formato `"tabla.columna"`). De ahí derivamos las `Relationship`
//     anidadas. El array textual `relationships` del agente es solo para
//     mostrar en el chat.
//
//  3. Convención de dirección (idéntica al `onCreateRel` manual del editor):
//     `source` = lado FK (hijo / "muchos"), `target` = lado PK referenciado
//     (padre / "uno"), `cardinality: '1:N'`. En la columna FK se marca
//     `foreignKeyRef = { table: <id destino>, column: <nombre col destino> }`.
//
//  4. Las FKs que no resuelven (tabla/columna destino ausente) se ignoran
//     en silencio: no se fabrica un wire inválido.
// ─────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import type { AgentColumn, AgentEngine, AgentTable, ModelingResponse } from './types';
import { ensureColumnId, findColumnId } from '@/lib/columnRef';
import type { DatabaseEngine, Relationship, Table, TableColumn } from '@/types/model';

// ─── Placement (jerarquía elegida en la UI al importar) ────────────────────

/** Ubicación destino para las tablas importadas del agente. Todos opcionales:
 *  lo elige el usuario en el diálogo de "Aplicar al canvas". */
export interface TablePlacement {
  /** ModelLevel id. */
  layer?: string;
  /** Domain id. */
  domain?: string;
  /** Subdomain label (de los `subdomains` del dominio). */
  subdomain?: string;
  /** Color de cabecera — heredado del dominio. */
  color?: string;
}

// ─── Engine mapping ────────────────────────────────────────────────────────

/**
 * Normaliza un engine del frontend al valor que entiende el backend. Tras la
 * unificación a los 5 motores soportados es prácticamente identity; cualquier
 * valor inesperado cae a `databricks_sql`.
 */
export function toAgentEngine(engine: DatabaseEngine | null | undefined): AgentEngine {
  switch (engine) {
    case 'databricks_sql':
    case 'cosmosdb':
    case 'sqlserver':
    case 'postgresql':
    case 'mysql':
      return engine;
    default:
      return 'databricks_sql';
  }
}

/** Motor del backend → motor del frontend. Identity (mismo conjunto). */
export function fromAgentEngine(engine: AgentEngine): DatabaseEngine {
  return engine;
}

// ─── Data type parsing ─────────────────────────────────────────────────────

/**
 * Parsea un data type estilo SQL (`VARCHAR(50)`, `DECIMAL(10,2)`, `BIGINT`) a
 * los campos que espera `TableColumn`.
 */
export function parseDataType(raw: string): {
  dataType: string;
  length?: number;
  scale?: number;
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { dataType: 'varchar' };

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_ ]*)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/);
  if (!match) {
    return { dataType: trimmed.toLowerCase() };
  }
  const base = match[1].trim().toLowerCase();
  const length = match[2] ? Number(match[2]) : undefined;
  const scale = match[3] ? Number(match[3]) : undefined;
  return {
    dataType: base,
    ...(length !== undefined ? { length } : {}),
    ...(scale !== undefined ? { scale } : {}),
  };
}

// ─── Column / Table mapping ────────────────────────────────────────────────

function parseFkReference(ref: string | null): { table: string; column: string } | undefined {
  if (!ref) return undefined;
  const idx = ref.indexOf('.');
  if (idx <= 0 || idx === ref.length - 1) return undefined;
  const table = ref.slice(0, idx).trim();
  const column = ref.slice(idx + 1).trim();
  if (!table || !column) return undefined;
  return { table, column };
}

/**
 * `AgentColumn` → `TableColumn`. La FK queda referenciada por NOMBRE
 * (`{ table, column }`); el id destino se resuelve en `deriveRelationships`
 * una vez que el conjunto de tablas final está armado.
 */
export function agentColumnToTableColumn(col: AgentColumn): TableColumn {
  const parsed = parseDataType(col.data_type);
  const fkRef = col.is_fk ? parseFkReference(col.fk_references) : undefined;

  return ensureColumnId({
    name: col.column_name,
    dataType: parsed.dataType,
    ...(parsed.length !== undefined ? { length: parsed.length } : {}),
    ...(parsed.scale !== undefined ? { scale: parsed.scale } : {}),
    isPrimaryKey: col.is_pk || undefined,
    isForeignKey: col.is_fk || undefined,
    ...(fkRef ? { foreignKeyRef: fkRef } : {}),
    isNullable: col.nullable,
    functionalDefinition: col.functional_definition || undefined,
    observations: col.observations || undefined,
  });
}

/**
 * `AgentTable` → `Table` project-centric. Genera un `id` nuevo, embebe
 * `views: []` y estampa la jerarquía elegida (`placement`).
 */
export function agentTableToTable(table: AgentTable, placement: TablePlacement = {}): Table {
  return {
    id: uuidv4(),
    name: table.table_name,
    columns: table.columns.map(agentColumnToTableColumn),
    views: [],
    functionalDefinition: table.table_description || undefined,
    ...(placement.layer ? { layer: placement.layer } : {}),
    ...(placement.domain ? { domain: placement.domain } : {}),
    ...(placement.subdomain ? { subdomain: placement.subdomain } : {}),
    ...(placement.color ? { color: placement.color } : {}),
  };
}

/**
 * Mezcla (upsert por NOMBRE físico) las tablas entrantes del agente sobre las
 * tablas existentes del proyecto. Un match existente conserva su `id`,
 * `position` y `schema`; reemplaza columnas + definición + placement con lo
 * último del agente. Las nuevas se agregan. Devuelve el conjunto resultante.
 */
function upsertByName(existing: Table[], incoming: Table[]): Table[] {
  const result = existing.slice();
  const indexByName = new Map(existing.map((t, i) => [t.name, i] as const));

  for (const t of incoming) {
    const idx = indexByName.get(t.name);
    if (idx !== undefined) {
      const prev = result[idx];
      result[idx] = {
        ...prev,
        columns: t.columns,
        functionalDefinition: t.functionalDefinition ?? prev.functionalDefinition,
        layer: t.layer ?? prev.layer,
        domain: t.domain ?? prev.domain,
        subdomain: t.subdomain ?? prev.subdomain,
        color: t.color ?? prev.color,
        views: prev.views ?? [],
      };
    } else {
      indexByName.set(t.name, result.length);
      result.push(t);
    }
  }
  return result;
}

/**
 * Deriva `Relationship[]` a partir de las FKs declaradas en las columnas.
 *
 * `sourceTableNames`, si se pasa, restringe el lado SOURCE a esas tablas (las
 * que el agente produjo) para no resucitar/duplicar relaciones de tablas
 * preexistentes; el lado TARGET puede ser cualquier tabla del conjunto.
 *
 * Efecto colateral intencional: reescribe `foreignKeyRef.table` de la columna
 * source al `id` destino resuelto, igual que el `onCreateRel` manual.
 */
export function deriveRelationships(
  tables: Table[],
  sourceTableNames?: Set<string>,
): Relationship[] {
  const rels: Relationship[] = [];

  for (const table of tables) {
    if (sourceTableNames && !sourceTableNames.has(table.name)) continue;
    for (const col of table.columns) {
      if (!col.isForeignKey || !col.foreignKeyRef) continue;
      const targetName = col.foreignKeyRef.table;
      const targetCol = col.foreignKeyRef.column;
      if (!targetName || !targetCol) continue;

      const targetTable =
        tables.find((t) => t.name === targetName) ?? tables.find((t) => t.id === targetName);
      if (!targetTable) continue;
      const targetColId = findColumnId(tables, targetTable.id, targetCol);
      if (!targetColId) continue;

      // Reescribe la FK al id destino (consistente con relaciones manuales).
      col.foreignKeyRef = { table: targetTable.id, column: targetCol };
      rels.push({
        id: uuidv4(),
        source: { table: table.id, column: col.id },
        target: { table: targetTable.id, column: targetColId },
        cardinality: '1:N',
      });
    }
  }

  return rels;
}

/**
 * Convierte la respuesta del agente al par `{ tables, relationships }` ya
 * MEZCLADO con las tablas existentes del proyecto, listo para `setTables` /
 * merge de relaciones en el editor.
 *
 * - `placement`: jerarquía elegida en la UI (layer/domain/subdomain/color).
 * - `existingTables`: tablas actuales del proyecto (para upsert por nombre y
 *   para que las FKs puedan apuntar a tablas preexistentes).
 */
export function modelingResponseToCanvas(
  response: ModelingResponse,
  placement: TablePlacement = {},
  existingTables: Table[] = [],
): { tables: Table[]; relationships: Relationship[] } {
  const incoming = response.tables.map((t) => agentTableToTable(t, placement));
  const incomingNames = new Set(incoming.map((t) => t.name));
  const tables = upsertByName(existingTables, incoming);
  const relationships = deriveRelationships(tables, incomingNames);
  return { tables, relationships };
}
