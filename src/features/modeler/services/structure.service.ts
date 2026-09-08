/**
 * structure.service — ESTRUCTURA (projects / folders / subject_areas)
 * changeset-aware. Fix del leak crítico 2026-07-16 (doc 16): crear un proyecto
 * o canvas en una versión draft escribía DIRECTO a las colecciones publicadas
 * y aparecía en producción antes de aprobar.
 *
 * Regla (espeja `rec()` de governance.service):
 *  - ESCRITURAS con sesión de edición (openMode='editing' + changeset activo)
 *    → se REGISTRAN en el changeset (`csvc.recordChange`) y publican recién
 *    en el approve. El payload es SIEMPRE el doc COMPLETO: el overlay de
 *    lectura REEMPLAZA el doc publicado con el payload (no mergea).
 *  - LECTURAS con changeset activo (edición O readonly de un request) → estado
 *    efectivo (`csvc.effective`), para que el dueño Y los revisores vean la
 *    estructura draft.
 *  - Sin changeset (producción/legacy) → endpoints directos de siempre.
 */
import * as mod from './modeler.service';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import type { Drawing, Folder, Project, SubjectArea } from './modeler.service';

/** Changeset para LECTURAS: cualquier modo con changeset activo (el visor
 *  readonly de un request también debe ver su estructura draft). */
const readCs = (): string | null => useSessionStore.getState().activeChangesetId;

/** Changeset para ESCRITURAS: solo sesión de edición (mismo gate que rec()). */
const writeCs = (): string | null =>
  useSessionStore.getState().openMode === 'editing' ? readCs() : null;

const uid = () => crypto.randomUUID();

// ── Lecturas efectivas ─────────────────────────────────────────────────────

export const listProjects = async (): Promise<Project[]> => {
  const cs = readCs();
  if (!cs) return mod.listProjects();
  const rows = await csvc.effective<Project>(cs, 'projects');
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

// El endpoint effective no filtra por projectId: se trae la colección completa
// (chica: decenas de folders / canvases) y se filtra client-side.
export const listFolders = async (projectId: string): Promise<Folder[]> => {
  const cs = readCs();
  if (!cs) return mod.listFolders(projectId);
  const rows = await csvc.effective<Folder>(cs, 'folders');
  return rows
    .filter((f) => f.projectId === projectId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
};

export const listSubjectAreas = async (projectId: string): Promise<SubjectArea[]> => {
  const cs = readCs();
  if (!cs) return mod.listSubjectAreas(projectId);
  const rows = await csvc.effective<SubjectArea>(cs, 'subject_areas');
  return rows
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const getSubjectArea = async (saId: string): Promise<SubjectArea> => {
  const cs = readCs();
  if (!cs) return mod.getSubjectArea(saId);
  const sa = await fetchEffectiveSa(cs, saId);
  if (!sa) throw new Error('Canvas no encontrado en el estado efectivo.');
  return sa;
};

async function fetchEffectiveSa(cs: string, saId: string): Promise<SubjectArea | null> {
  const rows = await csvc.effective<SubjectArea>(cs, 'subject_areas', { ids: [saId] });
  return rows.find((s) => s.id === saId) ?? null;
}

// ── Projects (doc 75 D5: se CREAN directo — projects.service — y se
//    renombran/describen/borran SOLO por draft del propio proyecto) ──────────

const requireWriteCs = (what: string): string => {
  const cs = writeCs();
  if (!cs) throw new Error(`${what} requires a working copy in edit mode.`);
  return cs;
};

export const renameProject = async (id: string, name: string): Promise<Project> => {
  const cs = requireWriteCs('Renaming a project');
  const cur = (await csvc.effective<Project>(cs, 'projects', { ids: [id] }))
    .find((p) => p.id === id);
  const next: Project = { ...(cur ?? { id, name }), id, name };
  await csvc.recordChange(cs, 'projects', id, 'upsert', { ...next });
  return next;
};

/** Graba UN solo cambio: el borrado del proyecto. La cascada (tablas,
 *  columnas, vistas, relaciones, esquemas, carpetas, canvases y estándares)
 *  la hace el servidor al APLICAR la versión aprobada (D5). */
export const deleteProject = async (id: string): Promise<void> => {
  const cs = requireWriteCs('Deleting a project');
  await csvc.recordChange(cs, 'projects', id, 'delete');
};

/** Deshace el borrado pendiente: vuelve a grabar el doc PUBLICADO del proyecto. */
export const reviveProject = async (id: string, published: Project): Promise<void> => {
  const cs = requireWriteCs('Restoring a project');
  await csvc.recordChange(cs, 'projects', id, 'upsert', { ...published });
};

/** ¿La working copy activa borra el proyecto? (el proyecto no está en su
 *  estado efectivo). Sin sesión de edición nunca hay borrado pendiente. */
export const projectDeletionPending = async (id: string): Promise<boolean> => {
  const cs = writeCs();
  if (!cs) return false;
  const rows = await csvc.effective<Project>(cs, 'projects', { ids: [id] });
  return !rows.some((p) => p.id === id);
};

// ── Folders ────────────────────────────────────────────────────────────────

export const createFolder = async (
  projectId: string, parentFolderId: string | null, name: string, order = 0,
): Promise<Folder> => {
  const cs = writeCs();
  if (!cs) return mod.createFolder(projectId, parentFolderId, name, order);
  const f: Folder = { id: uid(), projectId, parentFolderId, name, order };
  await csvc.recordChange(cs, 'folders', f.id, 'upsert', { ...f });
  return f;
};

async function patchFolder(cs: string, id: string, patch: Partial<Folder>): Promise<Folder> {
  const cur = (await csvc.effective<Folder>(cs, 'folders', { ids: [id] }))
    .find((f) => f.id === id);
  if (!cur) throw new Error('Folder no encontrado en el estado efectivo.');
  const next = { ...cur, ...patch, id };
  await csvc.recordChange(cs, 'folders', id, 'upsert', { ...next });
  return next;
}

export const renameFolder = (id: string, name: string): Promise<Folder> => {
  const cs = writeCs();
  return cs ? patchFolder(cs, id, { name }) : mod.renameFolder(id, name);
};

export const moveFolder = (id: string, parentFolderId: string | null): Promise<Folder> => {
  const cs = writeCs();
  return cs ? patchFolder(cs, id, { parentFolderId }) : mod.moveFolder(id, parentFolderId);
};

export const deleteFolder = async (id: string): Promise<{ deleted: boolean }> => {
  const cs = writeCs();
  if (!cs) return mod.deleteFolder(id);
  await csvc.recordChange(cs, 'folders', id, 'delete');
  return { deleted: true };
};

// ── Canvas (subject_areas) ─────────────────────────────────────────────────

export const createSubjectArea = async (
  projectId: string, name: string, folderId: string | null = null,
): Promise<SubjectArea> => {
  const cs = writeCs();
  if (!cs) return mod.createSubjectArea(projectId, name, folderId);
  const sa: SubjectArea = {
    id: uid(), projectId, name, folderId,
    tableIds: [], layout: {}, drawings: [], udpValues: {},
  };
  await csvc.recordChange(cs, 'subject_areas', sa.id, 'upsert', { ...sa });
  return sa;
};

/** Upsert del canvas al changeset con el doc EFECTIVO completo + patch (el
 *  overlay reemplaza: un payload parcial perdería layout/tableIds al leer). */
async function patchSa(cs: string, saId: string, patch: Partial<SubjectArea>): Promise<SubjectArea> {
  const cur = await fetchEffectiveSa(cs, saId);
  if (!cur) throw new Error('Canvas no encontrado en el estado efectivo.');
  const next = { ...cur, ...patch, id: saId };
  await csvc.recordChange(cs, 'subject_areas', saId, 'upsert', { ...next });
  return next;
}

export const updateSubjectArea = (
  id: string, body: { projectId: string; name: string; folderId?: string | null },
): Promise<SubjectArea> => {
  const cs = writeCs();
  return cs ? patchSa(cs, id, body) : mod.updateSubjectArea(id, body);
};

export const deleteSubjectArea = async (id: string): Promise<{ deleted: boolean }> => {
  const cs = writeCs();
  if (!cs) return mod.deleteSubjectArea(id);
  await csvc.recordChange(cs, 'subject_areas', id, 'delete');
  return { deleted: true };
};

export const setSubjectAreaTables = (saId: string, tableIds: string[]): Promise<SubjectArea> => {
  const cs = writeCs();
  return cs ? patchSa(cs, saId, { tableIds }) : mod.setSubjectAreaTables(saId, tableIds);
};

/** Doc 70: membresía de VISTAS del canvas (lista completa; el overlay
 *  reemplaza). Changeset-aware como `setSubjectAreaTables`. */
export const setSubjectAreaViews = (saId: string, viewIds: string[]): Promise<SubjectArea> => {
  const cs = writeCs();
  return cs ? patchSa(cs, saId, { viewIds }) : mod.setSubjectAreaViews(saId, viewIds);
};

/** Doc 70: tablas Y vistas del canvas en UNA escritura (import con vistas,
 *  Undo del import). Con changeset es un solo upsert del doc completo; sin
 *  changeset, un PUT por lista presente. */
export const setSubjectAreaMembers = async (
  saId: string, patch: { tableIds?: string[]; viewIds?: string[] },
): Promise<SubjectArea> => {
  const cs = writeCs();
  if (cs) return patchSa(cs, saId, patch);
  let sa: SubjectArea | null = null;
  if (patch.tableIds) sa = await mod.setSubjectAreaTables(saId, patch.tableIds);
  if (patch.viewIds) sa = await mod.setSubjectAreaViews(saId, patch.viewIds);
  return sa ?? mod.getSubjectArea(saId);
};

/** Saca UNA tabla del canvas: la quita de `tableIds` Y del `layout` (si sólo se
 *  quitara de tableIds, quedaría un nodo fantasma en layout → audit C9b).
 *  Doc 70: `viewIds` (opcional) fija la membresía de vistas resultante — el
 *  store la calcula sin las vistas que quedan huérfanas — y limpia también su
 *  layout. Changeset-aware; requiere versión activa (gateado por canEdit). */
export const removeTableFromCanvas = async (saId: string, tableId: string, viewIds?: string[]): Promise<void> => {
  const cs = writeCs();
  if (!cs) throw new Error('An active version is required to remove a table.');
  const cur = await fetchEffectiveSa(cs, saId);
  if (!cur) return;
  const tableIds = (cur.tableIds ?? []).filter((t) => t !== tableId);
  const layout = { ...(cur.layout ?? {}) };
  delete layout[tableId];
  const next: SubjectArea = { ...cur, tableIds, layout, id: saId };
  if (viewIds) {
    const keep = new Set(viewIds);
    for (const vid of cur.viewIds ?? []) if (!keep.has(vid)) delete layout[vid];
    next.viewIds = viewIds;
  }
  await csvc.recordChange(cs, 'subject_areas', saId, 'upsert', { ...next });
};

/** Doc 70: saca UNA vista del canvas (membresía + layout); la vista sigue
 *  existiendo en el modelo y en los demás canvases. */
export const removeViewFromCanvas = async (saId: string, viewId: string, viewIds: string[]): Promise<void> => {
  const cs = writeCs();
  if (!cs) throw new Error('An active version is required to remove a view.');
  const cur = await fetchEffectiveSa(cs, saId);
  if (!cur) return;
  const layout = { ...(cur.layout ?? {}) };
  delete layout[viewId];
  await csvc.recordChange(cs, 'subject_areas', saId, 'upsert', { ...cur, viewIds, layout, id: saId });
};

export const setSubjectAreaLayout = async (
  saId: string, layout: Record<string, { x: number; y: number }>,
): Promise<SubjectArea> => {
  const cs = writeCs();
  if (!cs) return mod.setSubjectAreaLayout(saId, layout);
  // El PUT directo MERGEA (M3a): replicamos el merge sobre el layout efectivo.
  const cur = await fetchEffectiveSa(cs, saId);
  if (!cur) throw new Error('Canvas no encontrado en el estado efectivo.');
  const next = { ...cur, layout: { ...(cur.layout ?? {}), ...layout }, id: saId };
  await csvc.recordChange(cs, 'subject_areas', saId, 'upsert', { ...next });
  return next;
};

export const setSubjectAreaDrawings = (saId: string, drawings: Drawing[]): Promise<SubjectArea> => {
  const cs = writeCs();
  return cs ? patchSa(cs, saId, { drawings }) : mod.setSubjectAreaDrawings(saId, drawings);
};

/** UDPs del canvas: SIEMPRE versionado (doc 75 D14: sin escritura directa). */
export const setSubjectAreaUdp = (saId: string, udpValues: Record<string, string>): Promise<SubjectArea> =>
  patchSa(requireWriteCs('Editing canvas properties'), saId, { udpValues });
