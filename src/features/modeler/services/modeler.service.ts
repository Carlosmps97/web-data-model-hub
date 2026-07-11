// Servicio del modeler: Projects/Folders/Canvas (subject_areas, directos, no
// versionados) + armado del diagrama changeset-aware (tablas/columnas/relaciones
// del overlay activo).
import { apiGet, apiPost, apiPut, apiDelete, apiFetch } from '@/services/http';
import * as gov from '@/features/governance/services/governance.service';
import { useChangesetStore } from '@/store/useChangesetStore';
import type { CanonicalTable, CanonicalColumn } from '@/features/governance/services/governance.service';
import type { Relationship } from '@/features/governance/services/governance.service';
import type { View } from '@/services/views.service';
export type { Relationship };

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface Project { id: string; name: string; description?: string; }
// Carpeta del Model Explorer (jerarquía anidada por `parentFolderId` dentro de un proyecto).
export interface Folder { id: string; projectId: string; parentFolderId: string | null; name: string; order: number; }
// Formas libres del canvas (capa DRAWING, detrás de las tablas). Persistidas por subject_area.
export type DrawingType = 'rect' | 'square' | 'circle' | 'ellipse' | 'line' | 'star' | 'diamond' | 'text';
export interface Drawing { id: string; type: DrawingType; x: number; y: number; w: number; h: number; text?: string; color?: string; }
// Un canvas = una subject_area = un diagrama ER. `folderId=null` ⇒ cuelga de la raíz del proyecto.
export interface SubjectArea { id: string; projectId: string; name: string; folderId?: string | null; tableIds: string[]; layout: Record<string, { x: number; y: number }>; drawings?: Drawing[]; }
// F3: `views` = vistas showOnCanvas con ≥1 fuente en este canvas (las filtra
// el backend en /diagram; el front solo las dibuja — nodos 'view' + wires).
export interface Diagram { subjectArea: SubjectArea; tables: CanonicalTable[]; columns: CanonicalColumn[]; relationships: Relationship[]; views: View[]; }

// ── Projects (directos) ──
export const listProjects = () => apiGet<Project[]>(`${API_BASE}/api/projects`);
export const createProject = (name: string) => apiPost<Project>(`${API_BASE}/api/projects`, { name });
export const renameProject = (id: string, name: string) => apiPut<Project>(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, { name });
export const deleteProject = (id: string) => apiDelete<{ deleted: boolean }>(`${API_BASE}/api/projects/${encodeURIComponent(id)}`);

// ── Folders (jerarquía anidada del Model Explorer) ──
export const listFolders = (projectId: string) => apiGet<Folder[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/folders`);
export const createFolder = (projectId: string, parentFolderId: string | null, name: string, order = 0) =>
  apiPost<Folder>(`${API_BASE}/api/folders`, { projectId, parentFolderId, name, order });
export const renameFolder = (id: string, name: string) => apiFetch<Folder>(`${API_BASE}/api/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } });
export const moveFolder = (id: string, parentFolderId: string | null) => apiFetch<Folder>(`${API_BASE}/api/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { parentFolderId } });
export const deleteFolder = (id: string) => apiDelete<{ deleted: boolean }>(`${API_BASE}/api/folders/${encodeURIComponent(id)}`);

// ── Canvas (subject_areas, directos) ──
export const listSubjectAreas = (projectId: string, folderId?: string) =>
  apiGet<SubjectArea[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/subject-areas${folderId !== undefined ? `?folderId=${encodeURIComponent(folderId)}` : ''}`);
export const createSubjectArea = (projectId: string, name: string, folderId: string | null = null) =>
  apiPost<SubjectArea>(`${API_BASE}/api/subject-areas`, { projectId, name, folderId });
// PUT exige el body completo (projectId+name); sirve para rename y para mover de carpeta.
export const updateSubjectArea = (id: string, body: { projectId: string; name: string; folderId?: string | null }) =>
  apiPut<SubjectArea>(`${API_BASE}/api/subject-areas/${encodeURIComponent(id)}`, body);
export const deleteSubjectArea = (id: string) => apiDelete<{ deleted: boolean }>(`${API_BASE}/api/subject-areas/${encodeURIComponent(id)}`);
export const getSubjectArea = (saId: string) => apiGet<SubjectArea>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}`);
export const setSubjectAreaTables = (saId: string, tableIds: string[]) => apiPut<SubjectArea>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/tables`, { tableIds });
export const setSubjectAreaLayout = (saId: string, layout: Record<string, { x: number; y: number }>) => apiPut<SubjectArea>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/layout`, { layout });
// Capa DRAWING: persiste el array completo de formas del canvas (R6d).
export const setSubjectAreaDrawings = (saId: string, drawings: Drawing[]) => apiPut<SubjectArea>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/drawings`, { drawings });

// ── Relaciones (changeset-aware, sólo render en M3b-1) ──
export const listRelationships = () => gov.listRelationships();

// ── Armado del diagrama (changeset-aware) ──
// UNA request: el backend arma el diagrama con queries batched ($in) y aplica
// el overlay del changeset server-side. El armado viejo en el cliente (pool
// completo de tablas + un fetch POR tabla + todas las relaciones) tardaba
// segundos con 100 tablas y movía el catálogo entero (15k) por apertura.
export async function loadDiagram(saId: string): Promise<Diagram> {
  const cs = useChangesetStore.getState().activeId;
  const qs = cs ? `?changesetId=${encodeURIComponent(cs)}` : '';
  return apiGet<Diagram>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/diagram${qs}`);
}
