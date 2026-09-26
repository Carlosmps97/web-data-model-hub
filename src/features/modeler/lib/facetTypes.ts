/**
 * facetTypes — reglas del TIPO entre las dos facetas de una columna (doc 96 D8):
 * un tipo complejo es el MISMO en lógico y físico (su estructura es propia de
 * cada columna); los simples son independientes (doc 69). Espejo de
 * `mirror_complex` / `synced_other_facet` del backend. Puro. Vive aparte de
 * `complexTypes` porque necesita la gramática de `typePick` (que ya importa
 * `complexTypes`).
 */
import { hasComplexContent, isComplexTypeStart } from './complexTypes';
import { canonicalDefaultType, parseParamType } from './typePick';

/** ¿Un tipo SIMPLE completo del catálogo (`STRING`, `VARCHAR(20)`, alias como
 *  `INT`)? Los estados intermedios del tecleo (`S`, `ARRAY`, `VARCHAR(`) no. */
export function isCompleteSimpleType(t: string): boolean {
  return parseParamType(canonicalDefaultType(t)) !== null;
}

/** Si `source` es un complejo con estructura y `target` no, `target` toma
 *  `source`; si no, queda. Direccional: `source` es la faceta que manda. */
export function mirrorComplex(source: string, target: string): string {
  return hasComplexContent(source) && !hasComplexContent(target) ? source : target;
}

/** Al poner `next` en una faceta, qué toma la otra: `next` si es complejo, o si
 *  las dos eran el MISMO tipo y ese tipo no era un simple completo (un complejo
 *  o un estado intermedio del tecleo en Code: siguen enlazadas hasta salir
 *  juntas); si no, queda como estaba. */
export function syncedOtherFacet(next: string, prevThis: string, prevOther: string): string {
  if (isComplexTypeStart(next)) return next;
  const t = prevThis.trim();
  const linked = t !== '' && prevOther.trim() === t && !isCompleteSimpleType(t);
  return linked ? next : prevOther;
}

/** Lo guardado de los tipos de una columna (valores y flags de override). */
export interface StoredFacetTypes {
  dataType?: string | null; logicalDataType?: string | null;
  typeOverridden?: boolean | null; logicalTypeOverridden?: boolean | null;
}

/** Parche de tipos de una columna: las dos facetas viajan JUNTAS (un solo
 *  upsert), pero el flag de override se recalcula SOLO en la faceta cuyo valor
 *  cambia respecto de lo guardado — editar el lógico no toca `typeOverridden`
 *  (minor #5 del doc 96). Override = distinto del default HOMOLOGADO del
 *  dominio en esa faceta (doc 46 / doc 64 r2); sin dominio, no hay override. */
export function typeFacetPatch(
  phys: string, logi: string, stored: StoredFacetTypes,
  domain: { defaultDataType: string; logicalDataType?: string | null } | null | undefined,
): { dataType: string; typeOverridden: boolean; logicalDataType: string | undefined; logicalTypeOverridden: boolean } {
  const p = phys.trim();
  const l = logi.trim();
  const physChanged = p !== (stored.dataType ?? '').trim();
  const logiChanged = l !== (stored.logicalDataType ?? '').trim();
  return {
    dataType: phys,
    typeOverridden: physChanged
      ? !!domain && p !== canonicalDefaultType(domain.defaultDataType) : !!stored.typeOverridden,
    logicalDataType: l || undefined,
    logicalTypeOverridden: logiChanged
      ? !!domain && !!l && l !== canonicalDefaultType(domain.logicalDataType ?? undefined) : !!stored.logicalTypeOverridden,
  };
}
