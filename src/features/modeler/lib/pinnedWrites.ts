/**
 * Escrituras atadas al pin de una sesión (`pinSession`), para las acciones y
 * los pasos del historial (Undo/Redo) que escriben varias veces. Los servicios
 * toman la versión al llamarlos: si entre dos escrituras la sesión cambia (se
 * abre otra versión, o la revalidación la degrada), lo que falta no se escribe
 * (ni en la nueva ni en ninguna) y el corte no se traga como un error más.
 */
import { pendingWrite } from '@/services/draftWork';
import * as gov from '@/services/governance.service';
import type { BulkChange, CanonicalColumn, Relationship } from '@/services/governance.service';
import { NothingDoneError, type HistoryStep } from '@/store/useUndoStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as viewsSvc from '@/services/views.service';
import { SessionChangedError, afterRevalidation, pinSession, touchesVersion, type SessionPin } from './sessionGuard';
import { renamedViews, syncNewColumnsToMirrorViews, syncRemovedColumnFromViews, syncRenamedColumnInViews } from './viewSync';

/** `fn` que, antes de escribir, verifica que siga la sesión del pin. */
export const pinned = <A extends unknown[], R>(pin: SessionPin, fn: (...a: A) => R) =>
  (...a: A): R => { pin.check(); return fn(...a); };

/** Deps de los sync de vistas (`viewSync`) con el pin en `updateView`: leen
 *  igual (también las columnas vigentes de la tabla, para no tocar el nombre
 *  que conserva una homónima) y cortan antes de escribir si la sesión cambia. */
export const pinnedViewDeps = (pin: SessionPin) => ({
  listViews: viewsSvc.listViews,
  listColumns: gov.listColumns,
  updateView: pinned(pin, viewsSvc.updateView),
});

/** Un paso best-effort (sync de vistas): cualquier error se traga — la vista
 *  se corrige a mano —, salvo que la sesión haya cambiado: eso corta la acción. */
export async function bestEffort(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (e) { if (e instanceof SessionChangedError) throw e; }
}

/** Paso de un lote por valor: graba `write`, recarga (`after`) y devuelve el
 *  paso que graba `back` — deshacer y rehacer un lote son el mismo paso con los
 *  lotes cruzados (entrar o salir de la llave, cambiar el tipo de relación). */
export function lotStep(write: BulkChange[], back: BulkChange[], after: () => Promise<unknown>): HistoryStep {
  return async () => {
    await gov.recordChangesBulk(write);
    await after();
    return lotStep(back, write, after);
  };
}

/** Paso del tipo de una relación (identifying ↔ non-identifying): deshacer
 *  graba `back` en un lote (la relación y las columnas como estaban); rehacer
 *  graba la relación (`rel`) y la llave (`keys`) en un lote, salvo en una
 *  relación recursiva: ahí la llave del padre es la del hijo y el backend valida
 *  el N=N contra ella, así que va como la acción — la relación y después la llave. */
export function relationshipTypeStep(back: BulkChange[], rel: Relationship, keys: BulkChange[], after: () => Promise<unknown>): HistoryStep {
  const undo: HistoryStep = async () => {
    await gov.recordChangesBulk(back);
    await after();
    return redo;
  };
  const redo: HistoryStep = async (pin) => {
    if (rel.parentTableId !== rel.childTableId) await gov.recordChangesBulk([gov.bulk.upsertRelationship(rel), ...keys]);
    else {
      await gov.updateRelationship(rel);
      if (keys.length) {
        pin.check();
        await gov.recordChangesBulk(keys);
      }
    }
    await after();
    return undo;
  };
  return undo;
}

/** La base de un guardado de columna: la que se ve (`shown`: en el diagrama o en
 *  la ficha del Object Inspector) o, sin ella o con `fromServer` (lo que el panel
 *  manda al cerrarse), la vigente de la versión. undefined si ya no está: no se
 *  graba (un guardado no revive una columna borrada). */
export async function columnBase(id: string, shown: CanonicalColumn | undefined, fromServer?: boolean): Promise<CanonicalColumn | undefined> {
  return shown && !fromServer ? shown : (await gov.currentColumns([id]))[0];
}

/** Graba una columna. Si su físico cambia (de `fromPhysical` al de `write`), las
 *  vistas que usaban el nombre anterior —el que la columna tiene hoy en la
 *  versión: un guardado sin respuesta pudo grabarse— se re-apuntan en el MISMO
 *  lote (`renamedViews`): un solo request, todo o nada, así dos renombres seguidos
 *  (en la fila de la columna) nunca dejan una vista en el nombre intermedio. Si no
 *  se pueden leer las vistas, no graba nada (`NothingDoneError`: se puede
 *  reintentar); corta antes de escribir si la sesión del pin es otra. Devuelve
 *  cuántas vistas re-apuntó. */
export async function writeColumn(write: CanonicalColumn, fromPhysical: string, pin: SessionPin): Promise<number> {
  const same = write.physicalName.trim().toLowerCase() === fromPhysical.trim().toLowerCase();
  let moved: ReturnType<typeof renamedViews> = [];
  if (!same) {
    const cs = useSessionStore.getState().activeChangesetId;
    try {
      const [views, cols] = await Promise.all([viewsSvc.listViews(write.tableId), gov.listColumns(write.tableId).catch(() => null)]);
      const from = cols?.find((c) => c.id === write.id)?.physicalName ?? fromPhysical;
      moved = renamedViews(views, cols && cols.filter((c) => c.id !== write.id), write.tableId, from, write.physicalName);
    } catch (e) {
      // Como las demás lecturas previas: un error de la versión espera la
      // revalidación y, si la sesión ya es otra, sale tal cual (quien lo pidió
      // calla); si no, no se grabó nada y se puede reintentar.
      if (touchesVersion(e, cs)) await afterRevalidation();
      if (!pin.holds()) throw e;
      const reason = `Couldn't read the views that use ${fromPhysical}`;
      throw new NothingDoneError(reason, `${reason}: nothing was saved. Try again.`);
    }
  }
  pin.check();
  if (!moved.length) {
    await gov.updateColumn(write);   // upsert por id = update (merge)
    return 0;
  }
  const lot = [gov.bulk.updateColumn(write), ...moved.map((v) => gov.bulk.upsertView(viewsSvc.viewWriteDoc(v.id, v)))];
  await gov.recordChangesBulk(lot, lot.length);   // un solo request: todo o nada
  return moved.length;
}

/** Paso de una columna por valor: graba `write` con sus vistas re-apuntadas desde
 *  el físico de `back` (`writeColumn`, un solo lote) y devuelve el paso que graba
 *  `back`. */
export function columnStep(write: CanonicalColumn, back: CanonicalColumn, after: () => Promise<unknown>): HistoryStep {
  return async (pin) => {
    await writeColumn(write, back.physicalName, pin);
    await after();
    return columnStep(back, write, after);
  };
}

/** Un lote que creó columnas y/o renombró otras (pegar columnas, migrar la
 *  llave de una relación o de una subcategoría) como pasos del historial, con
 *  los mismos ids de un lado y del otro.
 *  · Deshacer: el lote inverso y, best-effort, las vistas — sacar las columnas
 *    creadas y devolver los renames (`renames` va del nombre previo al nuevo).
 *  · Rehacer: el lote original y, best-effort, las creadas a las vistas espejo
 *    (con la tabla de antes del lote, `baseline`) y los renames al nombre nuevo
 *    (`createdIds`: las columnas del lote, que no sostienen el nombre previo).
 *  `after`, la recarga. Cada uno corta antes de escribir si la sesión del paso
 *  es otra. */
export function columnsBatchStep(o: {
  forward: BulkChange[]; inverse: BulkChange[]; tableId: string;
  created: { physicalName: string; isPrimaryKey?: boolean | null }[]; baseline: CanonicalColumn[];
  renames?: { from: string; to: string }[]; createdIds?: string[];
  after: () => Promise<unknown>;
}): HistoryStep {
  const undo: HistoryStep = async (pin) => {
    await gov.recordChangesBulk(o.inverse);
    for (const c of o.created) {
      pin.check();
      await bestEffort(() => syncRemovedColumnFromViews(pinnedViewDeps(pin), o.tableId, c.physicalName));
    }
    for (const r of o.renames ?? []) {
      pin.check();
      await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), o.tableId, r.to, r.from));
    }
    pin.check();
    await o.after();
    return redo;
  };
  const redo: HistoryStep = async (pin) => {
    await gov.recordChangesBulk(o.forward);
    pin.check();
    await bestEffort(() => syncNewColumnsToMirrorViews(pinnedViewDeps(pin), o.tableId, o.created, o.baseline));
    for (const r of o.renames ?? []) {
      pin.check();
      await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), o.tableId, r.from, r.to, { createdIds: o.createdIds }));
    }
    pin.check();
    await o.after();
    return undo;
  };
  return undo;
}

/** Escrituras diferidas de lo que el usuario editó (debounce por clave y
 *  `flush` al cerrar el panel o al pulsar Undo o Redo). Cada una va con el pin
 *  tomado al editar: si al dispararse la sesión es otra (al cambiar de versión
 *  el panel se cierra y hace flush), se descarta. Nunca se escribe en la
 *  versión que se abrió después (si la cambia la revalidación, ella ya avisa).
 *  `write` recibe ese pin: su canvas es el de la edición. */
export function pinnedDebouncer<T>(write: (value: T, pin: SessionPin) => unknown, ms: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, { value: T; pin: SessionPin }>();
  // Lo pendiente cuenta para Undo y Redo, que lo escriben ya.
  const scheduled = pendingWrite(() => api.flush());
  const settle = () => { if (!pending.size) scheduled.release(); };
  const fire = (key: string) => {
    const p = pending.get(key);
    pending.delete(key); timers.delete(key);
    settle();
    if (p && p.pin.holds()) void write(p.value, p.pin);
  };
  const api = {
    /** Agenda (o re-agenda) la escritura de `key` con la sesión vigente. */
    schedule(key: string, value: T) {
      clearTimeout(timers.get(key));
      pending.set(key, { value, pin: pinSession() });
      timers.set(key, setTimeout(() => fire(key), ms));
      scheduled.hold();
    },
    /** Descarta lo pendiente de `key` (otro guardado trae el valor vigente). */
    cancel(key: string) {
      clearTimeout(timers.get(key));
      timers.delete(key); pending.delete(key);
      settle();
    },
    /** Escribe ya lo pendiente (cerrar el panel, Undo, Redo) — solo lo de la sesión vigente. */
    flush() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const key of [...pending.keys()]) fire(key);
    },
  };
  return api;
}
