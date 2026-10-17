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
 *  - Sin changeset (producción/legacy) → LECTURAS por los endpoints directos
 *    de siempre. Las ESCRITURAS del canvas (posiciones, dibujos, trazos, UDPs)
 *    exigen la working copy: no hay escritura directa a producción (doc 104).
 *
 * Doc 99 — escrituras del canvas EN FILA: cada guardado del canvas es «leer el
 * doc efectivo + grabar el doc completo». Dos guardados casi simultáneos del
 * mismo canvas (mover una tabla y trazar un wire) leían el mismo doc viejo y
 * el segundo PUT borraba el cambio del primero. `inOrder` los encola por
 * canvas: el segundo lee recién cuando el primero terminó de grabar.
 */
import * as mod from './modeler.service';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { noteCanvasWrite, wholeLayout } from '../lib/canvasWrites';
import { MAX_ROUTE_POINTS, cleanRoute, cleanRoutes, pruneRoutes, routeOf, validWireId } from '../lib/wireRoute';
import { cleanColors, normalColor } from '@/lib/colors';
import { applyPending } from '../lib/udpDraft';
import type { RoutePoint, WireRoutes } from '../lib/wireRoute';
import type { Drawing, Folder, Project, SubjectArea } from './modeler.service';

/** Changeset para LECTURAS: cualquier modo con changeset activo (el visor
 *  readonly de un request también debe ver su estructura draft). */
const readCs = (): string | null => useSessionStore.getState().activeChangesetId;

/** Changeset para ESCRITURAS: solo sesión de edición (mismo gate que rec()). */
const writeCs = (): string | null =>
  useSessionStore.getState().openMode === 'editing' ? readCs() : null;

const uid = () => crypto.randomUUID();

/** Cola de escrituras POR canvas (doc 99). Un guardado que falla avisa a quien
 *  lo pidió y no frena al siguiente; canvases distintos no se esperan. Toda
 *  request lleva timeout (`apiFetch`), así que la cola no puede quedar colgada. */
const saQueue = new Map<string, Promise<unknown>>();
function inOrder<T>(saId: string, job: () => Promise<T>): Promise<T> {
  const run = (saQueue.get(saId) ?? Promise.resolve()).then(job);
  const tail = run.catch(() => undefined);
  saQueue.set(saId, tail);
  void tail.then(() => { if (saQueue.get(saId) === tail) saQueue.delete(saId); });
  return run;
}

/** Graba el documento COMPLETO del canvas en la working copy y anota qué quedó
 *  grabado: un diagrama pedido antes de esta escritura puede llegar con la
 *  posición o el trazo viejos (`lib/canvasWrites`). Doc 100 (P6): con las
 *  posiciones en píxeles enteros — también las que el canvas ya traía.
 *  Devuelve lo grabado. */
async function saveCanvas(cs: string, saId: string, doc: SubjectArea): Promise<SubjectArea> {
  const out = doc.layout ? { ...doc, layout: wholeLayout(doc.layout) } : doc;
  await csvc.recordChange(cs, 'subject_areas', saId, 'upsert', { ...out });
  noteCanvasWrite(cs, saId, out);
  return out;
}

type Layout = SubjectArea['layout'];

/** Avisos de algo que dejó de existir en la working copy. En inglés: llegan a
 *  pantalla. */
const CANVAS_GONE = 'This canvas is no longer in the working copy.';
const FOLDER_GONE = 'This folder is no longer in the working copy.';

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
  if (!sa) throw new Error(CANVAS_GONE);
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
// Doc 104 (ronda 2): carpetas y canvases van SIEMPRE por la working copy. El
// PUT/POST/DELETE directo de antes sólo lo alcanzaba un confirm o un input
// del Explorer que quedó abierto cuando la sesión se degradó (versión
// transferida, eliminada o enviada) — y borraba o editaba producción sin
// revisión.

export const createFolder = async (
  projectId: string, parentFolderId: string | null, name: string, order = 0,
): Promise<Folder> => {
  const cs = requireWriteCs('Creating a folder');
  const f: Folder = { id: uid(), projectId, parentFolderId, name, order };
  await csvc.recordChange(cs, 'folders', f.id, 'upsert', { ...f });
  return f;
};

async function patchFolder(cs: string, id: string, patch: Partial<Folder>): Promise<Folder> {
  const cur = (await csvc.effective<Folder>(cs, 'folders', { ids: [id] }))
    .find((f) => f.id === id);
  if (!cur) throw new Error(FOLDER_GONE);
  const next = { ...cur, ...patch, id };
  await csvc.recordChange(cs, 'folders', id, 'upsert', { ...next });
  return next;
}

export const renameFolder = async (id: string, name: string): Promise<Folder> =>
  patchFolder(requireWriteCs('Renaming a folder'), id, { name });

export const moveFolder = async (id: string, parentFolderId: string | null): Promise<Folder> =>
  patchFolder(requireWriteCs('Moving a folder'), id, { parentFolderId });

export const deleteFolder = async (id: string): Promise<{ deleted: boolean }> => {
  const cs = requireWriteCs('Deleting a folder');
  await csvc.recordChange(cs, 'folders', id, 'delete');
  return { deleted: true };
};

// ── Canvas (subject_areas) ─────────────────────────────────────────────────

export const createSubjectArea = async (
  projectId: string, name: string, folderId: string | null = null,
): Promise<SubjectArea> => {
  const cs = requireWriteCs('Creating a canvas');
  const sa: SubjectArea = {
    id: uid(), projectId, name, folderId,
    tableIds: [], layout: {}, drawings: [], udpValues: {}, routes: {},
  };
  await csvc.recordChange(cs, 'subject_areas', sa.id, 'upsert', { ...sa });
  return sa;
};

/** Upsert del canvas al changeset con el doc EFECTIVO completo + patch (el
 *  overlay reemplaza: un payload parcial perdería layout/tableIds al leer). */
function patchSa(cs: string, saId: string, patch: Partial<SubjectArea>): Promise<SubjectArea> {
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, ...patch, id: saId });
  });
}

export const updateSubjectArea = async (
  id: string, body: { projectId: string; name: string; folderId?: string | null },
): Promise<SubjectArea> => patchSa(requireWriteCs('Editing a canvas'), id, body);

export const deleteSubjectArea = async (id: string): Promise<{ deleted: boolean }> => {
  const cs = requireWriteCs('Deleting a canvas');
  // En fila: un guardado pendiente del canvas que aterrizara DESPUÉS del
  // borrado lo resucitaría (el cambio del draft volvería a ser un upsert).
  await inOrder(id, async () => {
    await csvc.recordChange(cs, 'subject_areas', id, 'delete');
    noteCanvasWrite(cs, id, null);
  });
  return { deleted: true };
};

// ── Miembros del canvas (doc 100, P5) ────────────────────────────────────
// La lista COMPLETA de tablas y vistas se arma DENTRO de la cola, sobre el
// canvas efectivo de ese momento. Armada afuera (con el diagrama en memoria o
// una lectura previa), se perdía cualquier otra escritura de miembros que
// cayera en medio: el Undo de sacar o borrar una tabla, o dos altas seguidas.

export interface CanvasMembers { tableIds?: string[]; viewIds?: string[] }

/** Vistas sobre las que se suma o se quita (doc 70): la lista EXPLÍCITA del
 *  canvas; si todavía no tiene (canvas nuevo o legacy), la que se MUESTRA
 *  (`shown`, la materializa el diagrama) — su primera escritura la vuelve
 *  explícita, así una tabla que entra NO arrastra sus vistas. Sin ninguna de
 *  las dos, las vistas no se tocan: la regla por fuentes las sigue mostrando. */
const viewBase = (cur: SubjectArea, shown?: string[] | null): string[] | null =>
  Array.isArray(cur.viewIds) ? cur.viewIds : (shown ?? null);

/** SUMA miembros al canvas, con sus posiciones (`layout`) y trazos (`routes`)
 *  en la MISMA escritura. Devuelve lo que REALMENTE entró: lo que ya estaba no
 *  cuenta (la inversa del Undo no debe sacarlo) y su posición tampoco se toca
 *  (revisión doc 113: un alta armada con un diagrama viejo movía un bloque que
 *  ya estaba, sin Undo); los trazos, sólo si entra una tabla (ronda 2: con la
 *  tabla ya en otro lugar, sus trazos viejos no calzan). Sin nada que cambiar,
 *  no graba.
 *  `shownViews` (ver `viewBase`): quien lo pasa fija la lista de vistas de un
 *  canvas que todavía no la tiene. Doc 112: lo que ENTRA llega con el color de
 *  su tabla — un color de este canvas guardado de antes para ese id no revive —
 *  salvo el que trae `colors` (el Undo de sacarla o borrarla lo repone); el
 *  color de una caja que ya estaba no se toca.
 *  Doc 114: `pins` — dónde se ven HOY los miembros sin posición guardada que la
 *  tabla que entra correría de casilla (`pinsForEntering`): sólo si entra una
 *  tabla y sólo a quien sigue sin posición en el canvas efectivo (nunca mueve
 *  un bloque posicionado), en la misma escritura. */
export const addToCanvas = async (
  saId: string, add: CanvasMembers & { layout?: Layout; routes?: WireRoutes; colors?: Record<string, string>; pins?: Layout },
  shownViews?: string[] | null,
): Promise<Required<CanvasMembers>> => {
  const cs = requireWriteCs('Editing a canvas');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    const tables = cur.tableIds ?? [];
    const tableIds = [...new Set(add.tableIds ?? [])].filter((id) => !tables.includes(id));
    const views = viewBase(cur, shownViews);
    const viewIds = views ? [...new Set(add.viewIds ?? [])].filter((id) => !views.includes(id)) : [];
    const entering = [...tableIds, ...viewIds];
    const placed = Object.fromEntries(Object.entries(add.layout ?? {}).filter(([id]) => entering.includes(id)));
    const members = new Set([...tables, ...(views ?? [])]);
    const pinned = tableIds.length
      ? Object.entries(add.pins ?? {}).filter(([id]) => members.has(id) && !cur.layout?.[id])
      : [];
    const layout = Object.keys(placed).length || pinned.length ? { ...Object.fromEntries(pinned), ...placed } : null;
    const routes = cleanRoutes(add.routes);
    const withRoutes = tableIds.length > 0 && Object.keys(routes).length > 0;
    if (!tableIds.length && !viewIds.length && !layout && !withRoutes) return { tableIds, viewIds };
    const next: SubjectArea = { ...cur, id: saId };
    if (tableIds.length) next.tableIds = [...tables, ...tableIds];
    if (views && (viewIds.length || !Array.isArray(cur.viewIds))) next.viewIds = [...views, ...viewIds];
    if (layout) next.layout = { ...(cur.layout ?? {}), ...layout };
    if (withRoutes) next.routes = { ...cleanRoutes(cur.routes), ...routes };
    if (entering.length) {
      const colors = cleanColors(cur.colors);
      const back = cleanColors(add.colors);
      let touched = false;
      for (const id of entering) {
        if (back[id]) { colors[id] = back[id]; touched = true; }
        else if (id in colors) { delete colors[id]; touched = true; }
      }
      if (touched) next.colors = colors;
    }
    await saveCanvas(cs, saId, next);
    return { tableIds, viewIds };
  });
};

/** Lo que salió de un canvas (doc 105): miembros, sus posiciones y (doc 112)
 *  su color en ese canvas. */
export type CanvasMembersOut = Required<CanvasMembers> & { layout: NonNullable<Layout>; colors: Record<string, string> };

/** Las posiciones de `ids` en un layout (sólo las que tiene). */
const positionsOf = (layout: Layout | undefined, ids: Iterable<string>): NonNullable<Layout> => {
  const out: NonNullable<Layout> = {};
  for (const id of ids) if (layout?.[id]) out[id] = { ...layout[id] };
  return out;
};

/** Doc 112: el color en el canvas de `ids` (sólo los que tienen). */
const colorsOf = (colors: unknown, ids: Iterable<string>): Record<string, string> => {
  const all = cleanColors(colors);
  const out: Record<string, string> = {};
  for (const id of ids) if (all[id]) out[id] = all[id];
  return out;
};

/** SACA miembros del canvas CON su posición (sin ella quedaría un nodo
 *  fantasma en el layout, audit C9b), su color en este canvas (doc 112: si
 *  vuelve, llega con el color de su tabla) y los trazos de `dropRouteIds` (los
 *  wires de una tabla que sale: si vuelve en otra posición ya no calzarían,
 *  doc 99). La tabla o vista sigue en el modelo y en los demás canvases. Un
 *  canvas que ya no está en la working copy no se toca (borrar una tabla
 *  recorre todos los canvases donde estaba). Doc 105 (F4): devuelve lo que
 *  REALMENTE salió, con sus posiciones y colores — el Undo lo repone tal cual. */
export const removeFromCanvas = async (
  saId: string, rm: CanvasMembers & { dropRouteIds?: string[]; pins?: Layout }, shownViews?: string[] | null,
): Promise<CanvasMembersOut> => {
  const cs = requireWriteCs('Editing a canvas');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) return { tableIds: [], viewIds: [], layout: {}, colors: {} };
    const next: SubjectArea = { ...cur, id: saId };
    const gone = new Set<string>();
    const tables = cur.tableIds ?? [];
    const outTables = (rm.tableIds ?? []).filter((id) => tables.includes(id));
    if (outTables.length) {
      next.tableIds = tables.filter((id) => !outTables.includes(id));
      outTables.forEach((id) => gone.add(id));
    }
    const views = rm.viewIds?.length ? viewBase(cur, shownViews) : null;
    const outViews = views ? rm.viewIds!.filter((id) => views.includes(id)) : [];
    if (outViews.length) {
      next.viewIds = views!.filter((id) => !outViews.includes(id));
      outViews.forEach((id) => gone.add(id));
    }
    let changed = gone.size > 0;
    if (gone.size && cur.layout) {
      next.layout = Object.fromEntries(Object.entries(cur.layout).filter(([id]) => !gone.has(id)));
    }
    // Revisión doc 114: `pins` — dónde se ven HOY los que quedan sin posición
    // (`pinsForLeaving`): sólo si sale una tabla y sólo a quien sigue sin
    // posición en el canvas efectivo, en la misma escritura.
    const stays = new Set([...(next.tableIds ?? tables), ...(viewBase(next, shownViews) ?? [])]);
    const pinned = outTables.length
      ? Object.entries(rm.pins ?? {}).filter(([id]) => stays.has(id) && !gone.has(id) && !cur.layout?.[id])
      : [];
    if (pinned.length) next.layout = { ...(next.layout ?? cur.layout ?? {}), ...Object.fromEntries(pinned) };
    const colors = colorsOf(cur.colors, gone);
    if (Object.keys(colors).length) {
      next.colors = Object.fromEntries(Object.entries(cleanColors(cur.colors)).filter(([id]) => !gone.has(id)));
    }
    if (rm.dropRouteIds?.length && cur.routes) {
      const routes = cleanRoutes(cur.routes);
      for (const id of rm.dropRouteIds) if (routeOf(routes, id)) { delete routes[id]; changed = true; }
      next.routes = routes;
    }
    if (changed) await saveCanvas(cs, saId, next);
    return { tableIds: outTables, viewIds: outViews, layout: positionsOf(cur.layout, gone), colors };
  });
};

/** Doc 105 (F4, A4-o4): de `viewIds`, cuáles lista EXPLÍCITAMENTE el canvas,
 *  dónde están y (doc 112) su color en él — leído en su cola (después de sus
 *  escrituras pendientes), sin escribir. Borrar una vista (o la tabla de la que sale) la saca de todo canvas
 *  que la lista, en el mismo request (cascada del backend, doc 88 §4): quien
 *  borra lo anota ANTES para que su Undo la reponga en su sitio. Un canvas sin
 *  lista explícita (legacy, doc 70) o que ya no está no lista ninguna: su regla
 *  por fuentes la vuelve a mostrar sola (y el backend no le toca el layout). */
export const listedViews = async (
  saId: string, viewIds: string[],
): Promise<{ viewIds: string[]; layout: NonNullable<Layout>; colors: Record<string, string> }> => {
  if (!viewIds.length) return { viewIds: [], layout: {}, colors: {} };
  const cs = requireWriteCs('Editing a canvas');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    const listed = Array.isArray(cur?.viewIds) ? viewIds.filter((id) => cur!.viewIds!.includes(id)) : [];
    return { viewIds: listed, layout: positionsOf(cur?.layout, listed), colors: colorsOf(cur?.colors, listed) };
  });
};

/* Doc 104: posiciones, auto-arrange y dibujos van SIEMPRE por la working copy
 * (como trazos y UDPs). El PUT directo a producción de antes no tenía uso
 * legítimo — el visor nunca persiste (doc 84 E) — y sólo lo alcanzaba un
 * guardado pendiente de una sesión que se degradó a solo lectura (versión
 * transferida, eliminada o enviada a revisión): publicaba sin revisión. */
export const setSubjectAreaLayout = async (
  saId: string, layout: Record<string, { x: number; y: number }>,
): Promise<SubjectArea> => {
  const cs = requireWriteCs('Saving the canvas layout');
  return inOrder(saId, async () => {
    // El PUT directo MERGEA (M3a): replicamos el merge sobre el layout efectivo.
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, layout: { ...(cur.layout ?? {}), ...layout }, id: saId });
  });
};

// ── Trazos manuales de wires (doc 99) ──────────────────────────────────────
// Viajan en el documento del canvas, SIEMPRE por la working copy (no hay
// escritura directa): se versionan igual que las posiciones.

/** Cambia los trazos sobre el canvas EFECTIVO (saneado: un trazo corrupto de
 *  la BD no vuelve como payload) y graba el doc completo. */
function patchRoutes(cs: string, saId: string, change: (cur: WireRoutes) => WireRoutes): Promise<SubjectArea> {
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, routes: change(cleanRoutes(cur.routes)), id: saId });
  });
}

/** Trazo de UN wire del canvas. `null` o lista vacía lo quita (el wire vuelve
 *  al camino automático); cualquier otra cosa que no sea una lista de puntos
 *  se rechaza — un `undefined` que llegara por error no borra un trazo.
 *  `validIds` = wires que existen hoy en el canvas: los trazos de los demás
 *  (relación borrada) se podan en la misma escritura. */
export const setWireRoute = async (
  saId: string, wireId: string, points: RoutePoint[] | null, validIds?: Iterable<string>,
): Promise<SubjectArea> => {
  const cs = requireWriteCs('Editing a wire route');
  if (!validWireId(wireId)) throw new Error('Invalid wire id.');
  if (points !== null && !Array.isArray(points)) throw new Error('Invalid wire route: expected a list of points.');
  if (points && points.length > MAX_ROUTE_POINTS) {
    throw new Error(`Invalid wire route: a wire can have at most ${MAX_ROUTE_POINTS} points.`);
  }
  const route = points?.length ? cleanRoute(points) : [];
  if (route === null) throw new Error('Invalid wire route: every point needs a finite x and y.');
  return patchRoutes(cs, saId, (cur) => {
    const next = { ...cur };
    if (route.length) next[wireId] = route; else delete next[wireId];
    return validIds ? pruneRoutes(next, validIds) : next;
  });
};

/** Auto-arrange de un canvas: posiciones nuevas (MERGEA, M3a) y trazos en UNA
 *  sola escritura. Por defecto los trazos se REINICIAN — con todos los bloques
 *  en otro sitio ya no calzan —; el Undo pasa los anteriores para reponerlos. */
export const arrangeSubjectArea = async (
  saId: string, layout: Record<string, { x: number; y: number }>, routes: WireRoutes = {},
): Promise<SubjectArea> => {
  const cs = requireWriteCs('Arranging the canvas');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, layout: { ...(cur.layout ?? {}), ...layout }, routes: cleanRoutes(routes), id: saId });
  });
};

export const setSubjectAreaDrawings = async (saId: string, drawings: Drawing[]): Promise<SubjectArea> =>
  patchSa(requireWriteCs('Saving the canvas drawings'), saId, { drawings });

/** Doc 109: color de cajas EN ESTE canvas. `patch` = {id de tabla o vista:
 *  ColorRef} — `null` quita la excepción (la caja vuelve al color de su tabla).
 *  Se mezcla, en la cola del canvas, sobre los colores EFECTIVOS de ese momento:
 *  dos cambios seguidos no se pisan. Una referencia inválida se rechaza. Doc 112:
 *  no se pinta una caja que ya no está en el canvas (la sacaron mientras se
 *  pintaba); en un canvas sin lista explícita de vistas (doc 70) un id que no es
 *  tabla puede ser una vista que se muestra por sus fuentes: se pinta. */
export const setCanvasColors = async (
  saId: string, patch: Record<string, string | null>,
): Promise<SubjectArea> => {
  const cs = requireWriteCs('Editing the canvas colors');
  for (const [id, ref] of Object.entries(patch)) {
    if (!id || (ref !== null && normalColor(ref, true) === null)) throw new Error(`Invalid color for ${id || 'a box'}.`);
  }
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    const colors = cleanColors(cur.colors);
    const gone = (id: string) => !(cur.tableIds ?? []).includes(id)
      && Array.isArray(cur.viewIds) && !cur.viewIds.includes(id);
    for (const [id, ref] of Object.entries(patch)) {
      if (ref === null) delete colors[id]; else if (!gone(id)) colors[id] = normalColor(ref, true)!;
    }
    return saveCanvas(cs, saId, { ...cur, colors, id: saId });
  });
};

/** UDPs del canvas: SIEMPRE versionado (doc 75 D14: sin escritura directa). */
export const setSubjectAreaUdp = (saId: string, udpValues: Record<string, string>): Promise<SubjectArea> =>
  patchSa(requireWriteCs('Editing canvas properties'), saId, { udpValues });

/** Doc 112: UDPs del canvas por CAMBIOS ({defId: valor}, '' = quitar), mezclados
 *  en la cola del canvas sobre los VIGENTES: una ficha abierta antes de que
 *  aterrizara otro guardado no lo pisa con sus valores viejos. */
export const patchSubjectAreaUdp = async (saId: string, changes: Record<string, string>): Promise<SubjectArea> => {
  const cs = requireWriteCs('Editing canvas properties');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, udpValues: applyPending(cur.udpValues ?? {}, changes), id: saId });
  });
};
