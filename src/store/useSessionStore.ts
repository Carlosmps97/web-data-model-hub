/**
 * useSessionStore — sesión del frontend: el actor (espejado desde `useAuthStore`
 * tras el login; en dev viaja además como header `X-Dev-User`) y la sesión de
 * canvas (proyecto + modo + changeset + etiqueta de versión).
 * Es la única fuente del changeset activo: servicios y gates de UI leen
 * `activeChangesetId` de aquí.
 */

import { create } from 'zustand';
import { setDevUser } from '@/services/http';

export interface SimUser {
  id: string;
  name: string;
  initials: string;
}

/** Cómo se abrió el modelo en el canvas: solo lectura (producción) o edición. */
export type OpenMode = 'readonly' | 'editing';

/** Clave de localStorage con el último proyecto abierto (preselección del Open model). */
export const LAST_PROJECT_KEY = 'dmh:lastProject';

/** Parámetros de apertura del modelo elegidos en el Open model modal (pg). */
export interface OpenModelArgs {
  /** Proyecto que se abre: toda sesión de canvas es de un proyecto. */
  projectId: string;
  mode: OpenMode;
  /**
   * Changeset asociado: en `editing` es la working copy a mutar; en `readonly`
   * permite ver el contenido de un changeset (overlay /effective) sin habilitar
   * escrituras — p.ej. un request en revisión abierto desde Review. Sin él,
   * `readonly` muestra producción.
   */
  changesetId?: string;
  /** Etiqueta de versión asociada (p.ej. la publicada en readonly, o la del draft). */
  versionLabel?: string | null;
}

interface SessionState {
  /** Actor de la sesión (`id` == username). Vacío hasta el login. */
  user: SimUser;
  /** Setea el actor real tras el login. La identidad autoritativa vive en
   *  `useAuthStore`; esto espeja el actor a los lectores (`user.id`) + el
   *  header X-Dev-User de desarrollo. */
  setSessionUser: (u: SimUser) => void;

  /** Modo con el que se abrió el modelo, o `null` si no hay sesión de canvas. */
  openMode: OpenMode | null;
  /** Changeset abierto: working copy en `editing`, o changeset visualizado en `readonly`. */
  activeChangesetId: string | null;
  /** Etiqueta de versión activa en el canvas (readonly: la publicada; editing: la del draft). */
  activeVersionLabel: string | null;
  /** Proyecto activo de la sesión de canvas, o `null` sin sesión. */
  activeProjectId: string | null;
  /**
   * Setea la intención de apertura del modelo (la consume el canvas).
   * No navega: el llamador (Open model modal) decide el `navigate('/model')`.
   */
  openModel: (args: OpenModelArgs) => void;
  /** Cierra la sesión de canvas (sin changeset, etiqueta ni proyecto): vuelve al chooser. */
  closeModel: () => void;
}

/** Proyecto activo o error explícito: ningún servicio del canvas busca «global». */
export function sessionProjectId(): string {
  const pid = useSessionStore.getState().activeProjectId;
  if (!pid) throw new Error('Open a project first.');
  return pid;
}

export const useSessionStore = create<SessionState>((set) => {
  return {
    user: { id: '', name: '', initials: '' },
    setSessionUser: (u: SimUser) => {
      setDevUser(u.id);
      set({ user: u });
    },

    openMode: null,
    activeChangesetId: null,
    activeVersionLabel: null,
    activeProjectId: null,
    openModel: ({ projectId, mode, changesetId, versionLabel }: OpenModelArgs) => {
      try { localStorage.setItem(LAST_PROJECT_KEY, projectId); } catch { /* storage bloqueado o ausente (tests) */ }
      set({
        openMode: mode,
        // También en `readonly`: con changesetId el canvas lee su overlay
        // (/effective) para visualizar un request; las escrituras quedan
        // bloqueadas por el gate de `openMode` (governance.service `rec()`).
        activeChangesetId: changesetId ?? null,
        activeVersionLabel: versionLabel ?? null,
        activeProjectId: projectId,
      });
    },
    closeModel: () => set({ openMode: null, activeChangesetId: null, activeVersionLabel: null, activeProjectId: null }),
  };
});
