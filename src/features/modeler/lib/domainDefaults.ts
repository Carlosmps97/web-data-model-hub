/**
 * domainDefaults (doc 69 §4.7 → afinado doc 79) — al asignar un parent domain,
 * Erwin autocompleta el nombre del atributo (= nombre del dominio) y su
 * definición SOLO para los dominios "atributo estándar": los que en Erwin
 * llevan `Attribute_Definition` (FecRutina, CodMes, FecDia, los de auditoría…)
 * y cuyos atributos heredan el nombre vía el macro `%AttDomain`. La migración
 * marca esos dominios con `inheritsName === true`.
 *
 * Los dominios GENÉRICOS de tipo (Codigo, Fecha, Number, Monto, Descripcion…)
 * NO llevan la marca: cada columna conserva SU nombre y SU definición — elegir
 * uno de ellos jamás los pisa (bug reportado por modelamiento, doc 79).
 *
 * Con la marca puesta, la regla es la del tipo (doc 46):
 *  - elegir OTRO dominio estándar RE-APLICA: nombre lógico sugerido
 *    (`namingTerm` ?? `name`) y definición (`description`, si la tiene). Es un
 *    cambio DIRECTO sobre el atributo (la herencia anterior pertenecía al
 *    dominio anterior);
 *  - re-elegir el MISMO dominio respeta lo que haya (no pisa lo manual);
 *  - quitar el dominio conserva todo. El físico lo deriva el glosario aparte.
 * Pura (testeable sin DOM).
 */
export interface DomainLike {
  id?: string;
  name: string;
  namingTerm?: string | null;
  description?: string | null;
  /** Doc 79: dominio "atributo estándar" (Erwin `Attribute_Definition`). Solo
   *  estos heredan nombre + definición al atributo; los genéricos, nunca. */
  inheritsName?: boolean | null;
}

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
  // Doc 79: solo los dominios "atributo estándar" empujan nombre y definición.
  // Un dominio genérico de tipo nunca pisa el nombre/definición propios.
  if (!i.nextDomain.inheritsName) return {};
  const out: DomainDefaultsPatch = {};
  const name = suggestedName(i.nextDomain);
  const desc = suggestedDescription(i.nextDomain);
  if (name && name !== i.current.logicalName.trim()) out.logicalName = name;
  if (desc && desc !== i.current.description.trim()) out.description = desc;
  return out;
}
