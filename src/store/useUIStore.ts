// Zustand store for UI state management
import { create } from 'zustand';

type ModalType = 'createProject' | 'importExcel' | 'tableForm' | 'dbmlEditor' | 'deleteConfirm' | null;

interface UIStore {
  // Panel visibility
  sidebarOpen: boolean;
  /**
   * Whether the main app sidebar is collapsed to its icon-only width.
   * Persisted across reloads via localStorage so the user's choice sticks.
   */
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  chatPanelOpen: boolean;
  /** Off-canvas quick-help drawer (opened from the rail "?" button). */
  helpOpen: boolean;

  /**
   * Width in pixels of the left workbench panel (Visual / Code tabs) inside
   * the model editor and the global canvas. Persisted across sessions via
   * `localStorage` so the user's preferred working width is remembered.
   */
  leftPanelWidth: number;

  // Selection
  selectedTableId: string | null;

  // Color preview (applied visually to the selected table without persisting)
  previewColor: string | null;

  // Modals
  activeModal: ModalType;
  modalData: Record<string, unknown> | null;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
  setChatPanelOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
  setLeftPanelWidth: (width: number) => void;
  setSelectedTable: (id: string | null) => void;
  setPreviewColor: (color: string | null) => void;
  openModal: (modal: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

/** Clamp the left-panel width to sane bounds independent of viewport size. */
const LEFT_PANEL_MIN = 220;
const LEFT_PANEL_MAX = 720;
const LEFT_PANEL_DEFAULT = 288;
const LEFT_PANEL_STORAGE_KEY = 'dmh:leftPanelWidth';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dmh:sidebarCollapsed';

function loadInitialLeftPanelWidth(): number {
  if (typeof window === 'undefined') return LEFT_PANEL_DEFAULT;
  const raw = window.localStorage.getItem(LEFT_PANEL_STORAGE_KEY);
  if (!raw) return LEFT_PANEL_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return LEFT_PANEL_DEFAULT;
  return Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, parsed));
}

function loadInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  sidebarCollapsed: loadInitialSidebarCollapsed(),
  rightPanelOpen: false,
  chatPanelOpen: false,
  helpOpen: false,
  leftPanelWidth: loadInitialLeftPanelWidth(),
  selectedTableId: null,
  previewColor: null,
  activeModal: null,
  modalData: null,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapsed: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      }
      return { sidebarCollapsed: next };
    }),
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  toggleChatPanel: () => set((state) => ({ chatPanelOpen: !state.chatPanelOpen })),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  toggleHelp: () => set((state) => ({ helpOpen: !state.helpOpen })),
  setLeftPanelWidth: (width) => {
    const clamped = Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, Math.round(width)));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LEFT_PANEL_STORAGE_KEY, String(clamped));
    }
    set({ leftPanelWidth: clamped });
  },
  setSelectedTable: (id) => set({ selectedTableId: id, rightPanelOpen: id !== null, previewColor: null }),
  setPreviewColor: (color) => set({ previewColor: color }),
  openModal: (modal, data) => set({ activeModal: modal, modalData: data || null }),
  closeModal: () => set({ activeModal: null, modalData: null }),
}));
