/**
 * helpers — tokens de diseño + utilidades puras del módulo Admin (pantalla 14).
 * Como el feature usa estilos inline (no .css), compartimos un objeto de tokens
 * `C` y algunos estilos base reutilizables entre AdminScreen y los modales.
 */
import type { CSSProperties } from 'react';
import type { AdminUser, Role } from '../admin.service';

/** Paleta del diseño navy light-only (tokens de referencia de la pantalla 14). */
export const C = {
  navy: '#1A2B4A',
  text: '#3A4658',
  text2: '#56607A',
  text3: '#8A93A5',
  blue: '#2E5BFF',
  blueSoft: '#EAF0FF',
  blueBorder: '#D4E0FF',
  border: '#EAEDF2',
  border2: '#E2E6EE',
  green: '#0E8C6A',
  greenBg: '#E4F6EF',
  amber: '#9A6B00',
  amberBg: '#FFF6E6',
  red: '#C0392B',
  redBg: '#FBEDEC',
  redDeep: '#9A2B2B',
  panel: '#FAFBFC',
  muted: '#AEB6C4',
  grey: '#F0F2F6',
  white: '#FFFFFF',
} as const;

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Slug estable a partir de un nombre libre (clave de rol al crear). */
export function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Set de colores navy/blue/green/purple/orange para avatares (hash del username).
const AVATAR_COLORS = ['#2E5BFF', '#1A2B4A', '#0E8C6A', '#7C5CFF', '#E8833A', '#3AA0C4', '#C0392B'];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsOf(u: Pick<AdminUser, 'name' | 'initials' | 'id'>): string {
  if (u.initials && u.initials.trim()) return u.initials.trim().slice(0, 2).toUpperCase();
  const base = (u.name || u.id || '').trim();
  if (!base) return '?';
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export interface Chip { label: string; color: string; bg: string; }

/** Nivel de acceso derivado de los permisos del ROL (no del usuario). */
export function accessLevelOf(perms: Record<string, boolean> | undefined): Chip {
  const p = perms ?? {};
  if (p['admin.manage']) return { label: 'Control total', color: C.redDeep, bg: C.redBg };
  if (p['model.edit'] || p['standards.edit'] || p['publish']) return { label: 'Edit', color: C.amber, bg: C.amberBg };
  return { label: 'Read-only', color: C.green, bg: C.greenBg };
}

export function statusMeta(status: string): Chip {
  switch (status) {
    case 'active': return { label: 'Activo', color: C.green, bg: C.greenBg };
    case 'invited': return { label: 'Invitado', color: C.text2, bg: C.grey };
    case 'disabled': return { label: 'Inactivo', color: C.red, bg: C.redBg };
    default: return { label: status || '—', color: C.text2, bg: C.grey };
  }
}

export function roleNameOf(roles: Role[], key: string): string {
  return roles.find((r) => r.id === key)?.name ?? key;
}

// ── Estilos base reutilizables (form controls + botones) ──
export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  fontSize: 13.5,
  color: C.text,
  border: `1px solid ${C.border2}`,
  borderRadius: 9,
  outline: 'none',
  background: C.white,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: C.text2,
  marginBottom: 5,
};

const btnBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '9px 15px',
  fontSize: 13.5,
  fontWeight: 600,
  borderRadius: 9,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

export const primaryBtn: CSSProperties = { ...btnBase, color: C.white, background: C.blue, border: `1px solid ${C.blue}` };
export const ghostBtn: CSSProperties = { ...btnBase, color: C.text2, background: C.white, border: `1px solid ${C.border2}` };
export const dangerBtn: CSSProperties = { ...btnBase, color: C.white, background: C.red, border: `1px solid ${C.red}` };

export const iconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  border: `1px solid ${C.border2}`,
  borderRadius: 8,
  background: C.white,
  color: C.text2,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export const chipStyle = (chip: Chip): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: chip.color,
  background: chip.bg,
  borderRadius: 999,
  whiteSpace: 'nowrap',
});
