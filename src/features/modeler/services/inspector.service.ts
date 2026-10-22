/**
 * inspector.service — datos del Object Inspector: el dossier de solo lectura
 * de una tabla/entidad o de una vista en una sola request, efectivo
 * con versión activa (draft o `asof:`) y publicado sin ella. No depende del
 * canvas: sirve para leer la metadata sin abrir ningún diagrama.
 */
import { apiGet } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import { useSessionStore } from '@/store/useSessionStore';
import type {
  CanonicalColumn, CanonicalTable, TableLinkRow, TableUsageRow,
} from '@/services/governance.service';
import type { TableViewRow, View } from '@/services/views.service';

export interface InspectTableResult {
  table: CanonicalTable;
  /** Columnas efectivas en orden físico (la faceta se ordena en el cliente). */
  columns: CanonicalColumn[];
  /** Relaciones globales (parent/child, pares con nombres, canvases donde se ven). */
  links: TableLinkRow[];
  /** Vistas sobre la tabla con los canvases donde son miembro. */
  views: TableViewRow[];
  /** Dónde se usa: proyecto › carpeta › canvas. */
  usage: TableUsageRow[];
}
export interface InspectSource { id: string; physicalName: string; logicalName: string; schema?: string | null }
export interface InspectViewResult {
  view: View;
  /** Tablas fuente en el orden de la vista (t1, t2…). */
  sources: InspectSource[];
  usage: TableUsageRow[];
}

const csQuery = (): string => {
  const a = useSessionStore.getState().activeChangesetId;
  return a ? `?changesetId=${encodeURIComponent(a)}` : '';
};

export const inspectTable = (tableId: string) =>
  apiGet<InspectTableResult>(`${API_BASE}/api/catalog/inspect/tables/${encodeURIComponent(tableId)}${csQuery()}`);

export const inspectView = (viewId: string) =>
  apiGet<InspectViewResult>(`${API_BASE}/api/catalog/inspect/views/${encodeURIComponent(viewId)}${csQuery()}`);
