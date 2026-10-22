// Tipos de request/response de la API

// Envoltorio genérico de respuesta de la API
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Endpoints de proyectos ──────────────────────────────────────────────────

/** Bloques de Data Standards que un proyecto nuevo puede copiar de otro.
 *  Espeja `COPY_BLOCKS` del backend. */
export type StandardsBlock = 'glossary' | 'domains' | 'udp' | 'naming' | 'ddl' | 'themes';

/** `POST /api/projects`: la creación es la única operación directa
 *  sobre un proyecto (renombrar/borrar van por draft). `copyFrom` copia bloques
 *  de Data Standards de otro proyecto; sin él, el proyecto nace vacío. */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  copyFrom?: { projectId: string; blocks: StandardsBlock[] };
}
