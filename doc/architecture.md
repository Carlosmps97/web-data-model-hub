# Arquitectura del Frontend — `web-data-model-hub`

> Este documento refleja el estado **post-migración** a backend
> centralizado: el frontend ya **no expone rutas API propias** (la
> carpeta `src/app/api/` fue eliminada). Todo el tráfico — auth, CRUD
> de proyectos / modelos / usuarios y el agente de modelado — apunta
> directamente al backend FastAPI `agent-modeler` cross-origin.

## 1. Visión General

`web-data-model-hub` es la UI Next.js (App Router) del sistema de
modelamiento. Sus responsabilidades:

- Render del editor visual de modelos (canvas ER + lista de tablas).
- Captura del input del usuario (formulario, DBML, Excel, SQL, chat
  con el agente).
- Estado local efímero (Zustand) y sincronización persistente con el
  backend mediante `apiFetch`.
- Generación cliente-side de DDL y DBML a partir del modelo en memoria
  (no requiere round-trip al backend).
- Validación de sesión vía middleware de Next.js que verifica el JWT
  cookie firmado por el backend.

```mermaid
flowchart LR
    subgraph Browser["Browser :3000"]
        UI["React UI<br/>(Client Components)"]
        ZS["Zustand stores<br/>useAuthStore · useModelStore<br/>useUIStore · useAgentStore"]
        RF["@xyflow/react<br/>Diagram Canvas"]
        SVC["src/services/*<br/>(apiFetch, auth, projects,<br/>models, admin, agent)"]
    end

    subgraph Server["Next.js Server :3000"]
        MID["middleware.ts<br/>(JWT verify + redirect)"]
        PAGES["app/* (Server + Client Components)"]
    end

    subgraph Backend["FastAPI agent-modeler :8000"]
        FAPI["/api/auth/*<br/>/api/projects/*<br/>/api/models/*<br/>/api/conversations/*"]
        DB[("Cosmos DB<br/>db_modeler")]
        FAPI --> DB
    end

    UI --> ZS
    ZS --> SVC
    UI --> RF
    UI --> PAGES
    SVC -.cookie modeler-auth (cross-origin).-> FAPI
    PAGES --> MID
    MID -. verifica JWT .- FAPI
    FAPI -.401 / 200.-> ZS
```

> **No hay storage local en el frontend**. La carpeta `data/` del
> proyecto y el módulo `jsonStore.ts` desaparecieron en la migración a
> Cosmos DB. Si el backend está caído, el frontend muestra estados de
> error pero no almacena nada offline.

---

## 2. Estructura del repositorio

```
web-data-model-hub/
├── src/
│   ├── app/                       # App Router (sin /api/*)
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Dashboard / Projects landing
│   │   ├── login/page.tsx
│   │   ├── admin/                 # Admin de usuarios + permisos
│   │   ├── dashboard/             # Dashboard con métricas
│   │   ├── docs/                  # Documentación in-app
│   │   └── projects/[projectId]/
│   │       ├── page.tsx           # Lista de modelos del proyecto
│   │       ├── global/page.tsx    # Canvas global (todos los modelos)
│   │       └── models/[modelId]/page.tsx   # Editor del modelo
│   ├── components/                # Components compartidos (UI primitives)
│   ├── features/                  # Feature modules (componentes + utils)
│   │   ├── admin-users/           # CRUD users + permission editor
│   │   ├── chat-agent/            # ChatPanel + useAgentConversation
│   │   ├── ddl/                   # Generators y modal de DDL preview
│   │   ├── diagram/               # DiagramCanvas + TableNode + edges
│   │   ├── domains/               # DomainManager
│   │   ├── engines/               # EngineSelect + EngineBadge + capabilities
│   │   ├── excel-import/          # Modal + parser de Excel
│   │   ├── projects/              # Tarjetas y forms de proyectos
│   │   ├── table-editor/          # TableForm, DBML editor, SQL importer
│   │   └── views/                 # ViewForm
│   ├── hooks/
│   ├── lib/
│   │   ├── columnRef.ts           # findColumnId / resolveColumnName / ensureColumnId
│   │   ├── auth/permissions.ts    # canViewModel, canEditProject, ...
│   │   └── agent/
│   │       ├── mapping.ts         # ModelingResponse → Tables/Relationships
│   │       └── types.ts
│   ├── server/
│   │   └── auth/jwt.ts            # signAuthToken / verifyAuthToken (jose)
│   ├── services/
│   │   ├── http.ts                # apiFetch + ApiError envelope
│   │   ├── auth.service.ts
│   │   ├── projects.service.ts
│   │   ├── models.service.ts
│   │   ├── admin.service.ts
│   │   ├── agent.service.ts
│   │   └── index.ts               # barrel
│   ├── store/
│   │   ├── useAuthStore.ts
│   │   ├── useModelStore.ts
│   │   ├── useUIStore.ts
│   │   └── useAgentStore.ts
│   ├── types/
│   │   ├── model.ts               # TableModel, TableColumn (con id estable), Relationship, ...
│   │   ├── api.ts                 # ApiResponse envelope
│   │   └── auth.ts                # AuthUser, AuthJwtClaims, Permission
│   └── middleware.ts              # JWT cookie verification
├── doc/                           # Esta carpeta
└── package.json
```

---

## 3. Capa de servicios (`src/services/`)

Toda comunicación con el backend pasa por aquí. La capa es fina
y tipada — un wrapper sobre `fetch` que desempaqueta el envelope
`{success, data?, error?}` y arroja `ApiError` en cualquier ruta no-OK.

```mermaid
flowchart LR
    UI["Component / Store"] --> SERVICE["projectsService.listProjects(...)"]
    SERVICE --> APIF["apiFetch<T>(url, opts)"]
    APIF --> FETCH["fetch<br/>credentials: 'include'<br/>cache: 'no-store'"]
    FETCH --> BACK["FastAPI :8000"]
    BACK --> ENV["{ success, data?, error? }"]
    ENV -->|"success === true"| OK["return data as T"]
    ENV -->|"success === false<br/>o no-2xx"| ERR["throw ApiError"]
    OK --> SERVICE
    ERR --> SERVICE
```

| Service | Endpoints que consume | Notas |
|---------|-----------------------|-------|
| `authService` | `/api/auth/login`, `/logout`, `/me` | `getCurrentUser` retorna `null` ante 401 (no lanza). |
| `projectsService` | `/api/projects/*` | Funciones puras sin estado. |
| `modelsService` | `/api/models/*` | Soporta `projectId` y `full` query params. |
| `adminService` | `/api/admin/users/*` | CRUD usuarios + edición de permisos. |
| `agentService` | `/api/conversations/*` | Cliente especializado: usa `AgentClientError` (con `code` y `detail`) en vez del envelope genérico, porque el backend del agente devuelve `{detail, code}` directo (no envuelve). |
| `apiFetch` | base genérica | Agrega `Content-Type: application/json` automático cuando hay body, propaga `AbortSignal`, lanza `ApiError(message, status)` ante errores. |

**`NEXT_PUBLIC_API_URL`**: la base URL del backend la lee cada service
de `process.env.NEXT_PUBLIC_API_URL` (default vacío → mismo origen).
En desarrollo típico se setea a `http://localhost:8000`.

---

## 4. Stores de Zustand

```mermaid
graph TB
    subgraph AUTH["useAuthStore"]
        AU_ST["user · status · error"]
        AU_AC["hydrate · login · logout · setUser"]
        AU_HE["isAdmin · canViewProject · canEditProject<br/>canViewModel · canEditModel"]
    end

    subgraph MODEL["useModelStore"]
        MO_ST["currentModel · tables · relationships<br/>views · domainCatalog · saving"]
        MO_AC["loadModel · setTables · setRelationships<br/>addTable · updateTable · removeTable<br/>addRelationship · removeRelationship<br/>saveModel (debounced 2s)"]
    end

    subgraph UI["useUIStore"]
        UI_ST["selectedTableId · hoveredTableId<br/>panelOpen · activeRightTab"]
    end

    subgraph AGENT["useAgentStore"]
        AG_ST["sessionByModel: modelId → { conversationId, ... }<br/>history · isThinking · lastResponse"]
        AG_AC["ensureSession · sendMessage · uploadGuidelines · clearSession"]
    end

    AU_HE -. consume .-> MODEL
    AU_HE -. consume .-> AGENT
```

| Store | Persistencia | Cuándo se hidrata |
|-------|--------------|--------------------|
| `useAuthStore` | sin persist; `hydrate()` consulta `/api/auth/me` | una vez por mount del app shell |
| `useModelStore` | sin persist; `loadModel(id)` consulta `/api/models/{id}` | al entrar al editor |
| `useUIStore` | sin persist | local a la sesión del browser |
| `useAgentStore` | sin persist; `conversationId` por `modelId` | en el primer `ensureSession` por modelo |

> Mantener los stores **sin `persist`** es deliberado: la fuente de
> verdad es Cosmos DB. Persistir en localStorage agrega complejidad y
> no aporta — el modelo siempre se rehidrata desde el backend.

---

## 5. Auth y middleware

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as middleware.ts
    participant FA as FastAPI

    B->>M: GET /projects/abc (cookie modeler-auth)
    M->>M: jose.jwtVerify(cookie, AUTH_SECRET)
    alt token válido
        M-->>B: NextResponse.next() (renderiza la página)
        Note right of B: Client component pide datos
        B->>FA: GET /api/projects (cookie incluido)
        FA->>FA: pyjwt.verify(cookie, AUTH_SECRET)
        FA->>FA: get_user_by_id (recarga viva desde Cosmos)
        FA-->>B: 200 + payload filtrado por permisos
    else token inválido / ausente
        M-->>B: redirect 302 → /login?next=/projects/abc
    end

    Note over B,FA: Las rutas /api/* del browser que NO requieren login (login screen)<br/>están en la lista PUBLIC_PATHS del middleware
```

**Detalles importantes**:

- **Mismo `AUTH_SECRET`** en `web-data-model-hub/.env` y
  `agent-modeler/.env`. El frontend firma con `jose`, el backend con
  `pyjwt`, ambos HS256.
- El middleware **no consulta DB**: solo verifica firma + expiración.
  Eso lo hace edge-compatible y rápido. Las verificaciones de
  permisos finos (admin? puedo editar este proyecto?) las hace el
  backend en cada request — el frontend usa `useAuthStore.canEdit*`
  solo para esconder/deshabilitar UI.
- El cookie es **`HttpOnly`** + `SameSite=Lax`. JS no lo ve, no
  hay riesgo XSS de robo del token. Pero como ambos servidores corren
  en orígenes distintos en dev (`:3000` ↔ `:8000`), el browser solo
  envía el cookie si el fetch usa `credentials: 'include'`. Ambos
  clientes (`apiFetch` y `agentService`) lo activan explícitamente.

---

## 6. Editor de modelos — vistas y navegación

`ModelEditorPage` (`src/app/projects/[projectId]/models/[modelId]/page.tsx`)
gestiona dos toggles independientes:

```mermaid
flowchart LR
    subgraph LEFT["leftTab"]
        LT_V["'visual'<br/>(formularios + chat)"]
        LT_C["'code'<br/>(DBMLEditorPanel)"]
    end
    subgraph MAIN["mainView"]
        MV_L["'list'<br/>TablesListView"]
        MV_C["'canvas'<br/>DiagramCanvas"]
    end

    PAGE["ModelEditorPage"] --> LEFT
    PAGE --> MAIN
    LT_V -. dispara .-> TF["TableForm modal"]
    LT_V -. dispara .-> EX["ExcelImport modal"]
    LT_V -. abre .-> CHAT["ChatPanel (slideInRight)"]
    LT_C --> DBML["DBMLEditorPanel"]
    MV_L --> CARDS["Tablas como tarjetas + filtros"]
    MV_C --> CANVAS["React Flow ER"]
```

`TablesListView` y `DiagramCanvas` comparten el **mismo store**
(`useModelStore`); cambiar de vista nunca refetcha datos.

---

## 7. Diagrama (`features/diagram/`)

```mermaid
graph TD
    DC["DiagramCanvas (Provider wrapper)"]
    DCI["DiagramCanvasInner"]
    RF["ReactFlow"]
    TN["TableNode (erTable)"]
    NS["NamespaceBackground (namespace)"]
    AE["AnimatedEREdge (animatedER)"]
    CTRL["Controls"]
    AAP["AutoArrangePopover"]

    DC --> DCI
    DCI --> RF
    RF --> TN
    RF --> NS
    RF --> AE
    DCI --> CTRL
    CTRL --> AAP
```

### `DiagramCanvasInner` gestiona

- **Estado de hover/selección** (`hoveredTableId` + `selectedTableId`)
  → derivado `activeTableId`.
- **Columnas activas** (`activeColsByTable`): mapa
  `tableId → Set<columnId>`. Se rellena recorriendo las relaciones
  conectadas a `activeTableId`. **Las relaciones almacenan `column.id`
  estables, no nombres** — ver §9.
- **Asignación de `highlighted` / `dimmed` / `edgeIndex`** a cada
  arista para enrutar conexiones paralelas con offset escalonado.
- **Auto-distribución al cargar**: cuando cambia la "huella estructural"
  del set de tablas (hash de IDs + nombres + columnas), se ejecuta
  `layoutCompact` por defecto. Las posiciones arrastradas se conservan
  en memoria mientras dure la sesión, **pero no se persisten al backend**.

### `TableNode`

- Encabezado con nombre + conteo de columnas.
- Una fila por columna con: ícono PK/FK/SK/PT, nombre, ◇ nullable,
  tipo en mono.
- **Handles** (`react-flow`) por columna, con id `${col.id}-source` y
  `${col.id}-target`. La estabilidad del id de columna es lo que evita
  que renombrar una columna rompa los edges existentes.
- Tooltip on hover con `logicalName / name`, tipo, `functionalDefinition`,
  FK ref.

### `AnimatedEdge`

- Enrutamiento inteligente: lado mismo (L→L o R→R) cuando los nodos
  se solapan horizontalmente; lado opuesto (R→L) cuando hay espacio.
- `offset = 20 + edgeIndex × 16` para separar conexiones paralelas.
- Animación `stroke-dashoffset` cuando la arista está activa.

---

## 8. Generación de DDL (`features/ddl/`)

Todo client-side, sin round-trip al backend:

```mermaid
flowchart LR
    BTN["Export DDL button<br/>(toolbar / list view / card row)"] --> SCOPE{"scope"}
    SCOPE -->|"model"| GT["generateTablesDDL(allTables, allRels, engine, opts)"]
    SCOPE -->|"domain"| GTD["generateTablesDDL(domainTables, allTables, ...)"]
    SCOPE -->|"single table"| GTS["generateTableDDL(table, allTables, ...)"]
    GT --> CTX["buildContext<br/>resolveSchema · supportsSchemas · supportsClustering"]
    GTD --> CTX
    GTS --> CTX
    CTX --> EM["emitSchemas<br/>(CREATE SCHEMA)"]
    CTX --> ET["emitTable<br/>(types via TYPE_MAP, quoting,<br/>PK inline, partition / cluster suffix)"]
    CTX --> EFK["emitForeignKeysFor<br/>(ALTER TABLE ... FK<br/>resolveColumnName(id → name))"]
    CTX --> CMT["appendComments<br/>(COMMENT ON ...)"]
    EM --> SQL["SQL string"]
    ET --> SQL
    EFK --> SQL
    CMT --> SQL
    SQL --> M["DDLPreviewModal<br/>(copy / download / toggle options)"]
```

| Archivo | Rol |
|---------|-----|
| `engines/engines.ts` | Define `EngineDefinition` con `defaultSchema`, `partitionStrategies`, `supportsClustering`, `partitionHint`. La UI filtra opciones de partition usando este metadato. |
| `ddl/typeMappings.ts` | `TYPE_MAP` (canónico → dialect) + `quoteIdent()` + `qualifyTable()`. |
| `ddl/generators.ts` | Punto de entrada `generateTableDDL()` y `generateTablesDDL()`. Resuelve `Relationship.sourceColumn` (id) → nombre físico vía `resolveColumnName`. |
| `ddl/components/DDLPreviewModal.tsx` | Diálogo unificado (model / domain / single-table). Toggles `emitSchemas` · `emitForeignKeys` · `emitComments`. |

---

## 9. Identidad estable de columnas (column IDs)

Cambio importante introducido durante la migración: cada `TableColumn`
tiene un `id` UUIDv4 estable.

| Por qué | Antes | Ahora |
|---------|-------|-------|
| Renombrar una columna no debe romper sus relaciones | `Relationship.sourceColumn` guardaba el **nombre** → renombrar dejaba edges huérfanos y warnings de React Flow | guarda el `id` UUID; el nombre se resuelve solo al emitir DDL/DBML |
| Handles de React Flow | `${col.name}-source` | `${col.id}-source` |
| Edge construction | matching por nombre | matching por id (con fallback a nombre para compat) |

**Punto único de verdad**: `src/lib/columnRef.ts`.

```typescript
findColumnId(tables, tableRef, columnName): string | null     // name → id (en imports)
resolveColumnName(tables, tableRef, columnRef): string | null // id → name (al emitir SQL)
ensureColumnId(col): col with id guaranteed                    // backfill defensivo
ensureTableColumnIds(table): table con todos sus cols con id
```

**Cobertura**:

- `TableForm.emptyColumn()` siempre stamp un `uuidv4()`.
- Importadores (`excelParser`, `dbmlParser`, `sqlToTable`,
  `agentColumnToTableColumn`) idem.
- El backend (`models_db._ensure_column_ids`) hace **safety net** en
  cada write: si llega una columna sin `id`, la stampa antes de
  persistir.
- Hay un **script de migración one-shot**
  (`agent-modeler/scripts/backfill_column_ids.py`) para datos
  pre-migración: backfillea los IDs en `model_tables` y purga las
  relaciones legacy (que apuntaban por nombre).

---

## 10. Lienzo Global

`GlobalPage` (`src/app/projects/[projectId]/global/page.tsx`) carga
todos los modelos del proyecto con `modelsService.list({ projectId, full: true })`,
fusiona sus tablas en un único `DiagramCanvas` y las colorea según
modelo de origen vía `namespaces` (background nodes).

Es de **solo lectura**: no permite agregar/editar tablas. Útil para
ver el linaje completo cuando un proyecto agrupa varios modelos.

---

## 11. Decisiones tecnológicas

### Next.js 16 (App Router) sin rutas API propias
El frontend solo usa Next.js para SSR / routing / middleware. Las
rutas API se eliminaron al migrar a Cosmos DB porque mantenerlas como
proxy era redundante: cualquier feature de auth o permisos que
exponíamos en `/api/*` ya vivía mejor en FastAPI con permission
helpers compartidos. La consecuencia es que el frontend funciona
incluso desplegado en **Vercel / serverless** sin filesystem propio.

### `@xyflow/react` v12
Misma decisión que en versiones previas: hooks-first
(`useInternalNode`, `useReactFlow`), tipos custom de nodo y arista,
`getSmoothStepPath` con `offset` para edges paralelos.

### Zustand v5 sin `persist`
Cosmos DB es la fuente de verdad. Persistir en localStorage añadiría
una capa más de divergencia que no compensa.

### `jose` (Edge runtime) para verificar JWT
El middleware corre en el Edge runtime de Next.js. `jsonwebtoken`
no funciona ahí; `jose` sí. El backend Python usa `pyjwt`. Misma
firma HS256, claves idénticas → cookie firmado por uno verificable
por el otro.

### Sin storage local para el diagrama
Las posiciones del canvas son **solo en memoria**. Algoritmos de
auto-layout (`layoutCompact`, `layoutLeftRight`, `layoutSnowflake`) se
recalculan cada vez que se carga el modelo. Esto evita el infierno de
tener posiciones obsoletas tras renombres / borrados.
