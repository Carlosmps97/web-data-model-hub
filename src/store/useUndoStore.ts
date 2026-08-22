/**
 * Pila de Undo de la sesión de edición (doc 50). Cada acción instrumentada
 * apila su INVERSA como closure que ejecuta los MISMOS servicios
 * changeset-aware — deshacer es un cambio más del draft (versionamiento y
 * change feeds ven upserts/deletes normales; cero mecánica nueva).
 *
 * Límites (pedido explícito): vive en memoria del tab, muere al cambiar o
 * soltar el changeset (suscripción en useModelerStore, junto al clipboard del
 * doc 48) y en resetAppState (logout). No hay redo.
 */
import { create } from 'zustand';

export interface UndoEntry {
  /** Qué se va a deshacer — se muestra en el tooltip del botón y en el toast. */
  label: string;
  /** Inversa: corre contra los servicios changeset-aware + reload. */
  run: () => Promise<void>;
}

const CAP = 50;

interface UndoState {
  stack: UndoEntry[];
  /** Inversa en vuelo: bloquea el botón/atajo y SUPRIME la instrumentación
   *  (una inversa no apila su propia inversa). */
  busy: boolean;
  push: (e: UndoEntry) => void;
  clear: () => void;
  /** Deshace la última acción. Devuelve su label (para el toast) o null si no
   *  había nada / ya corre una. Si la inversa falla, la entrada YA salió de la
   *  pila (se descarta — no bloquea el resto) y el error se propaga. */
  undoLast: () => Promise<string | null>;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  busy: false,
  push: (e) => {
    if (get().busy) return;
    const stack = [...get().stack, e];
    if (stack.length > CAP) stack.shift();
    set({ stack });
  },
  clear: () => { if (get().stack.length) set({ stack: [] }); },
  undoLast: async () => {
    const { stack, busy } = get();
    if (busy || !stack.length) return null;
    const entry = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1), busy: true });
    try {
      await entry.run();
      return entry.label;
    } finally { set({ busy: false }); }
  },
}));

/** Azúcar para los sitios de instrumentación (stores y popups). */
export const pushUndo = (label: string, run: () => Promise<void>) =>
  useUndoStore.getState().push({ label, run });
