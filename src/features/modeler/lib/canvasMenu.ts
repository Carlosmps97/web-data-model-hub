import type { FacetNouns } from '@/lib/facets';

/** Acciones del menú de clic derecho del canvas. */
export type CanvasMenuAction = 'copy-columns' | 'copy-table' | 'paste' | 'delete-columns' | 'remove-table' | 'delete-table';

export interface CanvasMenuItem {
  action: CanvasMenuAction;
  label: string;
  enabled: boolean;
  /** Por qué está deshabilitado (tooltip). */
  hint?: string;
  /** El atajo que hace lo mismo (solo de ayuda). */
  shortcut?: string;
  /** Borra: se dibuja en rojo. */
  danger?: boolean;
  /** Línea separadora antes del ítem. */
  separatorBefore?: boolean;
}

/** Lo que hay para pegar: nada, columnas o una tabla (son excluyentes). */
export type CanvasClipboard = { kind: 'none' } | { kind: 'columns'; count: number } | { kind: 'table'; name: string };

/** Ítems del menú de clic derecho en una fila (sobre las columnas seleccionadas)
 *  o en la tabla. Copy es lectura y vale siempre; Paste se ve siempre y, sin
 *  nada copiado o sin edición, queda deshabilitado; quitar y borrar exigen
 *  edición. Textos con los sustantivos de la faceta. Puro. */
export function canvasMenuItems(i: {
  target: 'row' | 'table'; selCount: number; clipboard: CanvasClipboard; canEdit: boolean;
  nouns: FacetNouns; keys: { copy: string; paste: string };
}): CanvasMenuItem[] {
  const { nouns: n, clipboard: clip } = i;
  const editHint = (what: string) => (i.canEdit ? undefined : `Open the model in edit mode to ${what}`);
  const paste: CanvasMenuItem = {
    action: 'paste',
    label: clip.kind === 'columns' ? `Paste ${clip.count} ${clip.count === 1 ? n.member : n.members}`
      : clip.kind === 'table' ? `Paste ${n.one} ${clip.name}…` : 'Paste',
    enabled: clip.kind !== 'none' && i.canEdit,
    hint: clip.kind === 'none' ? 'Nothing copied' : editHint('paste'),
    shortcut: i.keys.paste,
  };
  if (i.target === 'row') {
    const many = i.selCount > 1;
    return [
      { action: 'copy-columns', label: many ? `Copy ${i.selCount} ${n.members}` : `Copy ${n.member}`, enabled: i.selCount > 0, shortcut: i.keys.copy },
      paste,
      { action: 'delete-columns', label: many ? `Delete ${i.selCount} ${n.members}…` : `Delete ${n.member}…`,
        enabled: i.canEdit && i.selCount > 0, hint: editHint('delete'), danger: true, separatorBefore: true },
    ];
  }
  return [
    { action: 'copy-table', label: `Copy ${n.one}`, enabled: true, shortcut: i.keys.copy },
    paste,
    { action: 'remove-table', label: 'Remove from this canvas', enabled: i.canEdit, hint: editHint('change this canvas'), separatorBefore: true },
    { action: 'delete-table', label: `Delete ${n.one}…`, enabled: i.canEdit, hint: editHint('delete'), danger: true },
  ];
}
