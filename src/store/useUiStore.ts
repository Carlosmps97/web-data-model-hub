/**
 * useUiStore — preferencias de CHROME del Model (doc 92 D7): la barra de
 * herramientas del canvas (Model · Structure · Relationships · Drawing ·
 * Actions · Save · Publish) y el sidebar Explorer colapsados para ganar
 * espacio de canvas. La navegación de módulos (TopNav) NO se colapsa: queda
 * siempre fija. Se recuerdan por browser (localStorage); no son estado del
 * modelo.
 */
import { create } from 'zustand';

const TOOLBAR_KEY = 'dmh:ui:toolbarCollapsed';
const EXPLORER_KEY = 'dmh:ui:explorerCollapsed';

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage bloqueado o ausente (tests) */ }
}

interface UiState {
  /** Barra de herramientas del canvas colapsada a una franja mínima. */
  toolbarCollapsed: boolean;
  /** Explorer del Model colapsado a un riel con el botón para mostrarlo. */
  explorerCollapsed: boolean;
  setToolbarCollapsed: (v: boolean) => void;
  setExplorerCollapsed: (v: boolean) => void;
  toggleToolbar: () => void;
  toggleExplorer: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  toolbarCollapsed: readFlag(TOOLBAR_KEY),
  explorerCollapsed: readFlag(EXPLORER_KEY),
  setToolbarCollapsed: (v) => { writeFlag(TOOLBAR_KEY, v); set({ toolbarCollapsed: v }); },
  setExplorerCollapsed: (v) => { writeFlag(EXPLORER_KEY, v); set({ explorerCollapsed: v }); },
  toggleToolbar: () => get().setToolbarCollapsed(!get().toolbarCollapsed),
  toggleExplorer: () => get().setExplorerCollapsed(!get().explorerCollapsed),
}));
