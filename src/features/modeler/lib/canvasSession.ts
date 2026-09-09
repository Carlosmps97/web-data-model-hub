/**
 * canvasSession — clave de CONTEXTO de la sesión de canvas (doc 75 D8).
 *
 * El workspace re-sincroniza TODO (`refreshExplorer`: proyecto activo del
 * modeler, árbol, esquemas, canvas) cuando cambia el contexto con el que se
 * abrió el modelo: proyecto, modo o changeset. Antes el efecto sólo miraba
 * modo + changeset, así que abrir OTRO proyecto en el mismo modo (readonly →
 * readonly, el caso «View production») dejaba explorer/toolbar/canvas pegados
 * al proyecto anterior hasta recargar la página (owner 2026-09-08).
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
