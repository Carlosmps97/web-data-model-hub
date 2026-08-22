import type { DbSchema } from '../services/schemas.service';

/**
 * schemaPick (doc 52) — lógica PURA de los combos de esquema con buscador:
 * partición del catálogo por tipo de objeto y la convención `_VU` de New View.
 * Extraída del componente para testearla sin DOM.
 */

export type SchemaKindFilter = 'tables' | 'views' | 'all';

/**
 * Esquemas válidos para un contexto (doc 52 §3). Con `kind` concreto entran
 * los de ESE kind y los SIN clasificar (`kind == null`): un esquema nunca
 * clasificado no "pertenece al otro tipo", y excluirlo dejaría pickers vacíos
 * en BDs sin backfill (la BD real tiene 0 sin kind — no cambia nada visible).
 * Los del kind contrario NUNCA entran: la separación tables/views se mantiene.
 */
export function schemasForKind(schemas: DbSchema[], kind: SchemaKindFilter): DbSchema[] {
  if (kind === 'all') return schemas;
  return schemas.filter((s) => s.kind == null || s.kind === kind);
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
