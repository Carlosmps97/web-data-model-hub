import { isSystemSchema } from './schemaPick';

const trimmed = (v: string | undefined) => (v ?? '').trim();

/** ¿El valor del formulario equivale al del modelo en el campo `field`? Sin
 *  contar los espacios de los bordes; en el nombre lógico, tampoco los de adentro
 *  (el backend los junta); en el esquema, la opción vacía es el esquema por
 *  defecto (el backend graba en él la tabla o vista que va sin esquema). */
export function sameField(field: string, a: string | undefined, b: string | undefined): boolean {
  if (field === 'schema') return (isSystemSchema(a) ? '' : trimmed(a)) === (isSystemSchema(b) ? '' : trimmed(b));
  if (field === 'logicalName') return trimmed(a).replace(/\s+/g, ' ') === trimmed(b).replace(/\s+/g, ' ');
  return trimmed(a) === trimmed(b);
}

/** Formulario de un panel que copia campos de un objeto del modelo, cuando el
 *  objeto cambia en la versión (un Undo o Redo, el propio guardado): cada campo
 *  cuyo valor cambió en el modelo toma el nuevo si no tiene cambios locales
 *  (equivale a lo sembrado, `sameField`); uno que se está editando, o cuyo valor
 *  no cambió, queda como está. Pura. */
export function reseedForm<T extends Record<string, string>>(form: T, prev: T, next: T): T {
  const out = { ...form };
  for (const k of Object.keys(next) as (keyof T & string)[]) {
    if (next[k] !== prev[k] && sameField(k, form[k], prev[k])) out[k] = next[k];
  }
  return out;
}
