/**
 * schemaStaging — estado PENDIENTE del gestor de esquemas (doc 18 v2). Las
 * acciones del modal (crear / renombrar / cambiar qué contiene / eliminar) se
 * acumulan acá y se registran TODAS JUNTAS en la versión activa al apretar
 * "Save" — igual que el resto del modelo: nada llega al changeset hasta
 * guardar, y nada llega a producción hasta publicar. Puro (testeable sin React).
 */
import type { SchemaKind } from '@/types/model';

/** Qué contiene el esquema (doc 44 / doc 119): sólo tablas, sólo vistas o
 *  ambas. OJO: `kind` en StagedOp ya nombra el TIPO de operación — el del
 *  esquema viaja como `schemaKind`. */
export type { SchemaKind };

export interface DbSchemaLike { id: string; name: string; description?: string | null; kind?: SchemaKind | null }

/** Regla de nombre (espeja el backend): letras/números/guión bajo empezando
 *  con letra. Acepta mayúsculas — el legacy `No_Definido` debe validar. */
export const SCHEMA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export type StagedOp =
  | { kind: 'create'; key: string; name: string; schemaKind: SchemaKind }
  | { kind: 'setKind'; key: string; id: string; name: string; from: SchemaKind | null; to: SchemaKind }
  | { kind: 'rename'; key: string; id: string; from: string; to: string }
  | { kind: 'delete'; key: string; id: string; name: string };

/** Nombres ocupados DESPUÉS de aplicar el staging (validación de duplicados
 *  al stagear; el backend re-valida al guardar). Lower-case. */
export function takenNames(schemas: DbSchemaLike[], ops: StagedOp[]): Set<string> {
  const names = new Set(schemas.map((s) => s.name.toLowerCase()));
  for (const op of ops) {
    if (op.kind === 'rename') { names.delete(op.from.toLowerCase()); names.add(op.to.toLowerCase()); }
    else if (op.kind === 'delete') names.delete(op.name.toLowerCase());
    else if (op.kind === 'create') names.add(op.name.toLowerCase());
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

/** Un esquema existente lleva UN pendiente: renombrar y cambiar su kind se
 *  excluyen (el último manda) — así el gestor muestra un solo badge y un solo
 *  Undo, y el upsert del kind nunca pisa un nombre nuevo. */
const withoutEdits = (ops: StagedOp[], id: string): StagedOp[] =>
  ops.filter((o) => !((o.kind === 'rename' || o.kind === 'setKind') && o.id === id));

export function stageRename(ops: StagedOp[], schema: DbSchemaLike, to: string): StagedOp[] {
  const rest = withoutEdits(ops, schema.id);
  if (to === schema.name) return rest;   // volver al original = deshacer
  return [...rest, { kind: 'rename', key: `ren:${schema.id}`, id: schema.id, from: schema.name, to }];
}

/** Cambiar qué contiene un esquema existente (doc 119): volver a su kind
 *  actual deshace; clasificar un esquema que nunca se clasificó SÍ es un cambio. */
export function stageSetKind(ops: StagedOp[], schema: DbSchemaLike, to: SchemaKind): StagedOp[] {
  const rest = withoutEdits(ops, schema.id);
  const current = schema.kind ?? null;
  if (to === current) return rest;
  return [...rest, { kind: 'setKind', key: `kind:${schema.id}`, id: schema.id, name: schema.name, from: current, to }];
}

export function stageDelete(ops: StagedOp[], schema: DbSchemaLike): StagedOp[] {
  // el delete manda: descarta un rename o un setKind pendiente del mismo esquema
  const rest = ops.filter((o) => !(o.kind !== 'create' && o.id === schema.id));
  return [...rest, { kind: 'delete', key: `del:${schema.id}`, id: schema.id, name: schema.name }];
}

export function unstage(ops: StagedOp[], key: string): StagedOp[] {
  return ops.filter((o) => o.key !== key);
}

/** Pendiente (setKind, rename o delete) de un esquema EXISTENTE, si lo hay. */
export function pendingFor(ops: StagedOp[], id: string) {
  return ops.find((o) => o.kind !== 'create' && o.id === id) as
    Exclude<StagedOp, { kind: 'create' }> | undefined;
}

/** Orden de aplicación al guardar: creates → setKind → renames → deletes. */
export function orderedForSave(ops: StagedOp[]): StagedOp[] {
  const rank = { create: 0, setKind: 1, rename: 2, delete: 3 } as const;
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
 * sin guardar nunca se esconde detrás de un filtro. `keep` = ids que también
 * se muestran siempre (la fila con un editor inline abierto).
 */
export function visibleSchemas<T extends DbSchemaLike>(schemas: T[], ops: StagedOp[], q: string,
                                                       keep: Iterable<string> = []): T[] {
  const n = q.trim().toLowerCase();
  if (!n) return schemas;
  const touched = new Set([...ops.filter((o) => o.kind !== 'create').map((o) => o.id), ...keep]);
  return schemas.filter((s) => s.name.toLowerCase().includes(n) || touched.has(s.id));
}
