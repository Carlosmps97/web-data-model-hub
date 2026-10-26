/**
 * UserModal: la whitelist de acceso.
 *
 * Alta ("Add email"): correo + rol — la entrada habilita el login con la
 * cuenta de Databricks de ese correo. El nombre lo resuelve el backend en el
 * primer login (SCIM / derivado del correo).
 *
 * Edición: rol/estado/nombre/proyectos.
 *
 * Proyectos: «All projects» (lista vacía) o solo los marcados. Los
 * administradores ven todos los proyectos aunque tengan algunos marcados.
 *
 * El único administrador activo no puede cambiar su rol ni su estado: primero
 * se le da el rol de administrador a otra persona (el backend aplica la misma
 * regla).
 */
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/types/model';
import ModalShell, { Field } from './Modal';
import { C, ghostBtn, inputStyle, primaryBtn } from './helpers';
import type { AdminUser, Role, UpdateUserInput } from '../admin.service';
import { createUser, updateUser } from '../admin.service';

interface Props {
  mode: 'create' | 'edit';
  initial: AdminUser | null;
  roles: Role[];
  projects: Project[];
  /** El usuario en edición es el único administrador activo. */
  onlyAdmin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const STATUS_OPTS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'disabled', label: 'Disabled' },
];

const ONLY_ADMIN_HINT = 'This is the only administrator: give the administrator role to someone else before changing this role or status.';

const sectionLabel: CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 600, color: C.navy, marginBottom: 6 };
const radioRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text, cursor: 'pointer' };

export default function UserModal({ mode, initial, roles, projects, onlyAdmin, onClose, onSaved }: Props) {
  const isEdit = mode === 'edit';
  const lockRole = isEdit && onlyAdmin;
  const [email, setEmail] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? roles[0]?.id ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [allProjects, setAllProjects] = useState(!(initial?.projectIds?.length));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial?.projectIds ?? []));
  // En la edición, los proyectos se guardan solo si se tocó la sección: cambiar
  // el rol o el nombre no obliga a revisar una lista con proyectos ya borrados.
  const [projectsTouched, setProjectsTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const liveIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const liveSelected = useMemo(() => [...selected].filter((id) => liveIds.has(id)), [selected, liveIds]);
  const roleIsAdmin = Boolean(roles.find((r) => r.id === role)?.permissions['admin.manage']);

  const toggleProject = (id: string) => {
    setProjectsTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const pickScope = (all: boolean) => { setProjectsTouched(true); setAllProjects(all); };

  const submit = async () => {
    if (!isEdit && !email.trim().includes('@')) { toast.error('Enter a valid email address'); return; }
    if (!role) { toast.error('Select a role'); return; }
    const sendProjects = !isEdit || projectsTouched;
    if (sendProjects && !allProjects && liveSelected.length === 0) {
      toast.error('Select at least one project, or choose All projects');
      return;
    }
    const projectIds = allProjects ? [] : liveSelected;

    setBusy(true);
    try {
      if (isEdit && initial) {
        const body: UpdateUserInput = { name: name.trim(), ...(sendProjects ? { projectIds } : {}) };
        if (!lockRole) { body.role = role; body.status = status; }
        await updateUser(initial.id, body);
        toast.success('Access updated');
      } else {
        await createUser({ username: email.trim(), role, status, projectIds });
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
          label="Email"
          hint={isEdit ? undefined : 'The Databricks account email, exactly as it signs in to the workspace.'}
        >
          <input
            style={{ ...inputStyle, ...(isEdit ? { background: C.panel, color: C.text3, cursor: 'not-allowed' } : {}) }}
            type="email"
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
            <select style={{ ...inputStyle, ...(lockRole ? { cursor: 'not-allowed', color: C.text3 } : {}) }}
              value={role} disabled={lockRole} onChange={(e) => setRole(e.target.value)}>
              {roles.length === 0 && <option value="">— no roles —</option>}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select style={{ ...inputStyle, ...(lockRole ? { cursor: 'not-allowed', color: C.text3 } : {}) }}
              value={status} disabled={lockRole} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
        </div>
        {lockRole && <div role="note" style={{ fontSize: 12, color: C.amber, background: C.amberBg, borderRadius: 8, padding: '8px 10px', lineHeight: 1.4 }}>{ONLY_ADMIN_HINT}</div>}
        <div role="group" aria-label="Projects">
          <span style={sectionLabel}>Projects</span>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={radioRow}>
              <input type="radio" name="project-scope" checked={allProjects} onChange={() => pickScope(true)} />
              All projects
            </label>
            <label style={radioRow}>
              <input type="radio" name="project-scope" checked={!allProjects} onChange={() => pickScope(false)} />
              Only these projects
            </label>
          </div>
          {!allProjects && (
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 9, padding: '6px 10px', display: 'grid', gap: 4 }}>
              {projects.length === 0 && <span style={{ fontSize: 12.5, color: C.text3 }}>No projects yet.</span>}
              {projects.map((p) => (
                <label key={p.id} style={{ ...radioRow, gap: 9 }}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleProject(p.id)} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </label>
              ))}
            </div>
          )}
          <span style={{ display: 'block', fontSize: 11.5, color: C.text3, marginTop: 6 }}>
            {roleIsAdmin
              ? 'Administrators see every project, whatever is selected here.'
              : 'The user only sees, edits and reviews the selected projects.'}
          </span>
        </div>
      </div>
    </ModalShell>
  );
}
