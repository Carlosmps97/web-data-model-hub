import type { DbSchema } from '../services/schemas.service';

/**
 * schemaPick (doc 52) — lógica PURA de los combos de esquema con buscador:
 * partición del catálogo por tipo de objeto y la convención `_VU` de New View.
 * Extraída del componente para testearla sin DOM.
 */

export type SchemaKindFilter = 'tables' | 'views' | 'all';

/**
 * Esquemas válidos para un contexto (doc 52 §3). Con `kind` concreto entran
 * los de ESE kind, los que contienen tablas y vistas (`both`, doc 119) y los
 * SIN clasificar (`kind == null`): un esquema nunca clasificado no "pertenece
 * al otro tipo", y excluirlo dejaría pickers vacíos. Los del kind contrario
 * NUNCA entran: la separación tables/views se mantiene.
 */
export function schemasForKind(schemas: DbSchema[], kind: SchemaKindFilter): DbSchema[] {
  if (kind === 'all') return schemas;
  return schemas.filter((s) => s.kind == null || s.kind === kind || s.kind === 'both');
}

/**
 * Convención de New View (doc 52 §4): esquema sugerido = `<esquemaTabla>_VU`
 * si EXISTE en el catálogo (match case-insensitive, excluyendo los de kind
 * `tables`). Devuelve el nombre EXACTO catalogado, o null si no hay match —
 * el caller conserva entonces su fallback actual.
 */
export function defaultViewSchema(tableSchema: string | undefined | null, schemas: DbSchema[]): string | null {
  const base = (tableSchema ?? '').trim();
  if (!base) return null;
  const wanted = `${base}_VU`.toLowerCase();
  const hit = schemas.find((s) => s.kind !== 'tables' && s.name.trim().toLowerCase() === wanted);
  return hit ? hit.name : null;
}

/**
 * Estado inicial del combo **Schema** al CREAR una vista con tabla fuente
 * (doc 80 §1). Antes el fallback era el esquema de la TABLA: una vista nacía
 * apuntando a un esquema de tablas — que ni siquiera figura en su propio combo
 * (`SchemaSelect kind="views"` lo excluye y lo inyectaba como opción postiza).
 *
 * Ahora: si existe `<esquemaTabla>_VU` se pre-selecciona; si NO existe el campo
 * queda VACÍO y se devuelve el nombre que habría que crear, para ofrecerlo.
 * `suggest` es null cuando no hay nada que sugerir (sin tabla fuente) o cuando
 * ya se resolvió el esquema.
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
