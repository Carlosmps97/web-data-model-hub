'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon from '@/components/ui/Icon';
import ConfirmDialog, { shouldSkipConfirm } from '@/components/ui/ConfirmDialog';
import { EngineBadge } from '@/features/engines';
import { useProjectStore } from '@/store/useProjectStore';
import { useAuthStore } from '@/store/useAuthStore';
import CreateProjectModal from './CreateProjectModal';

function formatDate(s?: string): string {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('es-ES', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

export default function ProjectsScreen() {
  const router = useRouter();
  const { projects, loading, loadProjects, createProject, deleteProject } = useProjectStore();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = async (data: { name: string; description: string }) => {
    const project = await createProject(data);
    if (project) {
      setShowCreate(false);
      router.push(`/projects/${project.id}`);
    }
  };

  const askDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (shouldSkipConfirm('projects:delete')) { void deleteProject(id); return; }
    setPendingDelete({ id, name });
  };

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header
          crumbs={[{ label: 'Projects' }]}
          actions={
            isAdmin && (
              <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => setShowCreate(true)}>
                <Icon name="plus" size={14} sw={2.6} />Nuevo proyecto
              </button>
            )
          }
        />
        <div className="dmh-page">
          <div className="dmh-page-head">
            <div>
              <div className="rd-h1" style={{ marginBottom: 4 }}>Projects</div>
              <div className="rd-small">Gestiona tus proyectos de modelado de datos</div>
            </div>
            <div className="rd-search" style={{ width: 280 }}>
              <Icon name="search" size={15} />
              <input className="rd-input" placeholder="Buscar proyectos…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {loading && projects.length === 0 ? (
            <div className="dmh-grid">
              {[1, 2, 3].map((i) => (
                <div key={i} className="dmh-pcard" style={{ opacity: 0.5, height: 150 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="dmh-empty">
              <div className="ico"><Icon name="grid" size={64} sw={1} /></div>
              <div className="rd-h3" style={{ marginBottom: 6 }}>{search ? 'Sin resultados' : 'Aún no hay proyectos'}</div>
              <div className="rd-small">
                {search ? 'Ajusta los términos de búsqueda.' : isAdmin ? 'Crea tu primer proyecto para empezar.' : 'Pide acceso a un administrador.'}
              </div>
            </div>
          ) : (
            <div className="dmh-grid">
              {filtered.map((p) => (
                <div className="dmh-pcard" key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>
                  {isAdmin && (
                    <div className="dmh-pcard-del">
                      <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Eliminar proyecto" onClick={(e) => askDelete(e, p.id, p.name)}>
                        <Icon name="trash" size={13} style={{ color: 'var(--error)' }} />
                      </button>
                    </div>
                  )}
                  <div className="dmh-pcard-title">{p.name}</div>
                  <div className="dmh-pcard-desc">{p.description || 'Sin descripción'}</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                    {p.engines.map((e) => <EngineBadge key={e} engine={e} compact />)}
                  </div>
                  <div className="dmh-pcard-foot">
                    <span className="rd-badge rd-badge-primary"><Icon name="layers" size={11} />{p.layers.length} modelos</span>
                    {p.updatedAt && <span className="rd-small" style={{ marginLeft: 'auto' }}>Actualizado {formatDate(p.updatedAt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateProjectModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSubmit={handleCreate} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar proyecto"
        message={pendingDelete ? <>¿Eliminar <strong>{pendingDelete.name}</strong> y todo su contenido? No se puede deshacer.</> : null}
        confirmLabel="Eliminar"
        variant="danger"
        dontAskKey="projects:delete"
        onConfirm={() => { if (pendingDelete) void deleteProject(pendingDelete.id); setPendingDelete(null); }}
        onCancel={() => setPendingDelete(null)}
      />
    </AppLayout>
  );
}
