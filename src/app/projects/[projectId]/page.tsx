'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import EngineSelect from '@/features/engines/components/EngineSelect';
import EngineBadge from '@/features/engines/components/EngineBadge';
import ConfirmDialog, { shouldSkipConfirm } from '@/components/ui/ConfirmDialog';
import { projectsService, modelsService } from '@/services';
import { useAuthStore } from '@/store/useAuthStore';
import { useModelStore } from '@/store/useModelStore';
import type { Project, DataModel, DatabaseEngine } from '@/types/model';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectModelsPage({ params }: PageProps) {
  const { projectId } = use(params);
  const router = useRouter();

  const { loadModels, createModel, deleteModel } = useModelStore();
  // Authorization — drives visibility of mutation controls. The
  // backend enforces the same rules; this is purely UX.
  const canEditProject = useAuthStore((s) => s.canEditProject(projectId));
  const canEditModelFn = useAuthStore((s) => s.canEditModel);

  const [project, setProject] = useState<Project | null>(null);
  const [models, setModels] = useState<DataModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreateModel, setShowCreateModel] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingModelDelete, setPendingModelDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const proj = await projectsService.getProject(projectId);
        setProject(proj);

        const loadedModels = await loadModels(projectId);
        setModels(loadedModels);
        setLoaded(true);
      } catch {
        router.push('/');
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleCreateModel = async () => {
    if (!newModelName.trim()) return;
    setCreating(true);
    const model = await createModel({ projectId, name: newModelName.trim() });
    setCreating(false);
    if (model) {
      setShowCreateModel(false);
      setNewModelName('');
      router.push(`/projects/${projectId}/models/${model.id}`);
    }
  };

  const handleOpenModel = (modelId: string) => {
    router.push(`/projects/${projectId}/models/${modelId}`);
  };

  const handleOpenGlobal = () => {
    router.push(`/projects/${projectId}/global`);
  };

  const performModelDelete = async (modelId: string) => {
    const ok = await deleteModel(modelId);
    if (ok) setModels((prev) => prev.filter((m) => m.id !== modelId));
  };

  const handleDeleteModel = (modelId: string, modelName: string) => {
    if (shouldSkipConfirm('project:delete-model')) {
      void performModelDelete(modelId);
      return;
    }
    setPendingModelDelete({ id: modelId, name: modelName });
  };

  const handleUpdateEngine = async (modelId: string, engine: DatabaseEngine | null) => {
    // Optimistic update
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, engine: engine ?? undefined } : m)));
    try {
      await modelsService.updateModel(modelId, { engine: engine ?? undefined });
    } catch (err) {
      console.error('Failed to update engine:', err);
    }
  };

  const aggregatedEngines = Array.from(
    new Set(models.map((m) => m.engine).filter((e): e is DatabaseEngine => !!e))
  );

  const filteredModels = models.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  const formatRelative = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!loaded) {
    return (
      <AppLayout>
        <div className="flex-center" style={{ height: '60vh' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="skeleton" style={{ width: '200px', height: '20px', marginBottom: 'var(--space-3)', margin: '0 auto' }} />
            <div className="skeleton" style={{ width: '150px', height: '14px', margin: '0 auto' }} />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Header
        title={project?.name || 'Project'}
        subtitle={project?.description || 'Data models in this project'}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => router.push('/')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              Projects
            </button>
            {models.length > 0 && (
              <button className="btn btn-secondary btn-sm btn-global" onClick={handleOpenGlobal} title="Open global canvas">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                Global Canvas
              </button>
            )}
            {canEditProject && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreateModel(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Model
              </button>
            )}
          </div>
        }
      />

      <div className="app-content">
        {/* Breadcrumb */}
        <nav className="breadcrumbs">
          <Link href="/">Projects</Link>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span>{project?.name}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="breadcrumb-current">Data Models</span>
        </nav>

        {/* Aggregated engines strip */}
        {aggregatedEngines.length > 0 && (
          <div className="project-engines-strip">
            <span className="project-engines-label">Engines in this project:</span>
            {aggregatedEngines.map((e) => (
              <EngineBadge key={e} engine={e} compact />
            ))}
          </div>
        )}

        {/* Search + count */}
        {models.length > 0 && (
          <div className="search-bar" style={{ marginBottom: 'var(--space-5)', maxWidth: '400px' }}>
            <span className="search-bar-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {/* Empty state */}
        {models.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
            </div>
            <h3>No models yet</h3>
            <p>
              {canEditProject
                ? 'Create your first data model in this project to start designing ER diagrams.'
                : 'There are no models to view yet. Ask an administrator for access.'}
            </p>
            {canEditProject && (
              <button className="btn btn-primary btn-lg" onClick={() => setShowCreateModel(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create First Model
              </button>
            )}
          </div>
        )}

        {/* Models table */}
        {filteredModels.length > 0 && (
          <div className="models-table-wrapper">
            <table className="models-table">
              <thead>
                <tr>
                  <th>Model Name</th>
                  <th>Engine</th>
                  <th>Tables</th>
                  <th>Relationships</th>
                  <th>Last edited</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((model) => (
                  <tr key={model.id} onClick={() => handleOpenModel(model.id)}>
                    <td>
                      <div className="models-table-name">
                        <div className="models-table-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                            <line x1="9" y1="21" x2="9" y2="9" />
                          </svg>
                        </div>
                        <div>
                          <div className="models-table-model-name">{model.name}</div>
                          {model.description && (
                            <div className="models-table-model-desc">{model.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <EngineSelect
                        value={model.engine ?? null}
                        onChange={(eng) => handleUpdateEngine(model.id, eng)}
                        size="sm"
                        disabled={!canEditModelFn(model.id, projectId)}
                      />
                    </td>
                    <td>
                      <span className="models-table-pill">{model.tables.length}</span>
                    </td>
                    <td>
                      <span className="models-table-pill">{model.relationships.length}</span>
                    </td>
                    <td className="models-table-date">{formatRelative(model.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ width: 40, textAlign: 'center' }}>
                      {canEditModelFn(model.id, projectId) && (
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Eliminar modelo"
                          onClick={() => handleDeleteModel(model.id, model.name)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* No search matches */}
        {search && models.length > 0 && filteredModels.length === 0 && (
          <div className="empty-state" style={{ paddingTop: 'var(--space-8)' }}>
            <h3>No models match your search</h3>
            <p>Try a different search term.</p>
          </div>
        )}
      </div>

      {/* Create Model Modal */}
      {showCreateModel && (
        <div className="modal-backdrop" onClick={() => setShowCreateModel(false)}>
          <div className="modal-content animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Model</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowCreateModel(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="input-label">Model Name</label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Sales Data Model, User Management Schema"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateModel()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateModel(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreateModel}
                disabled={!newModelName.trim() || creating}
              >
                {creating ? 'Creating…' : 'Create Model'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingModelDelete !== null}
        title="Eliminar modelo"
        message={
          pendingModelDelete ? (
            <>
              ¿Eliminar el modelo <strong>{pendingModelDelete.name}</strong>? Esta acción no se puede deshacer.
            </>
          ) : null
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        dontAskKey="project:delete-model"
        onConfirm={() => {
          if (!pendingModelDelete) return;
          void performModelDelete(pendingModelDelete.id);
          setPendingModelDelete(null);
        }}
        onCancel={() => setPendingModelDelete(null)}
      />
    </AppLayout>
  );
}
