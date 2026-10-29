/**
 * Mover un canvas o una carpeta dentro del proyecto (Explorer: arrastrar y
 * soltar, «Move to…»). El destino es una carpeta o la raíz del proyecto
 * (`null`, la rama «Models»). Una carpeta nunca va dentro de sí misma; lo que
 * ya está en el destino no se mueve; y no queda junto a otro del mismo tipo con
 * el mismo nombre (`nameKey`): la carga Excel y el Reporting ubican carpetas y
 * canvases por su ruta de nombres. Puro.
 */
import { nameKey } from '@/lib/nameKey';
import type { Folder, SubjectArea } from '../services/modeler.service';

export type MoveItem = { kind: 'folder' | 'canvas'; id: string };
export type MoveVerdict =
  | { ok: true }
  | { ok: false; reason: 'same-place' | 'into-itself' | 'name-taken' | 'missing'; message: string };

/** El tipo de dato de un arrastre del Explorer (otros destinos no lo aceptan). */
export const EXPLORER_DRAG_TYPE = 'application/x-dmh-explorer';

const FOLDER_GONE = 'This folder is no longer in the working copy.';
const CANVAS_GONE = 'This canvas is no longer in the working copy.';

/** La carpeta `rootId` y todas sus descendientes (termina aunque haya un ciclo). */
export function folderSubtree(folders: Folder[], rootId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentFolderId) continue;
    const list = kids.get(f.parentFolderId);
    if (list) list.push(f.id); else kids.set(f.parentFolderId, [f.id]);
  }
  const out = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const k of kids.get(queue.shift()!) ?? []) {
      if (!out.has(k)) { out.add(k); queue.push(k); }
    }
  }
  return out;
}

/** Cómo se nombra el destino en los avisos: su carpeta o «Models». */
export function targetLabel(target: string | null, folders: Folder[]): string {
  return target == null ? 'Models' : folders.find((f) => f.id === target)?.name ?? '';
}

/** ¿Se puede mover `item` a `target`? Con el motivo en inglés (llega a pantalla). */
export function moveVerdict(item: MoveItem, target: string | null, folders: Folder[], canvases: SubjectArea[]): MoveVerdict {
  const self = item.kind === 'folder' ? folders.find((f) => f.id === item.id) : canvases.find((c) => c.id === item.id);
  if (!self) return { ok: false, reason: 'missing', message: item.kind === 'folder' ? FOLDER_GONE : CANVAS_GONE };
  if (target != null && !folders.some((f) => f.id === target)) return { ok: false, reason: 'missing', message: FOLDER_GONE };
  if (item.kind === 'folder' && target != null && folderSubtree(folders, item.id).has(target)) {
    return { ok: false, reason: 'into-itself', message: "A folder can't be moved inside itself" };
  }
  const here = item.kind === 'folder' ? (self as Folder).parentFolderId ?? null : (self as SubjectArea).folderId ?? null;
  if (here === target) return { ok: false, reason: 'same-place', message: 'Already in this folder' };
  const key = nameKey(self.name);
  const siblings: { id: string; name: string }[] = item.kind === 'folder'
    ? folders.filter((f) => (f.parentFolderId ?? null) === target)
    : canvases.filter((c) => (c.folderId ?? null) === target);
  if (siblings.some((s) => s.id !== item.id && nameKey(s.name) === key)) {
    return {
      ok: false, reason: 'name-taken',
      message: `A ${item.kind} named “${self.name.trim()}” already exists in “${targetLabel(target, folders)}”`,
    };
  }
  return { ok: true };
}

/** Orden de nombres del Explorer: sin mayúsculas; el exacto desempata. */
export const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b);
/** Orden de carpetas del Explorer: por nombre; `order` (el de Erwin) desempata. */
export const folderOrder = (a: Folder, b: Folder): number => byName(a.name, b.name) || a.order - b.order;
/** El padre a la vista de cada carpeta, con el orden del Explorer (`shownParents`). */
export const displayParents = (folders: Folder[]): Map<string, string | null> =>
  shownParents(folders, (a, b) => folderOrder(a, b) || byName(a.id, b.id));

/** El padre con que se dibuja cada carpeta: el suyo si existe; la raíz si ya no
 *  existe; en un ciclo (dos versiones que publicaron «A dentro de B» y «B dentro
 *  de A»), el primero según `first` va a la raíz y los demás siguen colgando de
 *  su padre. Así el árbol no tiene ciclos y cada carpeta aparece una vez. */
export function shownParents(folders: Folder[], first: (a: Folder, b: Folder) => number): Map<string, string | null> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parent = new Map<string, string | null>();
  for (const f of folders) {
    const p = f.parentFolderId ?? null;
    parent.set(f.id, p && byId.has(p) ? p : null);
  }
  const seen = new Map<string, 'walking' | 'done'>();
  for (const f of folders) {
    const path: string[] = [];
    let cur: string | null = f.id;
    while (cur && !seen.has(cur)) {
      seen.set(cur, 'walking');
      path.push(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur && seen.get(cur) === 'walking') {
      const cycle = path.slice(path.indexOf(cur)).map((id) => byId.get(id)!);
      parent.set(cycle.reduce((a, b) => (first(a, b) <= 0 ? a : b)).id, null);
    }
    for (const id of path) seen.set(id, 'done');
  }
  return parent;
}

/** Un destino de «Move to…»: la raíz (`id` null) o una carpeta, con su
 *  profundidad en el árbol y si se puede elegir (y si no, por qué). */
export interface MoveTarget { id: string | null; label: string; depth: number; ok: boolean; why?: string }

/** Los destinos de `item` en orden de árbol (el del Explorer: por nombre, `order`
 *  desempata), la raíz primero. Puro. */
export function moveTargets(item: MoveItem, folders: Folder[], canvases: SubjectArea[]): MoveTarget[] {
  const parentOf = displayParents(folders);
  const kids = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = parentOf.get(f.id) ?? null;
    const list = kids.get(key);
    if (list) list.push(f); else kids.set(key, [f]);
  }
  const row = (id: string | null, label: string, depth: number): MoveTarget => {
    const v = moveVerdict(item, id, folders, canvases);
    return v.ok ? { id, label, depth, ok: true } : { id, label, depth, ok: false, why: v.reason === 'same-place' ? 'Already here' : v.message };
  };
  const out: MoveTarget[] = [row(null, 'Models (project root)', 0)];
  const visit = (parent: string | null, depth: number) => {
    for (const f of [...(kids.get(parent) ?? [])].sort(folderOrder)) {
      out.push(row(f.id, f.name, depth));
      visit(f.id, depth + 1);
    }
  };
  visit(null, 1);
  return out;
}
