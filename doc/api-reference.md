# Referencia de API consumida por el frontend — Data Model Hub (DMH)

Actualizado: 2026-09-08 (doc 75: proyectos independientes — `{pid}` en las rutas es `sessionProjectId()` para el Model y el `projectId` del selector en Standards/Reporting).

Este documento describe, a partir del código real, cómo el frontend (Vite + React + Zustand) del Data Model Hub consume la API del backend (FastAPI). Cubre el cliente HTTP compartido y, pantalla por pantalla / feature por feature, qué endpoints se llaman, con qué método, qué body envían y qué devuelven. Todos los ejemplos y firmas provienen de `src/services/*` y `src/features/*/services/*`.

---

## 1. Panorama general

El frontend habla con el backend siempre a través de un único cliente HTTP (`src/services/http.ts`). Ese cliente:

- Antepone la base URL `API_BASE` (`src/services/apiBase.ts`): vacía por defecto = mismo origen (en dev el proxy de Vite reenvía `/api` → `:8000`; en producción `server.mjs` sirve la SPA y proxya `/api` al backend).
- Adjunta el token de sesión como header **`X-Session-Token`** (NO `Authorization: Bearer` — ver §2.2).
- Adjunta el header `X-Dev-User` SOLO en desarrollo (`vite dev`), como fallback del seam local.
- Desempaqueta el envelope estándar `{ success, data, error }` y devuelve directamente `data`.
- Convierte cualquier fallo (red, timeout, 4xx/5xx, envelope inválido) en un `ApiError` tipado.

Encima de esa capa, cada feature tiene su propio "service" que solo aporta tipos y arma las URLs. Ningún componente inspecciona `json.success` a mano: todo pasa por los helpers `apiGet` / `apiPost` / `apiPut` / `apiDelete` / `apiFetch`.

```mermaid
flowchart TD
  UI[Componentes React por pantalla] --> SVC[Services de feature]
  SVC --> HTTP[http.ts apiGet apiPost apiPut apiDelete]
  HTTP --> ENV[Desempaqueta envelope success data error]
  ENV --> PRX[Mismo origen: proxy Vite en dev / server.mjs en prod]
  PRX --> API[Backend FastAPI /api/...]
  API --> DB[(Databricks Lakebase Postgres)]
  HTTP -. lanza .-> ERR[ApiError status message]
  ERR --> UI
```

El módulo **DDL** (`src/features/ddl`) genera el SQL base en el cliente a partir del modelo ya cargado; solo llama a la API cuando el usuario selecciona reglas de export en el modal: `rulesBridge.ts` → `POST /api/projects/{pid}/ddl-rules/render` (ver §3.5.3).

---

## 2. Cliente HTTP (`src/services/http.ts`)

### 2.1. Base URL (`src/services/apiBase.ts`)

Todos los services importan la base ÚNICA (homologación 2026-07-19):

```ts
export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';
```

- **Vacía = mismo origen, el caso NORMAL en dev Y en producción**: en dev, el proxy de `vite.config.ts` reenvía `/api` → `http://localhost:8000`; en producción (doc 36), `server.mjs` sirve la SPA y proxya `/api` al backend servidor-a-servidor. Por eso `VITE_API_URL` NO se define en el build de Databricks Apps: definirla reactivaría el cruce navegador→backend y su doble muro SSO.
- `VITE_API_URL` queda solo para apuntar el front a otro backend en local (por ejemplo, probar contra el desplegado).

### 2.2. Estado de sesión en memoria

`http.ts` guarda tres piezas de estado a nivel de módulo, que otras capas empujan:

| Variable | Setter público | Uso |
|---|---|---|
| `_token` | `setAuthToken(t)` | Se envía como header **`X-Session-Token`** en TODA llamada. |
| `_devUser` | `setDevUser(u)` | Fallback del seam local; se envía como `X-Dev-User` SOLO en desarrollo (`import.meta.env.DEV`). |
| `_onUnauthorized` | `setOnUnauthorized(cb)` | Callback global que se dispara ante un 401 (cerrar sesión + ir a `/login`). |

Por qué `X-Session-Token` y no `Authorization: Bearer`: en Databricks Apps el header `Authorization` le pertenece al proxy SSO de la plataforma — lo consume para su propia autenticación y el backend nunca lo recibe (visto 2026-07-20: 401 con el Bearer en vuelo). Además, en producción `server.mjs` DESCARTA el `Authorization` entrante del cliente y pone SIEMPRE su propio Bearer M2M del service principal (conservando `X-Session-Token`). El backend acepta ambos headers: `Authorization` sigue sirviendo para `curl`/dev directo.

El `X-Dev-User` dejó de viajar en producción a propósito: la identidad es el token (`REQUIRE_AUTH`) y mandarlo solo hacía que el preflight CORS lo rechazara ("Disallowed CORS headers" → "Failed to fetch" en el login de Apps).

El token vive en `localStorage` bajo la clave `dmh.token` y lo administra el store de auth (ver §2.7). El cliente HTTP en sí solo conoce el valor en memoria; no lee `localStorage` directamente (salvo el export CSV del reporting, que sí lo hace de forma puntual).

### 2.3. `ApiError`

Error tipado que propagan todos los helpers. Lleva el `status` HTTP (o `0` para fallos de red / timeout):

```ts
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
```

Los consumidores hacen `try/catch (ApiError)` y deciden si muestran un toast, redirigen o reintentan.

### 2.4. `apiFetch<T>()` — el corazón del cliente

```ts
export async function apiFetch<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts;

  // Combina el signal del caller (cleanup de useEffect) con el timeout global.
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS); // 30_000 ms
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const init: RequestInit = {
    method,
    signal: combined,
    credentials: 'include',
    headers: {
      ...(_token ? { 'X-Session-Token': _token } : {}),
      ...(import.meta.env.DEV && _devUser ? { 'X-Dev-User': _devUser } : {}),
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
  }
  // ... fetch, 401, parse de envelope ...
}
```

Detalles importantes del comportamiento:

- **Timeout global de 30 s** (`DEFAULT_TIMEOUT_MS`). Sin él, un backend colgado dejaría spinners eternos, porque `fetch` no tiene timeout propio. Si el caller pasa su propio `signal` (por ejemplo, el cleanup de un `useEffect`), ambos se combinan con `AbortSignal.any`.
- **`credentials: 'include'`**: en producción todo es mismo origen, pero cuando el front local apunta a un backend remoto (`VITE_API_URL` definida) el proxy SSO de Databricks Apps exige su cookie de sesión en requests cross-app; sin esto el navegador no la enviaría/aceptaría.
- **`Content-Type: application/json`** se agrega automáticamente solo cuando hay body.
- **Manejo del 401**: si la respuesta es `401` y hay `_onUnauthorized` registrado, se invoca (logout global). Igual se lanza `ApiError` para que el caller no siga con datos vacíos.

### 2.5. Manejo del envelope y de errores

```ts
if (!json || typeof json.success !== 'boolean') {
  // FastAPI HTTPException responde `{detail}` (sin envelope): propaga el
  // mensaje real (p.ej. 409 "versión ya no está en borrador").
  const detail = (json as { detail?: unknown } | null)?.detail;
  if (!response.ok && typeof detail === 'string' && detail) {
    throw new ApiError(detail, response.status);
  }
  throw new ApiError(`Unexpected response shape (HTTP ${response.status})`, response.status);
}

if (!json.success) {
  throw new ApiError(json.error ?? `Request failed (HTTP ${response.status})`, response.status);
}

return json.data as T;
```

Reglas de decodificación:

1. Respuesta con envelope válido y `success: true` → devuelve `json.data` (ya tipado como `T`).
2. Respuesta con envelope válido y `success: false` → lanza `ApiError(json.error, status)`.
3. Respuesta SIN envelope pero con `{ detail }` (típico `HTTPException` de FastAPI) → lanza `ApiError(detail, status)` para no perder el mensaje real (por ejemplo, un `409` con motivo).
4. JSON inválido → `ApiError("Invalid JSON response (HTTP ...)")`.
5. Red caída / DNS / abort / timeout → `ApiError(..., 0)`. Si fue el timeout, el mensaje es explícito: "The server didn't respond within 30s — try again in a moment." (la UI está en inglés).

El tipo del envelope está en `src/types/api.ts`:

```ts
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### 2.6. Helpers de conveniencia

```ts
export function apiGet<T>(url, opts)         // GET
export function apiPost<T>(url, body, opts)  // POST
export function apiPut<T>(url, body, opts)   // PUT
export function apiDelete<T>(url, opts)      // DELETE
// apiFetch acepta method arbitrario, incluido PATCH
```

`apiFetch` se usa directamente cuando hace falta `PATCH` (por ejemplo, mover/renombrar carpetas).

`http.ts` exporta además dos helpers de error para los consumidores:

```ts
/** Mensaje legible de un error de API: el `detail` del backend si vino
 *  (ApiError lo conserva como `message`), o `fallback`. */
export function apiErrorMessage(e: unknown, fallback: string): string;

/** ¿Es un 409 de negocio del backend (p.ej. nombre duplicado)? */
export function isConflictError(e: unknown): boolean;
```

### 2.7. Ciclo de vida del token (auth store)

El token se administra en `src/store/useAuthStore.ts`, que actúa como fuente de verdad de la sesión y empuja el valor al cliente HTTP:

```ts
const TOKEN_KEY = 'dmh.token';

login: async (username, password) => {
  const { token, user } = await auth.login(username.trim(), password);
  // Defensa en profundidad: si la sesión anterior murió sin logout, el nuevo
  // actor arranca SIN estado heredado.
  resetAppState();
  localStorage.setItem(TOKEN_KEY, token);
  setAuthToken(token);       // ← empuja a http.ts (X-Session-Token)
  mirror(user);              // espeja el actor a useSessionStore (X-Dev-User en dev)
  set({ user, status: 'authed', error: null });
},

logout: async () => {
  try { await auth.logout(); } catch { /* best-effort */ }
  localStorage.removeItem(TOKEN_KEY);
  setAuthToken('');
  resetAppState();           // el logout es navegación SPA: sin esto los stores
  set({ user: null, status: 'anon' });   // singleton heredarían el canvas
},

restore: async () => {           // al arrancar la app
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { set({ status: 'anon', user: null }); return; }
  setAuthToken(token);
  const user = await auth.fetchMe();
  // /me degrada al Principal básico si el actor no está registrado; sin
  // `permissions` no es una sesión válida de la auth propia.
},
```

Y el 401 global queda cableado una sola vez:

```ts
setOnUnauthorized(() => {
  if (useAuthStore.getState().status === 'authed') {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    resetAppState();
    useAuthStore.setState({ status: 'anon', user: null });
  }
});
```

```mermaid
sequenceDiagram
  participant U as Usuario
  participant S as useAuthStore
  participant H as http.ts
  participant B as Backend

  U->>S: login(username, password)
  S->>H: apiPost /api/auth/login
  H->>B: POST con body {username, password}
  B-->>H: {success, data: {token, user}}
  H-->>S: {token, user}
  S->>S: localStorage dmh.token = token
  S->>H: setAuthToken(token)
  Note over H: Toda llamada futura lleva X-Session-Token
  U->>S: (navega) getSummary()
  S->>H: apiGet /api/summary
  H->>B: GET con X-Session-Token
  B-->>H: {success, data}
  alt 401
    B-->>H: 401
    H->>S: onUnauthorized() logout + /login
  end
```

---

## 3. Endpoints por pantalla / feature

A continuación, el detalle por área funcional. En todas las tablas, la ruta es relativa a `API_BASE` (vacía = mismo origen) y la respuesta ya viene desempaquetada (sin el envelope).

### 3.1. Autenticación e identidad

**Services:** `src/features/auth/auth.service.ts` y `src/services/warmup.ts`. (El `identity.service` / `GET /api/me` se retiró en el doc 75 D14: la identidad autoritativa es `GET /api/auth/me`.)

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `ssoLogin()` | POST | `/api/auth/sso/login` | — (identidad en headers de relay del server, doc 38) | `{ token, user: SessionUser }` |
| `login(username, password)` | POST | `/api/auth/login` | `{ username, password }` | `{ token, user: SessionUser }` |
| `logout()` | POST | `/api/auth/logout` | — | `{ ok: boolean }` |
| `fetchMe()` | GET | `/api/auth/me` | — | `SessionUser` |
| `ensureBackendSession()` | GET | `/api/health` (probe) + `/api/auth/warmup/{next_b64}` (navegación) | — | — |

`ssoLogin()` es el carril principal (doc 38): el botón "Continue with Databricks" hereda la identidad del SSO de la plataforma — el server del front la releva en headers `x-dmh-sso-*` con secreto compartido — y entra solo si el correo está asignado a un rol en Admin (403 con mensaje accionable si no). `login()` queda como carril del administrador (la UI pide solo la contraseña de la cuenta `admin`). Ambos emiten el mismo token y comparten el pipeline del store (`enterSession`: resetAppState → localStorage → mirror). El login por contraseña está rate-limited en el backend (`5/minute` por IP; el SSO a `10/minute`). `SessionUser` incluye el rol, `projectIds`, `initials` y el mapa de permisos efectivos:

```ts
/** Permisos de la matriz (1:1 con el backend `PERMISSIONS`). */
export type Permission =
  | 'model.view' | 'model.edit' | 'review.decide' | 'publish'
  | 'rollback' | 'export' | 'standards.edit' | 'admin.manage';

export interface SessionUser {
  username: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  roleName?: string | null;
  projectIds: string[];
  status?: string | null;
  initials?: string | null;
  permissions: Record<string, boolean>;   // 'model.view', 'model.edit', ...
  accessLevel?: 'full' | 'edit' | 'read' | null;
}
```

**Warm-up SSO (`warmup.ts`, doc 36)** — solo aplica cuando el front local apunta a un backend remoto de Databricks Apps (`API_BASE` no vacía): cada app vive detrás de su propio muro SSO por subdominio y un `fetch()` no puede completar ese SSO (redirect cross-origin). `ensureBackendSession()` hace un probe con `fetch` crudo a `GET /api/health`; si el fetch es rechazado, navega top-level (una sola vez, guard en `sessionStorage`) a `GET /api/auth/warmup/{next_b64}` — la URL de retorno viaja EN EL PATH como base64url sin padding, no como query string (el replay post-SSO del proxy de Databricks se atora con query strings). **Con `API_BASE` vacía (mismo origen, la producción actual) la función es inerte**: retorna sin hacer nada. La invoca `LoginScreen.tsx`.

Equivalente en `curl` (backend directo; acepta `X-Session-Token` o `Authorization: Bearer`):

```bash
curl -X POST "$BACKEND/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cperez","password":"secreto"}'
# → {"success":true,"data":{"token":"eyJ...","user":{...}}}

curl "$BACKEND/api/auth/me" \
  -H "X-Session-Token: eyJ..."
# → {"success":true,"data":{"username":"cperez","permissions":{...}}}
```

### 3.2. Home / Dashboard (Screen 0)

Dos services alimentan el Home: los contadores (`dashboard.service`) y las versiones/solicitudes (`versioning.service`).

**Service:** `src/services/dashboard.service.ts`

| Función | Método | Ruta | Respuesta |
|---|---|---|---|
| `getSummary(projectIds?)` | GET | `/api/summary?projectId=...` | `DashboardSummary` |

`getSummary` acepta una lista de proyectos y los concatena como parámetros repetidos; sin proyectos, devuelve totales globales:

```ts
export function getSummary(projectIds?: string[]): Promise<DashboardSummary> {
  const ids = (projectIds ?? []).filter(Boolean);
  const qs = ids.length
    ? `?${ids.map((id) => `projectId=${encodeURIComponent(id)}`).join('&')}`
    : '';
  return apiGet<DashboardSummary>(`${API_BASE}/api/summary${qs}`);
}
```

```ts
export interface DashboardSummary {
  tables: number;
  views: number;
  relationships: number;
  subjectAreas: number;
  projects: number;
}
```

Ejemplo:

```bash
curl "$BACKEND/api/summary?projectId=p1&projectId=p2" -H "X-Session-Token: eyJ..."
# → {"success":true,"data":{"tables":812,"views":34,"relationships":455,"subjectAreas":21,"projects":2}}
```

**Service:** `src/services/versioning.service.ts` (comparte backend con los changesets)

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listVersions(projectId?)` | GET | `/api/versions[?projectId=]` | — | `VersionRow[]` (cada fila con `projectId` y `deletesProject`) |
| `getPublished(projectId)` | GET | `/api/projects/{pid}/versions/published` | — | `VersionRow \| null` (producción DEL proyecto) |
| `compareVersions(fromId, toId)` | GET | `/api/versions/compare?fromId=&toId=` | — | `VersionCompare` (doc 65; mismo proyecto) |
| `compareVersionDetails(fromId, toId, items)` | POST | `/api/versions/compare/details` | `{ fromId, toId, items }` | detalle antes→después |
| `listRequests({reviewer, owner})` | GET | `/api/requests?reviewer=&owner=` | — | `VersionRow[]` |
| `snapshot(body)` | POST | `/api/changesets/snapshot` | `SnapshotBody` (`projectId` obligatorio) | `VersionRow` |
| `listUsers(can?)` | GET | `/api/users?can=` | — | `SimUserDto[]` |
| `submit(id, body)` | POST | `/api/changesets/{id}/submit` | `SubmitBody` | `VersionRow` |
| `getChangeset(id)` | GET | `/api/changesets/{id}` | — | `ChangesetDetail` |
| `getDiff(id)` | GET | `/api/changesets/{id}/diff` | — | `ChangesetDiff` |
| `getDiffDetails(id, items)` | POST | `/api/changesets/{id}/diff/details` | `{ items: {collection, entityId}[] }` | `{ items: DiffEntityDetail[] }` |
| `review(id, body)` | POST | `/api/changesets/{id}/review` | `ReviewBody` | `ChangesetDetail` |
| `addComment(id, {text})` | POST | `/api/changesets/{id}/comments` | `{ text }` | `ChangesetDetail` |
| `withdraw(id)` | POST | `/api/changesets/{id}/withdraw` | — | `ChangesetDetail` |
| `reopen(id)` | POST | `/api/changesets/{id}/reopen` | — | `ChangesetDetail` |
| `rollbackVersion(id)` | POST | `/api/changesets/{id}/rollback` | `{}` | `VersionRow` |

Notas por endpoint:

- `listUsers(can)`: con `can` (p.ej. `'review.decide'`) devuelve solo los usuarios cuyo ROL otorga ese permiso — el selector de revisores lo usa para no ofrecer gente que nunca podría aprobar.
- **Presentación de cambios (doc 31)**: la card "Changes summary" se arma con `summarizeDiff(diff)` — helper PURO del service, cero backend, que agrega el `GET /diff` ya cargado en conteos verde/ámbar/rojo por colección más proyectos/modelos afectados. El popup "Change details" usa `getDiffDetails()` (`POST /diff/details`, read-only): diff de campos ANTES→DESPUÉS de entidades puntuales, bajo demanda por selección y con tope de 200 ítems por llamada (el modal trocea). El `before` es la imagen estampada si la versión ya se aplicó, o el publicado vivo si está en revisión.
- `review()` propaga el `detail` real del backend en los 403 (distingue "sin permiso `review.decide`" de "no asignado como revisor"), con fallback legible:

```ts
export async function review(id: string, body: ReviewBody): Promise<ChangesetDetail> {
  try {
    return await apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/review`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      throw new ApiError(err.message || 'You are not assigned as a reviewer of this change.', 403);
    }
    throw err;
  }
}
```

- `rollbackVersion()` (permiso propio `rollback`, doc 27): el backend crea un DRAFT con los cambios INVERSOS que restaura la base a esa versión (deshaciendo las posteriores). Producción no cambia hasta que ese draft pase submit → review → approve.

Bodies relevantes (de `src/types/versioning.ts`):

```ts
export interface SnapshotBody {
  projectId: string;            // doc 75: la working copy es de UN proyecto
  title?: string; description?: string; versionLabel?: string;
}
export interface SubmitBody {
  title?: string; description?: string; reviewers?: string[];
}
```

Máquina de estados de una versión / changeset (los endpoints que la mueven):

```mermaid
stateDiagram-v2
  [*] --> draft: snapshot / createChangeset
  draft --> submitted: submit
  submitted --> approved: review approve
  submitted --> rejected: review reject
  submitted --> draft: withdraw
  rejected --> draft: reopen
  approved --> [*]: applied a produccion
```

El `rollback` de una versión aplicada no altera esta máquina: crea un draft NUEVO (inverso) que recorre el mismo ciclo.

### 3.3. Model (Modeler): Project → Folders → Canvas

El editor de modelo se apoya en varios services complementarios: `modeler.service` (endpoints directos de estructura + armado del diagrama), `structure.service` (envoltorio changeset-aware de esa estructura — desde el doc 16 projects/folders/subject_areas son VERSIONADOS), `governance.service` + `changeset.service` (catálogo canónico y relaciones), `schemas.service` (esquemas como entidad), `views.service` (vistas versionadas) y `explorer.service` (Database Explorer draft-aware).

#### 3.3.1. Estructura: proyectos, carpetas y canvas (`modeler.service.ts` + `structure.service.ts`)

**La estructura es VERSIONADA** (fix del leak crítico 2026-07-16, doc 16: crear un proyecto o canvas en un draft escribía directo a producción). La UI llama a `structure.service.ts`, que espeja la regla de `rec()` de governance:

- ESCRITURAS con sesión de edición (`openMode='editing'` + changeset activo) → se REGISTRAN en el changeset (`csvc.recordChange`) con el payload SIEMPRE como doc COMPLETO (el overlay de lectura REEMPLAZA el doc publicado, no mergea) y publican recién en el approve.
- LECTURAS con changeset activo (edición O readonly de un request) → estado efectivo (`csvc.effective` de `projects` / `folders` / `subject_areas`), para que el dueño Y los revisores vean la estructura draft.
- Sin changeset (producción) → los endpoints directos de `modeler.service.ts` que siguen.

**Proyectos** (`projects.service.ts` para crear/listar; el ciclo de vida por draft en `structure.service.ts`, doc 75 D5)

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listProjects()` | GET | `/api/projects` | — | `Project[]` |
| `createProject(data)` | POST | `/api/projects` | `CreateProjectRequest = { name, description?, copyFrom?: { projectId, blocks[] } }` | `Project` (nace con estándares vacíos o copiados + `v1`; timeout largo + overlay) |
| `getProjectCounts(id)` | GET | `/api/projects/{id}/counts` | — | `ScopeCounts` (diálogo «Delete project…») |
| `structure.renameProject(id, name)` | PUT (changeset) | `/api/changesets/{cs}/changes` | upsert `projects/{id}` | `Project` — sólo por draft |
| `structure.deleteProject(id)` | PUT (changeset) | `/api/changesets/{cs}/changes` | delete `projects/{id}` | — (un solo cambio; «Deletion pending») |
| `structure.reviveProject(id, published)` / `projectDeletionPending(id)` | PUT / GET (changeset) | `/api/changesets/{cs}/changes` · `/effective/projects` | — | deshace el borrado / detecta el pending |

No existen `PUT/DELETE /api/projects/{id}` directos: renombrar, describir y borrar un proyecto van SIEMPRE por un draft del propio proyecto y se aplican al aprobar (el borrado con aviso crítico al revisor).

**Carpetas** (jerarquía anidada del Model Explorer, vía `parentFolderId`)

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listFolders(projectId)` | GET | `/api/projects/{projectId}/folders` | — | `Folder[]` |
| `createFolder(projectId, parentFolderId, name, order)` | POST | `/api/folders` | `{ projectId, parentFolderId, name, order }` | `Folder` |
| `renameFolder(id, name)` | PATCH | `/api/folders/{id}` | `{ name }` | `Folder` |
| `moveFolder(id, parentFolderId)` | PATCH | `/api/folders/{id}` | `{ parentFolderId }` | `Folder` |
| `deleteFolder(id)` | DELETE | `/api/folders/{id}` | — | `{ deleted: boolean }` |

`renameFolder` / `moveFolder` usan `apiFetch` directamente porque necesitan `PATCH`:

```ts
export const renameFolder = (id: string, name: string) =>
  apiFetch<Folder>(`${API_BASE}/api/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } });
```

**Canvas (subject-areas)** — un canvas = una subject area = un diagrama ER

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listSubjectAreas(projectId, folderId?)` | GET | `/api/projects/{projectId}/subject-areas?folderId=` | — | `SubjectArea[]` |
| `createSubjectArea(projectId, name, folderId)` | POST | `/api/subject-areas` | `{ projectId, name, folderId }` | `SubjectArea` |
| `updateSubjectArea(id, body)` | PUT | `/api/subject-areas/{id}` | `{ projectId, name, folderId? }` | `SubjectArea` |
| `deleteSubjectArea(id)` | DELETE | `/api/subject-areas/{id}` | — | `{ deleted: boolean }` |
| `getSubjectArea(saId)` | GET | `/api/subject-areas/{saId}` | — | `SubjectArea` |
| `setSubjectAreaTables(saId, tableIds)` | PUT | `/api/subject-areas/{saId}/tables` | `{ tableIds }` | `SubjectArea` |
| `setSubjectAreaLayout(saId, layout)` | PUT | `/api/subject-areas/{saId}/layout` | `{ layout }` | `SubjectArea` |
| `setSubjectAreaDrawings(saId, drawings)` | PUT | `/api/subject-areas/{saId}/drawings` | `{ drawings }` | `SubjectArea` |
| `setSubjectAreaUdp(saId, udpValues)` | PUT | `/api/subject-areas/{saId}/udp` | `{ udpValues }` | `SubjectArea` |
| `loadDiagram(saId)` | GET | `/api/subject-areas/{saId}/diagram?changesetId=` | — | `Diagram` |

Con changeset activo, `structure.service` reemplaza cada escritura de esta tabla por un `recordChange` sobre el doc efectivo completo (por ejemplo, `setSubjectAreaLayout` replica server-side el merge del PUT directo, y `removeTableFromCanvas` quita la tabla de `tableIds` Y de `layout` en un solo upsert, para no dejar nodos fantasma).

`loadDiagram` es la llamada clave de apertura de un canvas: en UNA sola request el backend arma tablas + columnas + relaciones + vistas aplicando el overlay del changeset activo del lado servidor. El `changesetId` sale del store:

```ts
export async function loadDiagram(saId: string): Promise<Diagram> {
  const cs = useSessionStore.getState().activeChangesetId;
  const qs = cs ? `?changesetId=${encodeURIComponent(cs)}` : '';
  return apiGet<Diagram>(`${API_BASE}/api/subject-areas/${encodeURIComponent(saId)}/diagram${qs}`);
}
```

```ts
export interface Diagram {
  subjectArea: SubjectArea;
  tables: CanonicalTable[];
  columns: CanonicalColumn[];
  relationships: Relationship[];
  /** Vistas showOnCanvas con ≥1 fuente en este canvas (las filtra el backend). */
  views: View[];
}
```

#### 3.3.2. Catálogo, relaciones y escrituras versionadas (`governance.service.ts` + `changeset.service.ts`)

La governance es "consciente del changeset activo": si hay un changeset activo, LEE del estado efectivo (`/effective`) y ESCRIBE al changeset (`/changes`); sin changeset activo, LEE lo publicado y la UI queda de solo lectura. Ambos servicios viven en `src/services/` (doc 75 D14: `features/governance/` se eliminó) y arman las rutas de proyecto con `sessionProjectId()` (`/api/projects/{pid}/…`); si no hay proyecto en sesión, las funciones rechazan.

**Lecturas de catálogo (publicado, sin changeset)**

| Función | Método | Ruta | Respuesta |
|---|---|---|---|
| `listTables()` (sin changeset) | GET | `/api/projects/{pid}/catalog/tables` | `CanonicalTable[]` |
| `searchTables(q, limit)` (sin changeset) | GET | `/api/projects/{pid}/catalog/tables?q=&limit=` | `CanonicalTable[]` |
| `listColumns(tableId)` (sin changeset) | GET | `/api/catalog/tables/{tableId}/columns` | `CanonicalColumn[]` |
| `listRelationships(tableId?)` (sin changeset) | GET | `/api/relationships?tableId=` | `Relationship[]` |
| `listDomains()` | GET | `/api/projects/{pid}/domains` | `ParentDomain[]` (solo lectura para el dropdown) |
| `physicalize(logical, scope?)` | POST | `/api/projects/{pid}/glossary/physicalize` | `{ physical }` |
| `searchModel(q, opts)` | GET | `/api/projects/{pid}/catalog/search?q=&limit=&offset=&scope=&folderId=&canvasId=&changesetId=` | hits de tablas/columnas/definiciones (⌘K, doc 70 §11) |

**Lecturas globales overlay-aware** (pasan `changesetId` como query param cuando hay changeset activo, en vez de ir por `/effective`; el backend resuelve nombres server-side):

| Función | Método | Ruta | Respuesta |
|---|---|---|---|
| `tableUsage(tableId)` | GET | `/api/catalog/tables/{tableId}/usage?changesetId=` | `{ usage: TableUsageRow[], total }` — canvases que referencian la tabla, con carpeta y proyecto |
| `tableLinks(tableId)` | GET | `/api/relationships/links?tableId=&changesetId=` | `{ links: TableLinkRow[], total }` — relaciones GLOBALES de la tabla con los canvases donde son visibles (Properties · Links, doc 26) |
| `columnImpact(columnId)` | GET | `/api/relationships/impact?columnId=&changesetId=` | `RelationshipImpact` — relaciones donde la columna es extremo; alimenta el warning del delete |

La búsqueda de tablas es server-side por escala (a 15k tablas no se baja la colección completa):

```ts
export const searchTables = (q: string, limit = 50) => {
  const a = active();
  if (a) return csvc.effective<CanonicalTable>(a, 'canonical_tables', { q: q || undefined, limit });
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  return apiGet<CanonicalTable[]>(`${CATALOG}/tables?${params.toString()}`);
};
```

**Lecturas con changeset activo (estado efectivo)** — `changeset.service.effective`

```ts
export const effective = <T>(
  id: string,
  collection: string,
  opts?: { tableId?: string; ids?: string[]; q?: string; limit?: number; schema?: string },
) => {
  const params = new URLSearchParams();
  if (opts?.tableId) params.set('tableId', opts.tableId);
  if (opts?.ids?.length) params.set('ids', opts.ids.join(','));
  if (opts?.q) params.set('q', opts.q);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.schema) params.set('schema', opts.schema);
  const qs = params.toString();
  return apiGet<T[]>(`${CS}/${encodeURIComponent(id)}/effective/${collection}${qs ? `?${qs}` : ''}`);
};
```

Ruta: `GET /api/changesets/{id}/effective/{collection}?tableId=&ids=&q=&limit=&schema=`. Las colecciones que consulta la UI son `canonical_tables`, `canonical_columns`, `relationships`, `views`, `schemas`, `projects`, `folders` y `subject_areas`. Los filtros son obligatorios en la práctica para no mover colecciones enteras (por ejemplo, `canonical_columns` puede tener cientos de miles de docs); `schema` acota a un esquema (Database Explorer draft-aware, doc 25).

**Escrituras (siempre al changeset)** — todas pasan por el guard único `governance.service.writableCs()`, que:

1. Bloquea si el modo de apertura es `readonly`.
2. Exige un changeset activo (y devuelve su id).

Sobre ese guard hay dos caminos: `rec()` (un cambio → `changeset.service.recordChange`) y `recordChangesBulk()` (un LOTE de cambios → `changeset.service.recordChangesBulk`, doc 39 — cascadas de borrar tabla / crear tabla desde fuentes en una sola llamada; los ítems se arman con los builders de `governance.service.bulk` para que los nombres de colecciones versionadas no salgan de los services).

```ts
const writableCs = (): string => {
  if (useSessionStore.getState().openMode === 'readonly')
    throw new Error('The model is open read-only: it does not accept changes.');
  const a = active();
  if (!a) throw new Error('An active changeset is required to edit.');
  return a;
};
const rec = (collection, id, op, payload?) => csvc.recordChange(writableCs(), collection, id, op, payload);
export const recordChangesBulk = (changes: BulkChange[]) => csvc.recordChangesBulk(writableCs(), changes);
```

```ts
export const recordChange = (id, collection, entityId, op: 'upsert' | 'delete', payload?) =>
  apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes`, { collection, entityId, op, payload });
// Lote: tandas de 1000 SECUENCIALES contra PUT /changes/bulk; lote vacío = cero requests.
export const recordChangesBulk = async (id, changes: BulkChange[], chunkSize = 1000) => { /* doc 39 */ };
```

Operaciones de modelo mapeadas a `PUT /api/changesets/{id}/changes`:

| Operación de UI | `collection` | `op` |
|---|---|---|
| `createTable(t)` | `canonical_tables` | `upsert` |
| `deleteTable(id)` — soft-delete versionado; el cascade (columnas/relaciones/vistas/membresías) lo orquesta el store, doc 23; desde doc 39 vistas+relaciones+columnas viajan EN LOTE (`recordChangesBulk`) y la tabla cierra la cascada | `canonical_tables` | `delete` |
| `createColumn(c)` / `updateColumn(c)` | `canonical_columns` | `upsert` |
| `deleteColumn(id)` | `canonical_columns` | `delete` |
| `markForeignKey(col, identifying, pkPosition?)` | `canonical_columns` | `upsert` |
| `markPrimaryKey(col, pkPosition?)` — el extremo padre de un wire se vuelve PK, doc 19 | `canonical_columns` | `upsert` |
| `createRelationship(r)` / `updateRelationship(r)` | `relationships` | `upsert` |
| `deleteRelationship(id)` | `relationships` | `delete` |

El backend valida en `add_change` el límite de longitud del nombre físico por scope (`maxLength` de `naming_config`, doc 24): crear/renombrar por encima del límite responde 400 (`NameTooLongError`) y la UI lo muestra como popup inline.

**Ciclo de vida del changeset** (`changeset.service.ts`):

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listChangesets()` | GET | `/api/changesets` | — | `Changeset[]` |
| `getChangeset(id)` | GET | `/api/changesets/{id}` | — | `Changeset` |
| `createChangeset(title)` | POST | `/api/changesets` | `{ title }` | `Changeset` |
| `recordChange(...)` | PUT | `/api/changesets/{id}/changes` | `{ collection, entityId, op, payload }` | `Changeset` |
| `recordChangesBulk(id, changes)` (doc 39) | PUT | `/api/changesets/{id}/changes/bulk` | `{ changes: BulkChange[] }` (tandas de 1000) | `Changeset` |
| `submitChangeset(id)` | POST | `/api/changesets/{id}/submit` | — | `Changeset` |
| `approveChangeset(id)` (legacy) | POST | `/api/changesets/{id}/approve` | — | `Changeset` |
| `rejectChangeset(id, note?)` (legacy) | POST | `/api/changesets/{id}/reject` | `{ note }` | `Changeset` |

`approve`/`reject` son el par legacy de la M-series; el flujo actual de Review usa `POST /{id}/review` (veredicto por revisor asignado) de `versioning.service` (§3.2).

Los cambios crudos NUNCA viajan al cliente: viven en la colección `changeset_changes` del backend (un documento por cambio) y se consumen únicamente vía `/effective` y `/diff`.

```mermaid
sequenceDiagram
  participant C as Canvas UI
  participant G as governance.service
  participant K as changeset.service
  participant B as Backend

  Note over C,B: Abrir canvas con changeset activo
  C->>G: loadDiagram(saId)
  G->>B: GET /api/subject-areas/{saId}/diagram?changesetId=cs1
  B-->>G: {subjectArea, tables, columns, relationships}

  Note over C,B: Editar una columna
  C->>G: updateColumn(col)
  G->>G: rec() valida readonly + changeset activo
  G->>K: recordChange(cs1, canonical_columns, col.id, upsert, payload)
  K->>B: PUT /api/changesets/cs1/changes
  B-->>K: Changeset actualizado

  Note over C,B: Releer columnas efectivas de una tabla
  C->>G: listColumns(tableId)
  G->>K: effective(cs1, canonical_columns, {tableId})
  K->>B: GET /api/changesets/cs1/effective/canonical_columns?tableId=t9
  B-->>K: CanonicalColumn[]
```

#### 3.3.3. Vistas (`views.service.ts`)

Las vistas son **VERSIONADAS** desde el doc 20 (tras la auditoría integral de la matriz del doc 20): siguen el MISMO patrón changeset-aware que governance/estructura/esquemas. Con changeset activo, las lecturas van al estado EFECTIVO (`/effective/views`) y las escrituras se registran en el changeset con el DOC COMPLETO; producción se toca solo en el apply del approve, y el rollback las revierte. Sin changeset (scripts/compat), sigue el REST directo:

| Función | Método/vía | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listViews(tableId)` | GET (o `/effective/views?tableId=`) | `/api/views?tableId=` | — | `View[]` |
| `listViewsForTables(tableIds)` | GET (o N × `/effective/views?tableId=` dedup por id) | `/api/views?tableIds=a,b,c` | — | `View[]` — Export DDL de un canvas en una request |
| `createView(body)` | POST (o `recordChange` upsert) | `/api/views` | `ViewInput` | `View` |
| `updateView(id, body)` | PUT (o `recordChange` upsert) | `/api/views/{id}` | `ViewInput` | `View` |
| `deleteView(id)` | DELETE (o `recordChange` delete) | `/api/views/{id}` | — | `{ deleted: boolean }` |

```ts
export interface ViewInput {
  tableId?: string;            // legacy: primera fuente (= sourceTableIds[0])
  sourceTableIds?: string[];   // F3: fuentes canónicas en orden (alias t1, t2…); 2+ ⇒ `FROM t1, t2` (doc 91 D5)
  showOnCanvas?: boolean;      // F3 (D3): la vista aparece en todo canvas con ≥1 fuente
  name: string;
  schema?: string;
  sources?: ViewSource[];      // proyección columna por columna (07b-2); en User-Defined SQL = todas las columnas de las fuentes (doc 91 D7)
  outputAlias?: string;
  expression?: string;
  sql?: string;                // referencia congelada (preview / SQL de Erwin)
  description?: string;        // F5: definición a nivel VISTA
  customSql?: string;          // doc 91 D6: User-Defined SQL — sentencia completa, VERBATIM, sin validar
  udpValues?: Record<string, string>;  // doc 61: UDPs de nivel 'view'
}
```

Cada `ViewSource` admite además `description` propia (F5, doc 22: definición re-contextualizada de la columna en la vista; vacía = hereda la de la columna física). Antes de registrar el cambio, el service normaliza `tableId` ↔ `sourceTableIds` para que queden coherentes (espejo de la normalización del apply).

> Doc 91 (2026-09-17): `tags`, `filter`, `joinOverride` y `customColumns` se **retiraron** del contrato (los UDP de vista reemplazan a las etiquetas; WHERE/JOIN viven en el User-Defined SQL; las columnas de salida son siempre `sources`). El sandbox `parseViewSql` (`POST /api/views/sql/parse`, Validate) también se eliminó: el User-Defined SQL se guarda tal cual. El generador `viewDDL(view, opts, tableById)` emite `FROM a t1,\n  b t2` con 2+ fuentes y, si `customSql` empieza con `CREATE`, lo devuelve verbatim (`isFullCreateStatement`).

#### 3.3.4. Esquemas (`schemas.service.ts`)

La entidad `schemas` (doc 18) también es changeset-aware. La particularidad: **rename y delete van SIEMPRE por endpoints propios del changeset**, porque la propagación a tablas/vistas y el guard de uso se computan server-side.

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listSchemas()` | GET (o `/effective/schemas`) | `/api/projects/{pid}/schemas` | — | `DbSchema[]` (los del proyecto en sesión) |
| `listPublishedSchemas()` | GET | `/api/projects/{pid}/schemas` | — | `DbSchema[]` (ignora el changeset activo) |
| `createSchema(name, desc?, kind?)` | POST (o `recordChange` upsert) | `/api/projects/{pid}/schemas` | `{ name, description, kind }` | `DbSchema` (nombre único POR proyecto) |
| `schemaImpact(id)` | GET | `/api/changesets/{cs}/schemas/{id}/impact` | — | `{ name, tables, views, canvases }` — preview ANTES de guardar |
| `renameSchema(id, newName)` | POST | `/api/changesets/{cs}/schemas/{id}/rename` | `{ newName }` | `{ tables, views }` — cuántas se propagaron dentro del draft |
| `deleteSchema(id)` | POST (o DELETE directo sin changeset) | `/api/changesets/{cs}/schemas/{id}/delete` · `/api/schemas/{id}` | — | 409 si el esquema tiene tablas o vistas en su estado efectivo |

#### 3.3.5. Database Explorer (`explorer.service.ts`)

El Database Explorer es **draft-aware** (doc 25): con versión activa muestra el estado EFECTIVO (publicado + overlay del changeset); sin versión, el estado publicado vía reporting/catálogo. El componente solo consume filas `Dbx*` y no sabe de qué fuente vienen.

| Función | Ruta | Nota |
|---|---|---|
| `projectInventory(projectId)` | `GET /api/projects/{id}/catalog/inventory?changesetId=` | inventario del proyecto en UNA request (tablas con `columnCount` + vistas), con overlay del draft si hay changeset (doc 72; antes eran ~1 request por tabla) |
| `explorerColumns(tableId)` | `listColumns` de governance (publicado o `/effective/canonical_columns?tableId=`) | columnas de un nodo al expandirlo |
| `mapInventory` / `mapView` | — | puros: filas `Dbx*` del árbol |

La búsqueda profunda del Model (tablas/columnas/definiciones) vive en `governance.searchModel()` (`GET /api/projects/{pid}/catalog/search`, doc 70 §11 / 72 r2) y el inspector de objetos en `GET /api/catalog/inspect/tables/{id}` · `/inspect/views/{id}` (doc 72).

#### 3.3.6. Carga masiva desde Excel y perfiles de carga (`features/upload/upload.service.ts`, docs 55 · 78)

El popup «Upload from Excel» del toolbar lee el `.xlsx` en el navegador (`lib/parseWorkbook.ts`, SheetJS) como grillas CRUDAS de todas las hojas (`{name, rows: [{row, cells}]}`, con el origen forzado a A1 para que `row` sea la fila Excel absoluta) y las manda junto con el **perfil de carga** elegido; el backend aplica el perfil (hojas, fila de cabecera, mapeo cabecera → campo / UDP lógico y/o físico, reglas, políticas), valida y aplica dentro del draft como **job asíncrono**; el front hace polling hasta un estado terminal.

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `startUpload(csId, body)` | POST | `/api/changesets/{cs}/uploads` | `{ fileName, profileId, sheets: RawSheet[] }` | `UploadJob` (202, `validating`); 404 perfil inexistente; 413 topes |
| `getUploadJob(csId, jobId)` | GET | `/api/changesets/{cs}/uploads/{job}` | — | `UploadJob` (`status`, `progress`, `report` con `profile` y `sheets`, `result`, `error`); 404 = expiró |
| `pollUploadJob(csId, jobId, {onTick, intervalMs, signal})` | GET (×n) | ídem | — | Promesa que resuelve en `validated | applied | failed`; abortable |
| `applyUpload(csId, jobId)` | POST | `/api/changesets/{cs}/uploads/{job}/apply` | — | `UploadJob` (202, `applying`); 409 sin validar / con errores / otro apply en curso |
| `discardUpload(csId, jobId)` | DELETE | `/api/changesets/{cs}/uploads/{job}` | — | `{ deleted }`; 409 mientras aplica |
| `listProfiles(pid)` | GET | `/api/projects/{pid}/upload-profiles` | — | `UploadProfile[]` (default primero) |
| `createProfile(pid, body)` · `updateProfile(pid, id, body)` | POST · PUT | `…/upload-profiles[/{id}]` | `UploadProfileBody` | `UploadProfile`; 422 `{message, problems}` (→ `profileProblemsOf(e)`); 409 nombre repetido |
| `getProfile(pid, id)` · `deleteProfile(pid, id)` · `setDefaultProfile(pid, id)` | GET · DELETE · POST | `…/upload-profiles/{id}[/default]` | — | `UploadProfile` · `{ deleted }` · `UploadProfile` |
| `getProfileCatalog(pid)` | GET | `…/upload-profiles/catalog` | — | `ProfileCatalog` (campos por hoja, tipos de regla, políticas) |
| `validateProfile(pid, body)` | POST | `…/upload-profiles/validate` | `UploadProfileBody` | `{ problems: ProfileProblem[] }` sin guardar |
| `suggestMappings(pid, sheet, headers)` | POST | `…/upload-profiles/suggest` | `{ sheet, headers }` | `Suggestion[]` (mapeo propuesto por nombre) |
| `createDefaultProfile(pid)` | POST | `…/upload-profiles/default` | — | `{ profile, warnings }` (built-in «Plantilla BCP»); 409 si ya existe |

### 3.4. Reporting (Screen 11)

El reporting tiene dos capas: (a) la grilla tabular "clásica" (`reporting.service`) y (b) el motor de consulta configurable + insights (`query.service`).

#### 3.4.1. Grilla tabular clásica (`reporting.service.ts`)

Metadata tabular de solo lectura para la grilla y el export a Excel (también la consume el Database Explorer en modo producción, §3.3.5).

| Función | Método | Ruta | Respuesta |
|---|---|---|---|
| `listReportTables(filters)` | GET | `/api/reporting/tables?schema=&projectId=&limit=` | `ReportTableRow[]` |
> Doc 92: `listReportTables(projectId, { limit, offset })` pagina el scroll infinito (sólo sin filtros) y `countReportTables(projectId)` (`GET /api/reporting/tables/count`) trae el total real de tablas del proyecto.
| `listReportColumns(tableId?, tableIds?)` | GET | `/api/reporting/columns?tableId=` o `?tableIds=a,b,c` | `ReportColumnRow[]` |
| `listReportViews(tableIds?, schema?)` | GET | `/api/reporting/views?tableIds=&schema=` | `ReportViewRow[]` — fuentes resueltas + detalle por columna del editor de vistas |

```ts
export function listReportColumns(tableId?: string, tableIds?: string[]): Promise<ReportColumnRow[]> {
  const qs = new URLSearchParams();
  if (tableIds?.length) qs.set('tableIds', tableIds.join(','));
  else if (tableId) qs.set('tableId', tableId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns${suffix}`);
}
```

#### 3.4.2. Motor de consulta + Report Designer (`query.service.ts`)

Todo gira alrededor del `ReportSpec` (mismo IR que el backend): lo produce tanto el builder visual como la caja SQL, y lo consumen la grilla, las queries guardadas y el export.

**Catálogo, ejecución y facetas**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `getCatalog(from)` | GET | `/api/reporting/catalog?from=` | — | `{ from, fields: FieldDef[] }` (devuelve `.fields`) |
| `runQuery(spec, cursor?)` | POST | `/api/reporting/query?cursor=` | `ReportSpec` | `QueryResult` |
| `runSql(text, cursor?)` | POST | `/api/reporting/query/sql?cursor=` | `{ text }` | `QueryResult` |
| `validateSql(text)` | POST | `/api/reporting/query/validate` | `{ text }` | `SqlValidation` |
| `getFacets(from, field, q?)` | GET | `/api/reporting/facets?from=&field=&q=` | — | `{ value, label }[]` |

```ts
export const runQuery = (spec: ReportSpec, cursor?: string) =>
  apiPost<QueryResult>(`${R}/query${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, spec);

export const runSql = (text: string, cursor?: string) =>
  apiPost<QueryResult>(`${R}/query/sql${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { text });
```

El `ReportSpec` (IR compartido) y el resultado paginado por cursor. `from` admite seis entidades — a las cuatro físicas se sumaron las virtuales `view_columns` (columnas de vistas, doc 22) y `models` (canvases):

```ts
export type ViewKey = 'columns' | 'tables' | 'relationships' | 'views' | 'view_columns' | 'models';

export interface ReportSpec {
  from: ViewKey;
  select: string[];
  where?: WhereGroup | null;
  groupBy: string[];
  aggregations: Aggregation[];
  orderBy: OrderBy[];
  limit: number;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: ResultColumn[];
  nextCursor: string | null;
  hasMore: boolean;
  meta: { grouped: boolean; warnings: string[]; scan?: string };
}
```

**Vistas curadas / Insights**

| Función | Método | Ruta | Respuesta |
|---|---|---|---|
| `getScorecard()` | GET | `/api/reporting/insights/scorecard` | `Scorecard` |
| `getUdpCoverage()` | GET | `/api/reporting/insights/udp-coverage` | `UdpCoverage[]` |
| `getDomainUsage()` | GET | `/api/reporting/insights/domain-usage` | `DomainUsage[]` |
| `getGlossaryUsage()` | GET | `/api/reporting/insights/glossary-usage` | `GlossaryUsage[]` |
| `getRelationshipsReport(limit)` | GET | `/api/reporting/insights/relationships?limit=` | `RelationshipRow[]` |

**Queries guardadas (Saved Reports)**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listReports()` | GET | `/api/reporting/reports` | — | `SavedReport[]` |
| `createReport(b)` | POST | `/api/reporting/reports` | `{ name, description?, spec, shared? }` | `SavedReport` |
| `updateReport(id, b)` | PUT | `/api/reporting/reports/{id}` | `{ name, description?, spec, shared? }` | `SavedReport` |
| `deleteReport(id)` | DELETE | `/api/reporting/reports/{id}` | — | — |

**Export CSV por streaming** — único caso que NO usa el cliente `http.ts`, porque el stream no se bufferea bien vía JSON; hace `fetch` crudo y descarga un `Blob`. Lee el token directamente de `localStorage` y respeta el MISMO contrato de headers que `http.ts` (`X-Session-Token` + `credentials: 'include'`, no `Authorization`):

```ts
export async function exportCsv(spec: ReportSpec): Promise<void> {
  const token = localStorage.getItem('dmh.token');
  const res = await fetch(`${R}/export`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `report-${spec.from}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

Endpoint: `POST /api/reporting/export` con body `ReportSpec`, respuesta `text/csv` en streaming.

### 3.5. Data Standards (Glossary + Parent Domains + UDP + Naming + DDL Export Rules)

Este módulo combina tres services: `naming.service` (configuración global de nombres y dominios, escritura directa e inmediata), `standards.service` (snapshot + versionado independiente con apply/rollback/history) y `ddlRules.service` (5ta pestaña "DDL export rules", doc 30).

#### 3.5.1. Glosario, naming y dominios globales (`naming.service.ts`)

Estos recursos son configuración **del proyecto** (doc 75 D3; NO parte de un publish del canvas): editar un término o una regla de separador/casing re-fisicaliza los nombres de ESE proyecto de inmediato. Todas las funciones de `naming.service.ts` reciben el `projectId` como primer argumento (el del selector de `StandardsScreen`).

**Términos del glosario (Glossary)**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listTerms(projectId, scope)` | GET | `/api/projects/{pid}/glossary?scope=table\|column` | — | `DictTerm[]` |
| `createTerm(projectId, x)` | POST | `/api/projects/{pid}/glossary` | `{ term, abbrev, scope, wordType? }` | `DictTerm` |
| `updateTerm(projectId, id, x)` | PUT | `/api/projects/{pid}/glossary/{id}` | `{ term, abbrev, scope, wordType? }` | `DictTerm` |
| `deleteTerm(projectId, id)` | DELETE | `/api/projects/{pid}/glossary/{id}` | — | `{ id }` |
| `validateTerm(projectId, term, scope)` | POST | `/api/projects/{pid}/glossary/validate` | `{ term, scope }` | `GlossaryValidation` — duplicado en glosario + hits en el corpus de nombres lógicos (muestra capada a 50); cortesía de UX, el backend re-valida en cada write |
| `lockTerm(projectId, id)` / `unlockTerm(projectId, id)` | POST | `/api/projects/{pid}/glossary/{id}/lock` · `/unlock` | `{}` | `DictTerm` — solo `admin.manage`; una entrada bloqueada queda intocable para todos |

**Configuración de naming (separador / casing por scope)**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `getNamingConfig(projectId)` | GET | `/api/projects/{pid}/settings/naming` | — | `{ column: NamingRule, table: NamingRule }` |
| `setNamingConfig(projectId, scope, rule)` | PUT | `/api/projects/{pid}/settings/naming/{scope}` | `{ separator, case }` | `NamingRule` |

El `naming_config` incluye además `maxLength` por scope (doc 24), que el backend hace cumplir en cada `add_change` (§3.3.2); su edición va versionada por `applyStandards` (§3.5.2).

**Fisicalización**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `physicalize(projectId, logical, scope)` | POST | `/api/projects/{pid}/glossary/physicalize` | `{ logical, scope }` | `{ physical }` |
| `rephysicalize(projectId, scope?)` | POST | `/api/projects/{pid}/glossary/rephysicalize` | `{ scope? }` | `{ updated }` |

**Parent Domains del proyecto**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listDomainsGlobal(projectId)` | GET | `/api/projects/{pid}/domains` | — | `ParentDomainFull[]` |
| `createDomainGlobal(projectId, d)` | POST | `/api/projects/{pid}/domains` | `Omit<ParentDomainFull,'id'>` | `ParentDomainFull` |
| `updateDomainGlobal(projectId, id, d)` | PUT | `/api/projects/{pid}/domains/{id}` | `Omit<ParentDomainFull,'id'>` | `ParentDomainFull` |
| `deleteDomainGlobal(projectId, id)` | DELETE | `/api/projects/{pid}/domains/{id}` | — | `{ id }` |
| `getDomainImpact(projectId, id, {q, offset, limit})` | GET | `/api/projects/{pid}/domains/{id}/impact?q=&offset=&limit=` | — | `DomainImpact` |
| `propagateDomain(projectId, id)` | POST | `/api/projects/{pid}/domains/{id}/propagate` | — | `{ updated }` |

`getDomainImpact` previsualiza el impacto de un cambio de tipo del dominio (totales globales + filas agrupadas por tabla, con búsqueda server-side por nombre de tabla y paginación; respeta overrides manuales); `propagateDomain` aplica el `defaultDataType` a las columnas sin override.

#### 3.5.2. Snapshot + versionado + UDP (`standards.service.ts`)

Backend `/api/projects/{pid}/standards/*`. Aquí se agrupa un batch de cambios y se aplica como UNA versión (con rollback e historial) sobre el stream `standards_versions` **del proyecto** (`seq`/`vN` independientes por proyecto). `applyStandards`/`rollbackStandards` corren bajo `runBlocking` (overlay bloqueante).

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `getSnapshot(projectId)` | GET | `/api/projects/{pid}/standards/snapshot` | — | `StandardsSnapshot` (incluye `ddlRules` + `ddlConfig`) |
| `getVersions(projectId)` | GET | `/api/projects/{pid}/standards/versions` | — | `StandardsVersion[]` |
| `applyStandards(projectId, body)` | POST | `/api/projects/{pid}/standards/apply` | `ApplyStandardsBody` | `StandardsVersion` (permiso `standards.edit`) |
| `rollbackStandards(projectId, targetSeq)` | POST | `/api/projects/{pid}/standards/rollback` | `{ targetSeq }` | `StandardsVersion` (permiso `rollback`) |
| `getUdpDefs(projectId)` | GET | `/api/projects/{pid}/udp` | — | `UdpDefinition[]` |
| `getStandardsSummary(projectId)` | GET | `/api/projects/{pid}/standards/summary` | — | `{ glossary, domains, udp, rules, naming }` (asistente «New project», bloques `STANDARDS_BLOCKS`) |

El `ApplyStandardsBody` permite mezclar upserts/deletes de términos, naming, dominios, UDP y reglas de DDL en una sola versión:

```ts
export interface ApplyStandardsBody {
  kind?: 'glossary' | 'udp' | 'domain' | 'naming' | 'ddl' | 'batch';
  title?: string;
  description?: string;
  termsUpsert?: TermEditInput[];
  termsDelete?: string[];
  namingConfig?: Partial<Record<UdpScope, NamingEditInput>>;   // separator + case + maxLength
  domainsUpsert?: DomainEditInput[];
  domainsDelete?: string[];
  udpUpsert?: UdpEditInput[];
  udpDelete?: string[];
  rulesUpsert?: DdlRuleEditInput[];       // DDL export rules (doc 30)
  rulesDelete?: string[];
  ddlConfigPatch?: { lookups?: Record<string, DdlLookup>; functions?: DdlRulesetConfig['functions'] };
}
```

Las definiciones UDP se LEEN por `GET /api/projects/{pid}/udp`, pero se MUTAN siempre por `applyStandards` con `kind='udp'` (para quedar versionadas). Los `UdpDefinition` cubren los niveles `table` | `column` | `canvas` | `view` (con faceta `view: logical | physical`, doc 69) y tipos `string` | `number` | `boolean` | `date` | `list` (enum vía `allowedValues`).

#### 3.5.3. DDL Export Rules (`ddlRules.service.ts` + `features/ddl/rulesBridge.ts`)

Motor de reglas del Export DDL (doc 30): reglas y generadores que transforman el DDL exportado según UDPs, con motor sqlglot en el backend. La lectura y las operaciones stateless van a `/api/projects/{pid}/ddl-rules/*`; las MUTACIONES son versionadas — pasan por `applyStandards` con `kind='ddl'` (`rulesUpsert` / `rulesDelete` / `ddlConfigPatch`), de modo que cada guardado es una versión del historial de Standards, con rollback incluido.

**Lectura + validación (pestaña "DDL export rules", `ddlRules.service.ts`)**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listDdlRules(projectId)` | GET | `/api/projects/{pid}/ddl-rules` | — | `DdlRule[]` |
| `getDdlConfig(projectId)` | GET | `/api/projects/{pid}/ddl-rules/config` | — | `DdlRulesetConfig` (lookups + functions) |
| `getDdlArtifacts(projectId)` | GET | `/api/projects/{pid}/ddl-rules/artifacts` | — | `DdlArtifact[]` |
| `getDdlTemplates(projectId)` | GET | `/api/projects/{pid}/ddl-rules/templates` | — | `{ templates, seedRules, seedLookups }` |
| `validateDdlRule(projectId, rule)` | POST | `/api/projects/{pid}/ddl-rules/validate` | `DdlRuleEditInput` | `DdlValidateResult` (los 5 checks + condición canonizada + `udpRefs`) |
| `testDdlRule(projectId, rule, tableId)` | POST | `/api/projects/{pid}/ddl-rules/test` | `{ rule, tableId }` | `DdlTestResult` (fragmentos SQL sobre una tabla real) |
| `impactDdlRule(projectId, rule)` | POST | `/api/projects/{pid}/ddl-rules/impact` | `{ rule }` | `{ columns, tables }` |

El editor serializa la regla a YAML y de vuelta client-side (`ruleToYaml` / `yamlToRule`, dependencia `yaml 2.9.0`); el YAML nunca viaja como tal a la API. El CTA del catálogo vacío (`seedStarterRules(projectId)`) aplica el ruleset base (`seedRules` + `seedLookups` de `/templates`) como UNA versión vía `applyStandards`.

**Render en el export (`rulesBridge.ts`, modal Export DDL)**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `fetchExportRules(projectId)` | GET | `/api/projects/{pid}/ddl-rules` | — | `ExportRule[]` (vista liviana para el selector) |
| `renderWithRules(args)` | POST | `/api/projects/{pid}/ddl-rules/render` | ver abajo | `RenderedExport` (permiso `export`) |

El payload del `render` se arma con el estado EFECTIVO que el canvas está exportando (drafts incluidos): `ruleIds`, `model` (nombre + `udpValues` del canvas), `options` del modal (`identifierCase`, `tableFormat`, `external`, `location`, `locationFolderCase`, `includePartitions`, `partitionsLast`), `tables[]` (cada una con su doc, sus columnas con `udpValues` y su `baseSql` generado client-side) y `views[]` (con `sql`, `sourceTableIds` y el flag `businessView` = `showOnCanvas`). La respuesta trae `statements[]`, `log[]` (applied/skipped por regla), `rulesetVersion`, `applied` y `skipped`; el `.sql` final se ensambla en el cliente con el sello de la versión de reglas usada. Sin reglas seleccionadas, el export NO pasa por este endpoint y sale byte-idéntico al generador client-side.

### 3.6. Admin / RBAC (Screen 14)

**Service:** `src/features/admin/admin.service.ts`. Todo el módulo está gateado por el permiso `admin.manage`.

**Usuarios**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listUsers()` | GET | `/api/admin/users` | — | `AdminUser[]` |
| `createUser(body)` | POST | `/api/admin/users` | `CreateUserInput` | `AdminUser` |
| `updateUser(username, body)` | PUT | `/api/admin/users/{username}` | `UpdateUserInput` | `AdminUser` |
| `deleteUser(username)` | DELETE | `/api/admin/users/{username}` | — | `{ id }` |

**Roles + matriz de permisos**

| Función | Método | Ruta | Body | Respuesta |
|---|---|---|---|---|
| `listRoles()` | GET | `/api/admin/roles` | — | `Role[]` |
| `upsertRole(key, body)` | PUT | `/api/admin/roles/{key}` | `{ name, description?, permissions }` | `Role` |
| `deleteRole(key)` | DELETE | `/api/admin/roles/{key}` | — | `{ id }` |

**Catálogo de permisos y auditoría**

| Función | Método | Ruta | Respuesta |
|---|---|---|---|
| `getPermissions()` | GET | `/api/admin/permissions` | `Permission[]` |
| `getAudit(limit = 200)` | GET | `/api/admin/audit?limit=` | `AuditEntry[]` |

Los permisos del sistema son ocho, 1:1 con el backend (`rollback` se sumó con el doc 27):

```ts
export type Permission =
  | 'model.view' | 'model.edit' | 'review.decide' | 'publish'
  | 'rollback' | 'export' | 'standards.edit' | 'admin.manage';
```

Las etiquetas legibles de la matriz viven en `PERMISSION_LABELS` (`admin.service.ts`); por ejemplo `'rollback': 'Roll back to a published version'` y `'admin.manage': 'Manage users and permissions'`.

---

## 4. Tabla maestra de endpoints

Consolidado de todo lo que el frontend consume, con el guard que exige el backend (inventario de rutas del backend al 2026-07-31). Rutas relativas a `API_BASE` (vacía = mismo origen). Convención de la columna **Acceso**: "abierto" = sin token; "sesión" = en producción (`REQUIRE_AUTH=true`) exige token válido (401 sin él); un nombre de permiso = lo exige el endpoint (403 sin él). En los routers con `write_guard`, los GET solo exigen sesión y las escrituras exigen el permiso y auditan.

| Área | Método | Ruta | Acceso | Service |
|---|---|---|---|---|
| Auth | POST | `/api/auth/login` | abierto (rate limit 5/min) | auth.service |
| Auth | POST | `/api/auth/logout` | sesión | auth.service |
| Auth | GET | `/api/auth/me` | sesión | auth.service |
| Auth | GET | `/api/auth/warmup/{next_b64}` | abierto | warmup.ts (navegación top-level) |
| Salud | GET | `/api/health` | abierto | warmup.ts (probe con fetch crudo) |
| Identidad | GET | `/api/users?can=` | sesión | versioning.service |
| Home | GET | `/api/summary` | sesión | dashboard.service |
| Versiones | GET | `/api/versions[?projectId=]` · `/api/versions/compare` | sesión | versioning.service |
| Versiones | GET | `/api/projects/{pid}/versions/published` | sesión | versioning.service |
| Versiones | GET | `/api/requests` | sesión | versioning.service |
| Changesets | GET | `/api/changesets` | sesión | changeset.service |
| Changesets | POST | `/api/changesets` | model.edit | changeset.service |
| Changesets | POST | `/api/changesets/snapshot` | model.edit | versioning.service |
| Changesets | GET | `/api/changesets/{id}` | sesión | changeset / versioning |
| Changesets | PUT | `/api/changesets/{id}/changes` | model.edit | changeset.service (vía governance/structure/schemas/views) |
| Changesets | PUT | `/api/changesets/{id}/changes/bulk` | model.edit | changeset.service (`recordChangesBulk`, doc 39) |
| Upload | POST | `/api/changesets/{id}/uploads` | model.edit + owner del draft | upload.service (`startUpload`, docs 55/78) |
| Upload | GET/POST/PUT/DELETE | `/api/projects/{pid}/upload-profiles[/…]` | model.edit | upload.service (perfiles de carga: `listProfiles`, `createProfile`, `updateProfile`, `deleteProfile`, `setDefaultProfile`, `getProfileCatalog`, `validateProfile`, `suggestMappings`, `createDefaultProfile`, doc 78) |
| Upload | GET | `/api/changesets/{id}/uploads/{job}` | model.edit + owner | upload.service (`getUploadJob` / `pollUploadJob`) |
| Upload | POST | `/api/changesets/{id}/uploads/{job}/apply` | model.edit + owner | upload.service (`applyUpload`) |
| Upload | DELETE | `/api/changesets/{id}/uploads/{job}` | model.edit + owner | upload.service (`discardUpload`) |
| Changesets | GET | `/api/changesets/{id}/effective/{collection}` | sesión | changeset.service (ídem) |
| Changesets | GET | `/api/changesets/{id}/diff` | sesión | versioning.service |
| Changesets | POST | `/api/changesets/{id}/diff/details` | sesión | versioning.service |
| Changesets | POST | `/api/changesets/{id}/submit` | model.edit | changeset / versioning |
| Changesets | POST | `/api/changesets/{id}/review` | review.decide | versioning.service |
| Changesets | POST | `/api/changesets/{id}/comments` | sesión | versioning.service |
| Changesets | POST | `/api/changesets/{id}/withdraw` | model.edit | versioning.service |
| Changesets | POST | `/api/changesets/{id}/reopen` | model.edit | versioning.service |
| Changesets | POST | `/api/changesets/{id}/rollback` | rollback | versioning.service |
| Changesets | GET | `/api/changesets/{id}/schemas/{sid}/impact` | sesión | schemas.service |
| Changesets | POST | `/api/changesets/{id}/schemas/{sid}/rename` | model.edit | schemas.service |
| Changesets | POST | `/api/changesets/{id}/schemas/{sid}/delete` | model.edit | schemas.service |
| Changesets | POST | `/api/changesets/{id}/approve` (legacy) | review.decide | changeset.service |
| Changesets | POST | `/api/changesets/{id}/reject` (legacy) | review.decide | changeset.service |
| Proyectos | GET | `/api/projects` | sesión | projects.service / modeler / structure |
| Proyectos | POST | `/api/projects` | model.edit | projects.service (NewProjectModal) |
| Proyectos | GET | `/api/projects/{id}/counts` | sesión | projects.service (DeleteProjectDialog, CriticalDeletionBlock) |
| Carpetas | GET | `/api/projects/{projectId}/folders` | sesión | modeler / structure |
| Carpetas | POST | `/api/folders` | model.edit | modeler / structure |
| Carpetas | PATCH/DELETE | `/api/folders/{id}` | model.edit | modeler / structure |
| Canvas | GET | `/api/projects/{projectId}/subject-areas` | sesión | modeler / structure |
| Canvas | POST | `/api/subject-areas` | model.edit | modeler / structure |
| Canvas | GET | `/api/subject-areas/{id}` | sesión | modeler / structure |
| Canvas | PUT/DELETE | `/api/subject-areas/{id}` | model.edit | modeler / structure |
| Canvas | PUT | `/api/subject-areas/{id}/tables` | model.edit | modeler / structure |
| Canvas | PUT | `/api/subject-areas/{id}/layout` | model.edit | modeler / structure |
| Canvas | PUT | `/api/subject-areas/{id}/drawings` | model.edit | modeler / structure |
| Canvas | PUT | `/api/subject-areas/{id}/views` | model.edit | modeler / structure |
| Canvas | GET | `/api/subject-areas/{id}/diagram` | sesión | modeler.service |
| Catálogo | GET | `/api/projects/{pid}/catalog/tables` | sesión | governance.service |
| Catálogo | GET | `/api/projects/{pid}/catalog/search` | sesión | governance.service (⌘K) |
| Catálogo | GET | `/api/projects/{pid}/catalog/inventory` | sesión | explorer.service |
| Catálogo | GET | `/api/catalog/inspect/tables/{id}` · `/inspect/views/{id}` | sesión | inspector (doc 72) |
| Catálogo | GET | `/api/catalog/tables/{tableId}/columns` | sesión | governance.service |
| Catálogo | GET | `/api/catalog/tables/{tableId}/usage` | sesión | governance.service |
| Relaciones | GET | `/api/relationships` | sesión | governance.service |
| Relaciones | GET | `/api/relationships/impact` | sesión | governance.service |
| Relaciones | GET | `/api/relationships/links` | sesión | governance.service |
| Esquemas | GET | `/api/projects/{pid}/schemas` | sesión | schemas.service |
| Esquemas | POST | `/api/projects/{pid}/schemas` | model.edit | schemas.service |
| Esquemas | DELETE | `/api/schemas/{sid}` | model.edit | schemas.service (solo sin changeset) |
| Standards | GET | `/api/projects/{pid}/standards/summary` | sesión | standards.service |
| Vistas | GET | `/api/views` | sesión | views.service |
| Vistas | POST | `/api/views` | model.edit | views.service (solo sin changeset) |
| Vistas | PUT/DELETE | `/api/views/{id}` | model.edit | views.service (solo sin changeset) |
| Reporting | GET | `/api/reporting/tables` | sesión | reporting.service |
| Reporting | GET | `/api/reporting/columns` | sesión | reporting.service |
| Reporting | GET | `/api/reporting/views` | sesión | reporting.service |
| Reporting | GET | `/api/reporting/catalog` | sesión | query.service |
| Reporting | POST | `/api/reporting/query` | sesión | query.service |
| Reporting | POST | `/api/reporting/query/sql` | sesión | query.service |
| Reporting | POST | `/api/reporting/query/validate` | sesión | query.service |
| Reporting | GET | `/api/reporting/facets` | sesión | query.service |
| Reporting | GET | `/api/reporting/insights/scorecard` | sesión | query.service |
| Reporting | GET | `/api/reporting/insights/udp-coverage` | sesión | query.service |
| Reporting | GET | `/api/reporting/insights/domain-usage` | sesión | query.service |
| Reporting | GET | `/api/reporting/insights/glossary-usage` | sesión | query.service |
| Reporting | GET | `/api/reporting/insights/relationships` | sesión | query.service |
| Reporting | GET/POST | `/api/reporting/reports` | sesión | query.service |
| Reporting | PUT/DELETE | `/api/reporting/reports/{id}` | sesión (por-usuario) | query.service |
| Reporting | POST | `/api/reporting/export` | sesión | query.service (fetch crudo) |
| Standards | GET | `/api/projects/{pid}/glossary` | sesión | naming.service |
| Standards | POST | `/api/projects/{pid}/glossary` | standards.edit | naming.service |
| Standards | PUT/DELETE | `/api/projects/{pid}/glossary/{id}` | standards.edit | naming.service |
| Standards | POST | `/api/projects/{pid}/glossary/validate` | sesión (cómputo) | naming.service |
| Standards | POST | `/api/projects/{pid}/glossary/physicalize` | sesión (cómputo) | naming / governance |
| Standards | POST | `/api/projects/{pid}/glossary/rephysicalize` | standards.edit | naming.service |
| Standards | POST | `/api/projects/{pid}/glossary/{id}/lock` · `/unlock` | admin.manage | naming.service |
| Standards | GET | `/api/projects/{pid}/settings/naming` | sesión | naming.service |
| Standards | PUT | `/api/projects/{pid}/settings/naming/{scope}` | standards.edit | naming.service |
| Standards | GET | `/api/projects/{pid}/domains` | sesión | naming / governance |
| Standards | POST | `/api/projects/{pid}/domains` | standards.edit | naming.service |
| Standards | PUT/DELETE | `/api/projects/{pid}/domains/{id}` | standards.edit | naming.service |
| Standards | GET | `/api/projects/{pid}/domains/{id}/impact` | sesión | naming.service |
| Standards | POST | `/api/projects/{pid}/domains/{id}/propagate` | standards.edit | naming.service |
| Standards | GET | `/api/projects/{pid}/standards/snapshot` | sesión | standards.service |
| Standards | GET | `/api/projects/{pid}/standards/versions` | sesión | standards.service |
| Standards | POST | `/api/projects/{pid}/standards/apply` | standards.edit | standards / ddlRules.service |
| Standards | POST | `/api/projects/{pid}/standards/rollback` | rollback | standards.service |
| Standards | GET | `/api/projects/{pid}/udp` | sesión | standards.service |
| DDL rules | GET | `/api/projects/{pid}/ddl-rules` | sesión | ddlRules.service / rulesBridge |
| DDL rules | GET | `/api/projects/{pid}/ddl-rules/config` | sesión | ddlRules.service |
| DDL rules | GET | `/api/projects/{pid}/ddl-rules/artifacts` | sesión | ddlRules.service |
| DDL rules | GET | `/api/projects/{pid}/ddl-rules/templates` | sesión | ddlRules.service |
| DDL rules | POST | `/api/projects/{pid}/ddl-rules/validate` | sesión (no escribe) | ddlRules.service |
| DDL rules | POST | `/api/projects/{pid}/ddl-rules/test` | sesión (no escribe) | ddlRules.service |
| DDL rules | POST | `/api/projects/{pid}/ddl-rules/impact` | sesión (no escribe) | ddlRules.service |
| DDL rules | POST | `/api/projects/{pid}/ddl-rules/render` | export | rulesBridge (features/ddl) |
| Admin | GET/POST | `/api/admin/users` | admin.manage | admin.service |
| Admin | PUT/DELETE | `/api/admin/users/{username}` | admin.manage | admin.service |
| Admin | GET | `/api/admin/roles` | admin.manage | admin.service |
| Admin | PUT/DELETE | `/api/admin/roles/{key}` | admin.manage | admin.service |
| Admin | GET | `/api/admin/permissions` | admin.manage | admin.service |
| Admin | GET | `/api/admin/audit` | admin.manage | admin.service |

Filas retiradas: `GET /api/projects/{id}` (2026-07-06; la ruta no existe en el backend) y, con el doc 75 (2026-09-08), `GET /api/me`, `POST …/glossary/logicalize`, `PUT /api/subject-areas/{id}/udp`, `PUT/DELETE /api/projects/{id}` y `GET /api/versions/published` global (ahora por proyecto). Las escrituras directas de vistas/esquemas quedan anotadas "solo sin changeset" porque con versión activa esas mutaciones viajan como cambios del changeset (`PUT /{id}/changes`), no por su REST directo.

---

## 5. Modelo de datos que viaja por la API (resumen)

Relación de las entidades principales que el frontend intercambia:

```mermaid
erDiagram
  PROJECT ||--o{ FOLDER : contiene
  PROJECT ||--o{ SUBJECT_AREA : contiene
  FOLDER ||--o{ SUBJECT_AREA : agrupa
  SUBJECT_AREA ||--o{ CANONICAL_TABLE : referencia
  CANONICAL_TABLE ||--o{ CANONICAL_COLUMN : tiene
  CANONICAL_TABLE ||--o{ VIEW : origina
  CANONICAL_COLUMN }o--o| PARENT_DOMAIN : usa
  RELATIONSHIP }o--|| CANONICAL_TABLE : source
  RELATIONSHIP }o--|| CANONICAL_TABLE : target
  CHANGESET ||--o{ CHANGE : agrupa
  CHANGESET ||--o{ APPROVAL : recibe
```

Notas de mapeo relevantes:

- `SUBJECT_AREA` guarda `tableIds`, `layout` (posiciones por tabla), `drawings` (formas libres del canvas) y `udpValues` (UDP a nivel Modelo de Datos).
- Con changeset activo, TODO lo versionado se registra como `CHANGE` dentro del `CHANGESET` y se materializa al aplicar (publish): el modelo (`CANONICAL_TABLE`, `CANONICAL_COLUMN`, `RELATIONSHIP`), las vistas (`VIEW`, doc 20), los esquemas (`schemas`, doc 18) y la estructura (`PROJECT`, `FOLDER`, `SUBJECT_AREA`, doc 16).
- `PARENT_DOMAIN`, glosario, UDP, naming y reglas de DDL export son configuración GLOBAL (fuera del changeset del canvas); su versionado vive en el módulo Data Standards (stream `standards_versions`, con apply/rollback propios).

---

## 6. Consideraciones de despliegue

### 6.1. Dónde corre

La producción es **Databricks Apps** (workspace corporativo, docs 35+36): dos apps desplegadas por Asset Bundle (`frnt-data-model-hub` y `bknd-data-model-hub`), pero **UN SOLO origen para el navegador**. La app del front no es un sitio estático: corre `server.mjs` (Node sin dependencias externas), que sirve el build de `dist/` con fallback SPA y **proxya `/api` al backend servidor-a-servidor** con un token M2M del service principal:

- El mint del token es `POST {DATABRICKS_HOST}/oidc/v1/token` (`client_credentials`, scope `all-apis`) con las credenciales `DATABRICKS_CLIENT_ID/SECRET` que Databricks Apps inyecta; se cachea hasta `expires_in` menos 5 minutos y los mints concurrentes se deduplican (N usuarios = 1 mint).
- El proxy DESCARTA el header `Authorization` entrante del cliente (el Bearer lo pone siempre el server) y conserva el resto, incluido `X-Session-Token`. Ante 401/403 del upstream invalida el cache y reintenta UNA vez, solo en GET/HEAD.
- El destino sale de la variable runtime `BACKEND_API_URL` (variable del bundle); sin ella el proxy responde 502.

El navegador jamás habla directo con el backend en producción: eso evita el doble muro SSO por app de Databricks (cada app tiene su propia cookie SSO por subdominio, y un `fetch()` cross-app no puede completar ese SSO — el intento de warm-up por redirect fracasó, doc 36). **CORS solo es relevante en local contra un backend remoto** (`VITE_API_URL` definida): para ese caso el backend expone `CORS_ORIGIN_REGEX` y permite los headers `X-Session-Token` / `X-Dev-User`. En producción, al ser mismo origen, CORS no interviene.

En desarrollo el esquema es el mismo de un solo origen: `vite dev` en `:3000` con proxy `/api` → `http://localhost:8000` (`vite.config.ts`). `server.mjs` también corre en local sin credenciales (`BACKEND_API_URL=http://localhost:8000 node server.mjs`): sin CLIENT_ID/SECRET simplemente no adjunta Bearer.

### 6.2. Variables de entorno del frontend

| Variable | Momento | Rol |
|---|---|---|
| `VITE_API_URL` | build | Base URL del backend para el NAVEGADOR (`API_BASE`). NO se define en el build de producción (reactivaría el cruce navegador→backend y su doble SSO); queda para apuntar el front local a otro backend. Sin ella, `API_BASE = ''` → rutas relativas `/api/...`. |
| `BACKEND_API_URL` | runtime (`server.mjs`) | Destino del proxy `/api` en producción. Es variable del bundle (GitHub Variable), no se inlinea en el build. |

`VITE_API_URL` es la única variable que consume el cliente HTTP, centralizada en `src/services/apiBase.ts`. Al ser `VITE_*` se inyecta en build; el cambio de backend en producción NO requiere re-buildear el front, porque se resuelve en runtime vía `BACKEND_API_URL`.

Otras piezas de configuración del cliente son runtime, no variables de entorno:

- El token de sesión vive en `localStorage` bajo la clave `dmh.token`.
- El timeout global de request es una constante del código (`DEFAULT_TIMEOUT_MS = 30_000`).

### 6.3. Base de datos: Databricks Lakebase Postgres

El backend persiste sobre **Databricks Lakebase Postgres**: un adaptador JSONB con superficie estilo pymongo traduce las operaciones a SQL/JSONB. Las decisiones de escala del contrato siguen vigentes:

- **Nada de colecciones completas por request.** Endpoints como `GET /api/projects/{pid}/catalog/tables?q=&limit=`, `GET /api/changesets/{id}/effective/{collection}?tableId=` o `GET /api/reporting/columns?tableIds=` fuerzan filtros server-side. A escala real (2,108 tablas y ~96k columnas cargadas del modelo DDV) bajar la colección entera al cliente no es viable.
- **Cambios de modelo como documentos independientes.** Los cambios de un changeset se guardan uno por documento en la colección `changeset_changes` (decisión del versionado por changesets: updates chicos y diffs por slice). El cliente nunca recibe esos cambios crudos: los ve derivados vía `/effective` y `/diff`.
- **Paginación por cursor en reporting.** `runQuery` / `runSql` devuelven `nextCursor` y `hasMore` (keyset/streaming), y el export es un stream (`POST /api/reporting/export`), pensados para no materializar resultados grandes en memoria.
- **Envelope y errores estables.** El backend responde siempre `{ success, data, error }`, salvo los `HTTPException` de FastAPI que devuelven `{ detail }`; el cliente los reconoce en el path de error para no perder el mensaje real (por ejemplo, un `409` de conflicto de versión). Esto es independiente del motor de base y del entorno de despliegue.

---

## 7. Archivos de referencia

Rutas absolutas de los archivos analizados:

- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/http.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/apiBase.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/warmup.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/dashboard.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/versioning.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/projects.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/views.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/naming.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/reporting.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/modeler/services/modeler.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/modeler/services/structure.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/modeler/services/schemas.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/modeler/services/explorer.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/governance.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/changeset.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/reporting/query.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/standards/standards.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/standards/ddlRules.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/ddl/rulesBridge.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/admin/admin.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/auth/auth.service.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/store/useAuthStore.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/types/api.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/types/versioning.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/server.mjs` (proxy de producción, §6)
