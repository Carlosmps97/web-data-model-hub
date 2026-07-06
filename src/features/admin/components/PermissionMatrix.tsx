/**
 * PermissionMatrix — grilla permiso (fila) × rol (columna). Cada celda es un
 * toggle que persiste el cambio vía `onToggle` (upsertRole en el padre).
 * Filas en el ORDEN de getPermissions(); etiquetas de PERMISSION_LABELS.
 */
import type { Permission } from '@/features/auth/auth.service';
import type { Role } from '../admin.service';
import { PERMISSION_LABELS } from '../admin.service';
import { C, MONO } from './helpers';
import { CheckIcon, MinusIcon } from './icons';

interface Props {
  roles: Role[];
  permissions: Permission[];
  onToggle: (role: Role, perm: string) => void;
  pending: string | null; // `${roleId}:${perm}` en guardado
}

function Dot({ on, size = 30 }: { on: boolean; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: on ? C.greenBg : C.grey,
        color: on ? C.green : C.muted,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <CheckIcon size={Math.round(size * 0.5)} sw={2.6} /> : <MinusIcon size={Math.round(size * 0.5)} sw={2.6} />}
    </span>
  );
}

export default function PermissionMatrix({ roles, permissions, onToggle, pending }: Props) {
  const cols = `minmax(230px, 1.5fr) repeat(${Math.max(roles.length, 1)}, minmax(112px, 1fr))`;

  return (
    <div>
      <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 13, background: C.white }}>
        <div style={{ minWidth: 'max-content' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: C.text3 }}>Permiso</div>
            {roles.map((r) => (
              <div key={r.id} style={{ padding: '12px 10px', textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: C.navy, borderLeft: `1px solid ${C.border}` }}>
                {r.name}
              </div>
            ))}
            {roles.length === 0 && <div style={{ padding: '12px 10px', fontSize: 12.5, color: C.text3, borderLeft: `1px solid ${C.border}` }}>—</div>}
          </div>

          {/* Filas de permiso */}
          {permissions.map((perm, idx) => (
            <div
              key={perm}
              style={{
                display: 'grid',
                gridTemplateColumns: cols,
                borderBottom: idx === permissions.length - 1 ? 'none' : `1px solid ${C.border}`,
              }}
            >
              <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{PERMISSION_LABELS[perm] ?? perm}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.text3 }}>{perm}</span>
              </div>
              {roles.map((r) => {
                const on = !!r.permissions[perm];
                const id = `${r.id}:${perm}`;
                const isPending = pending === id;
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${C.border}`, padding: '8px 0' }}>
                    <button
                      type="button"
                      onClick={() => onToggle(r, perm)}
                      disabled={isPending}
                      aria-pressed={on}
                      title={`${r.name} · ${on ? 'permitido' : 'no permitido'}`}
                      aria-label={`${r.name} — ${PERMISSION_LABELS[perm] ?? perm}: ${on ? 'permitido' : 'no permitido'}`}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        cursor: isPending ? 'default' : 'pointer',
                        opacity: isPending ? 0.45 : 1,
                        borderRadius: 999,
                      }}
                    >
                      <Dot on={on} />
                    </button>
                  </div>
                );
              })}
              {roles.length === 0 && <div style={{ borderLeft: `1px solid ${C.border}` }} />}
            </div>
          ))}

          {permissions.length === 0 && (
            <div style={{ padding: '18px 16px', fontSize: 13, color: C.text3 }}>Sin permisos en el catálogo.</div>
          )}
        </div>
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.text2 }}>
          <Dot on size={20} /> Permitido
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.text2 }}>
          <Dot on={false} size={20} /> No permitido
        </span>
        <span style={{ fontSize: 12, color: C.text3, marginLeft: 'auto' }}>
          Los cambios se aplican de inmediato a todos los usuarios del rol.
        </span>
      </div>
    </div>
  );
}
