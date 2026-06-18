/**
 * Convierte el `ExcelPreview` (ya editado por el usuario) en `Table[]` con la
 * forma project-centric. Genera ids estables, mapea `description` →
 * `functionalDefinition` y hereda `layer`/`domain`/`color` del scope actual.
 * No fija `position` — el editor calcula el layout.
 */

import { v4 as uuidv4 } from 'uuid';
import type { TableColumn, Table } from '@/types/model';
import type { PreviewTable } from '../services/excelImport.service';

export interface PreviewMeta {
  layer?: string;
  domain?: string;
  color?: string;
}

export function previewToTables(tables: PreviewTable[], meta: PreviewMeta = {}): Table[] {
  return tables.map((table) => ({
    id: uuidv4(),
    name: table.name,
    schema: table.schema ?? undefined,
    layer: meta.layer,
    domain: meta.domain,
    subdomain: '',
    color: meta.color ?? '#4f46e5',
    functionalDefinition: table.description ?? undefined,
    columns: table.columns.map(toColumn),
    views: [],
  }));
}

function toColumn(col: PreviewTable['columns'][number]): TableColumn {
  return {
    id: uuidv4(),
    name: col.name,
    dataType: col.dataType,
    length: col.length ?? undefined,
    scale: col.scale ?? undefined,
    functionalDefinition: col.functionalDefinition ?? undefined,
  };
}
