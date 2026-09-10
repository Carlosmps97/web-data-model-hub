import type { DiffEntityDetail } from '@/types/versioning';

/**
 * Caché del popup «Change details» (doc 80 §8). Estados por entidad:
 *  · 'loading' — pedido en vuelo
 *  · 'missing' — el backend respondió, pero esa entidad no venía (no pertenece
 *                al changeset): NO es un error, es «no hay detalle»
 *  · 'error'   — el pedido falló; se puede reintentar
 *  · el objeto — el detalle resuelto
 *
 * El fallo NO puede borrar la entrada: al quedar `undefined` el render volvía a
 * «Loading diff…» y el popup se veía colgado para siempre (así se leyó el 500
 * de `/diff/details` del 2026-09-09 — un spinner eterno en vez de un error).
 * Puro: la lógica del caché se testea sin React.
 */
export type CacheEntry = DiffEntityDetail | 'loading' | 'missing' | 'error';
export type CacheMap = Record<string, CacheEntry>;
export interface DetailRef { collection: string; entityId: string }

export const keyOf = (collection: string, entityId: string) => `${collection}::${entityId}`;

/** Marca el lote como en vuelo sin pisar lo ya resuelto. Un 'error' previo SÍ
 *  se pisa: reintentar debe volver a mostrar el spinner. */
export function markLoading(prev: CacheMap, chunk: DetailRef[]): CacheMap {
  const next = { ...prev };
  for (const it of chunk) {
    const k = keyOf(it.collection, it.entityId);
    if (!(k in next) || next[k] === 'error') next[k] = 'loading';
  }
  return next;
}

/** Respuesta OK: lo devuelto se resuelve; lo pedido que no volvió es 'missing'. */
export function applyLoaded(prev: CacheMap, chunk: DetailRef[], got: DiffEntityDetail[]): CacheMap {
  const next = { ...prev };
  const returned = new Set(got.map((d) => keyOf(d.collection, d.entityId)));
  for (const d of got) next[keyOf(d.collection, d.entityId)] = d;
  for (const it of chunk) {
    const k = keyOf(it.collection, it.entityId);
    if (!returned.has(k)) next[k] = 'missing';
  }
  return next;
}

/** Fallo: 'error' (nunca borrar). Lo ya resuelto de antes se conserva. */
export function applyFailed(prev: CacheMap, chunk: DetailRef[]): CacheMap {
  const next = { ...prev };
  for (const it of chunk) {
    const k = keyOf(it.collection, it.entityId);
    if (next[k] === undefined || next[k] === 'loading') next[k] = 'error';
  }
  return next;
}
