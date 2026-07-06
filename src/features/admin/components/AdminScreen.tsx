/**
 * AdminScreen — pantalla 14 "Permisos: administrar niveles de acceso por usuario".
 *
 * Layout: sidebar de roles (izq) + main con header, tabla de usuarios y matriz de
 * permisos por rol. Se renderiza DEBAJO del TopNav global (chrome de ShellLayout)
 * y ya viene gated a `admin.manage`. Estilos inline (diseño navy light-only).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/services/http';
import type { Permission } from '@/features/auth/auth.service';
import type { AdminUser, Role } from '../admin.service';
import { listUsers, listRoles, getPermissions, deleteUser, deleteRole, upsertRole } from '../admin.service';
import {
  C, accessLevelOf, avatarColor, chipStyle, initialsOf, primaryBtn, inputStyle,
  iconBtnStyle, roleNameOf, statusMeta,
} from './helpers';
import { CloseIcon, PencilIcon, PlusIcon, SearchIcon, ShieldIcon, TrashIcon } from './icons';
import UserModal from './UserModal';
import RoleModal from './RoleModal';
import ConfirmModal from './ConfirmModal';
import PermissionMatrix from './PermissionMatrix';

interface ConfirmState { title: string; message: string; confirmLabel?: string; onConfirm: () => Promise<void>; }
interface UserModalState { open: boolean; mode: 'create' | 'edit'; initial: AdminUser | null; }
interface RoleModalState { open: boolean; mode: 'create' | 'edit'; initial: Role | null; }

const TABLE_COLS = 'minmax(230px, 2.2fr) 132px 150px minmax(150px, 1.5fr) 118px 96px';

const eyebrowStyle: CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#8A93A5' };
const h1Style: CSSProperties = { margin: '6px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', color: C.navy };
const thStyle: CSSProperties = { padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: C.text3 };
const tdStyle: CSSProperties = { padding: '11px 14px', display: 'flex', alignItems: 'center', minWidth: 0 };

export default function AdminScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  const [userModal, setUserModal] = useState<UserModalState>({ open: false, mode: 'create', initial: null });
  const [roleModal, setRoleModal] = useState<RoleModalState>({ open: false, mode: 'create', initial: null });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ── carga ──
  const fetchAll = useCallback(async () => {
    const [u, r, p] = await Promise.all([listUsers(), listRoles(), getPermissions()]);
    setUsers(u);
    setRoles(r);
    setPermissions(p);
  }, []);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'No se pudieron cargar los datos de administración';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  const softRefresh = useCallback(async () => {
    try {
      await fetchAll();
    } catch {
      toast.error('No se pudo refrescar la información');
    }
  }, [fetchAll]);

  useEffect(() => { void initialLoad(); }, [initialLoad]);

  // ── derivados ──
  const rolesById = useMemo(() => {
    const m: Record<string, Role> = {};
    for (const r of roles) m[r.id] = r;
    return m;
  }, [roles]);

  const roleCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of users) m[u.role] = (m[u.role] ?? 0) + 1;
    return m;
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (selectedRoleId && u.role !== selectedRoleId) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
    });
  }, [users, search, selectedRoleId]);

  // ── mutaciones ──
  const handleToggle = useCallback(async (role: Role, perm: string) => {
    const cellId = `${role.id}:${perm}`;
    const nextPerms = { ...role.permissions, [perm]: !role.permissions[perm] };
    setPendingCell(cellId);
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, permissions: nextPerms } : r))); // optimista
    try {
      await upsertRole(role.id, { name: role.name, description: role.description ?? undefined, permissions: nextPerms });
      const fresh = await listRoles(); // refresca (mantiene niveles de acceso en sync)
      setRoles(fresh);
    } catch (e) {
      setRoles((prev) => prev.map((r) => (r.id === role.id ? role : r))); // revierte
      toast.error(e instanceof Error ? e.message : 'No se pudo actualizar el permiso');
    } finally {
      setPendingCell(null);
    }
  }, []);

  const askDeleteUser = (u: AdminUser) => setConfirm({
    title: 'Eliminar usuario',
    message: `Se eliminará "${u.name}" (${u.id}). Esta acción no se puede deshacer.`,
    onConfirm: async () => { await deleteUser(u.id); toast.success('Usuario eliminado'); await softRefresh(); },
  });

  const askDeleteRole = (r: Role) => setConfirm({
    title: 'Eliminar rol',
    message: `Se eliminará el rol "${r.name}"${roleCounts[r.id] ? ` — ${roleCounts[r.id]} usuario(s) lo tienen asignado` : ''}. Esta acción no se puede deshacer.`,
    onConfirm: async () => {
      await deleteRole(r.id);
      toast.success('Rol eliminado');
      setSelectedRoleId((sel) => (sel === r.id ? null : sel));
      await softRefresh();
    },
  });

  // ── render ──
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', background: C.white, color: C.text }}>
      {/* SIDEBAR — roles */}
      <aside style={{ width: 270, flexShrink: 0, background: C.panel, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '20px 18px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldIcon size={14} color={C.muted} />
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted }}>Roles definidos</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roles.map((r) => {
            const selected = selectedRoleId === r.id;
            const count = roleCounts[r.id] ?? 0;
            return (
              <div
                key={r.id}
                onClick={() => setSelectedRoleId((sel) => (sel === r.id ? null : r.id))}
                style={{
                  padding: '11px 12px',
                  borderRadius: 11,
                  cursor: 'pointer',
                  border: `1px solid ${selected ? C.blueBorder : C.border}`,
                  background: selected ? C.blueSoft : C.white,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13.5, color: selected ? C.blue : C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span
                    title={`${count} usuario(s)`}
                    style={{ padding: '1px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: selected ? C.blue : C.text2, background: selected ? C.white : C.grey, border: selected ? `1px solid ${C.blueBorder}` : '1px solid transparent' }}
                  >
                    {count}
                  </span>
                </div>
                {r.description && <div style={{ fontSize: 12, color: C.text3, marginTop: 4, lineHeight: 1.4 }}>{r.description}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setRoleModal({ open: true, mode: 'edit', initial: r }); }}
                    aria-label={`Editar rol ${r.name}`}
                    style={{ ...iconBtnStyle, width: 28, height: 28 }}
                  >
                    <PencilIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); askDeleteRole(r); }}
                    aria-label={`Eliminar rol ${r.name}`}
                    style={{ ...iconBtnStyle, width: 28, height: 28, color: C.red }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && roles.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.text3, padding: '8px 4px' }}>Sin roles todavía. Creá el primero.</div>
          )}
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
          <button
            type="button"
            onClick={() => setRoleModal({ open: true, mode: 'create', initial: null })}
            style={{ width: '100%', padding: '10px', border: `1px dashed ${C.blueBorder}`, borderRadius: 10, background: C.white, color: C.blue, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: 'inherit' }}
          >
            <PlusIcon size={15} sw={2.4} /> Nuevo rol
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '26px 30px 64px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={eyebrowStyle}>Administración</div>
              <h1 style={h1Style}>Permisos y niveles de acceso</h1>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 11, display: 'inline-flex', color: C.text3, pointerEvents: 'none' }}><SearchIcon size={15} /></span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar usuario"
                  aria-label="Buscar usuario"
                  style={{ ...inputStyle, width: 230, paddingLeft: 33 }}
                />
              </div>
              <button
                type="button"
                onClick={() => setUserModal({ open: true, mode: 'create', initial: null })}
                style={primaryBtn}
              >
                <PlusIcon size={16} sw={2.4} /> Agregar usuario
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: C.text3, fontSize: 14 }}>Cargando administración…</div>
          ) : error ? (
            <div style={{ marginTop: 26, padding: 24, border: `1px solid ${C.redBg}`, background: C.redBg, borderRadius: 13, color: C.redDeep }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No se pudo cargar</div>
              <div style={{ fontSize: 13, marginBottom: 14 }}>{error}</div>
              <button type="button" onClick={() => void initialLoad()} style={primaryBtn}>Reintentar</button>
            </div>
          ) : (
            <>
              {/* Filtro por rol seleccionado */}
              {selectedRoleId && (
                <div style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 8px 6px 13px', borderRadius: 999, background: C.blueSoft, border: `1px solid ${C.blueBorder}`, fontSize: 12.5, color: C.blue }}>
                  Filtrando por <strong>{roleNameOf(roles, selectedRoleId)}</strong>
                  <button type="button" onClick={() => setSelectedRoleId(null)} aria-label="Quitar filtro" style={{ display: 'inline-flex', border: 'none', background: C.white, color: C.blue, borderRadius: 999, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                    <CloseIcon size={13} />
                  </button>
                </div>
              )}

              {/* Tabla de usuarios */}
              <div style={{ marginTop: 20, border: `1px solid ${C.border}`, borderRadius: 13, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: 860 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
                      <div style={thStyle}>Usuario</div>
                      <div style={thStyle}>Rol</div>
                      <div style={thStyle}>Nivel de acceso</div>
                      <div style={thStyle}>Proyectos</div>
                      <div style={thStyle}>Estado</div>
                      <div style={{ ...thStyle, textAlign: 'right' }} />
                    </div>

                    {filteredUsers.map((u, idx) => {
                      const level = accessLevelOf(rolesById[u.role]?.permissions);
                      const status = statusMeta(u.status);
                      const projects = u.projectIds.length ? u.projectIds.join(' · ') : 'Todos';
                      return (
                        <div key={u.id} style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, borderBottom: idx === filteredUsers.length - 1 ? 'none' : `1px solid ${C.border}` }}>
                          <div style={{ ...tdStyle, gap: 11 }}>
                            <span style={{ width: 34, height: 34, borderRadius: 999, background: avatarColor(u.id), color: C.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>
                              {initialsOf(u)}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                              <span style={{ display: 'block', fontSize: 12, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                            </span>
                          </div>
                          <div style={tdStyle}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', fontSize: 12, fontWeight: 600, color: C.navy, background: '#EEF1F6', borderRadius: 999, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {roleNameOf(roles, u.role)}
                            </span>
                          </div>
                          <div style={tdStyle}>
                            <span style={chipStyle(level)}>{level.label}</span>
                          </div>
                          <div style={{ ...tdStyle, fontSize: 12.5, color: u.projectIds.length ? C.text2 : C.text3 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projects}</span>
                          </div>
                          <div style={tdStyle}>
                            <span style={chipStyle(status)}>{status.label}</span>
                          </div>
                          <div style={{ ...tdStyle, justifyContent: 'flex-end', gap: 6 }}>
                            <button type="button" onClick={() => setUserModal({ open: true, mode: 'edit', initial: u })} aria-label={`Editar ${u.name}`} style={{ ...iconBtnStyle, width: 30, height: 30 }}>
                              <PencilIcon size={14} />
                            </button>
                            <button type="button" onClick={() => askDeleteUser(u)} aria-label={`Eliminar ${u.name}`} style={{ ...iconBtnStyle, width: 30, height: 30, color: C.red }}>
                              <TrashIcon size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {filteredUsers.length === 0 && (
                      <div style={{ padding: '34px 16px', textAlign: 'center', fontSize: 13, color: C.text3 }}>
                        {users.length === 0 ? 'No hay usuarios todavía. Agregá el primero.' : 'Ningún usuario coincide con el filtro.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Matriz de permisos */}
              <section style={{ marginTop: 34 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.navy }}>Matriz de permisos por rol</h2>
                <p style={{ margin: '5px 0 16px', fontSize: 13, color: C.text2 }}>
                  Activá o desactivá permisos por rol. Cada usuario hereda el nivel de acceso del rol que tiene asignado.
                </p>
                <PermissionMatrix roles={roles} permissions={permissions} onToggle={handleToggle} pending={pendingCell} />
              </section>
            </>
          )}
        </div>
      </main>

      {/* MODALES */}
      {userModal.open && (
        <UserModal
          mode={userModal.mode}
          initial={userModal.initial}
          roles={roles}
          onClose={() => setUserModal({ open: false, mode: 'create', initial: null })}
          onSaved={softRefresh}
        />
      )}
      {roleModal.open && (
        <RoleModal
          mode={roleModal.mode}
          initial={roleModal.initial}
          onClose={() => setRoleModal({ open: false, mode: 'create', initial: null })}
          onSaved={softRefresh}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
