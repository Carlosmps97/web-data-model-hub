// Zustand store for data model state management.
//
// All HTTP calls delegate to `@/services/*` helpers; the store itself
// only owns in-memory state and optimistic updates. This keeps the
// store focused and makes services easy to mock in tests.
import { create } from 'zustand';
import type { Project, DataModel, TableModel, Relationship, ViewModel, DomainDefinition } from '@/types/model';
import { projectsService, modelsService, ApiError } from '@/services';

interface ModelStore {
  // Projects
  projects: Project[];
  currentProject: Project | null;

  // Current model
  currentModel: DataModel | null;
  tables: TableModel[];
  relationships: Relationship[];
  views: ViewModel[];
  domainCatalog: DomainDefinition[];

  // Loading states
  loading: boolean;
  saving: boolean;

  // Project actions
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (project: Project | null) => void;
  loadProjects: () => Promise<void>;
  createProject: (data: { name: string; description?: string }) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;

  // Model actions
  setCurrentModel: (model: DataModel | null) => void;
  loadModels: (projectId: string) => Promise<DataModel[]>;
  loadModelsFull: (projectId: string) => Promise<DataModel[]>;
  loadModel: (modelId: string) => Promise<void>;
  createModel: (data: { projectId: string; name: string; description?: string }) => Promise<DataModel | null>;
  saveModel: () => Promise<void>;
  deleteModel: (id: string) => Promise<boolean>;

  // Table actions
  addTable: (table: TableModel) => void;
  updateTable: (id: string, updates: Partial<TableModel>) => void;
  removeTable: (id: string) => void;
  setTables: (tables: TableModel[]) => void;

  // Relationship actions
  addRelationship: (rel: Relationship) => void;
  removeRelationship: (id: string) => void;
  setRelationships: (relationships: Relationship[]) => void;

  // View actions
  addView: (view: ViewModel) => void;
  updateView: (id: string, updates: Partial<ViewModel>) => void;
  removeView: (id: string) => void;
  setViews: (views: ViewModel[]) => void;

  // Domain catalog actions
  setDomainCatalog: (catalog: DomainDefinition[]) => void;
  addDomain: (domain: DomainDefinition) => void;
  updateDomain: (id: string, updates: Partial<DomainDefinition>) => void;
  removeDomain: (id: string) => void;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  projects: [],
  currentProject: null,
  currentModel: null,
  tables: [],
  relationships: [],
  views: [],
  domainCatalog: [],
  loading: false,
  saving: false,

  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await projectsService.listProjects();
      set({ projects });
    } catch (err) {
      if (err instanceof ApiError) console.error('Failed to load projects:', err.message);
      else console.error('Failed to load projects:', err);
    } finally {
      set({ loading: false });
    }
  },

  createProject: async (data) => {
    try {
      const project = await projectsService.createProject(data);
      set((state) => ({ projects: [...state.projects, project] }));
      return project;
    } catch (err) {
      console.error('Failed to create project:', err);
      return null;
    }
  },

  deleteProject: async (id) => {
    try {
      await projectsService.deleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
      }));
      return true;
    } catch (err) {
      console.error('Failed to delete project:', err);
      return false;
    }
  },

  setCurrentModel: (model) => set({
    currentModel: model,
    tables: model?.tables || [],
    relationships: model?.relationships || [],
    views: model?.views || [],
    domainCatalog: model?.domainCatalog || [],
  }),

  loadModels: async (projectId) => {
    try {
      return await modelsService.listModels({ projectId });
    } catch (err) {
      console.error('Failed to load models:', err);
      return [];
    }
  },

  // Variant used by the Global Canvas. Asks the API for models with
  // their real tables and relationships instead of lightweight stubs
  // (which is what listing screens want for speed).
  loadModelsFull: async (projectId) => {
    try {
      return await modelsService.listModels({ projectId, full: true });
    } catch (err) {
      console.error('Failed to load full models:', err);
      return [];
    }
  },

  loadModel: async (modelId) => {
    set({ loading: true });
    try {
      const model = await modelsService.getModel(modelId);
      set({
        currentModel: model,
        tables: model.tables || [],
        relationships: model.relationships || [],
        views: model.views || [],
        domainCatalog: model.domainCatalog || [],
      });
    } catch (err) {
      console.error('Failed to load model:', err);
    } finally {
      set({ loading: false });
    }
  },

  createModel: async (data) => {
    try {
      return await modelsService.createModel(data);
    } catch (err) {
      console.error('Failed to create model:', err);
      return null;
    }
  },

  saveModel: async () => {
    const { currentModel, tables, relationships, views, domainCatalog } = get();
    if (!currentModel) return;
    set({ saving: true });
    try {
      await modelsService.updateModel(currentModel.id, {
        tables,
        relationships,
        views,
        domainCatalog,
      });
    } catch (err) {
      console.error('Failed to save model:', err);
    } finally {
      set({ saving: false });
    }
  },

  deleteModel: async (id) => {
    try {
      await modelsService.deleteModel(id);
      return true;
    } catch {
      return false;
    }
  },

  addTable: (table) => set((state) => ({
    tables: [...state.tables, table],
  })),

  updateTable: (id, updates) => set((state) => ({
    tables: state.tables.map((t) => (t.id === id ? { ...t, ...updates } : t)),
  })),

  removeTable: (id) => set((state) => ({
    tables: state.tables.filter((t) => t.id !== id),
    relationships: state.relationships.filter(
      (r) => r.sourceTable !== id && r.targetTable !== id
    ),
  })),

  setTables: (tables) => set({ tables }),

  addRelationship: (rel) => set((state) => ({
    relationships: [...state.relationships, rel],
  })),

  removeRelationship: (id) => set((state) => ({
    relationships: state.relationships.filter((r) => r.id !== id),
  })),

  setRelationships: (relationships) => set({ relationships }),

  addView: (view) => set((state) => ({ views: [...state.views, view] })),

  updateView: (id, updates) => set((state) => ({
    views: state.views.map((v) => v.id === id ? { ...v, ...updates } : v),
  })),

  removeView: (id) => set((state) => ({
    views: state.views.filter((v) => v.id !== id),
  })),

  setViews: (views) => set({ views }),

  setDomainCatalog: (catalog) => set({ domainCatalog: catalog }),

  addDomain: (domain) => set((state) => ({
    domainCatalog: [...state.domainCatalog, domain],
  })),

  updateDomain: (id, updates) => set((state) => ({
    domainCatalog: state.domainCatalog.map((d) =>
      d.id === id ? { ...d, ...updates } : d
    ),
  })),

  removeDomain: (id) => set((state) => ({
    domainCatalog: state.domainCatalog.filter((d) => d.id !== id),
    // Clear domainId/subdomainId references in tables that used this domain
    tables: state.tables.map((t) =>
      t.domainId === id
        ? { ...t, domainId: undefined, subdomainId: undefined }
        : t
    ),
  })),
}));
