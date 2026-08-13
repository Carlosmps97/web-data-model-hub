/**
 * PermissionMatrix — grilla permiso (fila) × rol (columna).
 * Flujo SEGURO: por defecto es SOLO-LECTURA. Solo en modo edición (`editing`)
 * las celdas son toggles; los cambios van a un BORRADOR en el padre y se
 * persisten todos juntos al Guardar (nada se aplica de inmediato). Las celdas
 * modificadas respecto al original se resaltan.
 */
import type { Permission } from '@/features/auth/auth.service';
import type { Role } from '../admin.service';
import { PERMISSION_LABELS } from '../admin.service';
import { C, MONO } from './helpers';
import { CheckIcon, MinusIcon } from './icons';

interface Props {
  roles: Role[];            // roles mostrados (borrador si editing, en vivo si no)
  permissions: Permission[];
  editing: boolean;
  saving: boolean;
  onToggle: (role: Role, perm: string) => void; // solo se invoca en modo edición
  original?: Role[];        // para resaltar celdas cambiadas
}

function Dot({ on, size = 30, dim }: { on: boolean; size?: number; dim?: boolean }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 999,
        background: on ? C.greenBg : C.grey, color: on ? C.green : C.muted,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        opacity: dim ? 0.5 : 1,
      }}
    >
      {on ? <CheckIcon size={Math.round(size * 0.5)} sw={2.6} /> : <MinusIcon size={Math.round(size * 0.5)} sw={2.6} />}
    </span>
  );
}

export default function PermissionMatrix({ roles, permissions, editing, saving, onToggle, original }: Props) {
  const cols = `minmax(230px, 1.5fr) repeat(${Math.max(roles.length, 1)}, minmax(112px, 1fr))`;
  const origById = new Map((original ?? []).map((r) => [r.id, r]));
  const isChanged = (r: Role, perm: string) =>
    editing && origById.has(r.id) && !!origById.get(r.id)!.permissions[perm] !== !!r.permissions[perm];

  return (
    <div>
      <div style={{ overflowX: 'auto', border: `1px solid ${editing ? C.blue : C.border}`, borderRadius: 13, background: C.white, boxShadow: editing ? `0 0 0 3px ${C.blueSoft}` : 'none', transition: 'border-color .12s, box-shadow .12s' }}>
        <div style={{ minWidth: 'max-content' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: C.text3 }}>Permission</div>
            {roles.map((r) => (
              <div key={r.id} style={{ padding: '12px 10px', textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: C.navy, borderLeft: `1px solid ${C.border}` }}>
                {r.name}
              </div>
            ))}
            {roles.length === 0 && <div style={{ padding: '12px 10px', fontSize: 12.5, color: C.text3, borderLeft: `1px solid ${C.border}` }}>—</div>}
          </div>

          {/* Filas de permiso */}
          {permissions.map((perm, idx) => (
            <div key={perm} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: idx === permissions.length - 1 ? 'none' : `1px solid ${C.border}` }}>
              <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{PERMISSION_LABELS[perm] ?? perm}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.text3 }}>{perm}</span>
              </div>
              {roles.map((r) => {
                const on = !!r.permissions[perm];
                const changed = isChanged(r, perm);
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${C.border}`, padding: '8px 0', background: changed ? C.blueSoft : 'transparent' }}>
                    {editing ? (
                      <button
                        type="button"
                        onClick={() => onToggle(r, perm)}
                        disabled={saving}
                        aria-pressed={on}
                        title={`${r.name} · ${on ? 'allowed' : 'not allowed'}${changed ? ' (changed)' : ''}`}
                        aria-label={`${r.name} — ${PERMISSION_LABELS[perm] ?? perm}: ${on ? 'allowed' : 'not allowed'}`}
                        style={{ border: 'none', background: 'transparent', padding: 0, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1, borderRadius: 999, outline: changed ? `2px solid ${C.blue}` : 'none', outlineOffset: 2 }}
                      >
                        <Dot on={on} />
                      </button>
                    ) : (
                      // Solo-lectura: no es interactivo.
                      <Dot on={on} dim />
                    )}
                  </div>
                );
              })}
              {roles.length === 0 && <div style={{ borderLeft: `1px solid ${C.border}` }} />}
            </div>
          ))}

          {permissions.length === 0 && (
            <div style={{ padding: '18px 16px', fontSize: 13, color: C.text3 }}>No permissions in the catalog.</div>
          )}
        </div>
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.text2 }}>
          <Dot on size={20} /> Allowed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.text2 }}>
          <Dot on={false} size={20} /> Not allowed
        </span>
        <span style={{ fontSize: 12, color: C.text3, marginLeft: 'auto' }}>
          {editing ? 'Changes are saved only when you press "Save changes".' : 'Press "Edit matrix" to modify permissions.'}
        </span>
      </div>
    </div>
  );
}
