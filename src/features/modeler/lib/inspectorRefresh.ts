/**
 * Qué refrescar tras una escritura del Object Inspector. Complementa la regla
 * de `reload()` (que sube `explorerTick` cuando cambia la firma del diagrama):
 * si el objeto está en el canvas activo, `reload()`; si no está (o no hay
 * canvas), un cambio estructural (nombre, esquema, borrado) sube el tick a
 * mano y uno no estructural (definición, UDP, flags, orden) no toca el
 * Explorer, que no lo muestra. Puro.
 */
export type InspectorRefresh = 'reload' | 'bump' | 'none';

export function inspectorRefreshPlan(i: { onActiveCanvas: boolean; structural: boolean }): InspectorRefresh {
  if (i.onActiveCanvas) return 'reload';
  return i.structural ? 'bump' : 'none';
}
