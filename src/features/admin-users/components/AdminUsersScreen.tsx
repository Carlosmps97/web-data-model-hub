'use client';

/**
 * /admin/users — user management dashboard (admin-only). Lists users with
 * role/status filters; create/edit via `UserFormModal`; delete with confirm
 * (admins can't delete their own account). Permissions are project-scoped.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon from '@/components/ui/Icon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/store/useAuthStore';
import { adminService, projectsService } from '@/services';
import type { AuthUser, UserRole } from '@/types/auth';
import type { Project } from '@/types/model';
import UserFormModal, { type UserFormSubmit } from './UserFormModal';

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Administrador', editor: 'Editor', viewer: 'Solo lectura' };

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso; }
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AuthUser | null>(null);
  const [filterRole, setFilterRole] = useState<'all' | UserRole>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    if (status === 'ready' && (!currentUser || currentUser.role !== 'admin')) router.replace('/');
  }, [status, currentUser, router]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [loadedUsers, loadedProjects] = await Promise.all([adminService.listUsers(), projectsService.listProjects()]);
      setUsers(loadedUsers);
      setProjects(loadedProjects);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (status === 'ready' && currentUser?.role === 'admin') reload(); }, [status, currentUser, reload]);

  const handleCreate = useCallback(async (payload: UserFormSubmit) => {
    if (!payload.password) throw new Error('La contraseña es obligatoria al crear un usuario.');
    await adminService.createUser({ username: payload.username, password: payload.password, role: payload.role, isActive: payload.isActive, permissions: payload.permissions });
    setShowForm(false); setEditingUser(null); await reload();
  }, [reload]);

  const handleUpdate = useCallback(async (payload: UserFormSubmit) => {
    if (!editingUser) return;
    await adminService.updateUser(editingUser.id, { username: payload.username, password: payload.password, role: payload.role, isActive: payload.isActive, permissions: payload.permissions });
    setShowForm(false); setEditingUser(null); await reload();
  }, [editingUser, reload]);

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    await adminService.deleteUser(pendingDelete.id);
    setPendingDelete(null); await reload();
  }, [pendingDelete, reload]);

  const filteredUsers = useMemo(() => users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (filterStatus === 'active' && !u.isActive) return false;
    if (filterStatus === 'inactive' && u.isActive) return false;
    return true;
  }), [users, filterRole, filterStatus]);

  const isAdminReady = status === 'ready' && currentUser?.role === 'admin';
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header
          crumbs={[{ label: 'Usuarios' }]}
          actions={isAdminReady && (
            <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => { setEditingUser(null); setShowForm(true); }}>
              <Icon name="plus" size={14} sw={2.6} />Nuevo usuario
            </button>
          )}
        />
        <div className="dmh-page">
          <div className="dmh-page-head">
            <div>
              <div className="rd-h1" style={{ marginBottom: 4 }}>Usuarios</div>
              <div className="rd-small">Administra credenciales, roles y permisos de acceso.</div>
            </div>
            {isAdminReady && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="dmh-select">
                  <select className="rd-input" value={filterRole} onChange={(e) => setFilterRole(e.target.value as typeof filterRole)} style={{ padding: '7px 26px 7px 11px', fontSize: 12.5 }}>
                    <option value="all">Todos los roles</option><option value="admin">Administrador</option><option value="editor">Editor</option><option value="viewer">Solo lectura</option>
                  </select>
                  <Icon name="chevD" size={13} className="chev" />
                </div>
                <div className="dmh-select">
                  <select className="rd-input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} style={{ padding: '7px 26px 7px 11px', fontSize: 12.5 }}>
                    <option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Desactivados</option>
                  </select>
                  <Icon name="chevD" size={13} className="chev" />
                </div>
              </div>
            )}
          </div>

          {!isAdminReady ? (
            <div className="rd-small">Cargando sesión…</div>
          ) : loadError ? (
            <div className="rd-small" style={{ color: 'var(--error)' }}>{loadError}</div>
          ) : loading ? (
            <div className="rd-small">Cargando usuarios…</div>
          ) : (
            <div className="mc-gridwrap">
              <table className="mc-grid">
                <thead><tr>
                  <th className="mc-th">Usuario</th><th className="mc-th">Rol</th><th className="mc-th">Estado</th>
                  <th className="mc-th">Permisos</th><th className="mc-th">Creado</th><th className="mc-th">Último acceso</th><th className="mc-th" style={{ width: 120 }}></th>
                </tr></thead>
                <tbody>
                  {filteredUsers.length === 0 && <tr><td colSpan={7}><div className="rd-small" style={{ padding: 14 }}>Sin usuarios que coincidan.</div></td></tr>}
                  {filteredUsers.map((u) => (
                    <tr key={u.id} style={{ cursor: 'default', opacity: u.isActive ? 1 : 0.6 }}>
                      <td><span className="mc-name">{u.username}{u.id === currentUser?.id && <span className="rd-badge rd-badge-neutral" style={{ marginLeft: 4 }}>Tú</span>}</span></td>
                      <td><span className={`rd-badge ${u.role === 'admin' ? 'rd-badge-primary' : 'rd-badge-neutral'}`}>{ROLE_LABELS[u.role]}</span></td>
                      <td><span className={`rd-badge ${u.isActive ? 'rd-badge-success' : 'rd-badge-neutral'}`}>{u.isActive ? 'Activo' : 'Desactivado'}</span></td>
                      <td>
                        {u.role === 'admin' ? <span className="mc-dim">Acceso total</span>
                          : u.permissions.length === 0 ? <span className="mc-dim">Sin permisos</span>
                          : <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{u.permissions.map((p, i) => <span key={i} className={`rd-badge ${p.level === 'edit' ? 'rd-badge-primary' : 'rd-badge-neutral'}`}>{projectNames.get(p.projectId) ?? p.projectId}: {p.level}</span>)}</div>}
                      </td>
                      <td className="mc-dim">{formatDate(u.createdAt)}</td>
                      <td className="mc-dim">{formatDate(u.lastLoginAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => { setEditingUser(u); setShowForm(true); }}>Editar</button>
                          {u.id !== currentUser?.id && <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setPendingDelete(u)}><Icon name="trash" size={13} style={{ color: 'var(--error)' }} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <UserFormModal
          user={editingUser}
          projects={projects}
          onCancel={() => { setShowForm(false); setEditingUser(null); }}
          onSubmit={editingUser ? handleUpdate : handleCreate}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Eliminar usuario"
        message={pendingDelete ? <>Vas a eliminar permanentemente al usuario <strong>{pendingDelete.username}</strong>. No se puede deshacer.</> : ''}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </AppLayout>
  );
}
