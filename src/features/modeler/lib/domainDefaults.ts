/**
 * domainDefaults (doc 69 §4.7, ajuste owner 2026-09-05) — al asignar un parent
 * domain, Erwin autocompleta el nombre del atributo (= nombre del dominio) y su
 * definición. Regla pura, alineada con la del tipo (doc 46):
 *  - elegir OTRO dominio (o el primero) RE-APLICA: nombre lógico sugerido
 *    (`namingTerm` ?? `name`) y definición (`description`, si el dominio la
 *    tiene). Es un cambio DIRECTO sobre el atributo — la única excepción que
 *    el owner admite para regenerar reglas (punto 5): la herencia anterior
 *    pertenecía al dominio anterior;
 *  - re-elegir el MISMO dominio respeta lo que haya (no pisa lo manual por un
 *    pick accidental);
 *  - quitar el dominio conserva todo. El físico lo deriva el glosario aparte.
 */
export interface DomainLike { id?: string; name: string; namingTerm?: string | null; description?: string | null }

export const suggestedName = (d?: DomainLike | null): string => (d?.namingTerm?.trim() || d?.name?.trim() || '');
export const suggestedDescription = (d?: DomainLike | null): string => d?.description?.trim() || '';

export interface DomainDefaultsInput {
  prevDomain: DomainLike | null | undefined;
  nextDomain: DomainLike | null | undefined;
  current: { logicalName: string; description: string };
}
export interface DomainDefaultsPatch { logicalName?: string; description?: string }

const sameDomain = (a: DomainLike, b: DomainLike): boolean =>
  a.id != null && b.id != null ? a.id === b.id : a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

export function applyDomainDefaults(i: DomainDefaultsInput): DomainDefaultsPatch {
  if (!i.nextDomain) return {};
  if (i.prevDomain && sameDomain(i.prevDomain, i.nextDomain)) return {};
  const out: DomainDefaultsPatch = {};
  const name = suggestedName(i.nextDomain);
  const desc = suggestedDescription(i.nextDomain);
  if (name && name !== i.current.logicalName.trim()) out.logicalName = name;
  if (desc && desc !== i.current.description.trim()) out.description = desc;
  return out;
}
