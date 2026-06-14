# Referencia de API (consumida por el frontend)

> El frontend **no expone rutas API propias**. Toda la comunicación apunta al
> backend FastAPI `backend-data-model-hub` (`:8000` en dev), configurado con
> `NEXT_PUBLIC_API_URL`. Este documento describe los endpoints que el frontend
> consume y los **tipos** que cruzan ambos lados (espejados en
> `backend-data-model-hub/src/db/db_models.py`).

**Toda request lleva el cookie `modeler-auth`** (HttpOnly, SameSite=Lax,
HS256). El cliente lo activa con `credentials: 'include'`.

---

## 1. Envelope de respuesta

```typescript
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

`apiFetch` (en `src/services/http.ts`) desempaqueta: devuelve `data` si
`success === true`, lanza `ApiError(message, status)` en cualquier otro caso
(red caída, 4xx/5xx, envelope inválido).

---

## 2. Endpoints

### 2.1 Auth

| Método | Ruta | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/login` | público | `{ username, password }` | `AuthUser` + Set-Cookie |
| POST | `/api/auth/logout` | público | — | `null` (limpia cookie) |
| GET  | `/api/auth/me` | cookie | — | `AuthUser` o 401 |

### 2.2 Proyectos

| Método | Ruta | Auth | Body |
|---|---|---|---|
| GET | `/api/projects` | sesión | — (filtra por permisos) |
| POST | `/api/projects` | **admin** | `{ name, description?, engines?, layers?, domains? }` |
| GET | `/api/projects/{id}` | view | — |
| PUT | `/api/projects/{id}` | edit | `{ name?, description?, engines?, layers?, domains? }` |
| DELETE | `/api/projects/{id}` | **admin** | — (cascade al canvas) |

El payload es un `Project` (con `engines` / `layers` / `domains` embebidos).
`PUT` es la vía para editar la jerarquía (Modelos/niveles y Dominios) desde el
hub del proyecto.

### 2.3 Canvas (tablas + relaciones)

| Método | Ruta | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/projects/{id}/canvas` | view | — | `{ tables: Table[], relationships: Relationship[] }` |
| PUT | `/api/projects/{id}/canvas` | edit | `{ tables?, relationships? }` | canvas actualizado |
| PATCH | `/api/projects/{id}/positions` | edit | `{ tables: { [tableId]: {x,y} } }` | `{ updated: N }` |

- `PUT /canvas` **reemplaza en bloque** lo que llegue (tablas y/o relaciones).
  Exige al menos uno (400 si ambos faltan).
- El store **omite `position`** al guardar el canvas; las posiciones van solo por
  `PATCH /positions`. (El editor actual las trata como per-sesión.)

### 2.4 Admin de usuarios

| Método | Ruta | Auth |
|---|---|---|
| GET | `/api/admin/users` | admin |
| POST | `/api/admin/users` | admin |
| PUT | `/api/admin/users/{id}` | admin |
| DELETE | `/api/admin/users/{id}` | admin |

Body de create/update: `{ username, password?, role, isActive, permissions: Permission[] }`
(password obligatorio al crear, ≥6 chars; omitir para no cambiarlo al editar).

### 2.5 Excel-import

| Método | Ruta | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/excel-import/preview` | sesión | multipart `file` (.xlsx/.xlsm) | `ExcelPreview` |

> El **agente de IA** (modelado conversacional) está desacoplado en
> `app-agents-modeler` y no se documenta aquí; el botón "AI Agent" del editor
> avisa que se reconectará en una versión próxima.

---

## 3. Códigos de error comunes

| HTTP | Causa típica |
|---|---|
| 400 | body inválido (p. ej. `PUT /canvas` sin tablas ni relaciones) |
| 401 | cookie ausente/expirada/firmada con otro secret → tratado como logout |
| 403 | autenticado pero sin permiso sobre el proyecto |
| 404 | recurso no encontrado |
| 413 | Excel > 10 MB |
| 500 | error inesperado / DB no conectada |

---

## 4. Tipos compartidos (frontend ↔ backend)

Viven en `web-data-model-hub/src/types/` y se reflejan en
`backend-data-model-hub/src/db/db_models.py`. La sincronía es manual.

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
  projectId: string;       // unidad de acceso = el proyecto (un canvas por proyecto)
  level: 'view' | 'edit';
}
```

### 4.2 `DatabaseEngine`

```typescript
type DatabaseEngine = 'postgresql' | 'databricks_sql' | 'sqlserver' | 'mysql' | 'cosmosdb';
```

| Engine | Schema default | Particionamiento | Clustering |
|---|---|---|---|
| `postgresql` | `public` | RANGE · LIST · HASH | — |
| `databricks_sql` | `default` | RANGE · LIST · BUCKET | sí (Z-ORDER) |
| `sqlserver` | `dbo` | RANGE | — |
| `mysql` | `public` | RANGE · LIST · HASH | — |
| `cosmosdb` | `default` | — (NoSQL) | — |

### 4.3 `Project` y su jerarquía

```typescript
interface Project {
  id: string;
  name: string;
  description?: string;
  engines: DatabaseEngine[];
  layers: ModelLevel[];     // los "Modelos / niveles"
  domains: Domain[];        // verticales
  createdAt?: string;
  updatedAt?: string;
}

interface ModelLevel {
  id: string;     // slug, p. ej. "rdv"
  name: string;   // código, p. ej. "RDV"
  full?: string;  // "Raw Data Vault"
  color?: string;
  order: number;  // banda izquierda→derecha + adyacencia cross-layer
  engine?: DatabaseEngine;
  desc?: string;
}

type Sensitivity = 'Public' | 'Internal' | 'Confidential' | 'Restricted' | 'PII';

interface Domain {
  id: string;
  name: string;
  color?: string;
  owner?: string;
  steward?: string;
  sensitivity?: Sensitivity;
  description?: string;
  subdomains: string[];   // etiquetas libres
  layers: string[];       // ids de ModelLevel que atraviesa
}
```

### 4.4 `Table`, `TableColumn`, `View`

```typescript
interface Table {
  id: string;
  schema?: string;
  name: string;
  logicalName?: string;
  layer?: string;         // ModelLevel id
  domain?: string;        // Domain id
  subdomain?: string;
  color?: string;         // heredado del dominio
  functionalDefinition?: string;
  applicationCode?: string;
  columns: TableColumn[];
  views: View[];          // proyecciones SQL por rol (no van en el diagrama ER)
  tags?: Tag[];
  partition?: PartitionSpec;
  position?: NodePosition; // per-sesión
}

interface TableColumn {
  id: string;             // ESTABLE — sobrevive a renames; las relaciones apuntan a este id
  name: string;
  logicalName?: string;
  dataType: string;       // canónico (integer, varchar, decimal…) o dialect-specific
  length?: number;
  scale?: number;
  isPrimaryKey?: boolean;
  isSurrogateKey?: boolean;
  isPartitionKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;
  observations?: string;
}

interface View {
  id: string;
  name: string;
  type: 'business' | 'technical';
  role?: string;
  select: string;   // multilínea: una expresión por línea (CONCAT, sha256, CASE…)
  where: string;    // multilínea: condiciones unidas con AND
}
```

### 4.5 `Relationship`

```typescript
type Cardinality = '1:1' | '1:N' | 'N:N';

interface RelationshipEndpoint {
  table: string;    // Table.id
  column: string;   // TableColumn.id
}

interface Relationship {
  id: string;
  source: RelationshipEndpoint;
  target: RelationshipEndpoint;
  cardinality: Cardinality;
  crossLayer?: boolean;  // DERIVADO (source.layer ≠ target.layer) — no se persiste
  skip?: boolean;        // DERIVADO (|orderΔ| > 1) — no se persiste
}
```

### 4.6 `Canvas`

```typescript
interface Canvas {
  tables: Table[];
  relationships: Relationship[];
}
```

`canvasService.getCanvas(projectId)` devuelve este shape; `saveCanvas` lo envía
(sin `position`).

---

## 5. Regla de oro

Nunca llamar `fetch` directo a `/api/*` desde un componente. Usar siempre la capa
`services/`:

```typescript
// ✅
import { projectsService, canvasService } from '@/services';
const projects = await projectsService.listProjects();
const canvas = await canvasService.getCanvas(projectId);
```

`services/*` ya apunta a `NEXT_PUBLIC_API_URL`, manda `credentials: 'include'`,
desempaqueta el envelope y lanza `ApiError` ante problemas.
