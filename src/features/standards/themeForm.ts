// Doc 109 — formulario de un theme de color (Data Standards → Color themes).
// Lógica pura: qué falta, si cambió algo y qué se manda al apply. Las mismas
// reglas que valida el backend (`app/features/themes/models.py`).
import type { Theme } from '@/lib/colors';
import type { ThemeEditInput } from './standards.service';

export interface ThemeForm { name: string; color: string }

export const MAX_THEME_NAME = 80;
/** Color de un theme nuevo: el del theme por defecto de Erwin. */
export const NEW_THEME_COLOR = '#CAD8FF';
const HEX = /^#[0-9A-Fa-f]{6}$/;

export const themeFormOf = (t: Theme | null): ThemeForm =>
  t ? { name: t.name, color: t.color.toUpperCase() } : { name: '', color: NEW_THEME_COLOR };

/** Qué impide guardar (null = nada). `others` = los demás themes del proyecto. Pura. */
export function themeFormError(form: ThemeForm, others: Theme[]): string | null {
  const name = form.name.trim();
  if (!name) return 'Every theme needs a name.';
  if (name.length > MAX_THEME_NAME) return `At most ${MAX_THEME_NAME} characters.`;
  if (others.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) return `There is already a theme named '${name}'.`;
  if (!HEX.test(form.color.trim())) return 'Use a color like #FFC080.';
  return null;
}

/** ¿Guardar cambiaría algo? Un alta siempre cambia. Pura. */
export const themeChanged = (form: ThemeForm, stored: Theme | null): boolean =>
  !stored || form.name.trim() !== stored.name || form.color.trim().toUpperCase() !== stored.color.toUpperCase();

/** Lo que va en `themesUpsert` (sin `id` = alta). Sin `order`: el backend
 *  conserva el de un theme existente y pone un alta al final. Pura. */
export const themeEditInput = (form: ThemeForm, stored: Theme | null): ThemeEditInput => ({
  ...(stored ? { id: stored.id } : {}),
  name: form.name.trim(),
  color: form.color.trim().toUpperCase(),
});
