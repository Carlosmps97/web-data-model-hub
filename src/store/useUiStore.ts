/**
 * useUiStore — preferencias de CHROME de la app (doc 92 D7): menú principal
 * (TopNav) y sidebar Explorer colapsados para ganar espacio de canvas. Se
 * recuerdan por browser (localStorage); no son estado del modelo.
 */
import { create } from 'zustand';

const NAV_KEY = 'dmh:ui:navCollapsed';
const EXPLORER_KEY = 'dmh:ui:explorerCollapsed';

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage bloqueado o ausente (tests) */ }
}

interface UiState {
  /** TopNav colapsado a una franja mínima con el botón para mostrarlo. */
  navCollapsed: boolean;
  /** Explorer del Model colapsado a un riel con el botón para mostrarlo. */
  explorerCollapsed: boolean;
  setNavCollapsed: (v: boolean) => void;
  setExplorerCollapsed: (v: boolean) => void;
  toggleNav: () => void;
  toggleExplorer: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  navCollapsed: readFlag(NAV_KEY),
  explorerCollapsed: readFlag(EXPLORER_KEY),
  setNavCollapsed: (v) => { writeFlag(NAV_KEY, v); set({ navCollapsed: v }); },
  setExplorerCollapsed: (v) => { writeFlag(EXPLORER_KEY, v); set({ explorerCollapsed: v }); },
  toggleNav: () => get().setNavCollapsed(!get().navCollapsed),
  toggleExplorer: () => get().setExplorerCollapsed(!get().explorerCollapsed),
}));
