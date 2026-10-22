import * as gov from '@/services/governance.service';
import { useSessionStore } from '@/store/useSessionStore';
import { listSchemas } from './schemas.service';
import { distinctTableSchemas, tableSchemasFromCatalog } from '../lib/ctasPick';

/**
 * schemaPartition — esquemas que contienen tablas, para los combobox de
 * esquema de CTAS y New table · Import existing. Esos popups solo consultan
 * `canonical_tables`: las vistas no se tocan (los esquemas `_vu` solo de
 * vistas quedan fuera por construcción: ningún doc de tabla vive ahí).
 *
 * Fast-path: si cada esquema del catálogo de `schemas` trae `kind`, la
 * respuesta sale del catálogo (bajada chica) sin tocar el pool. Si algún
 * esquema no está clasificado — o el catálogo falla — se cae al distinct del
 * pool completo de tablas (miles de docs, pesado), que por eso se cachea a
 * nivel de módulo por versión activa: se paga una vez por sesión y lo
 * comparten ambos modales. El in-flight compartido evita el doble fetch del
 * montaje doble de StrictMode. Un fallo no se cachea: el siguiente intento
 * re-consulta.
 */

let cache: { key: string; value: string[] } | null = null;
let inflight: { key: string; p: Promise<string[]> } | null = null;
let generation = 0;

/** Se llama cuando el catálogo cambia dentro de la versión (Structure · Schemas
 *  guarda un alta, un rename, un cambio de kind o un borrado, o `loadSchemas`
 *  del store trae un catálogo distinto: un alta desde un combo, un pegado que
 *  crea su esquema, una carga Excel): la próxima llamada vuelve a consultar.
 *  Una respuesta que ya estaba en vuelo no repone la foto desactualizada. */
export function invalidateTableSchemas(): void {
  generation += 1;
  cache = null;
  inflight = null;
}

export function tableSchemasCached(): Promise<string[]> {
  // La foto es del proyecto y la versión activos.
  const key = `${useSessionStore.getState().activeProjectId ?? ''}|${useSessionStore.getState().activeChangesetId ?? ''}`;
  if (cache?.key === key) return Promise.resolve(cache.value);
  if (inflight?.key === key) return inflight.p;
  const gen = generation;
  const p = listSchemas()
    .then((catalog) => tableSchemasFromCatalog(catalog))
    .catch(() => null)
    .then((fast) => fast ?? gov.listTables().then(distinctTableSchemas))
    .then((value) => {
      if (gen === generation) cache = { key, value };
      return value;
    })
    .finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = { key, p };
  return p;
}
