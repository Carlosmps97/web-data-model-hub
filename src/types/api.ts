// API request/response types

// Generic API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Project endpoints ───────────────────────────────────────────────────────

/** Bloques de Data Standards que un proyecto nuevo puede copiar de otro (doc 75 D15).
 *  Espeja `COPY_BLOCKS` del backend. */
export type StandardsBlock = 'glossary' | 'domains' | 'udp' | 'naming' | 'ddl';

/** `POST /api/projects` (doc 75 D15): la creación es la ÚNICA operación directa
 *  sobre un proyecto (renombrar/borrar van por draft). `copyFrom` copia bloques
 *  de Data Standards de otro proyecto; sin él, el proyecto nace vacío. */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  copyFrom?: { projectId: string; blocks: StandardsBlock[] };
}
