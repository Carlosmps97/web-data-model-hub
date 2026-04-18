import type { DatabaseEngine } from '@/types/model';

export interface EngineDefinition {
  id: DatabaseEngine;
  label: string;
  /** Short display (badge in tight spaces). */
  shortLabel: string;
  /** Accent color for the badge border/text. */
  color: string;
  /** Background tint (rgba). */
  bg: string;
}

export const ENGINES: EngineDefinition[] = [
  { id: 'postgresql', label: 'PostgreSQL', shortLabel: 'PostgreSQL', color: '#336791', bg: 'rgba(51, 103, 145, 0.08)' },
  { id: 'mysql',      label: 'MySQL',      shortLabel: 'MySQL',      color: '#00758f', bg: 'rgba(0, 117, 143, 0.08)' },
  { id: 'sqlserver',  label: 'SQL Server', shortLabel: 'SQL Server', color: '#a91d22', bg: 'rgba(169, 29, 34, 0.08)' },
  { id: 'oracle',     label: 'Oracle',     shortLabel: 'Oracle',     color: '#c54138', bg: 'rgba(197, 65, 56, 0.08)' },
  { id: 'snowflake',  label: 'Snowflake',  shortLabel: 'Snowflake',  color: '#29b5e8', bg: 'rgba(41, 181, 232, 0.08)' },
  { id: 'databricks', label: 'Databricks SQL', shortLabel: 'Databricks', color: '#ff3621', bg: 'rgba(255, 54, 33, 0.08)' },
  { id: 'bigquery',   label: 'BigQuery',   shortLabel: 'BigQuery',   color: '#4285f4', bg: 'rgba(66, 133, 244, 0.08)' },
  { id: 'redshift',   label: 'Redshift',   shortLabel: 'Redshift',   color: '#8c4fff', bg: 'rgba(140, 79, 255, 0.08)' },
  { id: 'sqlite',     label: 'SQLite',     shortLabel: 'SQLite',     color: '#003b57', bg: 'rgba(0, 59, 87, 0.08)' },
  { id: 'mongodb',    label: 'MongoDB',    shortLabel: 'MongoDB',    color: '#13aa52', bg: 'rgba(19, 170, 82, 0.08)' },
];

const ENGINE_MAP = new Map(ENGINES.map((e) => [e.id, e]));

export function getEngine(id: DatabaseEngine | undefined | null): EngineDefinition | undefined {
  if (!id) return undefined;
  return ENGINE_MAP.get(id);
}
