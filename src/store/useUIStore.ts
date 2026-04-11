// Zustand store for UI state management
import { create } from 'zustand';

type ModalType = 'createProject' | 'importExcel' | 'tableForm' | 'dbmlEditor' | 'deleteConfirm' | null;

interface UIStore {
  // Panel visibility
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  chatPanelOpen: boolean;

  // Selection
  selectedTableId: string | null;

  // Modals
  activeModal: ModalType;
  modalData: Record<string, unknown> | null;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
  setChatPanelOpen: (open: boolean) => void;
  setSelectedTable: (id: string | null) => void;
  openModal: (modal: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: false,
  chatPanelOpen: false,
  selectedTableId: null,
  activeModal: null,
  modalData: null,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  toggleChatPanel: () => set((state) => ({ chatPanelOpen: !state.chatPanelOpen })),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setSelectedTable: (id) => set({ selectedTableId: id, rightPanelOpen: id !== null }),
  openModal: (modal, data) => set({ activeModal: modal, modalData: data || null }),
  closeModal: () => set({ activeModal: null, modalData: null }),
}));
