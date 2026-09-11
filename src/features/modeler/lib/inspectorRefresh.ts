/**
 * Doc 89 §3.6 — qué refrescar tras una escritura del Object Inspector.
 * Regla COMPLEMENTARIA a la del doc 88 §2: si el objeto está en el canvas
 * activo, `reload()` (y el propio reload sube `explorerTick` cuando cambia la
 * firma del diagrama); si no está (o no hay canvas), un cambio ESTRUCTURAL
 * (nombre, esquema, borrado) sube el tick a mano y uno no estructural
 * (definición, UDP, flags, orden) no toca el Explorer — no lo pinta. Puro.
 */
export type InspectorRefresh = 'reload' | 'bump' | 'none';

export function inspectorRefreshPlan(i: { onActiveCanvas: boolean; structural: boolean }): InspectorRefresh {
  if (i.onActiveCanvas) return 'reload';
  return i.structural ? 'bump' : 'none';
}
