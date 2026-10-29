/**
 * Flujos de borrado compartidos por el menú del canvas y el panel Properties:
 * leen el impacto, abren el diálogo de `deleteConfirm` y avisan el resultado.
 * Cada flujo es de la sesión en que empezó: si mientras lee se abre otra
 * versión, el diálogo no se abre en ella, y la acción verifica el pin al clic.
 * `stillWanted` / `beforeDialog` son del menú: si se cerró mientras leía no hay
 * diálogo, y se cierra justo antes de abrirlo.
 */
import { confirmDialog } from '@/components/ui/dialogs';
import { facetName, facetNouns, type Facet, type FacetNouns } from '@/lib/facets';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { columnsImpactFromLinks } from '../lib/columnsImpact';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { namesLeavingTable, viewsLeftEmpty } from '../lib/viewSync';
import { confirmDeleteColumns, confirmDeleteTable, confirmDeleteTables, readTableDeleteCounts, readTablesDeleteCounts } from './deleteConfirm';

type PushToast = (m: string, k?: 'err') => void;
interface MenuHooks { stillWanted?: () => boolean; beforeDialog?: () => void }

/** Un borrado por tabla a la vez (de la tabla o de sus columnas): el menú y los
 *  paneles pueden pedir el mismo mientras el primero lee su impacto o tiene su
 *  diálogo abierto, y el segundo diálogo repetiría el borrado con un impacto
 *  viejo. Un pedido del menú que ya se canceló (el menú se cerró mientras leía)
 *  no retiene la tabla. */
export interface TableHold {
  /** El diálogo ya se abrió: desde ahí el pedido sigue aunque el menú se cerró. */
  dialog: boolean;
  release: () => void;
}
const held = new Map<string, TableHold & { stillWanted?: () => boolean }>();

/** El aviso cuando otro borrado vigente tiene la tabla (en un grupo, alguna de sus tablas). */
export const busyMessage = (nouns: FacetNouns, group = false) =>
  (group ? `A delete on one of these ${nouns.many} is already in progress` : `A delete on this ${nouns.one} is already in progress`);

/** Toma la tabla para un borrado; null si otro borrado vigente la tiene. */
export function holdTable(tableId: string, stillWanted?: () => boolean): TableHold | null {
  const other = held.get(tableId);
  if (other && (other.dialog || other.stillWanted?.() !== false)) return null;
  const hold = {
    dialog: false, stillWanted,
    release: () => { if (held.get(tableId) === hold) held.delete(tableId); },
  };
  held.set(tableId, hold);
  return hold;
}

/** Nombres de las vistas que borrar esas columnas deja sin columnas (un nombre
 *  que conserva otra columna de la tabla, homónima, no sale de las vistas);
 *  null si no se pudieron leer (el diálogo lo dice). Nunca rechaza: corre junto
 *  con la lectura del impacto, sin sumar una ida y vuelta. */
export function readEmptiedViews(tableId: string, cols: { id: string; physicalName: string }[]): Promise<string[] | null> {
  const gone = new Set(cols.map((c) => c.id));
  return Promise.all([viewsSvc.listViews(tableId), gov.listColumns(tableId)])
    .then(([views, all]) => {
      const names = namesLeavingTable(cols.map((c) => c.physicalName), all.filter((c) => !gone.has(c.id)));
      return viewsLeftEmpty(views, tableId, names).map((v) => v.name);
    })
    .catch(() => null);
}

/** Borrar columnas de una tabla (una o varias): el impacto sale de una sola
 *  lectura de los links de la tabla y las vistas se leen a la vez; un diálogo y
 *  un solo lote (`deleteColumns` del store) con las relaciones de ese impacto. */
export function askDeleteColumns(o: {
  tableId: string; tableName: string; cols: CanonicalColumn[]; viewMode: Facet; pushToast: PushToast;
  deleteColumns: (ids: string[], relIds: string[], opts?: { cols?: CanonicalColumn[] }) => Promise<void>;
} & MenuHooks): Promise<void> {
  const hold = holdTable(o.tableId, o.stillWanted);
  if (hold) return deleteColumnsFlow(o, hold).finally(hold.release);
  o.beforeDialog?.();
  o.pushToast(busyMessage(facetNouns(o.viewMode)));
  return Promise.resolve();
}

async function deleteColumnsFlow(o: Parameters<typeof askDeleteColumns>[0], hold: TableHold): Promise<void> {
  const nouns = facetNouns(o.viewMode);
  const one = o.cols.length === 1;
  const these = one ? `this ${nouns.member}` : `these ${nouns.members}`;
  // El pin y los avisos se toman antes de leer: creados después, el aviso
  // saldría encima del de la revalidación.
  const pin = pinSession();
  const unreadable = `Couldn't check the relationships of ${these}: nothing was deleted. Try again.`;
  const onImpactError = reportWriteError(() => o.pushToast(unreadable, 'err'));
  const onError = reportWriteError((e) => o.pushToast(e instanceof Error && e.message ? e.message : `Couldn't delete ${these}`, 'err'));
  const ids = o.cols.map((c) => c.id);
  const emptied = readEmptiedViews(o.tableId, o.cols);
  // Sin el impacto no se ofrece el borrado: sin `relIds` quedarían relaciones
  // con pares hacia columnas borradas.
  let impact: gov.RelationshipImpact;
  try {
    impact = columnsImpactFromLinks(ids, (await gov.tableLinks(o.tableId)).links);
  } catch (e) {
    // Si el menú se cerró mientras leía, el borrado ya se canceló: no hay aviso.
    if (o.stillWanted?.() !== false) await onImpactError(e);
    return;
  }
  const emptiedViews = await emptied;
  if (!pin.holds() || o.stillWanted?.() === false) return;
  hold.dialog = true;
  o.beforeDialog?.();
  const relIds = impact.relationships.map((r) => r.relId);
  try {
    const ok = await confirmDeleteColumns({
      names: o.cols.map((c) => facetName(c, o.viewMode)), tableName: o.tableName, nouns, impact, emptiedViews,
      // Las columnas viajan al store: si el canvas se cierra con el diálogo
      // abierto, la cascada (relaciones, FK, vistas, Undo) se resuelve igual.
      action: () => { pin.check(); return o.deleteColumns(ids, relIds, { cols: o.cols }); },
    });
    if (ok) {
      const what = one ? nouns.Member : `${o.cols.length} ${nouns.members}`;
      o.pushToast(impact.total > 0 ? `${what} and ${one ? 'its' : 'their'} relationships deleted` : `${what} deleted`);
    }
  } catch (e) { await onError(e); }
}

/** Borrar la tabla del modelo: conteo del impacto (canvases, tablas
 *  relacionadas, vistas), diálogo y la cascada versionada del store. */
export function askDeleteTable(o: {
  table: CanonicalTable; nouns: FacetNouns; pushToast: PushToast; deleteTable: (tableId: string) => Promise<void>;
} & MenuHooks): Promise<void> {
  const hold = holdTable(o.table.id, o.stillWanted);
  if (hold) return deleteTableFlow(o, hold).finally(hold.release);
  o.beforeDialog?.();
  o.pushToast(busyMessage(o.nouns));
  return Promise.resolve();
}

async function deleteTableFlow(o: Parameters<typeof askDeleteTable>[0], hold: TableHold): Promise<void> {
  const pin = pinSession();
  // Con la versión recién transferida el borrado termina con el error
  // original de la versión; la revalidación se encarga del aviso, así que
  // aquí se calla.
  const onError = reportWriteError((e) => o.pushToast(e instanceof Error && e.message ? e.message : `Couldn't delete the ${o.nouns.one}`, 'err'));
  try {
    // Lo que no se pudo contar, el diálogo lo indica (en vez de mostrar «0»).
    const impact = await readTableDeleteCounts(o.table.id);
    if (!pin.holds() || o.stillWanted?.() === false) return;
    hold.dialog = true;
    o.beforeDialog?.();
    // El borrado corre dentro del diálogo: queda con spinner y bloqueado hasta
    // terminar (evita clics repetidos durante la espera).
    const ok = await confirmDeleteTable({
      name: o.table.physicalName || o.table.logicalName, nouns: o.nouns, impact,
      action: async () => { pin.check(); await o.deleteTable(o.table.id); },
    });
    if (ok) o.pushToast(`${o.nouns.One} deleted`);
  } catch (e) { await onError(e); }
}

/** Borrar un grupo de tablas del modelo (doc 134 §3.9): cada una queda tomada
 *  mientras dura; si otro borrado ya tiene alguna, no hay diálogo y las demás
 *  quedan libres. Impacto sumado, un diálogo y un solo lote (`deleteTables`). */
export function askDeleteTables(o: {
  tables: CanonicalTable[]; nouns: FacetNouns; pushToast: PushToast; deleteTables: (ids: string[]) => Promise<void>;
} & MenuHooks): Promise<void> {
  const holds: TableHold[] = [];
  for (const t of o.tables) {
    const hold = holdTable(t.id, o.stillWanted);
    if (!hold) {
      holds.forEach((h) => h.release());
      o.beforeDialog?.();
      o.pushToast(busyMessage(o.nouns, o.tables.length > 1));
      return Promise.resolve();
    }
    holds.push(hold);
  }
  return deleteTablesFlow(o, holds).finally(() => holds.forEach((h) => h.release()));
}

async function deleteTablesFlow(o: Parameters<typeof askDeleteTables>[0], holds: TableHold[]): Promise<void> {
  const pin = pinSession();
  const what = `${o.tables.length} ${o.nouns.many}`;
  const onError = reportWriteError((e) => o.pushToast(e instanceof Error && e.message ? e.message : `Couldn't delete the ${what}`, 'err'));
  try {
    const impact = await readTablesDeleteCounts(o.tables.map((t) => t.id));
    if (!pin.holds() || o.stillWanted?.() === false) return;
    holds.forEach((h) => { h.dialog = true; });
    o.beforeDialog?.();
    const ids = o.tables.map((t) => t.id);
    const ok = await confirmDeleteTables({
      names: o.tables.map((t) => t.physicalName || t.logicalName), nouns: o.nouns, impact,
      action: async () => { pin.check(); await o.deleteTables(ids); },
    });
    if (ok) o.pushToast(`${what} deleted`);
  } catch (e) { await onError(e); }
}

/** Quitar un grupo de tablas del canvas abierto (siguen en el modelo). */
export async function askRemoveTablesFromCanvas(o: {
  tables: CanonicalTable[]; nouns: FacetNouns; pushToast: PushToast; remove: (ids: string[]) => Promise<void>;
}): Promise<void> {
  const what = `${o.tables.length} ${o.nouns.many}`;
  const onError = reportWriteError((e) => o.pushToast(e instanceof Error && e.message ? e.message : `Couldn't remove the ${what}`, 'err'));
  try {
    const ok = await confirmDialog({
      title: 'Remove from canvas',
      message: <>Remove {what} from this canvas? They stay in the model — you can add them back later.</>,
      confirmLabel: 'Remove', cancelLabel: 'Cancel',
      action: async () => { await o.remove(o.tables.map((t) => t.id)); },
    });
    if (ok) o.pushToast(`${what} removed from this canvas`);
  } catch (e) { await onError(e); }
}

/** Quitar la tabla del canvas abierto (sigue en el modelo). */
export async function askRemoveFromCanvas(o: {
  table: CanonicalTable; nouns: FacetNouns; pushToast: PushToast; remove: (tableId: string) => Promise<void>;
}): Promise<void> {
  const onError = reportWriteError((e) => o.pushToast(e instanceof Error && e.message ? e.message : `Couldn't remove the ${o.nouns.one}`, 'err'));
  try {
    const ok = await confirmDialog({
      title: 'Remove from canvas',
      message: <>Remove <strong>“{o.table.physicalName || o.table.logicalName}”</strong> from this canvas? The table and its data stay in the model — you can add it back later.</>,
      confirmLabel: 'Remove', cancelLabel: 'Cancel',
      // El diálogo queda con spinner y bloqueado hasta que termina (no cierra
      // ni deja re-clickear mientras se aplica).
      action: async () => { await o.remove(o.table.id); },
    });
    if (ok) o.pushToast(`${o.nouns.One} removed from this canvas`);
  } catch (e) { await onError(e); }
}
