'use client';

/**
 * Create / edit user modal (admin-only). Handles username, role, active flag,
 * password (required on create; empty = unchanged on edit) and the
 * per-project permissions grid (project is the unit of access — one canvas
 * per project, so there is no model-level scope).
 */

import React, { useCallback, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { AuthUser, Permission, UserRole } from '@/types/auth';
import type { Project } from '@/types/model';

export interface UserFormSubmit {
  username: string;
  role: UserRole;
  isActive: boolean;
  permissions: Permission[];
  /** Plaintext. `undefined` in edit mode means "do not change". */
  password?: string;
}

interface UserFormModalProps {
  user: AuthUser | null;
  projects: Project[];
  onCancel: () => void;
  onSubmit: (payload: UserFormSubmit) => Promise<void>;
}

const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Administrador', hint: 'Acceso total a todos los proyectos y a la gestión de usuarios.' },
  { value: 'editor', label: 'Editor', hint: 'Edita los proyectos a los que tenga permiso de "edit".' },
  { value: 'viewer', label: 'Solo lectura', hint: 'Visualiza los proyectos a los que tenga permiso de "view".' },
];

export default function UserFormModal({ user, projects, onCancel, onSubmit }: UserFormModalProps) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'viewer');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState<Permission[]>(user?.permissions ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isEdit && password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (isEdit && password.length > 0 && password.length < 6) { setError('La nueva contraseña debe tener al menos 6 caracteres.'); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        username: username.trim(), role, isActive,
        permissions: role === 'admin' ? [] : permissions,
        password: password.length > 0 ? password : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [isEdit, username, role, isActive, permissions, password, onSubmit]);

  return (
    <Modal
      title={isEdit ? `Editar usuario: ${user?.username}` : 'Nuevo usuario'}
      subtitle={isEdit ? 'Deja la contraseña vacía para mantener la actual.' : 'El usuario podrá ingresar con estas credenciales.'}
      icon="users"
      size="lg"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="rd-btn rd-btn-ghost" onClick={onCancel} disabled={submitting}>Cancelar</button>
          <button type="submit" form="user-form" className="rd-btn rd-btn-primary" disabled={submitting || !username}>{submitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear usuario'}</button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label className="rd-label" htmlFor="uf-username">Usuario</label>
            <input id="uf-username" className="rd-input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" minLength={3} maxLength={32} disabled={submitting} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="rd-label" htmlFor="uf-password">{isEdit ? 'Nueva contraseña' : 'Contraseña'}</label>
            <input id="uf-password" className="rd-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? 'Dejar vacío para no cambiar' : ''} autoComplete="new-password" required={!isEdit} disabled={submitting} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 4, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <label className="rd-label" htmlFor="uf-role">Rol</label>
            <div className="dmh-select">
              <select id="uf-role" className="rd-input" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={submitting}>
                {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Icon name="chevD" size={13} className="chev" />
            </div>
            <div className="rd-small" style={{ marginTop: 6 }}>{ROLE_OPTIONS.find((o) => o.value === role)?.hint}</div>
          </div>
          <div style={{ width: 160 }}>
            <label className="rd-label">Estado</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 4 }}>
              <span className={`rd-toggle${isActive ? ' on' : ''}`} onClick={() => !submitting && setIsActive((v) => !v)} />
              <span className="rd-small" style={{ fontWeight: 600 }}>{isActive ? 'Activo' : 'Desactivado'}</span>
            </label>
          </div>
        </div>

        {role !== 'admin' && <PermissionsEditor projects={projects} value={permissions} onChange={setPermissions} disabled={submitting} />}

        {error && <div className="rd-small" style={{ color: 'var(--error)', marginTop: 12 }}>{error}</div>}
      </form>
    </Modal>
  );
}

type AccessChoice = 'none' | 'view' | 'edit';

function PermissionsEditor({ projects, value, onChange, disabled }: { projects: Project[]; value: Permission[]; onChange: (p: Permission[]) => void; disabled?: boolean }) {
  const projectMap = useMemo(() => { const m = new Map<string, AccessChoice>(); value.forEach((p) => m.set(p.projectId, p.level)); return m; }, [value]);
  const setChoice = (projectId: string, choice: AccessChoice) => {
    const next = value.filter((p) => p.projectId !== projectId);
    if (choice !== 'none') next.push({ projectId, level: choice });
    onChange(next);
  };
  return (
    <div style={{ marginTop: 16 }}>
      <span className="rd-label">Permisos por proyecto</span>
      <p className="rd-small" style={{ marginBottom: 10 }}>Cada proyecto es la unidad de acceso (un canvas por proyecto).</p>
      {projects.length === 0 ? (
        <div className="rd-small">No hay proyectos a los que asignar permisos todavía.</div>
      ) : (
        <div className="mc-gridwrap">
          <table className="mc-grid">
            <tbody>
              {projects.map((p) => {
                const choice = projectMap.get(p.id) ?? 'none';
                return (
                  <tr key={p.id} style={{ cursor: 'default' }}>
                    <td><span className="mc-name" style={{ fontWeight: 700 }}>{p.name}</span></td>
                    <td style={{ width: 150 }}>
                      <div className="dmh-select">
                        <select className="rd-input" value={choice} onChange={(e) => setChoice(p.id, e.target.value as AccessChoice)} disabled={disabled} style={{ padding: '6px 26px 6px 10px', fontSize: 12.5 }}>
                          <option value="none">Sin acceso</option>
                          <option value="view">Ver</option>
                          <option value="edit">Editar</option>
                        </select>
                        <Icon name="chevD" size={12} className="chev" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
