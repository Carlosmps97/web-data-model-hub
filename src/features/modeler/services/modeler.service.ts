// Servicio del modeler: Projects/Folders/Canvas (subject_areas, directos, no
// versionados) + armado del diagrama changeset-aware (tablas/columnas/relaciones
// del overlay activo).
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
// Formas libres del canvas (capa DRAWING, detrás de las tablas). Persistidas por subject_area.
export type DrawingType = 'rect' | 'square' | 'circle' | 'ellipse' | 'line' | 'star' | 'diamond' | 'text';
export interface Drawing { id: string; type: DrawingType; x: number; y: number; w: number; h: number; text?: string; color?: string; }
// Un canvas = una subject_area = un diagrama ER. `folderId=null` ⇒ cuelga de la raíz del proyecto.
// Doc 70: `viewIds` = vistas MIEMBRO del canvas (paridad con tableIds; la
// posición ya vivía en layout[viewId]). `null`/ausente = canvas legacy que
// nunca materializó su lista (el backend aplica la regla vieja showOnCanvas ∧
// fuentes y devuelve en /diagram la lista materializada). Invariante
// round-trip: declarado acá Y en `SubjectAreaDoc`.
// Doc 99: `routes` = trazos MANUALES de wires — puntos de quiebre por wire, en
// coordenadas del canvas, padre → hijo. La llave es el id del wire en el
// canvas: el de la relación (wire crow's-foot y rama de subcategoría) o
// `subsym-{símbolo}` (tronco). Sin entrada, el wire usa el camino automático.
// Invariante round-trip: declarado acá Y en `SubjectAreaDoc`.
export interface SubjectArea { id: string; projectId: string; name: string; folderId?: string | null; tableIds: string[]; viewIds?: string[] | null; layout: Record<string, { x: number; y: number }>; drawings?: Drawing[]; udpValues?: Record<string, string>; routes?: Record<string, { x: number; y: number }[]>; }
// `views` = vistas MIEMBRO del canvas (`viewIds`, doc 70; un canvas legacy sin
// lista usa showOnCanvas + ≥1 fuente) — las resuelve el backend en /diagram; el
// front solo las dibuja (nodos 'view' + wires).
export interface Diagram { subjectArea: SubjectArea; tables: CanonicalTable[]; columns: CanonicalColumn[]; relationships: Relationship[]; views: View[]; }

// ── Projects (directos) ──
// Doc 75 D5: el proyecto se CREA directo (projects.service.createProject) y se
// renombra/describe/borra SOLO por draft (structure.service): acá no hay
// mutaciones directas de proyecto.
export const listProjects = () => apiGet<Project[]>(`${API_BASE}/api/projects`);

// ── Folders (jerarquía anidada del Model Explorer) ──
// Doc 105: sólo LECTURAS. Carpetas y canvases se escriben SIEMPRE por la
// versión en edición (structure.service); el backend rechaza (409) las
// escrituras directas a producción que había acá.
export const listFolders = (projectId: string) => apiGet<Folder[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/folders`);

// ── Canvas (subject_areas) ──
export const listSubjectAreas = (projectId: string, folderId?: string) =>
  apiGet<SubjectArea[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/subject-areas${folderId !== undefined ? `?folderId=${encodeURIComponent(folderId)}` : ''}`);
export const getSubjectArea = (saId: string) => apiGet<SubjectArea>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}`);

// ── Relaciones (changeset-aware, sólo render en M3b-1) ──
export const listRelationships = () => gov.listRelationships();

// ── Armado del diagrama (changeset-aware) ──
// UNA request: el backend arma el diagrama con queries batched ($in) y aplica
// el overlay del changeset server-side. El armado viejo en el cliente (pool
// completo de tablas + un fetch POR tabla + todas las relaciones) tardaba
// segundos con 100 tablas y movía el catálogo entero (15k) por apertura.
export async function loadDiagram(saId: string): Promise<Diagram> {
  const cs = useSessionStore.getState().activeChangesetId;
  const qs = cs ? `?changesetId=${encodeURIComponent(cs)}` : '';
  return apiGet<Diagram>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/diagram${qs}`);
}
