import { create } from 'zustand';

/**
 * useBusyStore — bloqueo por sesión de acciones largas: solo la
 * pestaña que disparó la acción ve el overlay; el backend no toma locks
 * globales, así que otras sesiones siguen trabajando.
 */
interface BusyState {
  active: { title: string; detail?: string; startedAt: number } | null;
  start: (title: string, detail?: string) => void;
  stop: () => void;
}

export const useBusyStore = create<BusyState>((set) => ({
  active: null,
  start: (title, detail) => set({ active: { title, detail, startedAt: Date.now() } }),
  stop: () => set({ active: null }),
}));

/** Corre `fn` con el overlay bloqueante encendido; lo apaga siempre (también
 *  si falla). Anidable: dentro de otra acción bloqueante no toca el overlay
 *  (el título de la acción externa se conserva hasta que ella termina). */
export async function runBlocking<T>(title: string, fn: () => Promise<T>, detail?: string): Promise<T> {
  const nested = useBusyStore.getState().active !== null;
  if (!nested) useBusyStore.getState().start(title, detail);
  try {
    return await fn();
  } finally {
    if (!nested) useBusyStore.getState().stop();
  }
}
