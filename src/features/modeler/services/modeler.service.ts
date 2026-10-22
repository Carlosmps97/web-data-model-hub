// Servicio del modeler: lecturas de Projects/Folders/Canvas (subject_areas) +
// armado del diagrama changeset-aware (tablas/columnas/relaciones del overlay
// activo).
import { apiGet } from '@/services/http';
import * as gov from '@/services/governance.service';
import { useSessionStore } from '@/store/useSessionStore';
import type { CanonicalTable, CanonicalColumn } from '@/services/governance.service';
import type { Relationship } from '@/services/governance.service';
import type { View } from '@/services/views.service';
export type { Relationship };

import { API_BASE } from '@/services/apiBase';

import type { Project } from '@/types/model';
export type { Project };
// Carpeta del Model Explorer (jerarquía anidada por `parentFolderId` dentro de un proyecto).
export interface Folder { id: string; projectId: string; parentFolderId: string | null; name: string; order: number; }
// Formas libres del canvas (capa Drawing, detrás de las tablas). Persistidas por subject_area.
export type DrawingType = 'rect' | 'square' | 'circle' | 'ellipse' | 'line' | 'star' | 'diamond' | 'text';
/** Formato del texto de un dibujo (cualquiera menos la línea). Cada campo es
 *  opcional: lo que falta toma el default del tipo (`lib/drawingStyle.ts`). */
export interface DrawingFont {
  family?: string | null;          // tal cual (p. ej. «Microsoft Sans Serif» de Erwin); null = la de la app
  size?: number;                   // en puntos (como Erwin y Office)
  bold?: boolean; italic?: boolean; underline?: boolean;
  color?: string | null;           // '#RRGGBB'
}
export type TextAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'top' | 'middle' | 'bottom';
/** Dibujo del canvas. `color` = borde (o la línea; en un texto sin `font`, el
 *  color del texto). `fill` = relleno ('none' = sin relleno), `font`,
 *  `align`/`valign` = posición del texto. Posición y tamaño en px del canvas. */
export interface Drawing {
  id: string; type: DrawingType; x: number; y: number; w: number; h: number;
  text?: string; color?: string | null;
  fill?: string | null; font?: DrawingFont; align?: TextAlign; valign?: TextVAlign;
}
// Un canvas = una subject_area = un diagrama ER. `folderId=null` ⇒ cuelga de la raíz del proyecto.
// `viewIds` = vistas miembro del canvas (paridad con tableIds; la posición vive
// en layout[viewId]). `null`/ausente = canvas que no materializó su lista (el
// backend aplica la regla showOnCanvas ∧ fuentes y devuelve en /diagram la
// lista materializada). Invariante round-trip: declarado acá y en
// `SubjectAreaDoc`.
// `routes` = trazos manuales de wires — puntos de quiebre por wire, en
// coordenadas del canvas, padre → hijo. La llave es el id del wire en el
// canvas: el de la relación (wire crow's-foot y rama de subcategoría) o
// `subsym-{símbolo}` (tronco). Sin entrada, el wire usa el camino automático.
// Invariante round-trip: declarado acá y en `SubjectAreaDoc`.
// `colors` = color de las cajas en este canvas ({id de tabla o vista:
// ColorRef}, `lib/colors.ts`) — excepción sobre el color propio de la tabla.
// Invariante round-trip: declarado acá y en `SubjectAreaDoc`.
export interface SubjectArea { id: string; projectId: string; name: string; folderId?: string | null; tableIds: string[]; viewIds?: string[] | null; layout: Record<string, { x: number; y: number }>; drawings?: Drawing[]; udpValues?: Record<string, string>; routes?: Record<string, { x: number; y: number }[]>; colors?: Record<string, string>; }
// `views` = vistas miembro del canvas (`viewIds`; un canvas sin lista usa
// showOnCanvas + ≥1 fuente) — las resuelve el backend en /diagram; el front
// solo las dibuja (nodos 'view' + wires).
export interface Diagram { subjectArea: SubjectArea; tables: CanonicalTable[]; columns: CanonicalColumn[]; relationships: Relationship[]; views: View[]; }

// ── Projects (directos) ──
// El proyecto se crea directo (projects.service.createProject) y se
// renombra/describe/borra solo por draft (structure.service): acá no hay
// mutaciones directas de proyecto.
export const listProjects = () => apiGet<Project[]>(`${API_BASE}/api/projects`);

// ── Folders (jerarquía anidada del Model Explorer) ──
// Solo lecturas. Carpetas y canvases se escriben siempre por la versión en
// edición (structure.service); el backend rechaza (409) las escrituras
// directas a producción.
export const listFolders = (projectId: string) => apiGet<Folder[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/folders`);

// ── Canvas (subject_areas) ──
export const listSubjectAreas = (projectId: string, folderId?: string) =>
  apiGet<SubjectArea[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/subject-areas${folderId !== undefined ? `?folderId=${encodeURIComponent(folderId)}` : ''}`);

// ── Relaciones (changeset-aware, solo lectura) ──
export const listRelationships = () => gov.listRelationships();

// ── Armado del diagrama (changeset-aware) ──
// Una sola request: el backend arma el diagrama con queries batched ($in) y
// aplica el overlay del changeset server-side. Armarlo en el cliente (pool
// completo de tablas + un fetch por tabla + todas las relaciones) tardaría
// segundos con 100 tablas y movería el catálogo entero por apertura.
export async function loadDiagram(saId: string): Promise<Diagram> {
  const cs = useSessionStore.getState().activeChangesetId;
  const qs = cs ? `?changesetId=${encodeURIComponent(cs)}` : '';
  return apiGet<Diagram>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/diagram${qs}`);
}
