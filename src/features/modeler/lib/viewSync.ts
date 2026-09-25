/**
 * Sincronización tabla → vistas (doc 19 §12b, features V1/V2):
 *
 *  - V1: una columna NUEVA de la tabla entra automáticamente a las vistas
 *    ESPEJO (las que contienen TODAS las columnas de la tabla). Una vista
 *    curada (subset deliberado de columnas) NO se toca — auto-extenderla
 *    rompería la curaduría del modelador.
 *  - V2: "ordenar como la tabla física" — reordena los sources de la vista
 *    según el orden ÚNICO de cada tabla fuente (doc 94: PK primero, cada
 *    bloque por `ordinal`).
 *
 * Los helpers de decisión son PUROS; `syncNewColumnToMirrorViews` orquesta
 * con dependencias inyectadas (patrón nameSync) para ser testeable sin red.
 */
import type { CanonicalColumn } from '@/services/governance.service';
import type { View, ViewInput, ViewSource } from '@/services/views.service';

import { orderColumns } from './columnOrder';

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

/** Sources con la columna nueva (alias = nombre físico, como las _vu); null si
 *  ya estaba (idempotente). Una no-PK entra AL FINAL. Doc 94 D4: si la nueva es
 *  PK (`pkNames` = físicos de las PK de su tabla), entra tras la última PK de
 *  su tabla en la vista — o primera de su tabla si la vista no tiene PK. */
export function appendColumnSource(view: View, tableId: string, physicalName: string, pkNames?: string[]): ViewSource[] | null {
  const sources = view.sources ?? [];
  const mine = (s: ViewSource) => (s.tableId ?? view.tableId) === tableId;
  if (sources.some((s) => mine(s) && norm(s.column) === norm(physicalName))) return null;
  const added: ViewSource = { tableId, column: physicalName, outputAlias: physicalName };
  if (!pkNames) return [...sources, added];
  const pks = new Set(pkNames.map(norm));
  let at = -1;
  sources.forEach((s, i) => { if (mine(s) && pks.has(norm(s.column))) at = i + 1; });
  if (at < 0) at = sources.findIndex(mine);
  if (at < 0) return [...sources, added];
  return [...sources.slice(0, at), added, ...sources.slice(at)];
}

/** Reordena los sources al ORDEN FÍSICO: grupos por tabla en el orden de
 *  `sourceTableIds` y, dentro de cada grupo, por el orden ÚNICO de la tabla
 *  (doc 94 D4: PK primero, cada bloque por `ordinal` — lo aplica acá, así una
 *  PK recién marcada con ordinal alto no queda abajo). Columnas no resolubles
 *  (expresiones / nombres desconocidos) conservan su orden relativo al final
 *  del grupo. `colsByTable`: las columnas de cada fuente, en cualquier orden.
 *  Puro. */
export function alignSourcesToPhysical(view: View, colsByTable: Map<string, CanonicalColumn[]>): ViewSource[] {
  const sources = view.sources ?? [];
  const groupOrder = view.sourceTableIds?.length ? view.sourceTableIds : [view.tableId ?? ''];
  const groupIdx = new Map(groupOrder.map((t, i) => [t, i]));
  const ordered = new Map([...colsByTable].map(([tid, cols]) => [tid, orderColumns(cols)]));
  const keyed = sources.map((s, i) => {
    const tid = s.tableId ?? view.tableId ?? '';
    const cols = ordered.get(tid) ?? [];
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

/** V1: propaga una columna recién creada a las vistas ESPEJO de su tabla
 *  (`isPrimaryKey`: la nueva es PK ⇒ entra tras las PK, doc 94 D4). Devuelve
 *  cuántas vistas se extendieron. Best-effort del caller (no debe bloquear el
 *  alta de la columna). */
export async function syncNewColumnToMirrorViews(
  deps: SyncDeps, tableId: string, physicalName: string, previousCols: CanonicalColumn[],
  isPrimaryKey = false,
): Promise<number> {
  const views = await deps.listViews(tableId);
  const pkNames = isPrimaryKey ? previousCols.filter((c) => c.isPrimaryKey).map((c) => c.physicalName) : undefined;
  let touched = 0;
  for (const v of views) {
    if (!isMirrorOfTable(v, tableId, previousCols)) continue;
    const next = appendColumnSource(v, tableId, physicalName, pkNames);
    if (!next) continue;
    await deps.updateView(v.id, { ...v, sources: next });
    touched += 1;
  }
  return touched;
}

/** V1 para VARIAS columnas nuevas de un mismo lote (paste, relación, split):
 *  las propaga en orden, ampliando la línea base con cada una — así varias PK
 *  nuevas entran tras las PK en SU orden (doc 94 D4) y una vista espejo sigue
 *  siéndolo para la siguiente. Devuelve cuántas propagaciones se hicieron;
 *  best-effort por columna. */
export async function syncNewColumnsToMirrorViews(
  deps: SyncDeps, tableId: string,
  newCols: { physicalName: string; isPrimaryKey?: boolean | null }[],
  previousCols: CanonicalColumn[],
): Promise<number> {
  let base = previousCols;
  let touched = 0;
  for (const c of newCols) {
    try { touched += await syncNewColumnToMirrorViews(deps, tableId, c.physicalName, base, !!c.isPrimaryKey); }
    catch { /* best-effort: la vista se alinea después con "Match physical order" */ }
    base = [...base, { id: `new:${c.physicalName}`, tableId, physicalName: c.physicalName, logicalName: c.physicalName,
      dataType: '', typeOverridden: false, ordinal: base.length, isPrimaryKey: !!c.isPrimaryKey }];
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
