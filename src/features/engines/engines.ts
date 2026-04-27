import type { DatabaseEngine, PartitionStrategy } from '@/types/model';

export interface EngineDefinition {
  id: DatabaseEngine;
  label: string;
  /** Short display (badge in tight spaces). */
  shortLabel: string;
  /** Accent color for the badge border/text. */
  color: string;
  /** Background tint (rgba). */
  bg: string;
  /** Conventional default schema when the user leaves the field blank. */
  defaultSchema: string;
  /** Whether this engine supports SQL schemas / namespaces in DDL. */
  supportsSchemas: boolean;
  /** Partition strategies the DDL generator can emit for this engine. */
  partitionStrategies: PartitionStrategy[];
  /** Whether the engine supports clustering / Z-ORDER on top of partitioning. */
  supportsClustering: boolean;
  /** A short hint shown in the partition UI to help the user. */
  partitionHint?: string;
  /**
   * Marks legacy engines that should NOT appear in the engine picker.
   * Loaded saved models with these values still render correctly via
   * `getEngine`, but the user cannot pick them on new models.
   */
  legacy?: boolean;
}

/**
 * Engines visible in the picker. These mirror exactly the set the AI agent
 * backend supports (`agent-modeler/src/config.py::SUPPORTED_ENGINES`) so a
 * model produced by the agent maps to a first-class entry here.
 */
export const ENGINES: EngineDefinition[] = [
  {
    id: 'postgresql', label: 'PostgreSQL', shortLabel: 'PostgreSQL',
    color: '#336791', bg: 'rgba(51, 103, 145, 0.08)',
    defaultSchema: 'public', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'HASH'],
    supportsClustering: false,
    partitionHint: 'PARTITION BY (RANGE | LIST | HASH) (column).',
  },
  {
    id: 'databricks_sql', label: 'Databricks SQL', shortLabel: 'Databricks',
    color: '#ff3621', bg: 'rgba(255, 54, 33, 0.08)',
    defaultSchema: 'default', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'BUCKET'],
    supportsClustering: true,
    partitionHint: 'USING DELTA + PARTITIONED BY (cols), optional CLUSTER BY (Z-ORDER).',
  },
  {
    id: 'sqlserver', label: 'SQL Server', shortLabel: 'SQL Server',
    color: '#a91d22', bg: 'rgba(169, 29, 34, 0.08)',
    defaultSchema: 'dbo', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE'],
    supportsClustering: false,
    partitionHint: 'PARTITION SCHEME backed by a PARTITION FUNCTION (RANGE).',
  },
  {
    id: 'mysql', label: 'MySQL', shortLabel: 'MySQL',
    color: '#00758f', bg: 'rgba(0, 117, 143, 0.08)',
    defaultSchema: 'public', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'HASH'],
    supportsClustering: false,
    partitionHint: 'PARTITION BY (RANGE | LIST | HASH) (col); subpartitions optional.',
  },
  {
    id: 'cosmosdb', label: 'Cosmos DB', shortLabel: 'Cosmos',
    color: '#0078d4', bg: 'rgba(0, 120, 212, 0.08)',
    // Cosmos uses (database, container) but we surface a single "namespace"
    // string that the agent uses when it labels containers.
    defaultSchema: 'default', supportsSchemas: false,
    partitionStrategies: ['NONE'],
    supportsClustering: false,
    partitionHint: 'Cosmos DB is NoSQL: partition keys are container-level, not table-level.',
  },
];

/**
 * Legacy engines kept reachable by `getEngine` so old saved models still
 * render with a meaningful badge. Hidden from the picker.
 */
const LEGACY_ENGINES: EngineDefinition[] = [
  {
    id: 'databricks', label: 'Databricks (legacy)', shortLabel: 'Databricks',
    color: '#ff3621', bg: 'rgba(255, 54, 33, 0.08)',
    defaultSchema: 'default', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'BUCKET'],
    supportsClustering: true,
    partitionHint: 'Legacy alias of databricks_sql (auto-migrated on read).',
    legacy: true,
  },
  {
    id: 'oracle', label: 'Oracle (legacy)', shortLabel: 'Oracle',
    color: '#c54138', bg: 'rgba(197, 65, 56, 0.08)',
    defaultSchema: 'HR', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'HASH'],
    supportsClustering: false,
    partitionHint: 'PARTITION BY (RANGE | LIST | HASH) (column). DDL kept for compatibility.',
    legacy: true,
  },
];

const ENGINE_MAP = new Map<DatabaseEngine, EngineDefinition>([
  ...ENGINES.map((e) => [e.id, e] as const),
  ...LEGACY_ENGINES.map((e) => [e.id, e] as const),
]);

/**
 * Look up an engine definition.
 *
 * Returns a definition for both pickable and legacy engines. Returns
 * `undefined` only when `id` is null/undefined or unknown — callers
 * should treat that as "engine not set".
 */
export function getEngine(id: DatabaseEngine | undefined | null): EngineDefinition | undefined {
  if (!id) return undefined;
  return ENGINE_MAP.get(id);
}

/** Resolve the schema for a table given the model engine, falling back to engine default. */
export function resolveSchema(
  tableSchema: string | undefined,
  engine: DatabaseEngine | undefined | null
): string {
  const trimmed = tableSchema?.trim();
  if (trimmed) return trimmed;
  return getEngine(engine)?.defaultSchema ?? 'public';
}
