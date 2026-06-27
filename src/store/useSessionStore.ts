/**
 * useSessionStore — usuario simulado actual de la sesión (sim auth Databricks).
 *
 * En local el backend corre con `AUTH_MODE=local` y resuelve el actor desde el
 * header `X-Dev-User`. Este store es la ÚNICA fuente de verdad del usuario
 * simulado en el frontend: el `UserMenu` del TopNav lo cambia y, en cada cambio,
 * empuja el id al cliente HTTP (`setDevUser`) para que TODA llamada lleve el
 * header correcto. En Databricks real el header lo pone el proxy (OBO) y este
 * switch se oculta (fuera de R0).
 *
 * NOTA: no consolida ni reemplaza `useChangesetStore`/`useIdentityStore`
 * (features legacy los importan). Es un store NUEVO que centraliza el actor.
 */

import { create } from 'zustand';
import { setDevUser } from '@/services/http';

export interface SimUser {
  id: string;
  name: string;
  initials: string;
}

/** Lista fija de usuarios simulados (espeja la lista del backend: ana/beto/carla/qa/mr). */
export const SIM_USERS: SimUser[] = [
  { id: 'ana',   name: 'Ana Rivas',     initials: 'AR' },
  { id: 'beto',  name: 'Beto Núñez',    initials: 'BN' },
  { id: 'carla', name: 'Carla Mendoza', initials: 'CM' },
  { id: 'qa',    name: 'QA Reviewer',   initials: 'QA' },
  { id: 'mr',    name: 'María Rey',      initials: 'MR' },
];

/** Usuario por defecto: "MR" (coincide con el avatar del diseño en el TopNav). */
const DEFAULT_USER = SIM_USERS.find((u) => u.id === 'mr') ?? SIM_USERS[0];

/** Cómo se abrió el modelo en el canvas: sólo-lectura (producción) o edición. */
export type OpenMode = 'readonly' | 'editing';

/** Parámetros de apertura del modelo elegidos en el Open model modal (pg). */
export interface OpenModelArgs {
  mode: OpenMode;
  /** Working copy a editar (sólo en `editing`). */
  changesetId?: string;
  /** Etiqueta de versión asociada (p.ej. la publicada en readonly, o la del draft). */
  versionLabel?: string | null;
}

interface SessionState {
  /** Usuario simulado activo. */
  user: SimUser;
  /** Lista de usuarios simulados disponibles para el switch. */
  users: SimUser[];
  /** Cambia el actor por id; propaga el header `X-Dev-User`. No-op si el id no existe. */
  setUser: (id: string) => void;

  /** Modo con el que se abrió el modelo, o `null` si no hay sesión de canvas. */
  openMode: OpenMode | null;
  /** Id de la working copy abierta para editar (sólo `editing`). */
  activeChangesetId: string | null;
  /** Etiqueta de versión activa en el canvas (readonly: la publicada; editing: la del draft). */
  activeVersionLabel: string | null;
  /**
   * Setea la intención de apertura del modelo (la consume el canvas en R3).
   * No navega: el llamador (Open model modal) decide el `navigate('/model')`.
   */
  openModel: (args: OpenModelArgs) => void;
}

export const useSessionStore = create<SessionState>((set) => {
  // Empuja el actor por defecto al cliente HTTP al inicializar el store, así el
  // header `X-Dev-User` viaja desde la primera llamada (antes de tocar el menú).
  setDevUser(DEFAULT_USER.id);

  return {
    user: DEFAULT_USER,
    users: SIM_USERS,
    setUser: (id: string) => {
      const next = SIM_USERS.find((u) => u.id === id);
      if (!next) return;
      setDevUser(next.id);
      set({ user: next });
    },

    openMode: null,
    activeChangesetId: null,
    activeVersionLabel: null,
    openModel: ({ mode, changesetId, versionLabel }: OpenModelArgs) =>
      set({
        openMode: mode,
        activeChangesetId: mode === 'editing' ? (changesetId ?? null) : null,
        activeVersionLabel: versionLabel ?? null,
      }),
  };
});
