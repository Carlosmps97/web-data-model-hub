import type { FacetNouns } from '@/lib/facets';

/** Acciones del menú de clic derecho del canvas. */
export type CanvasMenuAction = 'copy-columns' | 'copy-table' | 'paste' | 'delete-columns' | 'remove-table' | 'delete-table'
  | 'copy-tables' | 'remove-tables' | 'delete-tables';

/** Tope de tablas por acción de grupo (copiar, pegar, borrar; quitar del canvas
 *  no tiene: es una sola escritura). */
export const GROUP_MAX = 100;

/** Un grupo copiado en otro proyecto no se pega aquí (doc 118 §11). */
export const GROUP_PASTE_FOREIGN = 'A group of tables can only be pasted in its own project. Across projects, paste one table at a time.';

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

/** Lo que hay para pegar: nada, columnas, una tabla o un grupo de tablas (son
 *  excluyentes); `foreign`: el grupo se copió en otro proyecto. */
export type CanvasClipboard = { kind: 'none' } | { kind: 'columns'; count: number } | { kind: 'table'; name: string }
  | { kind: 'tables'; count: number; foreign: boolean };

/** Ítems del menú de clic derecho en una fila (sobre las columnas seleccionadas),
 *  en la tabla o en un grupo de tablas (`groupCount`). Copy es lectura y vale
 *  siempre; Paste se ve siempre y, sin nada copiado o sin edición, queda
 *  deshabilitado; quitar y borrar exigen edición. Textos con los sustantivos de
 *  la faceta. Puro. */
export function canvasMenuItems(i: {
  target: 'row' | 'table' | 'group'; selCount: number; groupCount?: number; clipboard: CanvasClipboard; canEdit: boolean;
  nouns: FacetNouns; keys: { copy: string; paste: string };
}): CanvasMenuItem[] {
  const { nouns: n, clipboard: clip } = i;
  const editHint = (what: string) => (i.canEdit ? undefined : `Open the model in edit mode to ${what}`);
  const foreign = clip.kind === 'tables' && clip.foreign;
  const paste: CanvasMenuItem = {
    action: 'paste',
    label: clip.kind === 'columns' ? `Paste ${clip.count} ${clip.count === 1 ? n.member : n.members}`
      : clip.kind === 'table' ? `Paste ${n.one} ${clip.name}…`
        : clip.kind === 'tables' ? `Paste ${clip.count} ${n.many}…` : 'Paste',
    enabled: clip.kind !== 'none' && i.canEdit && !foreign,
    hint: clip.kind === 'none' ? 'Nothing copied' : foreign ? GROUP_PASTE_FOREIGN : editHint('paste'),
    shortcut: i.keys.paste,
  };
  if (i.target === 'group') {
    const count = i.groupCount ?? 0;
    const what = `${count} ${n.many}`;
    const tooMany = count > GROUP_MAX ? `Select up to ${GROUP_MAX} ${n.many} at a time` : undefined;
    return [
      { action: 'copy-tables', label: `Copy ${what}`, enabled: !tooMany, hint: tooMany, shortcut: i.keys.copy },
      paste,
      { action: 'remove-tables', label: `Remove ${what} from this canvas`, enabled: i.canEdit, hint: editHint('change this canvas'), separatorBefore: true },
      { action: 'delete-tables', label: `Delete ${what}…`, enabled: i.canEdit && !tooMany, hint: editHint('delete') ?? tooMany, danger: true },
    ];
  }
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
