/**
 * Escrituras atadas al pin de una sesión (`pinSession`), para las acciones y
 * las inversas del Undo que escriben varias veces. Los servicios toman la
 * versión al llamarlos: si entre dos escrituras la sesión cambia (se abre otra
 * versión, o la revalidación la degrada), lo que falta no se escribe (ni en la
 * nueva ni en ninguna) y el corte no se traga como un error más.
 */
import * as gov from '@/services/governance.service';
import type { BulkChange } from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { SessionChangedError, pinSession, type SessionPin } from './sessionGuard';
import { syncRemovedColumnFromViews, syncRenamedColumnInViews } from './viewSync';

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

/** Inversa de un lote que creó columnas y/o renombró otras (pegar columnas,
 *  migrar la llave de una relación o de una subcategoría): el lote inverso y,
 *  best-effort, las vistas — sacar las columnas creadas y devolver los renames
 *  —; `after`, la recarga. Recibe el pin de la sesión del Undo (`run(pin)`). */
export function undoColumnsBatch(o: {
  inverse: BulkChange[]; tableId: string; created: string[]; renamesBack?: { from: string; to: string }[];
  after: () => Promise<unknown>;
}): (pin: SessionPin) => Promise<void> {
  return async (pin) => {
    await gov.recordChangesBulk(o.inverse);
    for (const name of o.created) {
      pin.check();
      await bestEffort(() => syncRemovedColumnFromViews(pinnedViewDeps(pin), o.tableId, name));
    }
    for (const r of o.renamesBack ?? []) {
      pin.check();
      await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), o.tableId, r.from, r.to));
    }
    pin.check();
    await o.after();
  };
}

/** Escrituras diferidas de lo que el usuario editó (debounce por clave y
 *  `flush` al cerrar el panel). Cada una va con el pin tomado al editar: si al
 *  dispararse la sesión es otra (al cambiar de versión el panel se cierra y
 *  hace flush), se descarta. Nunca se escribe en la versión que se abrió
 *  después (si la cambia la revalidación, ella ya avisa). */
export function pinnedDebouncer<T>(write: (value: T) => unknown, ms: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, { value: T; pin: SessionPin }>();
  const fire = (key: string) => {
    const p = pending.get(key);
    pending.delete(key); timers.delete(key);
    if (p && p.pin.holds()) void write(p.value);
  };
  return {
    /** Agenda (o re-agenda) la escritura de `key` con la sesión vigente. */
    schedule(key: string, value: T) {
      clearTimeout(timers.get(key));
      pending.set(key, { value, pin: pinSession() });
      timers.set(key, setTimeout(() => fire(key), ms));
    },
    /** Descarta lo pendiente de `key` (otro guardado trae el valor vigente). */
    cancel(key: string) {
      clearTimeout(timers.get(key));
      timers.delete(key); pending.delete(key);
    },
    /** Escribe ya lo pendiente (cerrar el panel) — solo lo de la sesión vigente. */
    flush() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const key of [...pending.keys()]) fire(key);
    },
  };
}
