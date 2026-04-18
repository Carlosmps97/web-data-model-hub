// Core data model types for Data Model Hub

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableColumn {
  name: string;
  dataType: string;
  isPrimaryKey?: boolean;
  isSurrogateKey?: boolean;
  isPartitionKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
  isNullable?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;
}

export interface TableModel {
  id: string;
  name: string;
  schema?: string;
  columns: TableColumn[];
  functionalDefinition?: string;
  color?: string;
}

export interface Relationship {
  id: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

// Database engines a DataModel can target
export type DatabaseEngine =
  | 'postgresql'
  | 'mysql'
  | 'sqlserver'
  | 'oracle'
  | 'snowflake'
  | 'databricks'
  | 'bigquery'
  | 'redshift'
  | 'sqlite'
  | 'mongodb';

export interface DataModel {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  engine?: DatabaseEngine;
  tables: TableModel[];
  relationships: Relationship[];
  createdAt: string;
  updatedAt: string;
}

// Column data type options
export const COLUMN_DATA_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'float',
  'double',
  'decimal',
  'numeric',
  'varchar',
  'char',
  'text',
  'nvarchar',
  'boolean',
  'date',
  'datetime',
  'timestamp',
  'time',
  'binary',
  'varbinary',
  'blob',
  'json',
  'xml',
  'uuid',
  'array',
  'map',
  'struct',
] as const;

export type ColumnDataType = (typeof COLUMN_DATA_TYPES)[number] | string;

// Relationship type labels
export const RELATIONSHIP_TYPE_LABELS: Record<Relationship['type'], string> = {
  'one-to-one': '1:1',
  'one-to-many': '1:N',
  'many-to-many': 'N:M',
};
