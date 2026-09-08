import * as gov from '@/services/governance.service';
import { useSessionStore } from '@/store/useSessionStore';
import { listSchemas } from './schemas.service';
import { distinctTableSchemas, tableSchemasFromCatalog } from '../lib/ctasPick';

/**
 * schemaPartition (doc 43) — esquemas que contienen TABLAS, para los combobox
 * de esquema de CTAS y New table · Import existing. Pedido del owner: esos
 * popups solo deben consultar `canonical_tables` — las vistas NI SE TOCAN (los
 * 189 esquemas `_vu` solo-de-vistas quedan fuera por construcción: ningún
 * doc de tabla vive ahí).
 *
 * Fast-path (doc 44): si TODO el catálogo de `schemas` trae `kind`, la
 * respuesta sale del catálogo (bajada chica) sin tocar el pool. Si algún
 * esquema no está clasificado — o el catálogo falla — se cae al distinct del
 * pool completo de tablas (~2.1k docs, pesado), que por eso se cachea a nivel
 * de módulo POR VERSIÓN ACTIVA: se paga una vez por sesión y lo comparten
 * ambos modales. El in-flight compartido evita el doble fetch del montaje
 * doble de StrictMode. Un fallo NO se cachea: el siguiente intento re-consulta.
 */

let cache: { key: string; value: string[] } | null = null;
let inflight: { key: string; p: Promise<string[]> } | null = null;

export function tableSchemasCached(): Promise<string[]> {
  // Doc 75: la foto es del proyecto Y la versión activos.
  const key = `${useSessionStore.getState().activeProjectId ?? ''}|${useSessionStore.getState().activeChangesetId ?? ''}`;
  if (cache?.key === key) return Promise.resolve(cache.value);
  if (inflight?.key === key) return inflight.p;
  const p = listSchemas()
    .then((catalog) => tableSchemasFromCatalog(catalog))
    .catch(() => null)
    .then((fast) => fast ?? gov.listTables().then(distinctTableSchemas))
    .then((value) => {
      cache = { key, value };
      return value;
    })
    .finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = { key, p };
  return p;
}
