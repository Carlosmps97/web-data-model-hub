/**
 * domainType: regla dominio→tipo al (re)elegir el parent domain de una
 * columna. Asociar un dominio hereda su `defaultDataType`; editar el tipo a
 * mano lo "deslinda" (typeOverridden). Con un override manual vigente, elegir
 * otro dominio re-aplica la regla: el tipo personalizado pertenecía a la
 * combinación anterior. Re-elegir el mismo dominio sí respeta el override (no
 * pisa un tipo custom por un pick accidental). Pura (testeable sin DOM).
 */

export interface DomainPickInput {
  /** Dominio persistido de la columna ('' = ninguno). */
  currentDomainId: string;
  /** Override manual vigente (persistido). */
  typeOverridden: boolean;
  /** Tipo visible en el editor (puede traer tipeo sin persistir). */
  currentType: string;
  /** Dominio elegido ('' = quitar el dominio). */
  nextDomainId: string;
  /** defaultDataType del dominio elegido (undefined si no hay o no tiene). */
  nextDefault: string | undefined;
}

export function applyDomainPick(i: DomainPickInput): { dataType: string; typeOverridden: boolean } {
  const hasDomain = i.nextDomainId !== '';
  const changed = i.nextDomainId !== i.currentDomainId;
  // El override manual solo sobrevive re-eligiendo el mismo dominio.
  const keepCustom = i.typeOverridden && !changed;
  const dataType = hasDomain && !keepCustom ? (i.nextDefault ?? i.currentType) : i.currentType;
  // Override recalculado contra el dominio elegido: coincide con su default →
  // conexión "sana" (false, la cascada de Standards lo re-deriva); difiere →
  // sigue deslindado (true, la cascada lo respeta).
  return { dataType, typeOverridden: hasDomain && dataType.trim() !== (i.nextDefault ?? '') };
}
