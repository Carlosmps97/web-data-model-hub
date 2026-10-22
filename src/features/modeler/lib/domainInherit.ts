/**
 * domainInherit: UDP por defecto de un parent domain que la columna puede
 * heredar al asignarlo. Erwin materializa en cada `<Domain>` los valores de
 * UDP de atributo (ambas facetas); la plataforma los guarda en
 * `domain.udpValues` (mismas claves = ids de defs `column`). El popup «Inherit
 * from domain» ofrece los no vacíos agrupados Logical · Physical y el usuario
 * elige cuáles copiar. Puro (testeable sin DOM).
 */
import type { UdpDefinition } from '@/features/standards/standards.service';
import { udpView, type Facet } from '@/lib/facets';

export interface DomainUdpOfferItem { def: UdpDefinition; value: string; facet: Facet }
export interface DomainUdpOffer { logical: DomainUdpOfferItem[]; physical: DomainUdpOfferItem[]; total: number }

/** Valores heredables: no vacíos, con def de columna conocida; por faceta
 *  (contrato `udpView`) y ordenados por nombre. */
export function domainUdpOffer(
  domain: { udpValues?: Record<string, string> | null } | null | undefined,
  defs: UdpDefinition[],
): DomainUdpOffer {
  const out: DomainUdpOffer = { logical: [], physical: [], total: 0 };
  const byId = new Map(defs.filter((d) => d.level === 'column').map((d) => [d.id, d] as const));
  for (const [id, raw] of Object.entries(domain?.udpValues ?? {})) {
    const def = byId.get(id);
    const value = (raw ?? '').trim();
    if (!def || !value) continue;
    const facet = udpView(def);
    out[facet].push({ def, value, facet });
  }
  for (const k of ['logical', 'physical'] as const) out[k].sort((a, b) => a.def.name.localeCompare(b.def.name));
  out.total = out.logical.length + out.physical.length;
  return out;
}

/** Copia a `current` los ítems elegidos (pisan la clave si existía: el usuario
 *  los eligió). Sin elegidos devuelve `current` intacto (misma referencia). */
export function mergeInheritedUdps(
  current: Record<string, string> | undefined,
  picked: DomainUdpOfferItem[],
): Record<string, string> {
  if (picked.length === 0) return current ?? {};
  const next = { ...(current ?? {}) };
  for (const p of picked) next[p.def.id] = p.value;
  return next;
}
