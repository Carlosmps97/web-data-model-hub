/**
 * facetEditable (doc 85 §3.7) — qué campos EDITA cada faceta en los Properties
 * del canvas. Espejo, restringido a lo que los paneles muestran, de los
 * contratos TABLE/COLUMN_FACET_FIELDS del backend: los campos de la otra
 * faceta se ven en solo-lectura con el hint «Switch the canvas to … to edit»;
 * lo compartido se edita en ambas. Puro.
 */
import type { Facet } from '@/lib/facets';

export type TableField = 'logicalName' | 'physicalName' | 'schema' | 'description';
export type ColumnField =
  | 'logicalName' | 'physicalName' | 'description' | 'physicalDescription'
  | 'logicalDataType' | 'dataType' | 'isNullable' | 'isPartition'
  | 'isPrimaryKey' | 'isForeignKey' | 'parentDomainId';

const TABLE: Record<TableField, Facet | 'shared'> = {
  logicalName: 'logical', physicalName: 'physical', schema: 'physical', description: 'shared',
};
const COLUMN: Record<ColumnField, Facet | 'shared'> = {
  logicalName: 'logical', logicalDataType: 'logical', description: 'logical',
  physicalName: 'physical', dataType: 'physical', physicalDescription: 'physical', isNullable: 'physical', isPartition: 'physical',
  isPrimaryKey: 'shared', isForeignKey: 'shared', parentDomainId: 'shared',
};

export function facetEditable(level: 'table', field: TableField, facet: Facet): boolean;
export function facetEditable(level: 'column', field: ColumnField, facet: Facet): boolean;
export function facetEditable(level: 'table' | 'column', field: string, facet: Facet): boolean {
  const owner = level === 'table' ? TABLE[field as TableField] : COLUMN[field as ColumnField];
  return owner === 'shared' || owner === facet;
}
