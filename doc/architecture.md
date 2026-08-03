# Arquitectura del Frontend — web-data-model-hub

> **Actualizado 2026-07-31** — versiones de dependencias pineadas exactas (política de ambos repos), servidor de producción propio `server.mjs` (§3.1), LOD del canvas (§6.7), review con `ChangesSummary`/`ChangesDetailModal` y 5.ª pestaña "DDL Export rules" en Data Standards (§9), despliegue de un solo origen (§11).

## 1. Visión

`web-data-model-hub` es la interfaz web del **Data Model Hub (DMH)**: una plataforma para diseñar, visualizar, gobernar y reportar modelos de datos empresariales. Reemplaza el flujo tradicional de una herramienta de modelado de escritorio (tipo Erwin) por una aplicación de una sola página (SPA) que corre en el navegador y conversa con un backend FastAPI.

La aplicación se organiza como una *shell* con navegación superior persistente y cinco grandes áreas de trabajo:

| Área | Ruta | Qué resuelve |
|------|------|--------------|
| **Home** | `/` | Panel de bienvenida: contadores del workspace, solicitudes asignadas al usuario y lista de versiones (solo lectura). |
| **Reporting** | `/reporting` | Vista tabular de la metadata (tablas, columnas, relaciones), exportación a Excel y un **Report Designer** con motor de consulta y SQL. |
| **Model** | `/model` | El **canvas** de modelado ER: proyectos → carpetas → canvases (subject areas), con tablas, columnas y relaciones editables. |
| **Data Standards** | `/standards` | Glosario, Parent Domains y UDP versionados de forma independiente al canvas. |
| **Admin** | `/admin` | Usuarios, roles y matriz de permisos (RBAC). |
| **Requests** | `/review` | Revisión y aprobación de solicitudes de cambio (governance), cruzando proyectos. |

El diseño rector es **DMH-Erwin v20260625-2**: un sistema visual claro (light-only), de acento *navy* y azul, con tipografía Geist. Todo el estado de sesión, edición y gobernanza vive en el cliente mediante **Zustand**, y todas las escrituras de modelo pasan por un *choke-point* consciente del *changeset* activo (la unidad de versionado del backend).

Un principio transversal es que **el frontend nunca toca la base de datos directamente**: consume exclusivamente endpoints REST `/api/*` con un envelope uniforme `{ success, data, error }`. La persistencia (Databricks Lakebase Postgres) es responsabilidad del backend.

---

## 2. Stack tecnológico

El proyecto es 100% TypeScript, construido con **Vite** (que también sirve el dev server; en producción sirve `server.mjs`, §3.1). No usa Next.js (migró desde Next a Vite); desde 2026-07-19 los `.env` y manifiestos de deploy ya usan `VITE_API_URL` (la herencia `NEXT_PUBLIC_*` fue eliminada) y el código lee `import.meta.env.VITE_API_URL` (centralizado en `src/services/apiBase.ts`; en producción la variable no se define, ver §11).

**Política de versiones (2026-07-31, ambos repos)**: todas las dependencias — `dependencies` y `devDependencies` — van pineadas **exactas**, sin `^` ni `~` (el backend aplica el mismo criterio con `==` en pip). Actualizar una versión es siempre un cambio deliberado y revisable en el `package.json`, nunca un efecto lateral de un `npm install`.

| Categoría | Tecnología | Versión | Rol en la app |
|-----------|-----------|---------|---------------|
| Build / dev server | **Vite** | `6.4.3` | Bundler, HMR, proxy `/api` en dev, build estático. |
| Runtime de producción | **`server.mjs`** (Node puro) | — | Sirve `dist/` con fallback SPA y proxya `/api` al backend con token M2M. No es una dependencia npm (cero deps, solo módulos `node:*`); es pieza del stack (§3.1). |
| UI runtime | **React** + **React DOM** | `19.2.4` | Componentes, `StrictMode`, hooks. |
| Lenguaje | **TypeScript** | `5.9.3` | Tipado estricto (`strict: true`), alias `@ → ./src`. |
| Routing | **react-router-dom** | `7.18.0` | `BrowserRouter`, rutas anidadas, guards, `useSearchParams`. |
| Estado | **Zustand** | `5.0.12` | Los 5 stores globales de `src/store/` + `dialogs.tsx`. |
| Canvas ER | **@xyflow/react** (React Flow) | `12.11.0` | Nodos/aristas, viewport, minimapa, virtualización. |
| Auto-layout | **elkjs** | `0.11.1` | Algoritmo `layered` (Sugiyama); único import en `lib/elkLayout.ts`. |
| Grilla virtual | **@tanstack/react-virtual** | `3.14.5` | Render virtualizado del reporting; único uso en `ResultsGrid.tsx`. |
| Toasts | **sonner** | `2.0.7` | Notificaciones globales (`richColors`, `bottom-center`). |
| Export Excel | **xlsx** (SheetJS) | `0.18.5` | Workbook multi-hoja; único uso en `ReportingScreen.tsx`. |
| Export SVG | **html-to-image** | `1.11.13` | Export SVG del canvas (`toSvg`, import dinámico en `Toolbar.tsx`). |
| Íconos | **lucide-react** | `1.21.0` | Set de íconos SVG (~40 archivos). |
| Tipografía | **@fontsource-variable/geist** + **geist-mono** | `5.2.9` / `5.2.8` | Geist (UI) y Geist Mono (datos/SQL, feature GSUB `liga` para `<>`), self-hosted. |
| IDs | **uuid** | `13.0.0` | `v4` para ids cliente-side; único import en `governance.service.ts`. |
| YAML | **yaml** | `2.9.0` | Round-trip YAML del editor de DDL Export Rules; único import en `ddlRules.service.ts`. |
| Testing | **Vitest** | `2.1.9` | Tests unitarios (`src/**/*.test.{ts,tsx}` + `server.test.mjs`). |
| Linting | **ESLint** + **typescript-eslint** + **eslint-plugin-react-hooks** | `9.39.4` / `8.58.1` / `7.1.1` | Reglas TS, hooks, y guard de límites de feature. |

Configuración clave (`vite.config.ts`):

```ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 3000,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}', 'server.test.mjs'] },
});
```

El punto de entrada (`src/main.tsx`) monta la app y carga las fuentes y el CSS de React Flow una sola vez:

```tsx
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@xyflow/react/dist/style.css';
import '@/app/globals.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

Una regla de ESLint (`no-restricted-imports`) refuerza los **límites de feature**: cada feature se importa por su *barrel* `@/features/<name>`, nunca por rutas internas.

---

## 3. Scaffolding de `src/`

La estructura separa el *chrome* global (shell, layout, UI primitives) de las *features* verticales (modeler, reporting, standards, admin, governance, ddl, auth, help). Cada feature es autocontenida (componentes + servicios + estilos + barrel).

```
src/
├── main.tsx                 # Punto de entrada: monta <App/> en StrictMode
├── App.tsx                  # Router + ShellLayout + guards + bridge + hosts globales
├── app/
│   └── globals.css          # Orquesta @imports de tokens + base + estilos por feature
├── components/
│   ├── ui/                  # Design-system: Button, Dialog, Badge, Avatar, Icon,
│   │                        #   SegmentedControl, Tooltip, Modal, ConfirmDialog,
│   │                        #   TagEditor, dialogs (DialogHost), index (barrel)
│   ├── layout/              # TopNav, UserMenu, Header, Sidebar, AppLayout
│   └── OpenModelModal.tsx   # Selector de versión/modo al entrar al canvas
├── features/
│   ├── modeler/             # El canvas ER (ver §6)
│   │   ├── components/      #   WorkspaceScreen, ModelerCanvas, TableNode, ViewNode,
│   │   │                    #   ShapeNode, CrowFootEdge, DerivationEdge, CrowFootMarkers,
│   │   │                    #   Toolbar, ModelExplorer, DatabaseExplorer, PropertiesPanel,
│   │   │                    #   ColumnEditor, ViewEditor, ComplexTypeBuilder,
│   │   │                    #   RelationshipPopup, RelIcon, NewTableModal, CtasModal,
│   │   │                    #   PublishModal, SchemaManagerModal, SchemaSelect,
│   │   │                    #   ModelPropertiesModal, UdpAssign
│   │   ├── lib/             #   elkLayout (auto-layout ELK), lodSize (LOD, §6.7),
│   │   │                    #   complexTypes, keyOrder, nameSync, relationshipPairs,
│   │   │                    #   schemaStaging, viewEditorLogic, viewGraph, viewSync
│   │   ├── services/        #   modeler.service, structure.service, schemas.service,
│   │   │                    #   explorer.service (Database Explorer draft-aware)
│   │   └── index.ts         #   Barrel: exporta WorkspaceScreen
│   ├── reporting/           # Grilla + Report Designer (ver §7)
│   │   ├── components/      #   ReportDesigner, FilterBuilder, ResultsGrid, SqlEditor
│   │   └── query.service.ts #   ReportSpec, runQuery/runSql, insights, export
│   ├── standards/           # Glossary / Parent Domains / UDP / DDL Export rules (ver §9)
│   │   ├── components/      #   StandardsScreen, GlossaryPage, DomainsPage, UdpDefsPage,
│   │   │                    #   DdlRulesTab, DdlRuleCatalog, DdlRuleEditor,
│   │   │                    #   DdlRuleTemplates, DdlLookupsEditor
│   │   ├── standards.service.ts, ddlRules.service.ts (YAML round-trip),
│   │   ├── domainImpact.ts, glossaryValidation.ts
│   │   └── index.ts
│   ├── admin/               # RBAC: usuarios, roles, matriz
│   │   ├── components/      #   AdminScreen, UserModal, RoleModal, PermissionMatrix…
│   │   ├── admin.service.ts
│   │   └── index.ts
│   ├── governance/          # Servicios changeset-aware + pantalla legacy
│   │   ├── components/      #   GovernanceScreen y ApprovalInbox (legacy, fuera del rail),
│   │   │                    #   ChangesetBar, CatalogPanel
│   │   └── services/        #   changeset.service, governance.service
│   ├── ddl/                 # generators (genDDL/genViewDDL), rulesBridge, ExportDdlModal
│   ├── auth/                # LoginScreen, guards (RequireAuth/RequirePermission), auth.service
│   └── help/                # HelpCenter bilingüe + contenido + PDF técnico
├── screens/                 # Pantallas de alto nivel montadas por el router
│   ├── HomeScreen.tsx
│   ├── ReportingScreen.tsx
│   ├── ReviewScreen.tsx
│   └── review/              #   ChangesSummary, ChangesDetailModal, DiffTree (ver §9)
├── store/                   # Stores Zustand + bridge + reset (ver §4)
│   ├── useAuthStore.ts
│   ├── useSessionStore.ts
│   ├── useChangesetStore.ts
│   ├── useIdentityStore.ts
│   ├── useModelerStore.ts
│   ├── sessionChangesetBridge.ts
│   └── resetAppState.ts     #   Limpia el estado de trabajo por usuario (logout/401/login)
├── services/                # Clientes HTTP transversales
│   ├── http.ts              #   apiFetch + envelope + X-Session-Token + 401 global
│   ├── apiBase.ts           #   API_BASE = import.meta.env.VITE_API_URL ?? ''
│   ├── warmup.ts            #   Warm-up SSO cross-app (inerte con API_BASE vacía)
│   ├── versioning.service.ts, dashboard.service.ts, projects.service.ts,
│   ├── reporting.service.ts, views.service.ts, naming.service.ts, identity.service.ts
├── hooks/                   # useIdentity (+ README de convenciones)
├── lib/                     # Utilidades puras (tags.ts)
├── types/                   # api.ts, model.ts, versioning.ts, identity.ts
└── styles/                  # tokens, base, ui, components, topnav, shell, home,
                             #   review, reporting (CSS global, sin CSS Modules)
```

Fuera de `src/`, en la raíz del repo, viven **`server.mjs`** (el servidor de producción, §3.1) y **`server.test.mjs`** (sus 12 tests, incluidos en el `include` de Vitest). `server.mjs` no está bajo `tsc` (el `tsconfig.json` solo incluye `src/`).

**Convención de estilos**: el CSS es global y se compone en cascada desde `app/globals.css`, que hace `@import` de los tokens y de las hojas por feature. No hay CSS Modules ni CSS-in-JS por defecto (aunque algunos componentes usan estilos inline puntuales, como `AdminScreen` o `ReportDesigner`).

### 3.1 El servidor de producción (`server.mjs`)

En producción el bundle estático no se sirve suelto: lo sirve `server.mjs`, un servidor Node propio de **cero dependencias** (solo módulos `node:fs`, `node:http`, `node:https`, `node:path`, `node:url`) que reemplaza a `vite preview` y cumple dos roles:

1. **Estáticos + fallback SPA**: sirve `dist/` (solo GET/HEAD; otros métodos → 405), con guardia anti path-traversal (`safeJoin`), cache inmutable para `/assets/*` (`public, max-age=31536000, immutable`) y `no-cache` para el resto (incluido `index.html`). Cualquier ruta no encontrada cae a `index.html` — el requisito del `BrowserRouter` (§5).
2. **Proxy `/api` → backend**: reenvía `/api` y `/api/*` al backend FastAPI (destino en `BACKEND_API_URL`) adjuntando un token OAuth **M2M** del service principal del front (`POST {DATABRICKS_HOST}/oidc/v1/token`, grant `client_credentials`, scope `all-apis`). La clase `TokenCache` cachea el token hasta su expiry **menos 5 minutos** y deduplica mints concurrentes (N requests simultáneas = 1 solo mint). El tráfico es **streaming puro** en ambos sentidos (pipe, sin bufferear cuerpos). Ante `401/403` del backend invalida el cache y reintenta UNA vez con token fresco, **solo para GET/HEAD** (el body de un POST ya se consumió del stream). El header `Authorization` entrante del cliente **se descarta** — el Bearer siempre lo pone este server; el JWT propio de la plataforma viaja aparte en `X-Session-Token` y pasa intacto al backend.

El motivo (doc 36 de plan-implementacion/): en Databricks Apps cada app tiene su propio muro SSO y `databricksapps.com` está en la Public Suffix List, así que la cookie de sesión es **por app** — un `fetch()` del navegador hacia la app backend no puede completar el baile SSO cross-origin. La solución definitiva es **un solo origen**: el navegador solo habla con el front, y `server.mjs` habla con el backend servidor-a-servidor.

Variables de entorno: `BACKEND_API_URL` (destino del proxy; sin ella el proxy responde 502), `DATABRICKS_HOST` + `DATABRICKS_CLIENT_ID`/`DATABRICKS_CLIENT_SECRET` (inyectadas por Databricks Apps; sin credenciales el proxy no adjunta Bearer — el modo local: `BACKEND_API_URL=http://localhost:8000 node server.mjs`) y `DATABRICKS_APP_PORT` (fallback `PORT`, fallback 3000). El archivo exporta `contentTypeFor`, `safeJoin`, `TokenCache`, `buildUpstreamHeaders` y `createServer` para los tests. Detalle operativo del deploy en [deployment.md](deployment.md).

---

## 4. Gestión de estado (Zustand)

El estado se reparte en cinco stores Zustand, cada uno con una responsabilidad clara, más un *bridge* que sincroniza dos de ellos y un módulo de limpieza (`resetAppState.ts`) que borra el estado de trabajo por usuario en logout/401/login — aísla la sesión entre usuarios en la misma máquina. No hay Context API ni Redux: los componentes leen con selectores (`useStore(s => s.campo)`) y los servicios leen/escriben con `getState()`.

```mermaid
flowchart TD
  subgraph Stores["Stores Zustand"]
    Auth["useAuthStore<br/>status, user, permissions<br/>login / logout / restore / has"]
    Session["useSessionStore<br/>SimUser, openMode<br/>activeChangesetId, versionLabel<br/>openModel"]
    Changeset["useChangesetStore<br/>activeId, changesets<br/>create / submit / approve / reject"]
    Identity["useIdentityStore<br/>principal (legacy /api/me)"]
    Modeler["useModelerStore<br/>projects, folders, diagram<br/>drawings, dirty, flow<br/>CRUD de tablas/columnas/relaciones"]
  end

  Bridge["sessionChangesetBridge<br/>espeja activeChangesetId -> setActive"]

  Auth -- "mirror(user)" --> Session
  Session -- "subscribe (session -> changeset)" --> Bridge
  Bridge --> Changeset
  Modeler -- "lee activeId" --> Changeset
  Modeler -- "gate openMode/readonly" --> Session

  Http["services/http.ts<br/>setAuthToken / setDevUser / onUnauthorized"]
  Auth -- "setAuthToken(token)" --> Http
  Session -- "setDevUser(id)" --> Http
```

### 4.1 `useAuthStore` — identidad autoritativa

Fuente de verdad del usuario logueado y sus permisos, con **auth propia por token** (bcrypt + JWT en el backend). Persiste el token en `localStorage` (`dmh.token`) y lo empuja al cliente HTTP.

- `status`: `'loading'` (restaurando al boot) · `'anon'` (sin sesión) · `'authed'`.
- `login(username, password)` → guarda token, espeja el actor a `useSessionStore`, marca `authed`.
- `restore()` → al boot, si hay token llama `GET /api/auth/me`; sin `permissions` en la respuesta, la sesión se considera inválida.
- `has(perm)` → booleano reactivo consultado por el `TopNav`, los guards y las pantallas.

Al montarse, registra el *handler* global de 401: si el backend responde `401`, cierra sesión y el guard redirige a `/login`.

### 4.2 `useSessionStore` — actor simulado + intención de apertura del canvas

Centraliza el actor de la sesión (para el header `X-Dev-User` en modo local) y la intención con la que se abre el modelo:

```ts
export type OpenMode = 'readonly' | 'editing';

openModel({ mode, changesetId, versionLabel }: OpenModelArgs) => void;
// setea openMode, activeChangesetId y activeVersionLabel
```

El `openModel` NO navega: quien lo invoca (el `OpenModelModal` o `ReviewScreen`) decide el `navigate('/model')`. En modo `editing` el changeset es la *working copy* a mutar; en `readonly` con changeset, el canvas LEE su overlay pero las escrituras quedan bloqueadas.

### 4.3 `useChangesetStore` — changeset activo

Mantiene `activeId` (el changeset que están leyendo/escribiendo los servicios de governance) y la lista de changesets con sus operaciones (`create`, `submit`, `approve`, `reject`). También conserva el `devUser` y lo propaga con `setDevUser`.

### 4.4 `useIdentityStore` — legado

Carga idempotente de `GET /api/me` (Principal). Es un store de compatibilidad; la identidad autoritativa vive en `useAuthStore`.

### 4.5 `useModelerStore` — el corazón del canvas

El store más grande (~600 líneas). Gestiona:

- **Árbol del explorer**: `projects`, `folders`, `subjectAreas`, y un cache por-proyecto `trees` para expandir varios proyectos a la vez.
- **Sesión de canvas**: `activeProjectId`, `activeFolderId`, `activeSaId`, `diagram`, `viewMode` (`logical`/`physical`).
- **Selección e interacción**: `selectedTableId`, `selectedEdgeId`, `hoverEdgeId`, `hoverNodeId`, la instancia de React Flow (`flow`) y `focusTable`.
- **LOD del canvas**: `lod` (default `true` — la primera pintura de un canvas grande ya sale compacta) y `lodLock` (candado que fuerza detalle completo durante el export SVG). Ver §6.7.
- **Focus cross-canvas**: `openCanvasAndFocus` / `pendingFocusTableId` — el Finder del Database Explorer abre otro canvas y centra la tabla pedida.
- **Capa DRAWING**: formas libres (`drawings`) persistidas con *debounce* de 500 ms por canvas.
- **Checkpoint `dirty`**: alimenta el guard de salida (guardar y salir / salir sin guardar). `saveAll()` persiste layout + drawings y limpia `dirty`.
- **CRUD de modelo**: `createTable`, `addColumn`, `createRelationship`, `updateColumn`, `reorderColumns`, `deleteColumn`, etc. Todas marcan `dirty`, escriben vía `governance.service` (changeset-aware) y hacen `reload()`.

Incluye protecciones de concurrencia notables: un contador de secuencia (`_loadSeq`) descarta respuestas de diagrama fuera de orden, y `reorderColumns` persiste en tandas de 5 para no saturar el backend con ráfagas de PUT.

Los selectores derivados (`selectActiveTree`, `buildProjectTree`) arman el árbol anidado a partir del estado plano.

### 4.6 `sessionChangesetBridge` — el puente sesión ↔ changeset

Es la pieza que evita duplicar lógica. El flujo de "Open model" decide la *working copy* en `useSessionStore.activeChangesetId`, pero los lectores existentes (`governance.service`, el canvas, los paneles) leen `useChangesetStore.activeId`. El bridge **espeja unidireccionalmente** session → changeset:

```ts
useSessionStore.subscribe((state, prev) => {
  if (state.activeChangesetId === prev.activeChangesetId) return;
  useChangesetStore.getState().setActive(state.activeChangesetId);
});
```

Se instala una sola vez desde `App.tsx` (`installSessionChangesetBridge()`), es idempotente y no genera ciclos de import ni de actualización.

### 4.7 El cliente HTTP (`services/http.ts`)

Todos los servicios se construyen sobre `apiFetch<T>`, que:

1. Envía en **cada** llamada el token de sesión como header `X-Session-Token: <token>` (si hay token) — NO como `Authorization: Bearer`: en Databricks Apps ese header lo consume el proxy SSO de la plataforma (y `server.mjs` lo descarta, §3.1). El backend acepta ambos headers (`Authorization` sigue sirviendo para `curl`/dev). `X-Dev-User: <id>` (actor simulado) viaja **solo en desarrollo** (`import.meta.env.DEV`). Todo con `credentials: 'include'`.
2. Aplica un **timeout global de 30 s** combinando el `AbortSignal` del caller con `AbortSignal.timeout(...)`.
3. Desempaqueta el envelope `{ success, data, error }` y devuelve `data`; ante error lanza `ApiError` tipado (con `status`).
4. Ante `401` dispara el handler global de sesión inválida.
5. Propaga el `detail` de un `HTTPException` de FastAPI cuando la respuesta no trae envelope (por ejemplo, un `409` con mensaje legible).

Ejemplo de llamada real (equivalente en `curl` de lo que emite el navegador):

```bash
curl -s http://localhost:8000/api/projects \
  -H "X-Session-Token: eyJhbGciOi..." \
  -H "X-Dev-User: mr"
```

Respuesta (envelope):

```json
{
  "success": true,
  "data": [
    { "id": "p-001", "name": "Ventas", "description": "Modelo comercial" },
    { "id": "p-002", "name": "Finanzas" }
  ]
}
```

En caso de error:

```json
{ "success": false, "error": "La versión ya no está en borrador (submitted)." }
```

Los atajos `apiGet`, `apiPost`, `apiPut`, `apiDelete` envuelven `apiFetch` con el método correspondiente.

---

## 5. Routing (React Router v7)

El árbol de rutas vive completo en `App.tsx`. Usa `BrowserRouter` (rutas limpias, requiere fallback a `index.html` en el servidor) y anida los guards con rutas *layout* sin path.

```tsx
<BrowserRouter>
  <Routes>
    <Route path="/login" element={<LoginScreen />} />           {/* público */}
    <Route element={<RequireAuth />}>                            {/* exige sesión */}
      <Route element={<ShellLayout />}>                          {/* TopNav + Outlet */}
        <Route path="/" element={<HomeScreen />} />
        <Route path="/reporting" element={<ReportingScreen />} />
        <Route path="/model" element={<div className="dmh-model-route"><WorkspaceScreen /></div>} />
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/standards" element={<RequirePermission perm="model.view"><StandardsScreen /></RequirePermission>} />
        <Route path="/admin" element={<RequirePermission perm="admin.manage"><AdminScreen /></RequirePermission>} />
        <Route path="/governance" element={<GovernanceScreen />} /> {/* legacy, fuera del rail */}
      </Route>
    </Route>
  </Routes>
  <DialogHost />   {/* host global de confirm/prompt estilizados */}
  <Toaster richColors position="bottom-center" />
</BrowserRouter>
```

`App` también dispara `restore()` una vez al montar (para recuperar la sesión del token) y monta el bridge sesión↔changeset.

### 5.1 Los guards (`features/auth/guards.tsx`)

- **`RequireAuth`**: si `status === 'loading'` muestra un *splash* (evita el parpadeo login→app); si `'anon'` navega a `/login` recordando el destino (`state.from`); si `'authed'` renderiza el `<Outlet/>`.
- **`RequirePermission`**: consulta `useAuthStore.has(perm)`; sin el permiso redirige a `/` (además, el módulo ni aparece en el `TopNav`).

### 5.2 El `ShellLayout` y el `TopNav`

`ShellLayout` renderiza el `TopNav` persistente sobre el `<Outlet/>` de la página. El `TopNav` filtra sus ítems por permiso (`Data Standards` requiere `model.view`, `Admin` requiere `admin.manage`) y ejecuta un **guard de navegación**: si se sale de `/model` con una versión en edición y cambios sin guardar (`dirty`), intercepta la navegación y ofrece *Guardar y salir* / *Salir sin guardar* / *Cancelar*.

```mermaid
flowchart TD
  Start["Usuario abre una URL"] --> Login{"ruta == /login?"}
  Login -- si --> LoginScreen["LoginScreen (publico)"]
  Login -- no --> RA["RequireAuth"]

  RA --> St{"status"}
  St -- loading --> Splash["Splash (spinner)"]
  St -- anon --> Redir["Navigate /login (guarda from)"]
  St -- authed --> Shell["ShellLayout: TopNav + Outlet"]

  Shell --> Route{"ruta"}
  Route -- "/" --> Home["HomeScreen"]
  Route -- "/reporting" --> Rep["ReportingScreen"]
  Route -- "/model" --> Model["WorkspaceScreen"]
  Route -- "/review" --> Rev["ReviewScreen"]
  Route -- "/standards" --> RP1{"has model.view?"}
  Route -- "/admin" --> RP2{"has admin.manage?"}

  RP1 -- si --> Std["StandardsScreen"]
  RP1 -- no --> HomeR["Navigate /"]
  RP2 -- si --> Adm["AdminScreen"]
  RP2 -- no --> HomeR
```

### 5.3 Los permisos (matriz RBAC)

El tipo `Permission` es 1:1 con el backend:

```ts
type Permission =
  | 'model.view' | 'model.edit' | 'review.decide' | 'publish'
  | 'export' | 'standards.edit' | 'admin.manage';
```

`SessionUser` (de `GET /api/auth/me`) trae `permissions: Record<string, boolean>` ya resueltos por rol, más `projectIds`, `role`, `accessLevel`, etc.

---

## 6. El canvas de modelado (`features/modeler`)

El canvas es la pieza técnica más rica. Se construye sobre **@xyflow/react** (React Flow 12) para el viewport, los nodos y las aristas, y sobre **elkjs** para el auto-layout.

### 6.1 Composición de la pantalla

`WorkspaceScreen` orquesta el layout y el ciclo de vida de la sesión de canvas:

```mermaid
flowchart TD
  WS["WorkspaceScreen"] --> TB["Toolbar<br/>(Save, Auto-organize, New table,<br/>Find a table, Draw relation, Open model)"]
  WS --> ME["ModelExplorer<br/>(arbol Project -> Folder -> Canvas)"]
  WS --> MC["ModelerCanvas<br/>(ReactFlow)"]
  WS --> PP["PropertiesPanel<br/>(solo si hay tabla seleccionada)"]
  WS --> CE["ColumnEditor<br/>(modal agregar columna)"]
  WS --> OM["OpenModelModal<br/>(elegir version + modo)"]

  MC --> TN["TableNode (type=table)"]
  MC --> SN["ShapeNode (type=shape)"]
  MC --> CF["CrowFootEdge (type=crowfoot)"]
  MC --> CM["CrowFootMarkers (defs SVG)"]
  MC --> RPop["RelationshipPopup (editar relacion)"]
```

Al entrar a `/model` sin una versión elegida, `WorkspaceScreen` **fuerza** el `OpenModelModal`: no se puede interactuar con un canvas de "producción" hasta escoger versión y modo (`readonly` o `editing`). Además:

- Un `useEffect` con `beforeunload` avisa (nativo del navegador) si se cierra la pestaña con cambios sin guardar en modo `editing`.
- Una defensa en profundidad degrada la sesión a solo lectura si el changeset dejó de estar en `draft` o el actor ya no es su dueño (evita 409/403 en cada edición).

### 6.2 `ModelerCanvas` — el `ReactFlow`

Registra los tipos de nodo y arista y sincroniza el `diagram` del store con el estado interno de React Flow:

```tsx
const nodeTypes = { table: TableNode, shape: ShapeNode, view: ViewNode };
const edgeTypes = { crowfoot: CrowFootEdge, derivation: DerivationEdge };
```

Puntos de diseño relevantes:

- **Virtualización**: `onlyRenderVisibleElements` monta DOM solo para lo visible. Con ~100 tablas × ~30 columnas hay ~3.000 filas y ~6.000 *handles*; sin virtualización el navegador se ahoga. (En fit view esta poda no alcanza — de eso se encarga el LOD, §6.7.)
- **Zoom amplio**: `minZoom={0.02}` y `fitView` para ver canvases enormes (un auto-arrange de 100 tablas puede medir ~14000×19000 px).
- **Conexión por cualquier lado**: `connectionMode={ConnectionMode.Loose}` permite iniciar o soltar una relación en cualquier *handle* (source o target); el canvas reorienta los extremos antes de persistir.
- **Viewer-lock**: en `readonly` los nodos no son arrastrables (`nodesDraggable={!readonly}`) y los *handles* no conectan.
- **Sin borrado por teclado** (`deleteKeyCode={null}`): el default de React Flow borraba solo en pantalla (sin persistir), engañoso; los borrados reales van por UI explícita.
- **Persistencia al soltar**: `onNodeDragStop` guarda el layout de la tabla (o la posición del shape), marcando `dirty`.

La creación de relaciones (`onConnect`) usa un **edge fantasma optimista**: al soltar aparece un wire semitransparente (`pending`) mientras se persiste, y el `reload()` lo reemplaza por el real. Como React Flow normaliza la dirección de la conexión, el canvas guarda dónde empezó el gesto (`onConnectStart`) para reorientar los extremos antes de persistir.

### 6.3 `TableNode` — nodo de tabla con ancho dinámico

Cada tabla es un nodo custom, **memoizado** (`React.memo`) porque React Flow repinta los custom nodes en cada pan/zoom/drag — los cuatro componentes custom (`TableNode`, `ViewNode`, `CrowFootEdge`, `DerivationEdge`) van envueltos en `React.memo`. Renderiza el encabezado (esquema + nombre), separa PK del resto, y por cada columna emite dos *handles* (`{id}__src` a la derecha, `{id}__tgt` a la izquierda). El ancho no es fijo: se adapta al contenido (nombre físico/lógico + tipo), y ese ancho **medido** es el que consume el auto-layout.

Detalle de rendimiento: los selectores son **booleanos derivados**, no ids crudos. Por ejemplo `selected = useModelerStore(s => s.selectedTableId === table.id)` — así cambiar la selección solo re-renderiza los 2 nodos afectados, no los 100.

El modo edición (`canEdit`) exige changeset activo y no-readonly; el *tool* "Dibujar relación" armado (`relPreset != null`) es lo que vuelve conectables los *handles*.

### 6.4 `CrowFootEdge` — aristas con notación pata de gallo

Cada relación se dibuja con `getSmoothStepPath` (ruteo ortogonal H/V con esquinas redondeadas provisto por React Flow, sin matemática manual). El lado por el que sale/entra el wire se recalcula según la posición absoluta de los nodos (se voltea solo al mover las tablas). Los marcadores crow's-foot (`markerStart`/`markerEnd`) se eligen por cardinalidad:

```ts
type Cardinality = 'one' | 'many' | 'one-only' | 'zero-one' | 'one-many' | 'zero-many';
```

El resaltado al hover (relación bajo el mouse, o relaciones conectadas a la tabla bajo el mouse) usa selectores booleanos derivados para no re-renderizar todas las aristas.

### 6.5 Auto-layout con ELK (`lib/elkLayout.ts`)

`autoOrganize()` del store importa ELK dinámicamente y ejecuta el algoritmo `layered` (Sugiyama), que resuelve asignación de capas, orden dentro de capa (minimización de cruces) y coordenadas:

```ts
const opts = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.separateConnectedComponents': 'true',
  'elk.layered.spacing.nodeNodeBetweenLayers': '140',
  'elk.spacing.nodeNode': '72',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.thoroughness': '10',
  // …
};
```

ELK usa el ancho/alto **medido** de cada nodo (`n.measured`), de modo que respeta el tamaño real de tablas altas (30 columnas ≈ 700 px). El resultado (posiciones) se persiste con `setSubjectAreaLayout` (que mergea en el backend) y se recarga.

### 6.6 Carga del diagrama y escrituras changeset-aware

El diagrama se trae en **una sola request** que arma tablas + columnas + relaciones y aplica el overlay del changeset del lado del servidor:

```ts
GET /api/subject-areas/{saId}/diagram?changesetId={csId}
```

Todas las **escrituras de modelo** pasan por `governance.service`, cuyo *choke-point* `rec()` decide el destino según el estado:

- En `readonly` → lanza error (no muta).
- Sin changeset activo → lanza "Se requiere un changeset activo para editar".
- Con changeset → `PUT /api/changesets/{id}/changes` (un cambio por documento en la colección `changeset_changes`).

Las **lecturas** también son changeset-aware: con changeset activo leen el estado efectivo (`/effective/{collection}` con slices server-side por `tableId`/`ids`/`q`/`limit`); sin changeset leen el catálogo publicado (y la UI queda read-only).

Ejemplo de escritura (equivalente `curl`):

```bash
curl -s -X PUT http://localhost:8000/api/changesets/cs-42/changes \
  -H "X-Session-Token: <token>" -H "X-Dev-User: mr" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "canonical_columns",
    "entityId": "col-88",
    "op": "upsert",
    "payload": { "id": "col-88", "tableId": "t-7", "physicalName": "cust_id",
                 "logicalName": "Customer ID", "dataType": "BIGINT",
                 "isPrimaryKey": true, "ordinal": 0, "typeOverridden": false }
  }'
```

### 6.7 LOD — zoom semántico para canvases gigantes

Desde 2026-07-25 el canvas tiene **nivel de detalle** (LOD, doc 33 de plan-implementacion/). El disparador: en fit view TODOS los nodos son "visibles" y `onlyRenderVisibleElements` no poda nada — un canvas de 392 nodos con ~99 mil filas de columna/source generaba ~450 mil elementos DOM y se trababa; en modo compacto ese mismo fit view baja a ~2 mil elementos.

- **Umbrales con histéresis** en `lib/lodSize.ts`: `LOD_ENTER = 0.10` / `LOD_EXIT = 0.20` (calibrados en vivo el 2026-07-25). En compacto se sale recién con zoom > 0.20; en detalle se entra recién con zoom < 0.10 — la banda muerta evita el parpadeo al orbitar el umbral. `onMove` evalúa `nextLod` con *throttle* por rAF y solo parchea `data.lod` de los nodos al CRUZAR el umbral.
- **Caja compacta del mismo tamaño**: en modo LOD, `TableNode`/`ViewNode` pintan solo la caja (`schema.nombre` + conteo) replicando las métricas del nodo detallado (`lodSize.ts`, espejo de las fórmulas de `arrange_all` del backend) — el layout no salta. Las tablas conservan una franja PK proporcional y las vistas su *hatch* con borde punteado: no se pierde información visual.
- **Edges intactos — handles fantasma**: la caja compacta emite *handles* con los MISMOS ids que las filas del modo detallado (más `__hdr_src`/`__hdr_tgt`), y el cruce de umbral es un patch atómico: los wires nunca se re-arman ni pierden ancla, cero frames sin edges.
- **`lod` default `true`** en `useModelerStore`: la primera pintura de un canvas grande ya sale compacta; `onInit` + doble rAF la corrige en canvases chicos.
- **`lodLock` en el export**: el export SVG (`Toolbar`) fuerza detalle completo siempre — activa el candado, apaga el LOD, captura con `toSvg` y restaura al terminar.

El diagnóstico completo (por qué NO era Lakebase ni el backend) y la calibración están en [consideraciones-tecnicas.md](consideraciones-tecnicas.md).

---

## 7. Reporting: grilla + Report Designer (`features/reporting`)

La ruta `/reporting` tiene dos modos, controlados por `ReportingScreenWrapper`:

1. **Grilla de metadata** (default): tabla de tablas del modelo con búsqueda por nombre y **filtros facetados** (Schema · Project · Subject area) que se acotan mutuamente. Cada faceta calcula sus opciones excluyendo su propia selección. La carga es perezosa: primero 50 tablas; al aplicar el primer filtro (con *debounce*) se descarga el set completo para que el *faceting* sea exacto sobre todo. La exportación arma un **workbook Excel** con `xlsx`, una hoja por nivel de detalle marcado (Tables / Columns / Relationships / Definitions) y solo con las filas seleccionadas.

2. **Report Designer** (`onDesign`): un constructor de consultas con dos modos, `builder` y `sql`, sobre un IR común `ReportSpec`.

### 7.1 El motor de consulta (`query.service.ts`)

Todo gira alrededor de `ReportSpec`, el mismo IR que produce el builder visual y la caja SQL, y que consumen la grilla, las consultas guardadas y el export:

```ts
interface ReportSpec {
  from: 'columns' | 'tables' | 'relationships' | 'views';
  select: string[];
  where?: WhereGroup | null;         // and / or / not, anidable
  groupBy: string[];
  aggregations: Aggregation[];       // count, sum, avg, min, max, countDistinct
  orderBy: OrderBy[];
  limit: number;
}
```

Endpoints principales:

| Función | Endpoint | Rol |
|---------|----------|-----|
| `getCatalog(from)` | `GET /api/reporting/catalog?from=` | Campos disponibles (incluye UDP dinámico marcado `udp:true`). |
| `runQuery(spec, cursor?)` | `POST /api/reporting/query` | Ejecuta el `ReportSpec`; paginación por **keyset** (`nextCursor`). |
| `runSql(text, cursor?)` | `POST /api/reporting/query/sql` | Ejecuta SQL de texto (validado con sqlglot en backend). |
| `validateSql(text)` | `POST /api/reporting/query/validate` | Devuelve el `ReportSpec` derivado o errores con línea/columna. |
| `exportCsv(spec)` | `POST /api/reporting/export` | Descarga por **streaming** (fetch directo, sin bufferear en JS). |
| `getScorecard()`, `getUdpCoverage()`, … | `GET /api/reporting/insights/*` | Vistas curadas / KPIs. |

`ReportDesigner` mantiene el `spec` y el `sqlText`, ejecuta `run()` según el modo, y en modo builder re-ejecuta al cambiar el orden. La caja SQL, al validar, produce un `ReportSpec` y salta al builder. Los resultados se pintan en `ResultsGrid`, una **grilla virtualizada** con `@tanstack/react-virtual` que soporta *load more* por cursor hasta cientos de miles de filas.

```mermaid
flowchart TD
  RD["ReportDesigner"] --> Mode{"mode"}
  Mode -- builder --> FP["Field picker + FilterBuilder<br/>arma ReportSpec"]
  Mode -- sql --> SE["SqlEditor<br/>valida -> ReportSpec"]
  FP --> Run["run()"]
  SE --> Run
  Run --> Q{"modo"}
  Q -- builder --> RQ["POST /api/reporting/query"]
  Q -- sql --> RS["POST /api/reporting/query/sql"]
  RQ --> Grid["ResultsGrid (virtualizada)"]
  RS --> Grid
  Grid -- "nextCursor" --> LoadMore["loadMore() concatena filas"]
  RD --> Exp["exportCsv (streaming) / createReport (guardar)"]
```

---

## 8. El módulo Help (`features/help`)

`HelpCenter` es una guía de uso in-app, renderizada con `createPortal` como modal a pantalla completa (`z-index 1000`). Características:

- **Bilingüe** ES/EN con un selector propio (`lang`), sin depender de i18n externo: el contenido (`helpContent.ts`, `helpModules.generated.ts`) trae variantes `...En`/`...Es`.
- **Buscable**: filtra los módulos por texto (título, blurb, bullets).
- **Estructurado**: módulos (home, canvas, standards, reporting, admin, workflow), conceptos, pasos (STEPS) y FAQ, cada uno con su ícono lucide.
- **PDF técnico**: `openTechnicalDocPdf(lang)` abre la documentación técnica; si el navegador bloquea el pop-up, avisa con un toast.
- **Contacto**: enlace `mailto:` al soporte.

Se abre desde el botón "Help" del `TopNav` y se cierra con `Escape` o clic en el *backdrop*.

---

## 9. Los otros módulos de feature

Para completar el mapa funcional:

- **Data Standards** (`features/standards`): `StandardsScreen` con cinco sub-tabs — *Overview / Glossary / Parent Domains / UDP / DDL Export rules*. El glosario, los Parent Domains, las definiciones UDP y las reglas DDL se versionan **independientemente** del canvas, todos en el mismo stream (`standards_versions`, snapshot + `apply` + `rollback` por `seq`). Ver requiere `model.view`; editar requiere `standards.edit`. El servicio (`standards.service.ts`) expone `getSnapshot`, `getVersions`, `applyStandards`, `rollbackStandards`, `getUdpDefs`.
  - La 5.ª pestaña **"DDL Export rules"** (2026-07-20, doc 30 de plan-implementacion/) autora reglas que transforman el texto SQL del Export DDL según los valores de UDP del modelo (mask, tags, generación de tabla `_rej` y vista técnica), sin tocar el modelo ni la data. Componentes: `DdlRulesTab` (overview → catálogo → editor), `DdlRuleCatalog`, `DdlRuleEditor` (split Form ↔ YAML con 5 checks de validación y bloque Test/Impact), `DdlRuleTemplates`, `DdlLookupsEditor`. El servicio `ddlRules.service.ts` (con la dependencia `yaml 2.9.0` para el round-trip) consume los endpoints read-only `/api/ddl-rules/*` y el `POST /api/ddl-rules/render` (permiso `export`); las mutaciones van SOLO por `POST /api/standards/apply` extendido.
- **Admin** (`features/admin`): `AdminScreen` con sidebar de roles + tabla de usuarios + `PermissionMatrix` editable en borrador (nada se persiste hasta Guardar). Todo bajo `admin.manage`. El servicio cubre CRUD de usuarios/roles, catálogo de permisos y auditoría (`getAudit`).
- **Governance** (`features/governance`): hoy provee sobre todo los servicios `changeset.service` (cabecera del changeset, `recordChange`, `effective`, `submit`/`approve`/`reject`) y `governance.service` (el choke-point de escrituras). La `GovernanceScreen` — con su `ApprovalInbox` — es **legacy**: quedó parkeada fuera del rail (`/governance` sin entrada en el `TopNav`), pendiente de retiro; la revisión real vive en `ReviewScreen`.
- **DDL** (`features/ddl`): `genDDL`/`genViewDDL` generan `CREATE TABLE`/`CREATE VIEW` con cláusula de partición según el engine (Databricks SQL, PostgreSQL, MySQL, SQL Server), expuestos por `ExportDdlModal`; `rulesBridge.ts` conecta con las DDL Export rules — el modal genera el DDL base y lo manda a `POST /api/ddl-rules/render` con las reglas marcadas (sin reglas seleccionadas, el export es byte-identical al flujo previo).
- **Auth** (`features/auth`): `LoginScreen`, los guards y `auth.service` (`login`/`logout`/`fetchMe`).

El flujo de gobernanza (crear draft → editar en canvas → enviar a revisión → aprobar/rechazar/retirar/reabrir) se maneja en `ReviewScreen`, que consume `versioning.service` (`listVersions`, `getChangeset`, `getDiff`, `getDiffDetails`, `review`, `withdraw`, `reopen`, `addComment`) con detección de conflictos contra producción. Desde 2026-07-24 (doc 31 de plan-implementacion/) la presentación de cambios vive en `src/screens/review/`:

- **`ChangesSummary`**: card de resumen del request — chips de proyectos y modelos afectados + matriz de conteos Created/Modified/Deleted (verde/ámbar/rojo) por tipo de entidad (Tables, Columns, Views, Relationships, Schemas, Projects, Folders, Canvases; solo filas con conteo > 0). Todo derivado del `GET /diff` ya cargado (`summarizeDiff()`), cero backend nuevo.
- **`ChangesDetailModal`**: popup master-detail con el árbol jerárquico tintado por verbo (`DiffTree`), sección propia de **Relationships** (antes invisibles en modo jerárquico) y panel de diff de campos ANTES→DESPUÉS bajo demanda vía el endpoint read-only `POST /api/changesets/{id}/diff/details`, con UDP, dominios y tablas resueltos a NOMBRE (no ids).

---

## 10. Diagrama del flujo de estado end-to-end

Este `sequenceDiagram` traza un caso completo: abrir un modelo en edición y editar una columna.

```mermaid
sequenceDiagram
  participant U as Usuario
  participant OM as OpenModelModal
  participant Sess as useSessionStore
  participant Br as sessionChangesetBridge
  participant Cs as useChangesetStore
  participant Mod as useModelerStore
  participant Gov as governance.service
  participant Http as http.apiFetch
  participant API as Backend FastAPI

  U->>OM: elegir version + modo editing
  OM->>Sess: openModel(mode, changesetId)
  Sess-->>Br: subscribe (activeChangesetId cambio)
  Br->>Cs: setActive(changesetId)
  U->>Mod: editar columna en PropertiesPanel
  Mod->>Gov: updateColumn(col)
  Gov->>Gov: rec() valida openMode + activeId
  Gov->>Http: PUT /api/changesets/{id}/changes
  Http->>API: fetch (X-Session-Token + X-Dev-User)
  API-->>Http: { success, data }
  Http-->>Gov: data (o ApiError)
  Gov-->>Mod: ok
  Mod->>Mod: reload() -> GET /diagram?changesetId
  Mod-->>U: canvas actualizado
```

---

## 11. Despliegue y entorno

### 11.1 Dónde corre

En producción el frontend es una **Databricks App** (`frnt-data-model-hub`). El `config.command` del bundle es `npm run start`: el hook `prestart` construye (`npm run build` = `tsc --noEmit && vite build` → carpeta `dist/`) y `start` levanta **`node server.mjs`** (§3.1), que sirve el bundle estático y proxya `/api` al backend con el token M2M del service principal. Al usar `BrowserRouter` (rutas limpias sin `#`), es `server.mjs` quien hace el *fallback* de cualquier ruta no encontrada a `index.html`, para que el enrutado del lado del cliente funcione al recargar en `/model`, `/reporting`, etc. (Cualquier otro host estático necesitaría replicar ese fallback y un proxy equivalente.)

Arquitectura de **un solo origen** (desde 2026-07-31, doc 36 de plan-implementacion/): el navegador solo habla con el front; el cruce al backend lo hace `server.mjs` servidor-a-servidor. En desarrollo, el dev server de Vite (`:3000`) reenvía `/api` al FastAPI (`:8000`) vía proxy — mismo contrato de rutas relativas. La simulación local de producción es `BACKEND_API_URL=http://localhost:8000 node server.mjs` (sin credenciales de SP, el proxy va sin Bearer).

La suite del repo, verificada 2026-07-31: `npx tsc --noEmit` limpio + `npx vitest run` = **166 tests en 24 archivos** (23 `*.test.ts` bajo `src/` + los 12 tests de `server.test.mjs`).

### 11.2 Variables de entorno

Desde 2026-07-31 la URL del backend es una variable de **runtime** que consume `server.mjs`; ya no se inlinea nada en el build:

| Variable | Ámbito | Significado |
|----------|--------|-------------|
| `BACKEND_API_URL` | **Runtime** (env de la app; `databricks.yml` → variable `backend_api_url` ← GitHub Variable `BACKEND_API_URL`) | Destino del proxy `/api` de `server.mjs`. Cambiarla no exige tocar el bundle JS: el navegador siempre llama rutas relativas `/api`. |
| `VITE_API_URL` | **Solo local** (build-time, `import.meta.env`) | En dev va vacía (`.env`) — el proxy de Vite reenvía `/api` → `:8000`. Sirve para apuntar el dev local a otro backend. **NO debe definirse en Databricks Apps**: reactivaría el cruce directo navegador→backend y el doble SSO. |

Todos los servicios anteponen `API_BASE` (centralizado en `src/services/apiBase.ts`: `import.meta.env.VITE_API_URL ?? ''`) a sus rutas `/api/...`. Con `VITE_API_URL` sin definir, `API_BASE` queda vacío y **todas las llamadas son relativas `/api`** — que es exactamente el estado de producción: mismo origen, atendido por `server.mjs`. `.env.production` y la herencia `NEXT_PUBLIC_API_URL` fueron eliminados en la homologación de 2026-07-19.

### 11.3 Consideraciones de base de datos

El frontend **no accede a la base de datos**: toda la persistencia la resuelve el backend contra **Databricks Lakebase Postgres** (adaptador JSONB estilo Mongo). Lo relevante para el front es el contrato y sus implicancias de escala:

- **Envelope uniforme** `{ success, data, error }` en todo `/api/*`, desempaquetado por `http.ts`. Los `HTTPException` de FastAPI (`{ detail }`) también se propagan legibles.
- **Escala**: el modelo puede tener decenas de miles de tablas y cientos de miles de columnas. Por eso el front nunca baja colecciones completas: usa slices server-side (`?tableId=`, `?ids=`, `?q=`, `?limit=`), armado del diagrama en una sola request, y paginación por **keyset/cursor** en el reporting.
- **Changesets**: los cambios de una versión viven en una colección `changeset_changes` (un documento por cambio — patrón nacido del límite de 2 MB por documento de Cosmos y conservado sobre Lakebase) y nunca viajan crudos al cliente; se consumen vía `/effective` y `/diff`.
- **Sesión**: el token JWT se guarda en `localStorage` (`dmh.token`) y viaja como `X-Session-Token` (§4.7); en modo local el actor simulado viaja como `X-Dev-User`. Un `401` limpia el token y redirige a `/login`.

En resumen, el front es un cliente delgado y consciente de la escala: delega toda la lógica de persistencia, versionado y consulta al backend, y se concentra en el modelado visual, la gobernanza y el reporting sobre un contrato REST estable.

---

Rutas de referencia (absolutas) de los archivos clave descritos:
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/server.mjs` y `server.test.mjs`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/App.tsx`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/services/http.ts` y `.../services/apiBase.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/store/` (`useAuthStore`, `useSessionStore`, `useChangesetStore`, `useIdentityStore`, `useModelerStore`, `sessionChangesetBridge`, `resetAppState`)
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/modeler/components/ModelerCanvas.tsx`, `.../TableNode.tsx`, `.../CrowFootEdge.tsx`, `.../lib/elkLayout.ts`, `.../lib/lodSize.ts`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/features/reporting/query.service.ts` y `.../components/ReportDesigner.tsx`
- `/Users/carlosperez/Desktop/Projects/Agentes/GitHub/WebApp/MODELER/web-data-model-hub/src/screens/review/` (`ChangesSummary`, `ChangesDetailModal`, `DiffTree`)
