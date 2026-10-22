import type { DbSchema } from '../services/schemas.service';

/**
 * schemaPick — lógica pura de los combos de esquema con buscador: partición
 * del catálogo por tipo de objeto y la convención `_VU` de New View. Separada
 * del componente para testearla sin DOM.
 */

export type SchemaKindFilter = 'tables' | 'views' | 'all';

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
  if (!base) return { schema: '', suggest: null };
  const hit = defaultViewSchema(base, schemas);
  return hit ? { schema: hit, suggest: null } : { schema: '', suggest: `${base}_VU` };
}
