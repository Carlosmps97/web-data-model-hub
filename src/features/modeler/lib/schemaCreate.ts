/**
 * schemaCreate — alta de un esquema desde un combo. Puro: la validación
 * compartida con el gestor de Esquemas, cuándo se ofrece y el orden que evita
 * acciones que no convergen (crear en la versión → recargar el catálogo →
 * recién seleccionar).
 */
import { isSystemSchema } from './schemaPick';
import { SCHEMA_NAME_RE, type SchemaKind } from './schemaStaging';

/** Misma validación que el gestor de Esquemas (el backend la repite al
 *  registrar el cambio). `taken` = nombres ocupados en minúsculas. */
export function schemaNameError(name: string, taken: Set<string>): string | null {
  const n = name.trim();
  if (!n) return 'The schema name is required.';
  if (!SCHEMA_NAME_RE.test(n)) {
    return 'Invalid name: letters, numbers and underscore, starting with a letter (e.g. stg_clientes).';
  }
  if (isSystemSchema(n)) return `${n} is reserved for the system default schema.`;
  if (taken.has(n.toLowerCase())) return `Schema ${n} already exists`;
  return null;
}

/** Se ofrece solo al elegir el esquema de una tabla o una vista, en una versión
 *  en edición (no histórica) y con el combo habilitado — el alta entra al
 *  changeset activo, igual que con Structure · Schemas. */
export function canCreateSchema(g: {
  disabled?: boolean; kind: 'tables' | 'views' | 'all';
  openMode: string | null; changesetId: string | null; asOf: boolean;
}): boolean {
  return !g.disabled && g.kind !== 'all' && g.openMode === 'editing' && !!g.changesetId && !g.asOf;
}

/** Crear (entra a la versión) → recargar el catálogo → recién seleccionar. Si
 *  crear falla, no se selecciona nada (el error sube al popup) pero el catálogo
 *  se recarga igual: el cambio pudo quedar registrado aunque la respuesta se
 *  perdiera, y así el combo y la validación de duplicados lo ven. Si solo falla
 *  la recarga, se selecciona igual: el esquema ya existe en la versión y el
 *  combo muestra un valor fuera de la lista como opción extra. */
export async function createSchemaAndPick(d: {
  name: string; kind: SchemaKind;
  create: (name: string, kind: SchemaKind) => Promise<unknown>;
  refresh: () => Promise<void>;
  pick: (name: string) => void;
}): Promise<void> {
  const name = d.name.trim();
  try {
    await d.create(name, d.kind);
  } catch (e) {
    await d.refresh().catch(() => undefined);
    throw e;
  }
  await d.refresh().catch(() => undefined);
  d.pick(name);
}

/** Texto de la fila de acción del combo. */
export const createActionLabel = (query: string): string =>
  (query.trim() ? `+ Create schema "${query.trim()}"…` : '+ New schema…');
