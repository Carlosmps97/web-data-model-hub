/**
 * UserModal — alta/edición de usuario. En edición el username es read-only y la
 * contraseña es opcional (en blanco = no cambiar). Guarda vía createUser/updateUser.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import ModalShell, { Field } from './Modal';
import { C, ghostBtn, inputStyle, primaryBtn } from './helpers';
import type { AdminUser, Role, UpdateUserInput } from '../admin.service';
import { createUser, updateUser } from '../admin.service';

interface Props {
  mode: 'create' | 'edit';
  initial: AdminUser | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const STATUS_OPTS: { value: string; label: string }[] = [
  { value: 'active', label: 'Activo' },
  { value: 'invited', label: 'Invitado' },
  { value: 'disabled', label: 'Inactivo' },
];

export default function UserModal({ mode, initial, roles, onClose, onSaved }: Props) {
  const isEdit = mode === 'edit';
  const [username, setUsername] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [role, setRole] = useState(initial?.role ?? roles[0]?.id ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [projectsText, setProjectsText] = useState((initial?.projectIds ?? []).join(', '));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const parseProjects = () => projectsText.split(',').map((s) => s.trim()).filter(Boolean);

  const submit = async () => {
    if (!isEdit && !username.trim()) { toast.error('El usuario (username) es obligatorio'); return; }
    if (!name.trim()) { toast.error('El nombre es obligatorio'); return; }
    if (!email.trim()) { toast.error('El email es obligatorio'); return; }
    if (!role) { toast.error('Seleccioná un rol'); return; }
    if (!isEdit && !password) { toast.error('La contraseña es obligatoria'); return; }

    setBusy(true);
    try {
      if (isEdit && initial) {
        const body: UpdateUserInput = { name: name.trim(), email: email.trim(), role, status, projectIds: parseProjects() };
        if (password) body.password = password;
        await updateUser(initial.id, body);
        toast.success('Usuario actualizado');
      } else {
        await createUser({
          username: username.trim(),
          name: name.trim(),
          email: email.trim(),
          role,
          password,
          status,
          projectIds: parseProjects(),
        });
        toast.success('Usuario creado');
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el usuario');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? 'Editar usuario' : 'Agregar usuario'}
      subtitle={isEdit ? initial?.id : 'Creá una cuenta y asignale un rol'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }} onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
            {isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <Field label="Usuario (username)">
          <input
            style={{ ...inputStyle, ...(isEdit ? { background: C.panel, color: C.text3, cursor: 'not-allowed' } : {}) }}
            value={username}
            readOnly={isEdit}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="jdoe"
            autoComplete="off"
          />
        </Field>
        <Field label="Nombre completo">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez" />
        </Field>
        <Field label="Email">
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@empresa.com" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Rol">
            <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.length === 0 && <option value="">— sin roles —</option>}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Estado">
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Proyectos" hint="IDs separados por coma. Vacío = acceso a todos los proyectos.">
          <input style={inputStyle} value={projectsText} onChange={(e) => setProjectsText(e.target.value)} placeholder="proj-riesgos, proj-finanzas" />
        </Field>
        <Field label={isEdit ? 'Contraseña' : 'Contraseña'} hint={isEdit ? 'Dejá en blanco para no cambiarla.' : undefined}>
          <input
            style={inputStyle}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? '••••••••' : 'Contraseña inicial'}
            autoComplete="new-password"
          />
        </Field>
      </div>
    </ModalShell>
  );
}
