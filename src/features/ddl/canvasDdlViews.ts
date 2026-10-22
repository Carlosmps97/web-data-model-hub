/**
 * Vistas del Export DDL = las miembro de este canvas (`diagram.views`, resueltas
 * por el backend con la regla única de membresía: la misma lista que el canvas
 * dibuja; en draft, con su overlay), no todas las vistas de sus tablas.
 * `showOnCanvas` viaja: decide la vista de negocio de las reglas.
 */
import type { View } from '@/services/views.service';
import type { DdlView } from './generators';

/** `diagram` = el `Diagram` del canvas (basta su lista `views`). */
export function canvasDdlViews(diagram: { views: View[] } | null): DdlView[] {
  return (diagram?.views ?? []).map((v) => ({
    id: v.id, tableId: v.tableId, sourceTableIds: v.sourceTableIds, name: v.name, schema: v.schema,
    sql: v.sql, description: v.description, sources: v.sources, showOnCanvas: v.showOnCanvas,
  }));
}
