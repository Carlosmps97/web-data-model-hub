/**
 * domainType (doc 46) — regla dominio→tipo al (re)elegir el parent domain de
 * una columna. La regla original: asociar un dominio hereda su
 * `defaultDataType`; editar el tipo a mano "deslinda" (typeOverridden). El
 * bug reportado por los modeladores: con un override manual vigente, elegir
 * OTRO dominio dejaba el tipo personalizado "pegado" — el personalizado
 * pertenecía a la combinación anterior, así que elegir OTRO dominio RE-APLICA
 * la regla. Re-elegir el MISMO dominio sí respeta el override (no clobberear
 * un tipo custom por un pick accidental). Pura (testeable sin DOM).
 */

export interface DomainPickInput {
  /** Dominio PERSISTIDO de la columna ('' = ninguno). */
  currentDomainId: string;
  /** Override manual vigente (persistido). */
  typeOverridden: boolean;
  /** Tipo visible en el editor (puede traer tipeo aún no persistido). */
  currentType: string;
  /** Dominio elegido ('' = quitar el dominio). */
  nextDomainId: string;
  /** defaultDataType del dominio elegido (undefined si no hay o no tiene). */
  nextDefault: string | undefined;
}

export function applyDomainPick(i: DomainPickInput): { dataType: string; typeOverridden: boolean } {
  const hasDomain = i.nextDomainId !== '';
  const changed = i.nextDomainId !== i.currentDomainId;
  // El override manual SOLO sobrevive re-eligiendo el MISMO dominio.
  const keepCustom = i.typeOverridden && !changed;
  const dataType = hasDomain && !keepCustom ? (i.nextDefault ?? i.currentType) : i.currentType;
  // Override recalculado contra el dominio NUEVO: coincide con su default →
  // conexión "sana" (false, la cascada de Standards lo re-deriva); difiere →
  // sigue deslindado (true, la cascada lo respeta).
  return { dataType, typeOverridden: hasDomain && dataType.trim() !== (i.nextDefault ?? '') };
}
