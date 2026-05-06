// ─────────────────────────────────────────────────────────────────────────
//  Adaptadores entre el contrato del backend (agent-modeler) y los tipos
//  internos del editor (`@/types/model`).
//
//  Reglas:
//
//  1. El agente devuelve modelos agnósticos a la geometría del canvas
//     (no tiene `position`, `color`, `domain`, `tags`). Esos campos quedan
//     `undefined` y el frontend los maneja con defaults.
//
//  2. El agente devuelve `relationships: string[]` como texto libre. Para
//     el grafo del canvas usamos las FKs declaradas en las columnas
//     (`is_fk` + `fk_references`), que sí están estructuradas. El array
//     textual se preserva aparte para mostrarlo en el bloque de resultado
//     del chat.
//
//  3. `fk_references` tiene formato `"tabla.columna"`. Si no parsea,
//     la FK se ignora (no se fabrica una referencia inválida).
//
//  4. El tipo de relación siempre se marca como `one-to-many` (convención
//     del editor manual; ver `handleAddTable` en la página del modelo).
// ─────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { findColumnId } from '@/lib/columnRef';
import type {
  AgentColumn,
  AgentEngine,
  AgentTable,
  ModelingResponse,
} from './types';
import type {
  DatabaseEngine,
  Relationship,
  TableColumn,
  TableModel,
} from '@/types/model';

// ─── Engine mapping ──────────────────────────────────────────────────────

/**
 * Normaliza un engine del frontend al valor que entiende el backend.
 *
 * Tras la ampliación a los 5 motores del backend, esta función es
 * principalmente identity. Conserva el alias legacy `databricks`
 * → `databricks_sql` para modelos guardados antes de la ampliación.
 * Engines sin correspondencia (`oracle`) se degradan a `postgresql` con
 * una señal en consola; el caller puede detectarlo revisando el retorno.
 */
export function toAgentEngine(engine: DatabaseEngine | null | undefined): AgentEngine {
  switch (engine) {
    case 'databricks_sql':
    case 'cosmosdb':
    case 'sqlserver':
    case 'postgresql':
    case 'mysql':
      return engine;
    case 'databricks':
      // Alias legacy.
      return 'databricks_sql';
    case 'oracle':
      // El backend no soporta Oracle. Degradamos a postgresql, que es el
      // motor SQL más cercano en semántica para que el agente siga pudiendo
      // razonar sobre el modelo. El usuario debe cambiar el engine.
      if (typeof console !== 'undefined') {
        console.warn(
          "[agent-mapping] engine 'oracle' no soportado por el backend; usando 'postgresql' para este turno.",
        );
      }
      return 'postgresql';
    default:
      return 'databricks_sql';
  }
}

/**
 * Motor del backend → motor del frontend. Identity en el caso común.
 * El alias legacy `databricks` NO se reintroduce en sentido inverso:
 * el frontend ya soporta `databricks_sql` nativamente.
 */
export function fromAgentEngine(engine: AgentEngine): DatabaseEngine {
  return engine;
}

// ─── Data type parsing ───────────────────────────────────────────────────

/**
 * Parsea un data type estilo SQL (ej. `VARCHAR(50)`, `DECIMAL(10,2)`,
 * `BIGINT`) a los campos que espera `TableColumn`.
 *
 * Casos:
 *
 *  - `VARCHAR(50)` → `{ dataType: 'varchar', length: 50 }`
 *  - `DECIMAL(10,2)` → `{ dataType: 'decimal', length: 10, scale: 2 }`
 *  - `BIGINT` → `{ dataType: 'bigint' }`
 *  - Tipos con espacios (`TIMESTAMP WITH TIME ZONE`) → dataType completo
 *    en lowercase, sin length/scale.
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

// ─── Column / Table mapping ──────────────────────────────────────────────

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
 * `AgentColumn` → `TableColumn`.
 *
 * Nota: el agente nunca marca `isSurrogateKey`, `isPartitionKey`,
 * `isUnique`, `defaultValue`. Esas propiedades quedan `undefined` y
 * el usuario puede ajustarlas a mano en el editor si lo necesita.
 */
export function agentColumnToTableColumn(col: AgentColumn): TableColumn {
  const parsed = parseDataType(col.data_type);
  const fkRef = col.is_fk ? parseFkReference(col.fk_references) : undefined;

  return {
    // Fresh id per column — the agent output is plain JSON and doesn't
    // carry our canvas-internal identifiers. The backend normaliser
    // assigns an id when persisting (see `models_db._replace_entities`
    // and `db_models.TableColumnDoc.id`), but keeping a UUID here too
    // means the model is immediately self-consistent before any save.
    id: uuidv4(),
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
  };
}

/**
 * `AgentTable` → `TableModel`. Genera un `id` nuevo; el editor usa
 * IDs internos distintos al nombre de la tabla.
 */
export function agentTableToTableModel(table: AgentTable): TableModel {
  return {
    id: uuidv4(),
    name: table.table_name,
    columns: table.columns.map(agentColumnToTableColumn),
    functionalDefinition: table.table_description || undefined,
  };
}

/**
 * Deriva `Relationship[]` a partir de los `TableModel` ya convertidos.
 *
 * IMPORTANTE: esta función debe ejecutarse DESPUÉS de `agentTableToTableModel`
 * porque las relaciones ahora referencian `TableColumn.id` (no el nombre).
 * Leemos `foreignKeyRef` de cada columna (poblado por el mapper a partir
 * de `AgentColumn.fk_references`) y resolvemos el nombre de la columna
 * destino a un id vía `findColumnId`. FKs malformadas o que apuntan a
 * tablas/columnas ausentes se ignoran silenciosamente.
 */
export function tableModelsToRelationships(tables: TableModel[]): Relationship[] {
  const rels: Relationship[] = [];

  for (const table of tables) {
    for (const col of table.columns) {
      if (!col.isForeignKey) continue;
      const ref = col.foreignKeyRef;
      if (!ref?.table || !ref?.column) continue;
      const targetColId = findColumnId(tables, ref.table, ref.column);
      if (!targetColId) continue;
      rels.push({
        id: uuidv4(),
        sourceTable: table.name,
        sourceColumn: col.id,
        targetTable: ref.table,
        targetColumn: targetColId,
        type: 'one-to-many',
      });
    }
  }

  return rels;
}

/**
 * Convierte la respuesta completa del agente al par `{tables, relationships}`
 * listo para inyectar en `useModelStore`.
 *
 * IMPORTANTE: los IDs de las tablas generadas son nuevos (uuidv4). El caller
 * que quiera merge incremental debe resolver la identidad por `name`, no
 * por `id`.
 */
export function modelingResponseToCanvas(
  response: ModelingResponse,
): { tables: TableModel[]; relationships: Relationship[] } {
  const tables = response.tables.map(agentTableToTableModel);
  const relationships = tableModelsToRelationships(tables);
  return { tables, relationships };
}
