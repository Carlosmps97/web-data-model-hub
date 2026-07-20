import { create } from 'zustand';
import { setDevUser } from '@/services/http';
import * as cs from '@/features/governance/services/changeset.service';
import type { Changeset } from '@/features/governance/services/changeset.service';

interface ChangesetState {
  devUser: string;
  activeId: string | null;
  changesets: Changeset[];
  setDev: (u: string) => void;
  setActive: (id: string | null) => void;
  load: () => Promise<void>;
  create: (title: string) => Promise<void>;
  submit: (id: string) => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string, note?: string) => Promise<void>;
}

export const useChangesetStore = create<ChangesetState>((set, get) => ({
  devUser: 'ana',
  activeId: null,
  changesets: [],
  setDev: (u) => { setDevUser(u); set({ devUser: u }); },
  setActive: (id) => set({ activeId: id }),
  load: async () => { set({ changesets: await cs.listChangesets() }); },
  create: async (title) => { const c = await cs.createChangeset(title); set({ activeId: c.id }); await get().load(); },
  submit: async (id) => { await cs.submitChangeset(id); if (get().activeId === id) set({ activeId: null }); await get().load(); },
  approve: async (id) => { await cs.approveChangeset(id); await get().load(); },
  reject: async (id, note) => { await cs.rejectChangeset(id, note); await get().load(); },
}));
