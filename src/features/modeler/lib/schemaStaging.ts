/**
 * schemaStaging — estado PENDIENTE del gestor de esquemas (doc 18 v2). Las
 * acciones del modal (crear/renombrar/eliminar) se acumulan acá y se
 * registran TODAS JUNTAS en la versión activa al apretar "Save" — igual que
 * el resto del modelo: nada llega al changeset hasta guardar, y nada llega a
 * producción hasta publicar. Puro (testeable sin React).
 */
export interface DbSchemaLike { id: string; name: string; description?: string | null }

/** Qué contiene el esquema (doc 44). OJO: `kind` en StagedOp ya nombra el TIPO
 *  de operación — el del esquema viaja como `schemaKind`. */
export type SchemaKind = 'tables' | 'views';

/** Regla de nombre (espeja el backend): letras/números/guión bajo empezando
 *  con letra. Acepta mayúsculas — el legacy `No_Definido` debe validar. */
export const SCHEMA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export type StagedOp =
  | { kind: 'create'; key: string; name: string; schemaKind: SchemaKind }
  | { kind: 'rename'; key: string; id: string; from: string; to: string }
  | { kind: 'delete'; key: string; id: string; name: string };

/** Nombres ocupados DESPUÉS de aplicar el staging (validación de duplicados
 *  al stagear; el backend re-valida al guardar). Lower-case. */
export function takenNames(schemas: DbSchemaLike[], ops: StagedOp[]): Set<string> {
  const names = new Set(schemas.map((s) => s.name.toLowerCase()));
  for (const op of ops) {
    if (op.kind === 'rename') { names.delete(op.from.toLowerCase()); names.add(op.to.toLowerCase()); }
    else if (op.kind === 'delete') names.delete(op.name.toLowerCase());
    else names.add(op.name.toLowerCase());
  }
  return names;
}

export function stageCreate(ops: StagedOp[], name: string, schemaKind: SchemaKind = 'tables'): StagedOp[] {
  // key determinista por nombre: los duplicados ya se validan antes de stagear.
  return [...ops, { kind: 'create', key: `new:${name.toLowerCase()}`, name, schemaKind }];
}

export function editCreate(ops: StagedOp[], key: string, name: string): StagedOp[] {
  return ops.map((o) => (o.key === key && o.kind === 'create' ? { ...o, name } : o));
}

export function stageRename(ops: StagedOp[], schema: DbSchemaLike, to: string): StagedOp[] {
  const rest = ops.filter((o) => !(o.kind === 'rename' && o.id === schema.id));
  if (to === schema.name) return rest;   // volver al original = deshacer
  return [...rest, { kind: 'rename', key: `ren:${schema.id}`, id: schema.id, from: schema.name, to }];
}

export function stageDelete(ops: StagedOp[], schema: DbSchemaLike): StagedOp[] {
  // el delete manda: descarta un rename pendiente del mismo esquema
  const rest = ops.filter((o) => !(o.kind !== 'create' && o.id === schema.id));
  return [...rest, { kind: 'delete', key: `del:${schema.id}`, id: schema.id, name: schema.name }];
}

export function unstage(ops: StagedOp[], key: string): StagedOp[] {
  return ops.filter((o) => o.key !== key);
}

/** Pendiente (rename o delete) de un esquema EXISTENTE, si lo hay. */
export function pendingFor(ops: StagedOp[], id: string) {
  return ops.find((o) => o.kind !== 'create' && o.id === id) as
    Exclude<StagedOp, { kind: 'create' }> | undefined;
}

/** Orden de aplicación al guardar: creates → renames → deletes. */
export function orderedForSave(ops: StagedOp[]): StagedOp[] {
  const rank = { create: 0, rename: 1, delete: 2 } as const;
  return [...ops].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * Filas visibles del gestor de esquemas (doc 80 §2). El campo "New schema"
 * hace DOBLE trabajo: mientras escribes, filtra la lista de abajo por
 * «contiene» case-insensitive (doc 57) — con ~390 esquemas, encontrar el que
 * quieres renombrar o borrar era scrollear a ciegas — y si nada coincide, ese
 * mismo texto es el nombre del esquema nuevo.
 *
 * Un esquema con cambio PENDIENTE se muestra siempre, coincida o no: trabajo
 * sin guardar nunca se esconde detrás de un filtro.
 */
export function visibleSchemas<T extends DbSchemaLike>(schemas: T[], ops: StagedOp[], q: string): T[] {
  const n = q.trim().toLowerCase();
  if (!n) return schemas;
  const touched = new Set(ops.filter((o) => o.kind !== 'create').map((o) => o.id));
  return schemas.filter((s) => s.name.toLowerCase().includes(n) || touched.has(s.id));
}
