/**
 * resetAppState — borra TODO el estado de trabajo ligado al usuario al cerrar
 * sesión (logout / 401 global) y antes de abrir una nueva (login).
 *
 * Los stores de zustand son singletons de módulo y el logout es navegación SPA
 * (sin reload de página): sin este reset, el siguiente usuario HEREDA la sesión
 * de canvas del anterior (`openMode` + `activeSaId`) y al entrar a /model se le
 * abría el último canvas del otro usuario, saltándose el modal "Open model".
 * El aislamiento por sesión se garantiza acá, en un único punto.
 */
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useIdentityStore } from '@/store/useIdentityStore';
import { setDevUser } from '@/services/http';

export function resetAppState(): void {
  // Intención de apertura del canvas — era el gate que saltaba el chooser.
  useSessionStore.setState({ openMode: null, activeChangesetId: null, activeVersionLabel: null });
  // Workspace del modeler completo: selección, diagrama, árboles cacheados,
  // drawings y la instancia de React Flow del canvas desmontado.
  useModelerStore.setState({
    projects: [], folders: [], subjectAreas: [], trees: {}, openingSaId: null,
    activeProjectId: null, activeFolderId: null, activeSaId: null, diagram: null,
    columnTarget: null, selectedTableId: null, selectedEdgeId: null,
    relPreset: null, hoverEdgeId: null, hoverNodeId: null, flow: null, drawings: [],
  });
  useChangesetStore.setState({ activeId: null, changesets: [] });
  // `loaded=false` fuerza el re-fetch de /api/me para el próximo actor (el
  // guard idempotente de loadIdentity dejaba pegado el principal anterior).
  useIdentityStore.setState({ principal: null, loaded: false, loading: false });
  // Header X-Dev-User del actor anterior (el login del siguiente lo re-setea).
  setDevUser('');
  // Prefs "no volver a preguntar" de ConfirmDialog: son por-sesión-de-usuario.
  const doomed: string[] = [];
  for (let i = 0; i < window.sessionStorage.length; i += 1) {
    const k = window.sessionStorage.key(i);
    if (k?.startsWith('confirm-skip:')) doomed.push(k);
  }
  doomed.forEach((k) => window.sessionStorage.removeItem(k));
}
