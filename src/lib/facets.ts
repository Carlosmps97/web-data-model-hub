/**
 * Contrato de FACETAS lógico/físico (doc 69 §4.9) — espejo de `app/core/facets.py`.
 *
 * Erwin modela UN objeto con DOS vistas: Entity/Attribute (lógica) y
 * Table/Column (física). En la plataforma es el mismo documento; cada
 * propiedad pertenece a una faceta o es compartida, y las definiciones UDP
 * declaran la suya (`view`). View y Model solo tienen faceta física.
 * Este módulo es la ÚNICA fuente de etiquetas y filtros por faceta para
 * paneles, Data Standards y exports — una faceta nueva se agrega acá.
 */
import type { UdpLevel, UdpView } from '@/features/standards/standards.service';

export type Facet = UdpView;

export const PHYSICAL_ONLY_UDP_LEVELS: ReadonlySet<UdpLevel> = new Set<UdpLevel>(['view', 'canvas']);

/** Faceta EFECTIVA de una def: view/canvas ⇒ physical; ausente/desconocida ⇒ physical (defs pre-doc 69). */
export function normalizeUdpView(level: UdpLevel, view?: string | null): Facet {
  if (PHYSICAL_ONLY_UDP_LEVELS.has(level)) return 'physical';
  return view === 'logical' ? 'logical' : 'physical';
}

export const udpView = (d: { level: UdpLevel; view?: string | null }): Facet => normalizeUdpView(d.level, d.view);

/** Nombre legible único por faceta (la física plana; la lógica con sufijo). */
export const udpDisplayName = (d: { name: string; level: UdpLevel; view?: string | null }): string =>
  udpView(d) === 'logical' ? `${d.name} (Logical)` : d.name;

export function facetUdpDefs<T extends { level: UdpLevel; view?: string | null }>(defs: T[], level: UdpLevel, facet: Facet): T[] {
  return defs.filter((d) => d.level === level && udpView(d) === facet);
}

/** Cuántos valores NO vacíos de `values` pertenecen a defs de (level, facet). */
export function countFacetUdpValues(
  values: Record<string, string> | undefined,
  defs: { id: string; level: UdpLevel; view?: string | null }[],
  level: UdpLevel,
  facet: Facet,
): number {
  if (!values) return 0;
  const ids = new Set(facetUdpDefs(defs, level, facet).map((d) => d.id));
  return Object.entries(values).filter(([id, v]) => ids.has(id) && v !== '').length;
}

/** Sustantivo del objeto según la faceta (headers de los paneles). */
export const facetNoun = (level: 'table' | 'column', facet: Facet): 'entity' | 'table' | 'attribute' | 'column' =>
  level === 'table' ? (facet === 'logical' ? 'entity' : 'table') : (facet === 'logical' ? 'attribute' : 'column');

/** Doc 114: el nombre de una tabla o columna en el modelo activo — lógico
 *  (entidad/atributo) o físico (tabla/columna) —, con el otro de respaldo si
 *  falta. Lo usan los popups de relación y subcategoría, como el canvas. */
export const facetName = (o: { logicalName?: string | null; physicalName?: string | null } | null | undefined, facet: Facet): string =>
  (facet === 'logical' ? (o?.logicalName || o?.physicalName) : (o?.physicalName || o?.logicalName)) ?? '';

/** Revisión doc 114 (H1): los nombres del modelo activo de un conjunto (las
 *  columnas de UNA tabla), por id — el lógico se puede repetir (el físico es el
 *  único): los repetidos, sin mirar mayúsculas, bordes, espacios internos ni la
 *  forma Unicode (ronda 2: la lista los dibuja iguales), llevan el nombre del
 *  otro modelo entre paréntesis; el resto, tal cual. */
export function distinctNames<T extends { id: string; logicalName?: string | null; physicalName?: string | null }>(
  items: readonly T[], facet: Facet,
): Map<string, string> {
  const key = (o: T) => facetName(o, facet).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const count = new Map<string, number>();
  for (const o of items) count.set(key(o), (count.get(key(o)) ?? 0) + 1);
  const other: Facet = facet === 'logical' ? 'physical' : 'logical';
  return new Map(items.map((o) => [o.id, (count.get(key(o)) ?? 0) > 1
    ? `${facetName(o, facet).trim()} (${facetName(o, other).trim()})` : facetName(o, facet)]));
}

/** Sustantivos del objeto por faceta (doc 85 §3.8): ÚNICA fuente de los
 *  rótulos «Entity/Attribute» (modelo lógico) y «Table/Column» (físico) que
 *  usa el workspace Model — pestañas, botones, diálogos, toasts, Explorer, ⌘K.
 *  Views no cambia de nombre (solo existen en físico). */
export interface FacetNouns {
  one: string; many: string; One: string; Many: string; a: string;
  member: string; members: string; Member: string; Members: string; aMember: string;
}
export const FACET_NOUNS: Record<Facet, FacetNouns> = {
  logical: { one: 'entity', many: 'entities', One: 'Entity', Many: 'Entities', a: 'an entity',
    member: 'attribute', members: 'attributes', Member: 'Attribute', Members: 'Attributes', aMember: 'an attribute' },
  physical: { one: 'table', many: 'tables', One: 'Table', Many: 'Tables', a: 'a table',
    member: 'column', members: 'columns', Member: 'Column', Members: 'Columns', aMember: 'a column' },
};
export const facetNouns = (facet: Facet): FacetNouns => FACET_NOUNS[facet];

/** Doc 86 §2.2: herramientas de Structure por modelo. Views, CTAS y Schemas
 *  son conceptos FÍSICOS; New entity/table vive en ambos. Doc 113 §1.2: la
 *  carga Excel también es física (crea tablas con esquema y sus vistas `_vu`). */
export type StructureTool = 'new-table' | 'ctas' | 'view' | 'schema' | 'upload';
const PHYSICAL_ONLY_TOOLS: ReadonlySet<StructureTool> = new Set<StructureTool>(['ctas', 'view', 'schema', 'upload']);
export const toolAvailableIn = (tool: StructureTool, facet: Facet): boolean =>
  facet === 'physical' || !PHYSICAL_ONLY_TOOLS.has(tool);
export const PHYSICAL_ONLY_TOOL_TIP: Record<StructureTool, string> = {
  'new-table': '',
  upload: 'Upload from Excel belongs to the physical model — switch to Physical',
  ctas: 'CTAS belongs to the physical model — switch to Physical',
  view: 'Views belong to the physical model — switch to Physical',
  schema: 'Schemas belong to the physical model — switch to Physical',
};
/** Rótulo del modelo activo (barra de estado del canvas, doc 86 D1). */
export const MODEL_MODE_CAPTION: Record<Facet, string> = {
  logical: 'Logical model · entities & attributes',
  physical: 'Physical model · tables, columns & views',
};

export const FACET_CLASS_LABEL: Record<UdpLevel, Record<Facet, string>> = {
  table: { logical: 'Entity (Logical)', physical: 'Table (Physical)' },
  column: { logical: 'Attribute (Logical)', physical: 'Column (Physical)' },
  view: { logical: 'View', physical: 'View' },
  canvas: { logical: 'Model', physical: 'Model' },
};

export const FACET_CAPTION: Record<'table' | 'column', Record<Facet, string>> = {
  table: { logical: 'Entity UDPs · logical model', physical: 'Table UDPs · physical model' },
  column: { logical: 'Attribute UDPs · logical model', physical: 'Column UDPs · physical model' },
};

export const FACET_SWITCH_HINT: Record<Facet, string> = {
  logical: 'Switch the canvas to Physical to edit the physical facet.',
  physical: 'Switch the canvas to Logical to edit the logical facet.',
};

export interface UdpClassSegment { id: 'entity' | 'table' | 'attribute' | 'column' | 'view' | 'model'; level: UdpLevel; view: Facet; label: string }

/** Segmentos «Class» de Data Standards → UDP (6 = Erwin: Entity/Table, Attribute/Column, View, Model). */
export const UDP_CLASS_SEGMENTS: UdpClassSegment[] = [
  { id: 'entity', level: 'table', view: 'logical', label: 'Entity (Logical)' },
  { id: 'table', level: 'table', view: 'physical', label: 'Table (Physical)' },
  { id: 'attribute', level: 'column', view: 'logical', label: 'Attribute (Logical)' },
  { id: 'column', level: 'column', view: 'physical', label: 'Column (Physical)' },
  { id: 'view', level: 'view', view: 'physical', label: 'View' },
  { id: 'model', level: 'canvas', view: 'physical', label: 'Model' },
];
