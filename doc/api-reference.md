# Referencia de API (consumida por el frontend)

> **El frontend ya no expone rutas API propias.** Toda la comunicación
> apunta directamente al backend FastAPI `agent-modeler` (puerto
> `:8000` en dev). Este documento describe los endpoints que el
> frontend consume y los **tipos** que cruzan ambos lados.

## URL Base

```
http://localhost:8000/api    # development
https://<tu-backend>/api     # production
```

Configurado en el frontend con `NEXT_PUBLIC_API_URL`.

**Toda request lleva el cookie `modeler-auth`** (HttpOnly, SameSite=Lax,
firmado HS256). El cliente de frontend lo activa con `credentials:
'include'` en cada `fetch`.

---

## 1. Envelope de respuesta

Todos los endpoints CRUD (auth / projects / models / admin) usan el
envelope estándar:

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

`apiFetch` desempaqueta automáticamente: devuelve `data` si
`success === true`, lanza `ApiError(message, status)` en cualquier
otro caso.

**Excepción**: los endpoints del agente (`/api/conversations/*`,
`/api/health`, `/api/engines`) devuelven el body directo (no envuelto).
Por eso `agent.service.ts` usa un cliente especializado que arroja
`AgentClientError(status, detail, code)`.

Ver `web-data-model-hub/src/services/http.ts` y `agent.service.ts`.

---

## 2. Endpoints

### 2.1 Auth

| Método | Ruta | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/auth/login` | público | `{ username, password }` | `AuthUser` + Set-Cookie |
| POST | `/api/auth/logout` | público | — | `null` (limpia cookie) |
| GET  | `/api/auth/me` | cookie | — | `AuthUser` o 401 |

Respuesta de `login` (envelope abierto):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "username": "admin",
    "role": "admin",
    "isActive": true,
    "permissions": [],
    "createdAt": "2026-...",
    "statusUpdatedAt": "2026-...",
    "lastLoginAt": "2026-..."
  }
}
```

`AuthUser.permissions` es `Permission[]` con `{scope, projectId,
modelId?, level}`. El frontend lo guarda en `useAuthStore` y lo
expone como helpers (`canViewProject`, `canEditModel`, …).

### 2.2 Proyectos

| Método | Ruta | Auth | Body | Notas |
|--------|------|------|------|-------|
| GET | `/api/projects` | sesión | — | filtra por permisos del usuario |
| POST | `/api/projects` | **admin** | `{ name, description? }` | |
| GET | `/api/projects/{id}` | view sobre el proyecto | — | |
| PUT | `/api/projects/{id}` | edit sobre el proyecto | `{ name?, description? }` | |
| DELETE | `/api/projects/{id}` | **admin** | — | cascade soft-delete de modelos hijos |

Respuesta envuelta. Tipo del payload:

```typescript
interface Project {
  id: string;            // uuid
  name: string;
  description: string | null;
  createdAt: string;     // ISO 8601
  updatedAt: string;
}
```

### 2.3 Modelos

| Método | Ruta | Auth | Notas |
|--------|------|------|-------|
| GET | `/api/models?projectId=…&full=…` | sesión | `projectId` filtra por proyecto; `full=true` hidrata `tables/relationships/views`; default = stubs livianos |
| POST | `/api/models` | edit sobre el `projectId` | body `{ projectId, name, description?, engine?, tables?, relationships?, views?, domainCatalog? }` |
| GET | `/api/models/{id}` | view sobre el modelo | siempre hidratado |
| PUT | `/api/models/{id}` | edit sobre el modelo | partial update; las child arrays se reemplazan en bloque si están en el body |
| DELETE | `/api/models/{id}` | edit sobre el modelo | cascade soft-delete de child collections |

**Stub mode** (`full=false`):

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "name": "Sales DM",
  "engine": "postgresql",
  "tables": [{"id": "stub-0", "name": "", "columns": []}, ...],   // tantos stubs como tablas
  "relationships": [],
  "views": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

El frontend usa stubs en la pantalla de proyectos para mostrar el
conteo de tablas sin pagar la hidratación completa.

### 2.4 Conversaciones (chat con el agente IA)

| Método | Ruta | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/conversations` | sesión | `{ conversation_id, engine }` | `{ conversation_id, engine, created }` |
| DELETE | `/api/conversations/{id}` | sesión | — | `{ conversation_id, deleted }` |
| POST | `/api/conversations/{id}/guidelines` | sesión | multipart `file` | `{ status, conversation_id, file_name, file_format, file_size_bytes, preview }` |
| POST | `/api/conversations/{id}/model` | sesión | multipart `excel_file`, `engine?`, `context_text?` | `ModelingResponse` |
| GET | `/api/conversations/{id}/model` | sesión | — | último `ModelingResponse` (404 si todavía sin turno) |

> Estos endpoints **no usan envelope**. El cliente
> (`src/services/agent.service.ts`) parsea body crudo y arroja
> `AgentClientError` ante no-2xx.

### 2.5 Health / engines

| Método | Ruta | Auth | Response |
|--------|------|------|----------|
| GET | `/api/health` | público | `{ status, version, foundry_connected, default_engine, active_conversations }` |
| GET | `/api/engines` | público | `{ engines: string[], default: string }` |

---

## 3. Códigos de error comunes

| HTTP | Causa típica |
|------|--------------|
| 400 | `conversation_id` no es UUID v4, engine no soportado, body inválido |
| 401 | Cookie ausente, expirada o firmada con secret distinto. El frontend lo trata como logout. |
| 403 | Usuario autenticado pero sin permisos para el recurso (project/model). |
| 404 | Recurso no encontrado o conversación no creada todavía. |
| 422 | Pydantic rechazó el body (ej. archivo de guidelines vacío o formato no soportado). |
| 429 | Rate limit (Foundry o el limiter interno). El backend ya hace retry; si llega al cliente significa que se agotaron. |
| 500 | Error inesperado. Log para diagnóstico. |
| 503 | Foundry no conectado o `ConversationStore` no inicializado al arranque. |

---

## 4. Tipos compartidos (frontend ↔ backend)

Los modelos viven en `web-data-model-hub/src/types/` y se reflejan
exactamente en los Pydantic docs de
`agent-modeler/src/db/db_models.py`. Esta sincronía es manual; cualquier
cambio de schema **debe replicarse en ambos lados**.

### 4.1 `AuthUser` y permisos

```typescript
interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  permissions: Permission[];
  createdAt: string;
  statusUpdatedAt: string;
  lastLoginAt: string | null;
}

interface Permission {
  scope: 'project' | 'model';
  projectId: string;
  modelId?: string | null;     // solo cuando scope === 'model'
  level: 'view' | 'edit';
}

interface AuthJwtClaims {
  sub: string;        // userId
  username: string;
  role: AuthUser['role'];
  iat?: number;
  exp?: number;
}
```

### 4.2 `Project`

```typescript
interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 4.3 `DataModel`

```typescript
interface DataModel {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  engine: DatabaseEngine | null;
  domainCatalog: DomainDefinition[];
  tables: TableModel[];
  relationships: Relationship[];
  views: ViewModel[];
  createdAt: string;
  updatedAt: string;
}
```

### 4.4 `DatabaseEngine`

Conjunto de motores soportados por el backend (`SUPPORTED_ENGINES`)
**y** por el frontend (los DDL generators los respetan):

| Valor | Schema default | Particionamiento | Clustering |
|-------|----------------|------------------|------------|
| `databricks_sql` | `default` | `RANGE`, `LIST`, `BUCKET` | sí (Z-ORDER) |
| `cosmosdb` | — | — | — |
| `sqlserver` | `dbo` | `RANGE` | — |
| `postgresql` | `public` | `RANGE`, `LIST`, `HASH` | — |
| `mysql` | — | `RANGE`, `LIST`, `HASH`, `KEY` | — |

> Los motores `oracle` y otros que aparecían en la doc legacy fueron
> retirados — el set canonical lo dicta `settings.SUPPORTED_ENGINES`
> en el backend.

### 4.5 `TableModel` y `TableColumn`

```typescript
interface TableModel {
  id: string;                   // uuid
  schema?: string;              // default del engine si vacío
  name: string;
  logicalName?: string;
  columns: TableColumn[];
  functionalDefinition?: string;
  applicationCode?: string;
  domain?: string;
  subdomain?: string;
  domainId?: string;
  subdomainId?: string;
  tags?: string[];
  color?: string;
  partition?: PartitionSpec;
}

interface TableColumn {
  /**
   * Identificador estable que sobrevive a renames. Todas las
   * relaciones (Relationship.sourceColumn / targetColumn) y los
   * handles de React Flow se referencian por este id, NUNCA por
   * `name`. Asegura que renombrar una columna no invalide edges
   * ni FKs.
   */
  id: string;
  name: string;                 // physical name (SQL)
  logicalName?: string;
  dataType: string;             // canónico (integer, varchar, decimal) o dialect-specific con paréntesis
  length?: number;              // varchar(N) / decimal(N)
  scale?: number;               // decimal(N, M)
  isPrimaryKey?: boolean;
  isSurrogateKey?: boolean;
  isPartitionKey?: boolean;     // legacy — preferir TableModel.partition
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };  // por NOMBRE (lo que el usuario escribe)
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;
  observations?: string;        // notas del agente sobre la columna
}
```

### 4.6 `PartitionSpec`

```typescript
interface PartitionSpec {
  strategy: 'NONE' | 'RANGE' | 'LIST' | 'HASH' | 'BUCKET';
  columns: string[];            // por nombre — el orden importa
  buckets?: number;             // para HASH / BUCKET
  granularity?: 'DAY' | 'MONTH' | 'YEAR' | 'HOUR';
  clusteringColumns?: string[]; // solo Databricks (Z-ORDER)
}
```

### 4.7 `Relationship`

```typescript
interface Relationship {
  id: string;                   // uuid
  /** Acepta TableModel.id (preferido) o TableModel.name (legacy). */
  sourceTable: string;
  /**
   * Apunta a TableColumn.id (post-migration). Datos pre-migration
   * todavía pueden contener nombres; el frontend los resuelve con
   * fallback en src/lib/columnRef.ts::resolveColumnName.
   */
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}
```

### 4.8 `ViewModel`

```typescript
interface ViewModel {
  id: string;
  name: string;
  logicalName?: string;
  schema?: string;
  sourceTableId: string;
  viewType: 'technical' | 'user' | 'business';
  columns: ViewColumnTransform[];
  whereClause?: string;
  useCustomSql?: boolean;
  customSql?: string;
  functionalDefinition?: string;
  domain?: string;
  subdomain?: string;
  tags?: string[];
  color?: string;
}

interface ViewColumnTransform {
  sourceColumn: string;
  alias?: string;
  expression?: string;
  include?: boolean;
}
```

### 4.9 `DomainDefinition`

```typescript
interface DomainDefinition {
  id: string;
  name: string;
  code?: string;
  description?: string;
  color?: string;
  subdomains: SubdomainDefinition[];
  defaults?: { schema?: string; tags?: string[] };
}

interface SubdomainDefinition {
  id: string;
  name: string;
  code?: string;
  description?: string;
  defaults?: { schema?: string; tags?: string[] };
}
```

### 4.10 `ModelingResponse` (output del agente)

```typescript
interface ModelingResponse {
  conversation_id: string;
  engine: AgentEngine;
  turn_number: number;
  tables: AgentTable[];
  relationships: string[];                      // siempre [] hoy
  export_sql: string;
  export_markdown: string;
  qa_report: AgentQAReport;                     // todos vacíos hoy
  guidelines_applied: string;
  summary: string;
}

interface AgentTable {
  table_name: string;
  table_description: string;
  columns: AgentColumn[];
  ddl: string;
}

interface AgentColumn {
  column_name: string;
  data_type: string;
  nullable: boolean;
  is_pk: boolean;
  is_fk: boolean;
  fk_references: string | null;                 // "tabla.columna" o null
  functional_definition: string;
  observations: string;
}
```

`modelingResponseToCanvas` (en `src/lib/agent/mapping.ts`) convierte
esto a `TableModel[]` + `Relationship[]` listos para inyectar en
`useModelStore`. Asigna `id: uuidv4()` a cada `TableModel` y a cada
`TableColumn`, y resuelve `fk_references` a relaciones por `id`
mediante `findColumnId`.

---

## 5. Migración desde rutas API legacy

Si encuentras código que todavía llama a `/api/projects` desde el
frontend usando `fetch` directo (sin `services/`), está pegado a la
era pre-migration. La regla actual es:

```typescript
// ❌ legacy
const res = await fetch('/api/projects');
const json = await res.json();

// ✅ ahora
import { projectsService } from '@/services';
const projects = await projectsService.listProjects();
```

`projectsService` ya:
- Apunta a `NEXT_PUBLIC_API_URL` (cross-origin con FastAPI).
- Manda `credentials: 'include'`.
- Desempaqueta el envelope.
- Lanza `ApiError` ante problemas — el componente solo `try/catch`.
