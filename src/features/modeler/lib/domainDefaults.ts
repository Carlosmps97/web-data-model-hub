/**
 * domainDefaults: al asignar un parent domain, Erwin autocompleta el nombre
 * del atributo (= nombre del dominio) y su definición solo para los dominios
 * "atributo estándar": los que en Erwin llevan `Attribute_Definition`
 * (FecRutina, CodMes, FecDia, los de auditoría…) y cuyos atributos heredan el
 * nombre vía el macro `%AttDomain`. La carga de modelos Erwin marca esos
 * dominios con `inheritsName === true`.
 *
 * Los dominios genéricos de tipo (Codigo, Fecha, Number, Monto, Descripcion…)
 * no llevan la marca: cada columna conserva su nombre y su definición; elegir
 * uno de ellos jamás los pisa.
 *
 * Con la marca puesta, la regla es la del tipo:
 *  - elegir otro dominio estándar re-aplica: nombre lógico sugerido
 *    (`namingTerm` ?? `name`) y definición (`description`, si la tiene). Es un
 *    cambio directo sobre el atributo (la herencia anterior pertenecía al
 *    dominio anterior);
 *  - re-elegir el mismo dominio respeta lo que haya (no pisa lo manual);
 *  - quitar el dominio conserva todo. El físico lo deriva el glosario aparte.
 * Pura (testeable sin DOM).
 */
export interface DomainLike {
  id?: string;
  name: string;
  namingTerm?: string | null;
  description?: string | null;
  /** Dominio "atributo estándar" (Erwin `Attribute_Definition`). Solo
   *  estos heredan nombre + definición al atributo; los genéricos, nunca. */
  inheritsName?: boolean | null;
  /** Faceta física del dominio: físico override (null = derivado) y
   *  descripción física (null = igual a la lógica). */
  physicalName?: string | null;
  physicalDescription?: string | null;
}

export const suggestedName = (d?: DomainLike | null): string => (d?.namingTerm?.trim() || d?.name?.trim() || '');
export const suggestedDescription = (d?: DomainLike | null): string => d?.description?.trim() || '';

export interface DomainDefaultsInput {
  prevDomain: DomainLike | null | undefined;
  nextDomain: DomainLike | null | undefined;
  current: { logicalName: string; description: string; physicalName?: string; physicalDescription?: string | null };
}
export interface DomainDefaultsPatch {
  logicalName?: string;
  /** Físico override del dominio; ausente = el caller lo deriva por glosario. */
  physicalName?: string;
  description?: string;
  /** null = limpiar (la física anterior pertenecía al dominio anterior). */
  physicalDescription?: string | null;
}

const sameDomain = (a: DomainLike, b: DomainLike): boolean =>
  a.id != null && b.id != null ? a.id === b.id : a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

export function applyDomainDefaults(i: DomainDefaultsInput): DomainDefaultsPatch {
  if (!i.nextDomain) return {};
  if (i.prevDomain && sameDomain(i.prevDomain, i.nextDomain)) return {};
  // Solo los dominios "atributo estándar" empujan nombre y definición.
  // Un dominio genérico de tipo nunca pisa el nombre/definición propios.
  if (!i.nextDomain.inheritsName) return {};
  const out: DomainDefaultsPatch = {};
  const name = suggestedName(i.nextDomain);
  const desc = suggestedDescription(i.nextDomain);
  if (name && name !== i.current.logicalName.trim()) out.logicalName = name;
  // El físico del dominio (override) se hereda tal cual; sin override el caller
  // deriva el físico del lógico resultante por glosario.
  const phys = i.nextDomain.physicalName?.trim();
  if (phys && phys !== (i.current.physicalName ?? '').trim()) out.physicalName = phys;
  if (desc && desc !== i.current.description.trim()) out.description = desc;
  // La descripción física va con la misma marca; si el dominio elegido no
  // tiene, se limpia (null): la anterior pertenecía al dominio anterior.
  const nextPhysDesc = i.nextDomain.physicalDescription?.trim() ?? '';
  if (nextPhysDesc !== (i.current.physicalDescription ?? '').trim()) out.physicalDescription = nextPhysDesc || null;
  return out;
}
