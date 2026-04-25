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
}

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
    id: 'oracle', label: 'Oracle', shortLabel: 'Oracle',
    color: '#c54138', bg: 'rgba(197, 65, 56, 0.08)',
    defaultSchema: 'HR', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'HASH'],
    supportsClustering: false,
    partitionHint: 'PARTITION BY (RANGE | LIST | HASH) (column).',
  },
  {
    id: 'databricks', label: 'Databricks SQL', shortLabel: 'Databricks',
    color: '#ff3621', bg: 'rgba(255, 54, 33, 0.08)',
    defaultSchema: 'default', supportsSchemas: true,
    partitionStrategies: ['NONE', 'RANGE', 'LIST', 'BUCKET'],
    supportsClustering: true,
    partitionHint: 'USING DELTA + PARTITIONED BY (cols), optional CLUSTER BY (Z-ORDER).',
  },
];

const ENGINE_MAP = new Map(ENGINES.map((e) => [e.id, e]));

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
