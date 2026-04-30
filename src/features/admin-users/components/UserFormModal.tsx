'use client';

/**
 * Create / edit user modal. Drives admin-only user management from
 * the `/admin/users` page. Handles:
 *
 *   - username, role, active flag
 *   - password (required on create; optional on edit where empty = no change)
 *   - permissions grid (project-scope + model-scope, level = view/edit)
 *
 * The list of grantable projects and per-project models is provided
 * by the parent — we don't fetch here to keep this component pure.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type {
  AuthUser,
  Permission,
  UserRole,
} from '@/types/auth';
import type { Project, DataModel } from '@/types/model';

export interface UserFormSubmit {
  username: string;
  role: UserRole;
  isActive: boolean;
  permissions: Permission[];
  /** Plaintext. `undefined` in edit mode means "do not change". */
  password?: string;
}

interface UserFormModalProps {
  /** Existing user when editing; `null` for create. */
  user: AuthUser | null;
  projects: Project[];
  /** Key = projectId, value = models for that project. Can be partial. */
  modelsByProject: Record<string, DataModel[]>;
  onCancel: () => void;
  onSubmit: (payload: UserFormSubmit) => Promise<void>;
}

const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Administrador', hint: 'Acceso total a todos los proyectos, modelos y gestión de usuarios.' },
  { value: 'editor', label: 'Editor', hint: 'Edita proyectos y modelos a los que tenga permiso de "edit".' },
  { value: 'viewer', label: 'Solo lectura', hint: 'Visualiza los recursos a los que tenga permiso de "view".' },
];

export default function UserFormModal({
  user,
  projects,
  modelsByProject,
  onCancel,
  onSubmit,
}: UserFormModalProps) {
  const isEdit = !!user;

  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'viewer');
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState<Permission[]>(
    user?.permissions ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!isEdit && password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres.');
        return;
      }
      if (isEdit && password.length > 0 && password.length < 6) {
        setError('La nueva contraseña debe tener al menos 6 caracteres.');
        return;
      }
      setSubmitting(true);
      try {
        await onSubmit({
          username: username.trim(),
          role,
          isActive,
          // Admin grants are wiped by the backend anyway; for clarity
          // we also send an empty array here.
          permissions: role === 'admin' ? [] : permissions,
          password: password.length > 0 ? password : undefined,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [isEdit, username, role, isActive, permissions, password, onSubmit],
  );

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-content modal-large animate-scaleIn user-form-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>{isEdit ? `Editar usuario: ${user?.username}` : 'Nuevo usuario'}</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {isEdit
                ? 'Dejá la contraseña vacía para mantener la actual.'
                : 'El usuario podrá ingresar con estas credenciales.'}
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onCancel} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="modal-body user-form-body" onSubmit={handleSubmit}>
          <div className="user-form-row">
            <div className="user-form-field">
              <label className="user-form-label" htmlFor="uf-username">Usuario</label>
              <input
                id="uf-username"
                className="input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="off"
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9._\-]+"
                title="3-32 caracteres: letras, dígitos, . _ -"
                disabled={submitting}
              />
            </div>

            <div className="user-form-field">
              <label className="user-form-label" htmlFor="uf-password">
                {isEdit ? 'Nueva contraseña' : 'Contraseña'}
              </label>
              <input
                id="uf-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? 'Dejar vacío para no cambiar' : ''}
                autoComplete="new-password"
                required={!isEdit}
                minLength={isEdit ? 0 : 6}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="user-form-row">
            <div className="user-form-field">
              <label className="user-form-label" htmlFor="uf-role">Rol</label>
              <select
                id="uf-role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                disabled={submitting}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="user-form-hint">
                {ROLE_OPTIONS.find((o) => o.value === role)?.hint}
              </div>
            </div>

            <div className="user-form-field user-form-field--inline">
              <label className="user-form-label" htmlFor="uf-active">Estado</label>
              <label className="user-form-toggle">
                <input
                  id="uf-active"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={submitting}
                />
                <span>{isActive ? 'Activo' : 'Desactivado'}</span>
              </label>
            </div>
          </div>

          {role !== 'admin' && (
            <PermissionsEditor
              projects={projects}
              modelsByProject={modelsByProject}
              value={permissions}
              onChange={setPermissions}
              disabled={submitting}
            />
          )}

          {error && <div className="user-form-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !username}>
              {submitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Permissions editor ───────────────────────────────────────────

interface PermissionsEditorProps {
  projects: Project[];
  modelsByProject: Record<string, DataModel[]>;
  value: Permission[];
  onChange: (perms: Permission[]) => void;
  disabled?: boolean;
}

type AccessChoice = 'none' | 'view' | 'edit';

/** Reduces the permissions array to a per-resource lookup. */
function indexPermissions(perms: Permission[]) {
  const projectMap = new Map<string, AccessChoice>();
  const modelMap = new Map<string, AccessChoice>();
  for (const p of perms) {
    if (p.scope === 'project') {
      projectMap.set(p.projectId, p.level);
    } else {
      modelMap.set(`${p.projectId}::${p.modelId}`, p.level);
    }
  }
  return { projectMap, modelMap };
}

function PermissionsEditor({
  projects,
  modelsByProject,
  value,
  onChange,
  disabled,
}: PermissionsEditorProps) {
  const { projectMap, modelMap } = useMemo(() => indexPermissions(value), [value]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const setProjectChoice = useCallback(
    (projectId: string, choice: AccessChoice) => {
      const next = value.filter((p) => !(p.scope === 'project' && p.projectId === projectId));
      if (choice !== 'none') {
        next.push({ scope: 'project', projectId, level: choice });
      }
      onChange(next);
    },
    [value, onChange],
  );

  const setModelChoice = useCallback(
    (projectId: string, modelId: string, choice: AccessChoice) => {
      const next = value.filter(
        (p) => !(p.scope === 'model' && p.projectId === projectId && p.modelId === modelId),
      );
      if (choice !== 'none') {
        next.push({ scope: 'model', projectId, modelId, level: choice });
      }
      onChange(next);
    },
    [value, onChange],
  );

  if (projects.length === 0) {
    return (
      <div className="user-form-section">
        <div className="user-form-label">Permisos</div>
        <div className="user-form-hint">No hay proyectos a los que asignar permisos todavía.</div>
      </div>
    );
  }

  return (
    <div className="user-form-section">
      <div className="user-form-label">Permisos por proyecto / modelo</div>
      <p className="user-form-hint">
        Un permiso a nivel de <strong>proyecto</strong> aplica a todos sus modelos.
        Podés además sobreescribir el nivel para un modelo específico.
      </p>
      <div className="perm-list">
        {projects.map((proj) => {
          const projChoice = projectMap.get(proj.id) ?? 'none';
          const projModels = modelsByProject[proj.id] ?? [];
          const isExpanded = expanded[proj.id] ?? false;
          const modelCountWithPerm = projModels.filter((m) =>
            modelMap.has(`${proj.id}::${m.id}`),
          ).length;
          return (
            <div key={proj.id} className="perm-row">
              <div className="perm-row-head">
                <button
                  type="button"
                  className="perm-row-expand"
                  onClick={() => setExpanded((s) => ({ ...s, [proj.id]: !isExpanded }))}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  disabled={disabled || projModels.length === 0}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <div className="perm-row-name">
                  <strong>{proj.name}</strong>
                  {modelCountWithPerm > 0 && (
                    <span className="perm-row-count">
                      {modelCountWithPerm} modelo{modelCountWithPerm !== 1 ? 's' : ''} con permiso específico
                    </span>
                  )}
                </div>
                <AccessSelect
                  value={projChoice}
                  onChange={(c) => setProjectChoice(proj.id, c)}
                  disabled={disabled}
                />
              </div>
              {isExpanded && projModels.length > 0 && (
                <div className="perm-row-models">
                  {projModels.map((model) => {
                    const key = `${proj.id}::${model.id}`;
                    const modelChoice: AccessChoice = modelMap.get(key) ?? 'none';
                    return (
                      <div key={model.id} className="perm-model-row">
                        <span className="perm-model-name">↳ {model.name}</span>
                        <AccessSelect
                          value={modelChoice}
                          onChange={(c) => setModelChoice(proj.id, model.id, c)}
                          disabled={disabled}
                          hint={projChoice !== 'none' ? `Por defecto: ${projChoice}` : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccessSelect({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: AccessChoice;
  onChange: (v: AccessChoice) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="perm-access">
      <select
        className="input perm-access-select"
        value={value}
        onChange={(e) => onChange(e.target.value as AccessChoice)}
        disabled={disabled}
      >
        <option value="none">Sin acceso</option>
        <option value="view">Ver</option>
        <option value="edit">Editar</option>
      </select>
      {hint && <span className="perm-access-hint">{hint}</span>}
    </div>
  );
}
