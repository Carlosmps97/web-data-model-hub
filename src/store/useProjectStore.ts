// Zustand store for the project-centric data model ("Aurora").
//
// Owns: the projects list, the currently-open project (with its embedded
// `layers` / `domains` / `engines`), its hydrated canvas (`tables` +
// `relationships`), and the editing `scope`. All HTTP calls delegate to
// `@/services/*`; the store only holds in-memory state + optimistic updates.
//
// Persistence is split, mirroring the backend:
//   - `persistProjectMeta()` → PUT /api/projects/{id}        (engines/layers/domains)
//   - `persistCanvas()`      → PUT /api/projects/{id}/canvas (tables/relationships)
//   - node positions are written separately by the canvas via
//     `canvasService.updatePositions` (never by `persistCanvas`).
import { create } from 'zustand';
import type {
  Project, Table, Relationship, View, ModelLevel, Domain, EngineId,
} from '@/types/model';
import { projectsService, canvasService, ApiError } from '@/services';
import { normalizeTags } from '@/lib/tags';
import { fullScope, type Scope } from '@/lib/hierarchy';

function normalizeTable(t: Table): Table {
  return { ...t, views: t.views ?? [], columns: t.columns ?? [], tags: normalizeTags(t.tags) };
}

interface ProjectStore {
  // Projects list
  projects: Project[];

  // Current project + canvas
  currentProject: Project | null;
  tables: Table[];
  relationships: Relationship[];
  scope: Scope;

  loading: boolean;
  saving: boolean;

  // ── Projects ──
  setProjects: (projects: Project[]) => void;
  loadProjects: () => Promise<void>;
  createProject: (data: { name: string; description?: string }) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;

  // ── Current project / canvas ──
  loadProject: (projectId: string) => Promise<void>;
  setScope: (scope: Scope) => void;
  resetScope: () => void;
  persistCanvas: () => Promise<void>;
  persistProjectMeta: () => Promise<void>;

  // ── Tables ──
  addTable: (table: Table) => void;
  updateTable: (id: string, updates: Partial<Table>) => void;
  removeTable: (id: string) => void;
  setTables: (tables: Table[]) => void;

  // ── Relationships ──
  addRelationship: (rel: Relationship) => void;
  removeRelationship: (id: string) => void;
  setRelationships: (relationships: Relationship[]) => void;

  // ── Views (embedded in a table) ──
  saveView: (tableId: string, view: View) => void;
  removeView: (tableId: string, viewId: string) => void;

  // ── Levels (models) ──
  addLayer: (layer: ModelLevel) => void;
  updateLayer: (id: string, updates: Partial<ModelLevel>) => void;
  removeLayer: (id: string) => void;

  // ── Domains ──
  addDomain: (domain: Domain) => void;
  updateDomain: (id: string, updates: Partial<Domain>) => void;
  removeDomain: (id: string) => void;

  // ── Engines ──
  setEngines: (engines: EngineId[]) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  tables: [],
  relationships: [],
  scope: { layers: [], domains: [] },
  loading: false,
  saving: false,

  setProjects: (projects) => set({ projects }),

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await projectsService.listProjects();
      set({ projects });
    } catch (err) {
      console.error('Failed to load projects:', err instanceof ApiError ? err.message : err);
    } finally {
      set({ loading: false });
    }
  },

  createProject: async (data) => {
    try {
      const project = await projectsService.createProject(data);
      set((s) => ({ projects: [project, ...s.projects] }));
      return project;
    } catch (err) {
      console.error('Failed to create project:', err);
      return null;
    }
  },

  deleteProject: async (id) => {
    try {
      await projectsService.deleteProject(id);
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        currentProject: s.currentProject?.id === id ? null : s.currentProject,
      }));
      return true;
    } catch (err) {
      console.error('Failed to delete project:', err);
      return false;
    }
  },

  loadProject: async (projectId) => {
    set({ loading: true });
    try {
      const [project, canvas] = await Promise.all([
        projectsService.getProject(projectId),
        canvasService.getCanvas(projectId),
      ]);
      set({
        currentProject: project,
        tables: (canvas.tables ?? []).map(normalizeTable),
        relationships: canvas.relationships ?? [],
        scope: fullScope(project),
      });
    } catch (err) {
      console.error('Failed to load project:', err);
      set({ currentProject: null, tables: [], relationships: [] });
    } finally {
      set({ loading: false });
    }
  },

  setScope: (scope) => set({ scope }),
  resetScope: () => {
    const p = get().currentProject;
    if (p) set({ scope: fullScope(p) });
  },

  persistCanvas: async () => {
    const { currentProject, tables, relationships } = get();
    if (!currentProject) return;
    set({ saving: true });
    try {
      // Positions are owned by `canvasService.updatePositions`; strip them so a
      // Save in one tab can't clobber a drag persisted by another.
      const tablesNoPos = tables.map((t) => {
        const copy: Table = { ...t };
        delete copy.position;
        return copy;
      });
      await canvasService.saveCanvas(currentProject.id, {
        tables: tablesNoPos,
        relationships,
      });
    } catch (err) {
      console.error('Failed to save canvas:', err);
    } finally {
      set({ saving: false });
    }
  },

  persistProjectMeta: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const updated = await projectsService.updateProject(currentProject.id, {
        engines: currentProject.engines,
        layers: currentProject.layers,
        domains: currentProject.domains,
      });
      set((s) => ({
        currentProject: updated,
        projects: s.projects.map((p) => (p.id === updated.id ? updated : p)),
      }));
    } catch (err) {
      console.error('Failed to save project metadata:', err);
    }
  },

  // ── Tables ──
  addTable: (table) => set((s) => ({ tables: [...s.tables, normalizeTable(table)] })),
  updateTable: (id, updates) =>
    set((s) => ({ tables: s.tables.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),
  removeTable: (id) =>
    set((s) => ({
      tables: s.tables.filter((t) => t.id !== id),
      relationships: s.relationships.filter(
        (r) => r.source.table !== id && r.target.table !== id,
      ),
    })),
  setTables: (tables) => set({ tables: tables.map(normalizeTable) }),

  // ── Relationships ──
  addRelationship: (rel) => set((s) => ({ relationships: [...s.relationships, rel] })),
  removeRelationship: (id) =>
    set((s) => ({ relationships: s.relationships.filter((r) => r.id !== id) })),
  setRelationships: (relationships) => set({ relationships }),

  // ── Views (embedded) ──
  saveView: (tableId, view) =>
    set((s) => ({
      tables: s.tables.map((t) => {
        if (t.id !== tableId) return t;
        const views = t.views ?? [];
        const exists = views.some((v) => v.id === view.id);
        return { ...t, views: exists ? views.map((v) => (v.id === view.id ? view : v)) : [...views, view] };
      }),
    })),
  removeView: (tableId, viewId) =>
    set((s) => ({
      tables: s.tables.map((t) =>
        t.id === tableId ? { ...t, views: (t.views ?? []).filter((v) => v.id !== viewId) } : t,
      ),
    })),

  // ── Levels (models) ──
  addLayer: (layer) =>
    set((s) => (s.currentProject
      ? { currentProject: { ...s.currentProject, layers: [...s.currentProject.layers, layer] } }
      : {})),
  updateLayer: (id, updates) =>
    set((s) => (s.currentProject
      ? { currentProject: { ...s.currentProject, layers: s.currentProject.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)) } }
      : {})),
  removeLayer: (id) =>
    set((s) => (s.currentProject
      ? {
          currentProject: { ...s.currentProject, layers: s.currentProject.layers.filter((l) => l.id !== id) },
          // Detach tables that lived on the removed layer.
          tables: s.tables.map((t) => (t.layer === id ? { ...t, layer: undefined } : t)),
        }
      : {})),

  // ── Domains ──
  addDomain: (domain) =>
    set((s) => (s.currentProject
      ? { currentProject: { ...s.currentProject, domains: [...s.currentProject.domains, domain] } }
      : {})),
  updateDomain: (id, updates) =>
    set((s) => (s.currentProject
      ? { currentProject: { ...s.currentProject, domains: s.currentProject.domains.map((d) => (d.id === id ? { ...d, ...updates } : d)) } }
      : {})),
  removeDomain: (id) =>
    set((s) => (s.currentProject
      ? {
          currentProject: { ...s.currentProject, domains: s.currentProject.domains.filter((d) => d.id !== id) },
          tables: s.tables.map((t) => (t.domain === id ? { ...t, domain: undefined } : t)),
        }
      : {})),

  // ── Engines ──
  setEngines: (engines) =>
    set((s) => (s.currentProject ? { currentProject: { ...s.currentProject, engines } } : {})),
}));
