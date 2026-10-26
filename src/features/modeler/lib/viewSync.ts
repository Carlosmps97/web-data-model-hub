/**
 * Sincronización tabla → vistas:
 *
 *  - Una columna nueva de la tabla entra automáticamente a las vistas espejo
 *    (las que contienen todas las columnas de la tabla). Una vista curada
 *    (subset deliberado de columnas) no se toca: auto-extenderla rompería la
 *    curaduría del modelador.
 *  - "Ordenar como la tabla física": reordena los sources de la vista según
 *    el orden único de cada tabla fuente (PK primero, cada bloque por
 *    `ordinal`).
 *
 * Los helpers de decisión son puros; `syncNewColumnToMirrorViews` orquesta
 * con dependencias inyectadas (patrón nameSync) para ser testeable sin red.
 */
import type { CanonicalColumn } from '@/services/governance.service';
import type { View, ViewInput, ViewSource } from '@/services/views.service';

import { orderColumns } from './columnOrder';
import { SessionChangedError } from './sessionGuard';
import { duplicateOutputNames, outputNameOf } from './viewEditorLogic';

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** ¿La vista es espejo de la tabla? — sus sources incluyen todas las columnas
 *  dadas de esa tabla (por physicalName, case-insensitive). `tableCols` deben
 *  ser las columnas previas al alta (sin la columna que se agrega). */
export function isMirrorOfTable(view: View, tableId: string, tableCols: CanonicalColumn[]): boolean {
  const have = new Set(
    (view.sources ?? [])
      .filter((s) => (s.tableId ?? view.tableId) === tableId && s.column)
      .map((s) => norm(s.column)),
  );
  return tableCols.length > 0 && tableCols.every((c) => have.has(norm(c.physicalName)));
}

/** Sources con la columna nueva (alias = nombre físico, como las _vu); null si
 *  ya estaba (idempotente). Una no-PK entra al final. Si la nueva es PK
 *  (`pkNames` = físicos de las PK de su tabla), entra tras la última PK de su
 *  tabla en la vista — o primera de su tabla si la vista no tiene PK. */
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

/** Reordena los sources al orden físico: grupos por tabla en el orden de
 *  `sourceTableIds` y, dentro de cada grupo, por el orden único de la tabla
 *  (PK primero, cada bloque por `ordinal` — se aplica acá, así una PK recién
 *  marcada con ordinal alto no queda abajo). Columnas no resolubles
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

const ofColumn = (view: View, s: ViewSource, tableId: string, physicalName: string) =>
  (s.tableId ?? view.tableId) === tableId && norm(s.column) === norm(physicalName);

/** Sources sin la columna (para un delete); null si la vista no la referencia.
 *  Aplica a toda vista (espejo o curada): una columna eliminada no puede
 *  quedar referenciada en ningún SELECT. */
export function removeColumnSource(view: View, tableId: string, physicalName: string): ViewSource[] | null {
  const sources = view.sources ?? [];
  const next = sources.filter((s) => !ofColumn(view, s, tableId, physicalName));
  return next.length === sources.length ? null : next;
}

/** Fuente de una columna en una vista, con su posición: lo que quita
 *  `removeColumnsSources` y repone `restoreColumnsSources`. */
export interface PlacedSource { index: number; source: ViewSource }

/** Una columna que salió de la vista en un borrado: sus fuentes, con su tabla
 *  explícita (una fuente legacy sin `tableId` no se resuelve después contra
 *  otra) y su posición en el documento de antes del borrado. */
export interface RemovedColumn { physicalName: string; at: PlacedSource[] }

/** Sources sin ninguna de esas columnas y, de cada una que la vista listaba, lo
 *  que salió (en el orden dado); null si no lista ninguna. Una sola pasada por
 *  las fuentes: el costo no crece con columnas × fuentes. Puro. */
export function removeColumnsSources(view: View, tableId: string, physicalNames: string[]): { sources: ViewSource[]; removed: RemovedColumn[] } | null {
  const wanted = new Map(physicalNames.map((name) => [norm(name), name]));
  const at = new Map<string, PlacedSource[]>();
  const sources: ViewSource[] = [];
  (view.sources ?? []).forEach((source, index) => {
    const name = (source.tableId ?? view.tableId) === tableId ? wanted.get(norm(source.column)) : undefined;
    if (name === undefined) { sources.push(source); return; }
    const placed = { index, source: { ...source, tableId } };
    const list = at.get(name);
    if (list) list.push(placed); else at.set(name, [placed]);
  });
  if (!at.size) return null;
  const removed = [...wanted.values()].flatMap((physicalName) => {
    const list = at.get(physicalName);
    return list ? [{ physicalName, at: list }] : [];
  });
  return { sources, removed };
}

/** Sources de `view` (su documento vigente) con las columnas que quitó
 *  `removeColumnsSources` de vuelta. Ninguna si la vista ya no lee de esa tabla
 *  (se re-apuntó); no vuelve la que la vista ya lista ni la que repetiría un
 *  nombre de salida (se decide en orden inverso al borrado, como si volvieran de
 *  a una). Cada fuente vuelve a su índice de antes del borrado, descontadas las
 *  que no vuelven y estaban antes que ella: entre las fuentes que quedaron, cae
 *  donde estaba (una columna que la vista volvió a listar, al final, no la
 *  corre); si ahora tiene menos fuentes, al final. null si no repone ninguna.
 *  Lineal. Puro. */
export function restoreColumnsSources(view: View, tableId: string, removed: RemovedColumn[]): ViewSource[] | null {
  const reads = view.sourceTableIds?.length ? view.sourceTableIds : (view.tableId ? [view.tableId] : []);
  if (!reads.includes(tableId)) return null;
  const current = view.sources ?? [];
  const listed = new Set(current.filter((s) => (s.tableId ?? view.tableId) === tableId).map((s) => norm(s.column)));
  // Un nombre de salida que ya estaba repetido puede repetirse; cualquier otro, no.
  const repeated = new Set(duplicateOutputNames(current).map((n) => n.toLowerCase()));
  const taken = new Set(current.map((s) => outputNameOf(s).toLowerCase()).filter(Boolean));
  const back = new Set<RemovedColumn>();
  for (const r of [...removed].reverse()) {
    if (listed.has(norm(r.physicalName))) continue;
    const names = r.at.map((p) => outputNameOf(p.source).toLowerCase()).filter(Boolean);
    if (names.some((n, i) => !repeated.has(n) && (taken.has(n) || names.indexOf(n) < i))) continue;
    names.forEach((n) => taken.add(n));
    back.add(r);
  }
  if (!back.size) return null;
  const skipped = removed.filter((r) => !back.has(r)).flatMap((r) => r.at.map((p) => p.index)).sort((a, b) => a - b);
  const placed = [...back].flatMap((r) => r.at).sort((a, b) => a.index - b.index);
  const out: ViewSource[] = [];
  let next = 0;   // la siguiente fuente vigente
  let gaps = 0;   // fuentes que no vuelven, antes de la que se ubica
  for (const { index, source } of placed) {
    while (gaps < skipped.length && skipped[gaps] < index) gaps += 1;
    while (out.length < index - gaps && next < current.length) out.push(current[next++]);
    out.push(source);
  }
  return [...out, ...current.slice(next)];
}

/** ¿Proyecta algo? Alguna fuente con columna o expresión no vacía: sin ninguna,
 *  el Export DDL (`viewDDL`) escribe la vista como `SELECT *`. Puro. */
export function hasProjection(sources: ViewSource[] | undefined): boolean {
  return (sources ?? []).some((s) => (s.column ?? '').trim() || (s.expression ?? '').trim());
}

/** Las vistas que quedan sin proyección al quitarles esas columnas. Puro. */
export function viewsLeftEmpty(views: View[], tableId: string, physicalNames: string[]): View[] {
  return views.filter((v) => {
    const next = removeColumnsSources(v, tableId, physicalNames);
    return !!next && !hasProjection(next.sources);
  });
}

/** Sources con la columna renombrada (rename físico); null si no la referencia.
 *  El alias sigue al nombre solo si era el default (== nombre anterior); un alias
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

/** Propaga una columna recién creada a las vistas espejo de su tabla
 *  (`isPrimaryKey`: la nueva es PK ⇒ entra tras las PK). Devuelve cuántas
 *  vistas se extendieron. Best-effort del caller (no debe bloquear el alta de
 *  la columna). */
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

/** Variante para varias columnas nuevas de un mismo lote (paste, relación,
 *  split): las propaga en orden, ampliando la línea base con cada una — así
 *  varias PK nuevas entran tras las PK en su orden y una vista espejo sigue
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
    catch (e) {
      // El corte por cambio de sesión (deps con pin) no es un error de esta
      // vista: corta el resto; lo demás, best-effort: la vista se alinea
      // después con "Match physical order".
      if (e instanceof SessionChangedError) throw e;
    }
    base = [...base, { id: `new:${c.physicalName}`, tableId, physicalName: c.physicalName, logicalName: c.physicalName,
      dataType: '', typeOverridden: false, ordinal: base.length, isPrimaryKey: !!c.isPrimaryKey }];
  }
  return touched;
}

/** Columna eliminada: sale de los sources de toda vista que la referencie
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

/** Columna renombrada (físico): re-apunta los sources de toda vista que la
 *  referenciaba por el nombre anterior. Devuelve cuántas vistas se tocaron. */
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
