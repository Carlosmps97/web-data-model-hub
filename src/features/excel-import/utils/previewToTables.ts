/**
 * Convierte el `ExcelPreview` (ya editado por el usuario en el modal)
 * en los `TableModel[]` que el resto de la app sabe manejar.
 *
 * Responsabilidades acotadas:
 * - Generar `id` estables (UUID) tanto para tabla como para columna.
 * - Mapear `description` (de TablesDescriptions) → `functionalDefinition`
 *   en `TableModel`, que es donde el resto de la UI muestra la
 *   descripción funcional de la tabla.
 * - Conservar `length`/`scale` de cada columna.
 * - Layout inicial determinístico — 3 columnas, espaciado fijo.
 *   `ELK` lo reacomoda después por `layoutNonce`.
 */

import { v4 as uuidv4 } from 'uuid';
import type { TableColumn, TableModel } from '@/types/model';
import type { PreviewTable } from '@/features/excel-import/services/excelImport.service';

const GRID_COLUMNS = 3;
const X_SPACING = 350;
const Y_SPACING = 400;
const X_OFFSET = 50;
const Y_OFFSET = 50;

export function previewToTables(tables: PreviewTable[]): TableModel[] {
  return tables.map((table, index) => ({
    id: uuidv4(),
    name: table.name,
    schema: table.schema ?? undefined,
    functionalDefinition: table.description ?? undefined,
    columns: table.columns.map(toColumn),
    position: {
      x: (index % GRID_COLUMNS) * X_SPACING + X_OFFSET,
      y: Math.floor(index / GRID_COLUMNS) * Y_SPACING + Y_OFFSET,
    },
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
