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
