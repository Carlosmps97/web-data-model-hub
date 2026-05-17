'use client';

/**
 * /admin/users — user management dashboard.
 *
 * - Only rendered for admins (we guard on mount by reading the auth
 *   store; the backend also enforces this via `requireAdmin`).
 * - Lists all users with quick filters for status and role.
 * - "New user" and per-row "Edit" open `UserFormModal`.
 * - Provides a confirm flow for deletion; the admin cannot delete
 *   their own account (enforced both here and server-side).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import UserFormModal, { type UserFormSubmit } from '@/features/admin-users/components/UserFormModal';
import { useAuthStore } from '@/store/useAuthStore';
import { adminService, modelsService, projectsService } from '@/services';
import type { AuthUser, UserRole } from '@/types/auth';
import type { DataModel, Project } from '@/types/model';

const ROLE_BADGE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Solo lectura',
};

export default function AdminUsersPage() {
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [modelsByProject, setModelsByProject] = useState<Record<string, DataModel[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AuthUser | null>(null);

  const [filterRole, setFilterRole] = useState<'all' | UserRole>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  // Route guard: once the session is hydrated, non-admins get bounced
  // back to the dashboard. The backend would also refuse, but a
  // client-side redirect yields a much cleaner UX.
  useEffect(() => {
    if (status === 'ready' && (!currentUser || currentUser.role !== 'admin')) {
      router.replace('/');
    }
  }, [status, currentUser, router]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [loadedUsers, loadedProjects] = await Promise.all([
        adminService.listUsers(),
        projectsService.listProjects(),
      ]);
      setUsers(loadedUsers);
      setProjects(loadedProjects);

      // Load the list of models per project in parallel. Each call
      // returns stubs only, so the payload is small; we use .id/.name
      // for the permissions editor.
      const modelsEntries = await Promise.all(
        loadedProjects.map(async (p) => {
          const list = await modelsService.listModels({ projectId: p.id });
          return [p.id, list] as const;
        }),
      );
      setModelsByProject(Object.fromEntries(modelsEntries));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'ready' && currentUser?.role === 'admin') {
      reload();
    }
  }, [status, currentUser, reload]);

  const handleCreate = useCallback(
    async (payload: UserFormSubmit) => {
      if (!payload.password) {
        throw new Error('La contraseña es obligatoria al crear un usuario.');
      }
      await adminService.createUser({
        username: payload.username,
        password: payload.password,
        role: payload.role,
        isActive: payload.isActive,
        permissions: payload.permissions,
      });
      setShowForm(false);
      setEditingUser(null);
      await reload();
    },
    [reload],
  );

  const handleUpdate = useCallback(
    async (payload: UserFormSubmit) => {
      if (!editingUser) return;
      await adminService.updateUser(editingUser.id, {
        username: payload.username,
        password: payload.password,
        role: payload.role,
        isActive: payload.isActive,
        permissions: payload.permissions,
      });
      setShowForm(false);
      setEditingUser(null);
      await reload();
    },
    [editingUser, reload],
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    await adminService.deleteUser(pendingDelete.id);
    setPendingDelete(null);
    await reload();
  }, [pendingDelete, reload]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (filterRole !== 'all' && u.role !== filterRole) return false;
      if (filterStatus === 'active' && !u.isActive) return false;
      if (filterStatus === 'inactive' && u.isActive) return false;
      return true;
    });
  }, [users, filterRole, filterStatus]);

  const isAdminReady = status === 'ready' && currentUser?.role === 'admin';

  return (
    <AppLayout>
      <Header
        crumbs={[{ label: 'Gestión de usuarios' }]}
        actions={
          isAdminReady && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setEditingUser(null); setShowForm(true); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Nuevo usuario
            </button>
          )
        }
      />

      <div className="admin-users-page">
        <div className="page-intro">
          <h1 className="page-intro-title">Gestión de usuarios</h1>
          <p className="page-intro-description">Administra credenciales, roles y permisos de acceso.</p>
        </div>

        {!isAdminReady ? (
          <div className="admin-users-empty">
            <p>Cargando sesión…</p>
          </div>
        ) : (
          <>
            <div className="admin-users-filters">
              <label className="admin-users-filter">
                <span>Rol</span>
                <select
                  className="input"
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
                >
                  <option value="all">Todos</option>
                  <option value="admin">Administrador</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Solo lectura</option>
                </select>
              </label>
              <label className="admin-users-filter">
                <span>Estado</span>
                <select
                  className="input"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                >
                  <option value="all">Todos</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Desactivados</option>
                </select>
              </label>
              <span className="admin-users-count">
                {filteredUsers.length} de {users.length} usuarios
              </span>
            </div>

            {loadError && <div className="admin-users-error">{loadError}</div>}

            {loading ? (
              <div className="admin-users-empty"><p>Cargando usuarios…</p></div>
            ) : filteredUsers.length === 0 ? (
              <div className="admin-users-empty">
                <p>Sin usuarios que coincidan con los filtros.</p>
              </div>
            ) : (
              <div className="admin-users-table-wrap">
                <table className="admin-users-table">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Permisos</th>
                      <th>Creado</th>
                      <th>Último acceso</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className={!u.isActive ? 'is-inactive' : undefined}>
                        <td>
                          <div className="admin-users-username">{u.username}</div>
                          {u.id === currentUser?.id && (
                            <div className="admin-users-self-tag">Tú</div>
                          )}
                        </td>
                        <td>
                          <span className={`role-badge role-${u.role}`}>
                            {ROLE_BADGE_LABELS[u.role]}
                          </span>
                        </td>
                        <td>
                          <span className={`status-dot status-${u.isActive ? 'active' : 'inactive'}`}>
                            {u.isActive ? 'Activo' : 'Desactivado'}
                          </span>
                        </td>
                        <td>
                          {u.role === 'admin'
                            ? <em className="admin-users-perm-muted">Acceso total</em>
                            : u.permissions.length === 0
                              ? <em className="admin-users-perm-muted">Sin permisos</em>
                              : (
                                <PermissionSummary
                                  permissions={u.permissions}
                                  projects={projects}
                                  modelsByProject={modelsByProject}
                                />
                              )}
                        </td>
                        <td>{formatDate(u.createdAt)}</td>
                        <td>{u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</td>
                        <td className="admin-users-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => { setEditingUser(u); setShowForm(true); }}
                          >
                            Editar
                          </button>
                          {u.id !== currentUser?.id && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-danger"
                              onClick={() => setPendingDelete(u)}
                            >
                              Eliminar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {showForm && (
        <UserFormModal
          user={editingUser}
          projects={projects}
          modelsByProject={modelsByProject}
          onCancel={() => { setShowForm(false); setEditingUser(null); }}
          onSubmit={editingUser ? handleUpdate : handleCreate}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Eliminar usuario"
        message={
          pendingDelete
            ? `Vas a eliminar permanentemente al usuario "${pendingDelete.username}". Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </AppLayout>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function PermissionSummary({
  permissions,
  projects,
  modelsByProject,
}: {
  permissions: AuthUser['permissions'];
  projects: Project[];
  modelsByProject: Record<string, DataModel[]>;
}) {
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const modelNames = new Map<string, string>();
  for (const list of Object.values(modelsByProject)) {
    for (const m of list) modelNames.set(m.id, m.name);
  }

  const byProject = new Map<string, { level: 'view' | 'edit' | null; models: { id: string; level: 'view' | 'edit' }[] }>();
  for (const p of permissions) {
    const entry = byProject.get(p.projectId) ?? { level: null, models: [] };
    if (p.scope === 'project') {
      entry.level = p.level;
    } else {
      entry.models.push({ id: p.modelId, level: p.level });
    }
    byProject.set(p.projectId, entry);
  }

  return (
    <div className="admin-users-perm-list">
      {Array.from(byProject.entries()).map(([projectId, info]) => (
        <div key={projectId} className="admin-users-perm-row">
          <strong>{projectNames.get(projectId) ?? projectId}</strong>
          {info.level && (
            <span className={`perm-chip perm-${info.level}`}>Proyecto: {info.level}</span>
          )}
          {info.models.map((m) => (
            <span key={m.id} className={`perm-chip perm-${m.level}`}>
              {modelNames.get(m.id) ?? m.id}: {m.level}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
