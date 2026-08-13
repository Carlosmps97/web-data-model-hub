/**
 * UserModal (doc 38) — la whitelist de acceso.
 *
 * Alta ("Add email"): correo + rol, sin contraseña — la entrada habilita el
 * login con la cuenta de Databricks de ese correo. El nombre lo resuelve el
 * backend en el primer login (SCIM / derivado del correo).
 *
 * Edición: rol/estado/nombre. El campo de contraseña SOLO aparece en cuentas
 * locales (`hasPassword`, p.ej. `admin`) para rotar su clave.
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
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'disabled', label: 'Disabled' },
];

export default function UserModal({ mode, initial, roles, onClose, onSaved }: Props) {
  const isEdit = mode === 'edit';
  const isLocalAccount = isEdit && Boolean(initial?.hasPassword);
  const [email, setEmail] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? roles[0]?.id ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isEdit && !email.trim().includes('@')) { toast.error('Enter a valid email address'); return; }
    if (!role) { toast.error('Select a role'); return; }

    setBusy(true);
    try {
      if (isEdit && initial) {
        const body: UpdateUserInput = { name: name.trim(), role, status };
        if (isLocalAccount && password) body.password = password;
        await updateUser(initial.id, body);
        toast.success('Access updated');
      } else {
        await createUser({ username: email.trim(), role, status });
        toast.success('Access granted');
      }
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the access entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? 'Edit access' : 'Add email'}
      subtitle={isEdit
        ? initial?.id
        : 'Grant access by assigning an email to a role'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
            {isEdit ? 'Save changes' : 'Grant access'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <Field
          label={isLocalAccount ? 'Username (local account)' : 'Email'}
          hint={isEdit ? undefined : 'The Databricks account email, exactly as it signs in to the workspace.'}
        >
          <input
            style={{ ...inputStyle, ...(isEdit ? { background: C.panel, color: C.text3, cursor: 'not-allowed' } : {}) }}
            type={isLocalAccount ? 'text' : 'email'}
            value={email}
            readOnly={isEdit}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
            autoComplete="off"
          />
        </Field>
        {isEdit && (
          <Field label="Full name" hint="Filled automatically on first sign-in; you can override it.">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="—" />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Role">
            <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.length === 0 && <option value="">— no roles —</option>}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>
        {isLocalAccount && (
          <Field label="Reset password" hint="Leave blank to keep it unchanged.">
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
        )}
      </div>
    </ModalShell>
  );
}
