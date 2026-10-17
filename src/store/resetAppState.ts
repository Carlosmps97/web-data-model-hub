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
import { useUndoStore } from '@/store/useUndoStore';
import { setDevUser } from '@/services/http';

export function resetAppState(): void {
  // Intención de apertura del canvas — era el gate que saltaba el chooser.
  useSessionStore.setState({ openMode: null, activeChangesetId: null, activeVersionLabel: null, activeProjectId: null });
  // Workspace del modeler completo: selección, diagrama, árboles cacheados,
  // drawings y la instancia de React Flow del canvas desmontado.
  useModelerStore.setState({
    projects: [], folders: [], subjectAreas: [], trees: {}, openingSaId: null,
    activeProjectId: null, activeFolderId: null, activeSaId: null, diagram: null,
    columnTarget: null, selectedTableId: null, selectedEdgeId: null, selectedColumnId: null,
    relPreset: null, subcatArmed: false, hoverEdgeId: null, hoverNodeId: null, flow: null, drawings: [], justAddedDrawingId: null,
    modelProps: null, colorPreview: null, freshNodes: {},
    // Aislamiento por sesión/usuario (doc 50 §4): los clipboards de copy/paste
    // (docs 48/50) y la selección/menú/deep-link viven en memoria del tab —
    // sin este reset, el SIGUIENTE usuario del mismo tab heredaba lo copiado
    // por el anterior y podía pegarlo sin querer.
    colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null,
    colClipboard: null, tblClipboard: null,
  });
  // La pila de Undo también es de la sesión (doc 50): las inversas del usuario
  // anterior no deben poder ejecutarse desde la sesión nueva.
  useUndoStore.getState().clear();
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
