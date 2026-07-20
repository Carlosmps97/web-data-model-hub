/**
 * Sincronización tabla → vistas (doc 19 §12b, features V1/V2):
 *
 *  - V1: una columna NUEVA de la tabla entra automáticamente a las vistas
 *    ESPEJO (las que contienen TODAS las columnas de la tabla). Una vista
 *    curada (subset deliberado de columnas) NO se toca — auto-extenderla
 *    rompería la curaduría del modelador.
 *  - V2: "ordenar como la tabla física" — reordena los sources de la vista
 *    según el `ordinal` de cada tabla fuente.
 *
 * Los helpers de decisión son PUROS; `syncNewColumnToMirrorViews` orquesta
 * con dependencias inyectadas (patrón nameSync) para ser testeable sin red.
 */
import type { CanonicalColumn } from '@/features/governance/services/governance.service';
import type { View, ViewInput, ViewSource } from '@/services/views.service';

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** ¿La vista es ESPEJO de la tabla? — sus sources incluyen TODAS las columnas
 *  dadas de esa tabla (por physicalName, case-insensitive). `tableCols` deben
 *  ser las columnas PREVIAS al alta (la nueva obviamente aún no está). */
export function isMirrorOfTable(view: View, tableId: string, tableCols: CanonicalColumn[]): boolean {
  const have = new Set(
    (view.sources ?? [])
      .filter((s) => (s.tableId ?? view.tableId) === tableId && s.column)
      .map((s) => norm(s.column)),
  );
  return tableCols.length > 0 && tableCols.every((c) => have.has(norm(c.physicalName)));
}

/** Sources con la columna nueva AL FINAL (alias = nombre físico, como las _vu);
 *  null si ya estaba (idempotente). */
export function appendColumnSource(view: View, tableId: string, physicalName: string): ViewSource[] | null {
  const sources = view.sources ?? [];
  const dup = sources.some((s) => (s.tableId ?? view.tableId) === tableId && norm(s.column) === norm(physicalName));
  if (dup) return null;
  return [...sources, { tableId, column: physicalName, outputAlias: physicalName }];
}

/** Reordena los sources al ORDEN FÍSICO: grupos por tabla en el orden de
 *  `sourceTableIds` y, dentro de cada grupo, por el ordinal físico de la
 *  columna. Columnas no resolubles (expresiones / nombres desconocidos)
 *  conservan su orden relativo al final del grupo. `colsByTable` con las
 *  columnas de cada fuente YA ordenadas por ordinal. Puro. */
export function alignSourcesToPhysical(view: View, colsByTable: Map<string, CanonicalColumn[]>): ViewSource[] {
  const sources = view.sources ?? [];
  const groupOrder = view.sourceTableIds?.length ? view.sourceTableIds : [view.tableId ?? ''];
  const groupIdx = new Map(groupOrder.map((t, i) => [t, i]));
  const keyed = sources.map((s, i) => {
    const tid = s.tableId ?? view.tableId ?? '';
    const cols = colsByTable.get(tid) ?? [];
    const pos = s.column ? cols.findIndex((c) => norm(c.physicalName) === norm(s.column)) : -1;
    return { s, i, g: groupIdx.get(tid) ?? groupOrder.length, pos: pos >= 0 ? pos : Number.MAX_SAFE_INTEGER };
  });
  keyed.sort((a, b) => (a.g - b.g) || (a.pos - b.pos) || (a.i - b.i));
  return keyed.map((k) => k.s);
}

/** Sources SIN la columna (para un delete); null si la vista no la referencia.
 *  Aplica a TODA vista (espejo o curada): una columna eliminada no puede
 *  quedar referenciada en ningún SELECT. */
export function removeColumnSource(view: View, tableId: string, physicalName: string): ViewSource[] | null {
  const sources = view.sources ?? [];
  const next = sources.filter((s) => !((s.tableId ?? view.tableId) === tableId && norm(s.column) === norm(physicalName)));
  return next.length === sources.length ? null : next;
}

/** Sources con la columna RENOMBRADA (rename físico); null si no la referencia.
 *  El alias sigue al nombre solo si era el default (== nombre viejo); un alias
 *  custom del modelador se respeta. */
export function renameColumnSource(view: View, tableId: string, oldPhysical: string, newPhysical: string): ViewSource[] | null {
  let touched = false;
  const next = (view.sources ?? []).map((s) => {
    if ((s.tableId ?? view.tableId) !== tableId || norm(s.column) !== norm(oldPhysical)) return s;
    touched = true;
    return {
      ...s,
      column: newPhysical,
      outputAlias: norm(s.outputAlias) === norm(oldPhysical) || !s.outputAlias ? newPhysical : s.outputAlias,
    };
  });
  return touched ? next : null;
}

type SyncDeps = {
  listViews: (tableId: string) => Promise<View[]>;
  updateView: (id: string, body: ViewInput) => Promise<unknown>;
};

/** V1: propaga una columna recién creada a las vistas ESPEJO de su tabla.
 *  Devuelve cuántas vistas se extendieron. Best-effort del caller (no debe
 *  bloquear el alta de la columna). */
export async function syncNewColumnToMirrorViews(
  deps: SyncDeps, tableId: string, physicalName: string, previousCols: CanonicalColumn[],
): Promise<number> {
  const views = await deps.listViews(tableId);
  let touched = 0;
  for (const v of views) {
    if (!isMirrorOfTable(v, tableId, previousCols)) continue;
    const next = appendColumnSource(v, tableId, physicalName);
    if (!next) continue;
    await deps.updateView(v.id, { ...v, sources: next });
    touched += 1;
  }
  return touched;
}

/** Columna ELIMINADA: sale de los sources de TODA vista que la referencie
 *  (espejo o curada). Devuelve cuántas vistas se tocaron. */
export async function syncRemovedColumnFromViews(
  deps: SyncDeps, tableId: string, physicalName: string,
): Promise<number> {
  const views = await deps.listViews(tableId);
  let touched = 0;
  for (const v of views) {
    const next = removeColumnSource(v, tableId, physicalName);
    if (!next) continue;
    await deps.updateView(v.id, { ...v, sources: next });
    touched += 1;
  }
  return touched;
}

/** Columna RENOMBRADA (físico): re-apunta los sources de toda vista que la
 *  referenciaba por el nombre viejo. Devuelve cuántas vistas se tocaron. */
export async function syncRenamedColumnInViews(
  deps: SyncDeps, tableId: string, oldPhysical: string, newPhysical: string,
): Promise<number> {
  if (norm(oldPhysical) === norm(newPhysical)) return 0;
  const views = await deps.listViews(tableId);
  let touched = 0;
  for (const v of views) {
    const next = renameColumnSource(v, tableId, oldPhysical, newPhysical);
    if (!next) continue;
    await deps.updateView(v.id, { ...v, sources: next });
    touched += 1;
  }
  return touched;
}
