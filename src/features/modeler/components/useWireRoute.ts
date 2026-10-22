import { useCallback, useState } from 'react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { routeOf, type RoutePoint } from '../lib/wireRoute';

/**
 * Trazo manual de un wire del canvas; lo comparten el wire crow's-foot y los
 * de subcategoría (tronco y ramas).
 *
 *  · `via`      — puntos a dibujar, o null para el camino automático. Sale
 *                 del store por selector (cambiar el trazo de un
 *                 wire no re-pinta los demás) y, mientras se arrastra un
 *                 tirador, del borrador local.
 *  · `editable` — mostrar los tiradores: wire seleccionado, sesión de edición
 *                 con working copy y zoom de detalle. Nunca en visor/snapshot
 *                 ni sobre un wire fantasma (relación en creación).
 *  · `commit`   — guarda el trazo (una escritura) y suelta el borrador.
 *
 * En modo visor, un auto-arrange de la sesión oculta los trazos publicados de
 * ese canvas (`viewerRoutesOff`): con los bloques en otro sitio no calzan.
 */
export function useWireRoute(id: string, pending: boolean) {
  const stored = useModelerStore((s) => routeOf(s.canvasRoutes, id));
  const hidden = useModelerStore((s) => !!s.viewerRoutesOff[s.activeSaId ?? '']);
  const selected = useModelerStore((s) => s.selectedEdgeId === id);
  const lod = useModelerStore((s) => s.lod);
  const editing = useSessionStore((s) => s.openMode === 'editing' && !!s.activeChangesetId);
  const viewer = useSessionStore((s) => s.openMode === 'readonly');
  const [draft, setDraft] = useState<RoutePoint[] | null>(null);

  const commit = useCallback((next: RoutePoint[] | null) => {
    void useModelerStore.getState().setWireRoute(id, next);
    setDraft(null);
  }, [id]);

  const editable = selected && editing && !lod && !pending;
  // El borrador solo cuenta mientras los tiradores están a la vista: fuera de
  // edición el wire dibuja siempre lo guardado.
  const current = pending ? null : (editable ? draft : null) ?? (viewer && hidden ? null : stored ?? null);
  return { via: current?.length ? current : null, editable, lod, setDraft, commit };
}
