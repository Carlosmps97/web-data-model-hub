/**
 * RoleModal — alta/edición de rol (nombre + descripción). Los permisos se editan
 * en la matriz de la pantalla, no acá: en alta arranca con permisos vacíos y en
 * edición se preservan. La clave (key) al crear es el slug del nombre.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import ModalShell, { Field } from './Modal';
import { C, ghostBtn, inputStyle, primaryBtn, MONO, slug } from './helpers';
import type { Role } from '../admin.service';
import { upsertRole } from '../admin.service';

interface Props {
  mode: 'create' | 'edit';
  initial: Role | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export default function RoleModal({ mode, initial, onClose, onSaved }: Props) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [busy, setBusy] = useState(false);

  const key = isEdit && initial ? initial.id : slug(name);

  const submit = async () => {
    if (!name.trim()) { toast.error('The role name is required'); return; }
    if (!isEdit && !key) { toast.error("The name doesn't produce a valid key"); return; }

    setBusy(true);
    try {
      await upsertRole(key, {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: initial?.permissions ?? {},
      });
      toast.success(isEdit ? 'Role updated' : 'Role created');
      await onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? 'Edit role' : 'New role'}
      subtitle={isEdit ? initial?.id : 'Permissions are adjusted later in the matrix'}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
            {isEdit ? 'Save changes' : 'Create role'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <Field label="Role name">
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Data analyst" autoFocus />
        </Field>
        {!isEdit && (
          <div style={{ fontSize: 11.5, color: C.text3, marginTop: -4 }}>
            Key: <span style={{ fontFamily: MONO, color: C.text2 }}>{key || '—'}</span>
          </div>
        )}
        <Field label="Description">
          <textarea
            style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description of the role scope"
          />
        </Field>
      </div>
    </ModalShell>
  );
}
