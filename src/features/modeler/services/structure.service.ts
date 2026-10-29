/**
 * structure.service — estructura (projects / folders / subject_areas)
 * changeset-aware: crear un proyecto o canvas en una versión draft no escribe
 * en las colecciones publicadas; aparece en producción recién al aprobar.
 *
 * Regla (espeja `rec()` de governance.service):
 *  - Escrituras con sesión de edición (openMode='editing' + changeset activo)
 *    → se registran en el changeset (`csvc.recordChange`) y se publican recién
 *    en el approve. El payload es siempre el doc completo: el overlay de
 *    lectura sustituye el doc publicado por el payload (no mergea).
 *  - Lecturas con changeset activo (edición o readonly de un request) → estado
 *    efectivo (`csvc.effective`), para que el dueño y quienes revisan vean la
 *    estructura draft.
 *  - Sin changeset (producción) → lecturas por los endpoints directos. Las
 *    escrituras del canvas (posiciones, dibujos, trazos, UDPs) exigen la
 *    working copy: no hay escritura directa a producción.
 *
 * Escrituras del canvas en fila: cada guardado del canvas es «leer el doc
 * efectivo + grabar el doc completo». Dos guardados casi simultáneos del mismo
 * canvas (mover una tabla y trazar un wire) leerían el mismo doc y el segundo
 * PUT borraría el cambio del primero. `inOrder` los encola por canvas: el
 * segundo lee recién cuando el primero terminó de grabar.
 */
import * as mod from './modeler.service';
import * as csvc from '@/services/changeset.service';
import { trackDraftWork } from '@/services/draftWork';
import { useSessionStore } from '@/store/useSessionStore';
import { noteCanvasWrite, wholeLayout } from '../lib/canvasWrites';
import { MAX_ROUTE_POINTS, cleanRoute, cleanRoutes, pruneRoutes, routeOf, validWireId } from '../lib/wireRoute';
import { cleanColors, normalColor } from '@/lib/colors';
import { applyPending } from '../lib/udpDraft';
import type { RoutePoint, WireRoutes } from '../lib/wireRoute';
import type { Drawing, Folder, Project, SubjectArea } from './modeler.service';
import type { BulkChange } from '@/services/changeset.service';

/** Changeset para lecturas: cualquier modo con changeset activo (el visor
 *  readonly de un request también debe ver su estructura draft). */
const readCs = (): string | null => useSessionStore.getState().activeChangesetId;

/** Changeset para escrituras: solo sesión de edición (mismo gate que rec()). */
const writeCs = (): string | null =>
  useSessionStore.getState().openMode === 'editing' ? readCs() : null;

const uid = () => crypto.randomUUID();

/** Cola de escrituras por canvas. Un guardado que falla avisa a quien
 *  lo pidió y no frena al siguiente; canvases distintos no se esperan. Toda
 *  request lleva timeout (`apiFetch`), así que la cola no puede quedar colgada. */
const saQueue = new Map<string, Promise<unknown>>();
function inOrder<T>(saId: string, job: () => Promise<T>): Promise<T> {
  const run = trackDraftWork((saQueue.get(saId) ?? Promise.resolve()).then(job));
  const tail = run.catch(() => undefined);
  saQueue.set(saId, tail);
  void tail.then(() => { if (saQueue.get(saId) === tail) saQueue.delete(saId); });
  return run;
}

/** Graba el documento completo del canvas en la working copy y anota qué se
 *  grabó: un diagrama pedido antes de esta escritura puede llegar con la
 *  posición o el trazo previos (`lib/canvasWrites`). Las posiciones se graban
 *  en píxeles enteros, también las que el canvas ya traía. Devuelve lo
 *  grabado. */
async function saveCanvas(cs: string, saId: string, doc: SubjectArea): Promise<SubjectArea> {
  const out = doc.layout ? { ...doc, layout: wholeLayout(doc.layout) } : doc;
  await csvc.recordChange(cs, 'subject_areas', saId, 'upsert', { ...out });
  noteCanvasWrite(cs, saId, out);
  return out;
}

type Layout = SubjectArea['layout'];

/** Avisos de algo que dejó de existir en la working copy. En inglés: llegan a
 *  pantalla. */
export const CANVAS_GONE = 'This canvas is no longer in the working copy.';
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

async function fetchEffectiveSa(cs: string, saId: string): Promise<SubjectArea | null> {
  const rows = await csvc.effective<SubjectArea>(cs, 'subject_areas', { ids: [saId] });
  return rows.find((s) => s.id === saId) ?? null;
}

// ── Projects (se crean directo — projects.service — y se
//    renombran/describen/borran solo por draft del propio proyecto) ──────────

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

/** Graba un solo cambio: el borrado del proyecto. La cascada (tablas,
 *  columnas, vistas, relaciones, esquemas, carpetas, canvases y estándares)
 *  la hace el servidor al aplicar la versión aprobada. */
export const deleteProject = async (id: string): Promise<void> => {
  const cs = requireWriteCs('Deleting a project');
  await csvc.recordChange(cs, 'projects', id, 'delete');
};

/** Deshace el borrado pendiente: vuelve a grabar el doc publicado del proyecto. */
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
// Carpetas y canvases van siempre por la working copy: un confirm o un input
// del Explorer abierto cuando la sesión se degrada (versión transferida,
// eliminada o enviada) no puede borrar ni editar producción sin revisión.

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

/** Upsert del canvas al changeset con el doc efectivo completo + patch (el
 *  overlay sustituye el doc: un payload parcial perdería layout/tableIds al leer). */
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
  // En fila: un guardado pendiente del canvas que aterrizara después del
  // borrado lo resucitaría (el cambio del draft volvería a ser un upsert).
  await inOrder(id, async () => {
    await csvc.recordChange(cs, 'subject_areas', id, 'delete');
    noteCanvasWrite(cs, id, null);
  });
  return { deleted: true };
};

// ── Miembros del canvas ──────────────────────────────────────────────────
// La lista completa de tablas y vistas se arma dentro de la cola, sobre el
// canvas efectivo de ese momento. Armada afuera (con el diagrama en memoria o
// una lectura previa), se perdería cualquier otra escritura de miembros que
// cayera en medio: el Undo de sacar o borrar una tabla, o dos altas seguidas.

export interface CanvasMembers { tableIds?: string[]; viewIds?: string[] }

/** Vistas sobre las que se suma o se quita: la lista explícita del canvas; si
 *  el canvas no tiene una, la que se muestra (`shown`, la materializa el
 *  diagrama) — su primera escritura la vuelve explícita, así una tabla que
 *  entra no arrastra sus vistas. Sin ninguna de las dos, las vistas no se
 *  tocan: la regla por fuentes las sigue mostrando. */
const viewBase = (cur: SubjectArea, shown?: string[] | null): string[] | null =>
  Array.isArray(cur.viewIds) ? cur.viewIds : (shown ?? null);

/** Suma miembros al canvas, con sus posiciones (`layout`) y trazos (`routes`)
 *  en la misma escritura. Devuelve lo que realmente entró: lo que ya estaba no
 *  cuenta (la inversa del Undo no debe sacarlo) y su posición tampoco se toca
 *  (un alta armada con un diagrama desactualizado movería, sin Undo, un bloque
 *  que ya estaba); los trazos, solo si entra una tabla (con la tabla ya en
 *  otro lugar, sus trazos previos no calzan). Sin nada que cambiar, no graba.
 *  `shownViews` (ver `viewBase`): quien lo pasa fija la lista de vistas de un
 *  canvas que no la tiene. Lo que entra llega con el color de su tabla — un
 *  color de este canvas guardado previamente para ese id no revive — salvo el
 *  que trae `colors` (el Undo de sacarla o borrarla lo repone); el color de
 *  una caja que ya estaba no se toca.
 *  `pins`: dónde se ven en ese momento los miembros sin posición guardada que
 *  la tabla que entra correría de casilla (`pinsForEntering`): solo si entra
 *  una tabla y solo a quien sigue sin posición en el canvas efectivo (nunca
 *  mueve un bloque posicionado), en la misma escritura. */
export const addToCanvas = async (
  saId: string, add: CanvasAdd, shownViews?: string[] | null,
): Promise<Required<CanvasMembers>> => {
  const cs = requireWriteCs('Editing a canvas');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    const { next, entered } = planCanvasAdd(cur, add, shownViews);
    if (next) await saveCanvas(cs, saId, next);
    return entered;
  });
};

/** Lo que suma `addToCanvas` a un canvas. */
export type CanvasAdd = CanvasMembers & { layout?: Layout; routes?: WireRoutes; colors?: Record<string, string>; pins?: Layout };

/** Lo que `addToCanvas` haría sobre el documento `cur`, sin escribir: el
 *  documento siguiente (null si no cambia nada) y lo que entra. */
export function planCanvasAdd(cur: SubjectArea, add: CanvasAdd, shownViews?: string[] | null):
  { next: SubjectArea | null; entered: Required<CanvasMembers> } {
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
  if (!tableIds.length && !viewIds.length && !layout && !withRoutes) return { next: null, entered: { tableIds, viewIds } };
  const next: SubjectArea = { ...cur };
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
  return { next, entered: { tableIds, viewIds } };
}

/** Lo que salió de un canvas: miembros, sus posiciones, su color en ese canvas
 *  y los trazos de wires que se quitaron. */
export type CanvasMembersOut = Required<CanvasMembers> & {
  layout: NonNullable<Layout>; colors: Record<string, string>; routes: WireRoutes;
};

/** Las posiciones de `ids` en un layout (solo las que tiene). */
const positionsOf = (layout: Layout | undefined, ids: Iterable<string>): NonNullable<Layout> => {
  const out: NonNullable<Layout> = {};
  for (const id of ids) if (layout?.[id]) out[id] = { ...layout[id] };
  return out;
};

/** El color en el canvas de `ids` (solo los que tienen). */
const colorsOf = (colors: unknown, ids: Iterable<string>): Record<string, string> => {
  const all = cleanColors(colors);
  const out: Record<string, string> = {};
  for (const id of ids) if (all[id]) out[id] = all[id];
  return out;
};

/** Saca miembros del canvas con su posición (sin ella quedaría un nodo
 *  fantasma en el layout), su color en este canvas (si vuelve, llega con el
 *  color de su tabla) y los trazos de `dropRouteIds` (los wires de una tabla
 *  que sale: si vuelve en otra posición no calzarían). La tabla o vista sigue
 *  en el modelo y en los demás canvases. Un canvas que no está en la working
 *  copy no se toca (borrar una tabla recorre todos los canvases donde estaba).
 *  Devuelve lo que realmente salió, con sus posiciones, colores y trazos — el
 *  Undo lo repone tal cual. */
export const removeFromCanvas = async (
  saId: string, rm: CanvasRemove, shownViews?: string[] | null,
): Promise<CanvasMembersOut> => {
  const cs = requireWriteCs('Editing a canvas');
  return inOrder(saId, async () => {
    const { next, out } = planCanvasRemove(await fetchEffectiveSa(cs, saId), rm, shownViews);
    if (next) await saveCanvas(cs, saId, next);
    return out;
  });
};

/** Lo que saca `removeFromCanvas` de un canvas. */
export type CanvasRemove = CanvasMembers & { dropRouteIds?: string[]; pins?: Layout };

/** Lo que `removeFromCanvas` haría sobre el documento `cur`, sin escribir: el
 *  documento siguiente (null si no cambia nada o el canvas no está) y lo que
 *  sale, con sus posiciones, colores y trazos. */
export function planCanvasRemove(cur: SubjectArea | null, rm: CanvasRemove, shownViews?: string[] | null):
  { next: SubjectArea | null; out: CanvasMembersOut } {
  if (!cur) return { next: null, out: { tableIds: [], viewIds: [], layout: {}, colors: {}, routes: {} } };
  const next: SubjectArea = { ...cur };
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
  // `pins`: dónde se ven en ese momento los que quedan sin posición
  // (`pinsForLeaving`): solo si sale una tabla y solo a quien sigue sin
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
  const dropped: WireRoutes = {};
  if (rm.dropRouteIds?.length && cur.routes) {
    const routes = cleanRoutes(cur.routes);
    for (const id of rm.dropRouteIds) {
      const route = routeOf(routes, id);
      if (route) { dropped[id] = route; delete routes[id]; changed = true; }
    }
    next.routes = routes;
  }
  return {
    next: changed ? next : null,
    out: { tableIds: outTables, viewIds: outViews, layout: positionsOf(cur.layout, gone), colors, routes: dropped },
  };
}

/** Máximo de cambios en un solo envío (techo del endpoint del lote). */
export const LOT_MAX = 2000;
/** Ids por lectura de canvases: 100 uuid ≈ 4 KB de URL, lejos del tope de 16 KB
 *  (línea de pedido + cabeceras) del servidor Node del front. */
const CANVAS_IDS_PER_GET = 100;

/** El lote no entra en un solo envío: no se grabó nada. */
export class LotTooLargeError extends Error {
  readonly size: number;
  constructor(size: number) {
    super(`This change needs ${size} writes and the limit is ${LOT_MAX} at a time: nothing was saved.`);
    this.name = 'LotTooLargeError';
    this.size = size;
  }
}

/** Los documentos efectivos de los canvases `ids` (los que están), en tandas de
 *  `CANVAS_IDS_PER_GET` a la vez. */
async function readCanvases(cs: string, ids: string[]): Promise<Map<string, SubjectArea>> {
  const reads: Promise<SubjectArea[]>[] = [];
  for (let i = 0; i < ids.length; i += CANVAS_IDS_PER_GET) {
    reads.push(csvc.effective<SubjectArea>(cs, 'subject_areas', { ids: ids.slice(i, i + CANVAS_IDS_PER_GET) }));
  }
  const wanted = new Set(ids);
  const out = new Map<string, SubjectArea>();
  for (const rows of await Promise.all(reads)) for (const doc of rows) if (wanted.has(doc.id)) out.set(doc.id, doc);
  return out;
}

/** Los documentos de los canvases `ids` en la versión abierta (los que están),
 *  sin esperar sus colas: una foto para decidir qué más leer. */
export const canvasDocs = async (ids: string[]): Promise<Map<string, SubjectArea>> => {
  const cs = readCs();
  return cs && ids.length ? readCanvases(cs, ids) : new Map();
};

/** Lo que arma `canvasLot`: los cambios del modelo, el documento nuevo de cada
 *  canvas que cambia (los que no están no se tocan) y lo que devuelve. */
export interface CanvasLotPlan<T> {
  changes: BulkChange[];
  canvases: Map<string, SubjectArea>;
  result: T;
}

/** Cambios del modelo y de varios canvases en un solo envío: todo o nada (doc
 *  133 §4). Toma la cola de cada canvas en orden de id (dos lotes nunca se esperan
 *  en cruz), lee sus documentos efectivos (null: ya no está; en tandas de
 *  `CANVAS_IDS_PER_GET`, a la vez) y `build` arma el lote sin escribir nada (no
 *  puede pedir otra escritura de canvas: esperaría su propia cola). Anota lo
 *  grabado de cada canvas. Con más cambios de los que admite un envío no graba
 *  nada (`LotTooLargeError`). */
export async function canvasLot<T>(saIds: string[], build: (docs: Map<string, SubjectArea | null>) => CanvasLotPlan<T>): Promise<T> {
  const cs = requireWriteCs('Editing a canvas');
  const ids = [...new Set(saIds)].sort();
  const run = async (): Promise<T> => {
    const docs = new Map<string, SubjectArea | null>(ids.map((id) => [id, null]));
    for (const [id, doc] of await readCanvases(cs, ids)) docs.set(id, doc);
    const plan = build(docs);
    const canvases = [...plan.canvases].map(([id, doc]) => [id, { ...doc, id, ...(doc.layout ? { layout: wholeLayout(doc.layout) } : {}) }] as const);
    const lot: BulkChange[] = [
      ...plan.changes,
      ...canvases.map(([id, doc]): BulkChange => ({ collection: 'subject_areas', entityId: id, op: 'upsert', payload: { ...doc } })),
    ];
    if (lot.length > LOT_MAX) throw new LotTooLargeError(lot.length);
    if (lot.length) await csvc.recordChangesBulk(cs, lot, lot.length);
    for (const [id, doc] of canvases) noteCanvasWrite(cs, id, doc);
    return plan.result;
  };
  const take = (i: number): Promise<T> => (i === ids.length ? run() : inOrder(ids[i], () => take(i + 1)));
  return take(0);
}

/** De `viewIds`, cuáles lista explícitamente el canvas, dónde están y su color
 *  en él — leído en su cola (después de sus escrituras pendientes), sin
 *  escribir. Borrar una vista (o la tabla de la que sale) la saca de todo
 *  canvas que la lista, en el mismo request (cascada del backend): quien borra
 *  lo anota primero para que su Undo la reponga en su sitio. Un canvas sin lista
 *  explícita o que no está en la working copy no lista ninguna: su regla por
 *  fuentes la vuelve a mostrar sola (y el backend no le toca el layout). */
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

/* Posiciones, auto-arrange y dibujos van siempre por la working copy (como
 * trazos y UDPs). No hay PUT directo a producción: el visor nunca persiste, y
 * un guardado pendiente de una sesión que se degradó a solo lectura (versión
 * transferida, eliminada o enviada a revisión) publicaría sin revisión. */
export const setSubjectAreaLayout = async (
  saId: string, layout: Record<string, { x: number; y: number }>,
): Promise<SubjectArea> => {
  const cs = requireWriteCs('Saving the canvas layout');
  return inOrder(saId, async () => {
    // Merge sobre el layout efectivo: solo cambian las posiciones recibidas.
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, layout: { ...(cur.layout ?? {}), ...layout }, id: saId });
  });
};

// ── Trazos manuales de wires ───────────────────────────────────────────────
// Viajan en el documento del canvas, siempre por la working copy (no hay
// escritura directa): se versionan igual que las posiciones.

/** Cambia los trazos sobre el canvas efectivo (saneado: un trazo corrupto de
 *  la BD no vuelve como payload) y graba el doc completo. */
function patchRoutes(cs: string, saId: string, change: (cur: WireRoutes) => WireRoutes): Promise<SubjectArea> {
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, routes: change(cleanRoutes(cur.routes)), id: saId });
  });
}

/** Trazo de un wire del canvas. `null` o lista vacía lo quita (el wire vuelve
 *  al camino automático); cualquier otra cosa que no sea una lista de puntos
 *  se rechaza — un `undefined` que llegara por error no borra un trazo.
 *  `validIds` = wires que existen en el canvas: los trazos de los demás
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

/** Auto-arrange de un canvas: posiciones nuevas (se mezclan con el layout) y
 *  trazos en una sola escritura. Por defecto los trazos se reinician — con
 *  todos los bloques en otro sitio no calzan —; el Undo pasa los anteriores
 *  para reponerlos. */
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

/** Color de cajas en este canvas. `patch` = {id de tabla o vista: ColorRef} —
 *  `null` quita la excepción (la caja vuelve al color de su tabla). Se mezcla,
 *  en la cola del canvas, sobre los colores efectivos de ese momento: dos
 *  cambios seguidos no se pisan. Una referencia inválida se rechaza. No se
 *  pinta una caja que salió del canvas mientras se pintaba; en un canvas sin
 *  lista explícita de vistas un id que no es tabla puede ser una vista que se
 *  muestra por sus fuentes: se pinta. */
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

/** UDPs del canvas: siempre versionado (sin escritura directa). */
export const setSubjectAreaUdp = (saId: string, udpValues: Record<string, string>): Promise<SubjectArea> =>
  patchSa(requireWriteCs('Editing canvas properties'), saId, { udpValues });

/** UDPs del canvas por cambios ({defId: valor}, '' = quitar), mezclados en la
 *  cola del canvas sobre los vigentes: una ficha abierta antes de que
 *  aterrizara otro guardado no lo pisa con sus valores previos. */
export const patchSubjectAreaUdp = async (saId: string, changes: Record<string, string>): Promise<SubjectArea> => {
  const cs = requireWriteCs('Editing canvas properties');
  return inOrder(saId, async () => {
    const cur = await fetchEffectiveSa(cs, saId);
    if (!cur) throw new Error(CANVAS_GONE);
    return saveCanvas(cs, saId, { ...cur, udpValues: applyPending(cur.udpValues ?? {}, changes), id: saId });
  });
};
