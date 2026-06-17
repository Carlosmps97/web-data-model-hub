// Zustand store for the transversal UDP / Semantic Type catalog.
//
// Loaded once (lazily) and cached for the session — it's small, cross-project
// governance metadata read by every project's table editor and managed in the
// Model Center "Metadata" section. All HTTP calls delegate to
// `@/services/metadata.service`.

import { create } from 'zustand';
import type { SemanticType, Udp } from '@/types/model';
import { metadataService, ApiError } from '@/services';

interface MetadataStore {
  semanticTypes: SemanticType[];
  udps: Udp[];
  loaded: boolean;
  loading: boolean;
  error: string | null;

  /** Load the catalog once. Pass `force` to refetch. */
  load: (force?: boolean) => Promise<void>;

  createSemanticType: (data: Omit<SemanticType, 'id'>) => Promise<SemanticType | null>;
  updateSemanticType: (id: string, data: Omit<SemanticType, 'id'>) => Promise<SemanticType | null>;
  deleteSemanticType: (id: string) => Promise<boolean>;

  createUdp: (data: Omit<Udp, 'id'>) => Promise<Udp | null>;
  updateUdp: (id: string, data: Omit<Udp, 'id'>) => Promise<Udp | null>;
  deleteUdp: (id: string) => Promise<boolean>;

  semanticTypeById: (id?: string) => SemanticType | undefined;
}

export const useMetadataStore = create<MetadataStore>((set, get) => ({
  semanticTypes: [],
  udps: [],
  loaded: false,
  loading: false,
  error: null,

  load: async (force) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true, error: null });
    try {
      const [semanticTypes, udps] = await Promise.all([
        metadataService.listSemanticTypes(),
        metadataService.listUdps(),
      ]);
      set({ semanticTypes, udps, loaded: true });
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  createSemanticType: async (data) => {
    try {
      const st = await metadataService.createSemanticType(data);
      set((s) => ({ semanticTypes: [...s.semanticTypes, st] }));
      return st;
    } catch (err) { console.error('createSemanticType', err); return null; }
  },
  updateSemanticType: async (id, data) => {
    try {
      const st = await metadataService.updateSemanticType(id, data);
      set((s) => ({ semanticTypes: s.semanticTypes.map((x) => (x.id === id ? st : x)) }));
      return st;
    } catch (err) { console.error('updateSemanticType', err); return null; }
  },
  deleteSemanticType: async (id) => {
    try {
      await metadataService.deleteSemanticType(id);
      set((s) => ({ semanticTypes: s.semanticTypes.filter((x) => x.id !== id) }));
      return true;
    } catch (err) { console.error('deleteSemanticType', err); return false; }
  },

  createUdp: async (data) => {
    try {
      const u = await metadataService.createUdp(data);
      set((s) => ({ udps: [...s.udps, u] }));
      return u;
    } catch (err) { console.error('createUdp', err); return null; }
  },
  updateUdp: async (id, data) => {
    try {
      const u = await metadataService.updateUdp(id, data);
      set((s) => ({ udps: s.udps.map((x) => (x.id === id ? u : x)) }));
      return u;
    } catch (err) { console.error('updateUdp', err); return null; }
  },
  deleteUdp: async (id) => {
    try {
      await metadataService.deleteUdp(id);
      set((s) => ({ udps: s.udps.filter((x) => x.id !== id) }));
      return true;
    } catch (err) { console.error('deleteUdp', err); return false; }
  },

  semanticTypeById: (id) => (id ? get().semanticTypes.find((s) => s.id === id) : undefined),
}));
