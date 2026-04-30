'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import CreateProjectModal from '@/features/projects/components/CreateProjectModal';
import EngineBadge from '@/features/engines/components/EngineBadge';
import ConfirmDialog, { shouldSkipConfirm } from '@/components/ui/ConfirmDialog';
import { modelsService } from '@/services';
import { useAuthStore } from '@/store/useAuthStore';
import { useModelStore } from '@/store/useModelStore';
import type { DatabaseEngine } from '@/types/model';

export default function HomePage() {
  const router = useRouter();
  const { projects, loading, loadProjects, createProject, deleteProject } = useModelStore();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [search, setSearch] = useState('');
  const [modelCounts, setModelCounts] = useState<Record<string, number>>({});
  const [projectEngines, setProjectEngines] = useState<Record<string, DatabaseEngine[]>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingProjectDelete, setPendingProjectDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    // Load model counts + engines per project
    async function loadMeta() {
      const counts: Record<string, number> = {};
      const engines: Record<string, DatabaseEngine[]> = {};
      for (const project of projects) {
        try {
          const models = await modelsService.listModels({ projectId: project.id });
          counts[project.id] = models.length;
          const set = new Set<DatabaseEngine>();
          for (const m of models) {
            if (m.engine) set.add(m.engine);
          }
          engines[project.id] = Array.from(set);
        } catch {
          counts[project.id] = 0;
          engines[project.id] = [];
        }
      }
      setModelCounts(counts);
      setProjectEngines(engines);
    }
    if (projects.length > 0) loadMeta();
  }, [projects]);

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (data: { name: string; description: string }) => {
    const project = await createProject(data);
    if (project) {
      setShowCreateModal(false);
      router.push(`/projects/${project.id}`);
    }
  };

  const performProjectDelete = async (id: string) => {
    setDeletingId(id);
    await deleteProject(id);
    setDeletingId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // Skip the modal entirely when the user previously chose
    // "don't ask again" this session.
    if (shouldSkipConfirm('home:delete-project')) {
      void performProjectDelete(id);
      return;
    }
    const project = projects.find((p) => p.id === id);
    setPendingProjectDelete({ id, name: project?.name ?? 'this project' });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <AppLayout>
      <Header
        title="Projects"
        subtitle="Manage your data model projects"
        actions={
          // Only admins can spin up new projects. Editors work inside
          // projects they've been granted access to.
          isAdmin && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Project
            </button>
          )
        }
      />

      <div className="app-content">
        {/* Search Bar */}
        <div className="search-bar" style={{ marginBottom: 'var(--space-6)', maxWidth: '400px' }}>
          <span className="search-bar-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Loading State */}
        {loading && projects.length === 0 && (
          <div className="project-grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="project-card" style={{ opacity: 0.5 }}>
                <div className="skeleton" style={{ width: '60%', height: '20px', marginBottom: 'var(--space-3)' }} />
                <div className="skeleton" style={{ width: '100%', height: '14px', marginBottom: 'var(--space-2)' }} />
                <div className="skeleton" style={{ width: '80%', height: '14px', marginBottom: 'var(--space-4)' }} />
                <div className="skeleton" style={{ width: '40%', height: '12px' }} />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && projects.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <line x1="7" y1="8" x2="11" y2="8" />
                <line x1="7" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <h3>No projects yet</h3>
            <p>
              {isAdmin
                ? 'Create your first project to start designing data models with interactive ER diagrams.'
                : 'You have no projects assigned yet. Ask an administrator to grant you access.'}
            </p>
            {isAdmin && (
              <button className="btn btn-primary btn-lg" onClick={() => setShowCreateModal(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create Your First Project
              </button>
            )}
          </div>
        )}

        {/* Project Grid */}
        {filteredProjects.length > 0 && (
          <div className="project-grid">
            {filteredProjects.map((project, index) => {
              const engines = projectEngines[project.id] ?? [];
              const count = modelCounts[project.id] ?? 0;
              return (
                <div
                  key={project.id}
                  className="project-card"
                  onClick={() => router.push(`/projects/${project.id}`)}
                  style={{ animationDelay: `${index * 50}ms`, animation: `slideUp var(--transition-normal) ease both` }}
                >
                  {isAdmin && (
                    <div className="project-card-actions">
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={(e) => handleDelete(e, project.id)}
                        title="Delete project"
                        style={{ opacity: deletingId === project.id ? 0.5 : 1 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <div className="project-card-title">{project.name}</div>
                  <div className="project-card-description">
                    {project.description || 'No description provided'}
                  </div>

                  {/* Aggregated engines */}
                  {engines.length > 0 && (
                    <div className="project-card-engines">
                      {engines.slice(0, 3).map((e) => (
                        <EngineBadge key={e} engine={e} compact />
                      ))}
                      {engines.length > 3 && (
                        <span className="engine-badge engine-badge-more">+{engines.length - 3}</span>
                      )}
                    </div>
                  )}

                  <div className="project-card-meta">
                    <span className="badge badge-primary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="9" y1="21" x2="9" y2="9" />
                      </svg>
                      {count} model{count !== 1 ? 's' : ''}
                    </span>
                    {count > 0 && (
                      <button
                        className="project-card-global-link"
                        onClick={(e) => { e.stopPropagation(); router.push(`/projects/${project.id}/global`); }}
                        title="Open global canvas"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="2" y1="12" x2="22" y2="12" />
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        Global canvas
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* No Search Results */}
        {!loading && search && filteredProjects.length === 0 && projects.length > 0 && (
          <div className="empty-state">
            <h3>No projects match your search</h3>
            <p>Try adjusting your search terms.</p>
          </div>
        )}
      </div>

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreate}
      />

      <ConfirmDialog
        open={pendingProjectDelete !== null}
        title="Delete project"
        message={
          pendingProjectDelete ? (
            <>
              Are you sure you want to delete <strong>{pendingProjectDelete.name}</strong> and all its models?
              This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="danger"
        dontAskKey="home:delete-project"
        onConfirm={() => {
          if (!pendingProjectDelete) return;
          void performProjectDelete(pendingProjectDelete.id);
          setPendingProjectDelete(null);
        }}
        onCancel={() => setPendingProjectDelete(null)}
      />
    </AppLayout>
  );
}
