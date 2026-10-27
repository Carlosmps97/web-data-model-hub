import type { DbSchema } from '../services/schemas.service';

/**
 * schemaPick — lógica pura de los combos de esquema con buscador: partición
 * del catálogo por tipo de objeto y la convención `_VU` de New View. Separada
 * del componente para testearla sin DOM.
 */

export type SchemaKindFilter = 'tables' | 'views' | 'all';

/** Esquema por defecto, del sistema (`DEFAULT_SCHEMA` de
 *  `app/features/schemas/models.py`): el backend deja en él la tabla o vista
 *  que se graba sin esquema; todo proyecto lo tiene y nadie lo renombra, le
 *  cambia el kind ni lo borra. */
const DEFAULT_SCHEMA = 'Not_defined';

/** ¿Es el esquema por defecto (sin distinguir mayúsculas ni espacios)? */
export function isSystemSchema(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === DEFAULT_SCHEMA.toLowerCase();
}

/** Nombre con que el backend graba una tabla o vista sin esquema: el esquema
 *  por defecto con la grafía que tenga en el catálogo (lo reusa sin distinguir
 *  mayúsculas). */
export function defaultSchemaName(catalog: DbSchema[] = []): string {
  return catalog.find((s) => isSystemSchema(s.name))?.name ?? DEFAULT_SCHEMA;
}

/** Rótulo de la opción vacía del combo: en tablas y vistas, el esquema por
 *  defecto. */
export function emptySchemaLabel(kind: SchemaKindFilter, catalog: DbSchema[] = []): string {
  return kind === 'all' ? '(no schema)' : `${defaultSchemaName(catalog)} (default)`;
}

/** Valor que deja elegir una opción del combo: en tablas y vistas, la opción
 *  vacía sobre un objeto que ya está en el esquema por defecto no lo cambia
 *  (son lo mismo: no hay nada que grabar). */
export function pickedSchema(kind: SchemaKindFilter, current: string, picked: string): string {
  return kind !== 'all' && picked === '' && isSystemSchema(current) ? current : picked;
}

/**
 * Esquemas válidos para un contexto. Con `kind` concreto entran los de ese
 * kind, los que contienen tablas y vistas (`both`) y los sin clasificar
 * (`kind == null`): un esquema nunca clasificado no "pertenece al otro tipo",
 * y excluirlo dejaría pickers vacíos. Los del kind contrario nunca entran: la
 * separación tables/views se mantiene.
 */
export function schemasForKind(schemas: DbSchema[], kind: SchemaKindFilter): DbSchema[] {
  if (kind === 'all') return schemas;
  return schemas.filter((s) => s.kind == null || s.kind === kind || s.kind === 'both');
}

/**
 * Convención de New View: esquema sugerido = `<esquemaTabla>_VU` si existe en
 * el catálogo (match case-insensitive, excluyendo los de kind `tables`).
 * Devuelve el nombre exacto catalogado, o null si no hay match; en ese caso el
 * caller conserva su fallback.
 */
export function defaultViewSchema(tableSchema: string | undefined | null, schemas: DbSchema[]): string | null {
  const base = (tableSchema ?? '').trim();
  if (!base) return null;
  const wanted = `${base}_VU`.toLowerCase();
  const hit = schemas.find((s) => s.kind !== 'tables' && s.name.trim().toLowerCase() === wanted);
  return hit ? hit.name : null;
}

/**
 * Estado inicial del combo **Schema** al crear una vista con tabla fuente: si
 * existe `<esquemaTabla>_VU` se pre-selecciona; si no existe, el campo queda
 * vacío y se devuelve el nombre que habría que crear, para ofrecerlo. El
 * esquema de la tabla no sirve de fallback: es un esquema de tablas, que ni
 * siquiera figura en el combo de la vista (`SchemaSelect kind="views"` lo
 * excluye). `suggest` es null cuando no hay nada que sugerir (sin tabla
 * fuente) o cuando ya se resolvió el esquema.
 */
export function viewSchemaOnCreate(
  tableSchema: string | undefined | null,
  schemas: DbSchema[],
): { schema: string; suggest: string | null } {
  const base = (tableSchema ?? '').trim();
  // Sin esquema propio (o en el por defecto) la vista también queda en el por defecto.
  if (!base || isSystemSchema(base)) return { schema: '', suggest: null };
  const hit = defaultViewSchema(base, schemas);
  return hit ? { schema: hit, suggest: null } : { schema: '', suggest: `${base}_VU` };
}
