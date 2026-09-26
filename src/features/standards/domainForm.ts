/**
 * domainForm — el formulario de un Parent Domain → cuerpo del apply de Data
 * Standards (final review #10 del doc 95). Puro: lo usan el guardado normal y el
 * «Revert to vN», así el revert aplica EXACTO lo que muestra el formulario.
 */
import type { DomainEditInput, SnapshotDomain } from './standards.service';

/** Texto opcional para el apply, que hace `exclude_none` (un campo AUSENTE queda
 *  como estaba): con valor viaja; vacío viaja como '' SOLO si lo guardado tenía
 *  valor (lo limpia); vacío y ya vacío no viaja (no convierte null en '' ni deja
 *  un cambio falso en el historial). */
function clearable(value: string | null | undefined, stored: string | null | undefined): string | undefined {
  if (value) return value;
  return stored ? '' : undefined;
}

/** `stored` = el dominio guardado (null al crear). El tipo lógico vacío nunca
 *  viaja: un tipo no se cascadea a vacío. */
export function domainEditInput(form: SnapshotDomain, stored: SnapshotDomain | null): DomainEditInput {
  return {
    id: stored ? form.id : undefined,
    name: form.name.trim(),
    defaultDataType: form.defaultDataType.trim(),
    // Doc 69: tipo físico (defaultDataType) + tipo lógico + nombre de atributo sugerido.
    logicalDataType: form.logicalDataType?.trim() || undefined,
    namingTerm: clearable(form.namingTerm?.trim(), stored?.namingTerm),
    description: clearable(form.description, stored?.description),
    // Doc 85: '' = volver al derivado / igual a la lógica (el backend lo lee como None); {} = sin UDP por defecto.
    physicalName: form.physicalName?.trim() ?? '',
    physicalDescription: form.physicalDescription?.trim() ?? '',
    udpValues: form.udpValues ?? {},
    // Doc 80 §4: `inheritsName` viaja SIEMPRE con su booleano (omitirlo dejaría el
    // flag como estaba y desmarcar la casilla no tendría efecto).
    inheritsName: !!form.inheritsName,
  };
}
