/**
 * canvasSession: clave de contexto de la sesión de canvas.
 *
 * El workspace re-sincroniza todo (`refreshExplorer`: proyecto activo del
 * modeler, árbol, esquemas, canvas) cuando cambia el contexto con el que se
 * abrió el modelo: proyecto, modo o changeset. El proyecto forma parte de la
 * clave: abrir otro proyecto en el mismo modo (readonly → readonly, el caso
 * «View production») también re-sincroniza; sin él, explorer, toolbar y canvas
 * quedarían en el proyecto anterior hasta recargar la página.
 *
 * Puro: la clave es un string estable para la misma sesión y distinto ante
 * cualquier cambio; `null` sin sesión de canvas.
 */
import type { OpenMode } from '@/store/useSessionStore';

export interface CanvasSession {
  openMode: OpenMode | null;
  activeChangesetId: string | null;
  activeProjectId: string | null;
}

export function canvasSessionKey(s: CanvasSession): string | null {
  if (!s.openMode) return null;
  return `${s.openMode}|${s.activeProjectId ?? ''}|${s.activeChangesetId ?? ''}`;
}
