# Flujos de Datos

> Cómo se mueven los datos del browser al backend FastAPI (y viceversa)
> para cada acción del usuario. Todos los diagramas reflejan el estado
> post-migración: **no hay rutas API en Next.js**, la persistencia
> vive en Cosmos DB y se accede mediante `apiFetch` cross-origin con
> cookie JWT.

## 0. Login y bootstrap del estado

```mermaid
sequenceDiagram
    participant B as Browser
    participant LP as /login (Next page)
    participant SVC as authService
    participant FA as FastAPI :8000
    participant DB as Cosmos DB

    B->>LP: render Login form
    B->>SVC: authService.login({username, password})
    SVC->>FA: POST /api/auth/login (credentials: 'include')
    FA->>FA: ensure_bootstrap_admin (idempotente)
    FA->>DB: get_user_by_username
    DB-->>FA: UserDoc
    FA->>FA: bcrypt.checkpw + sign_token (HS256, 10h)
    FA-->>B: 200 {success, data: AuthUser} + Set-Cookie modeler-auth
    SVC-->>B: AuthUser
    B->>B: useAuthStore.setUser(user) + redirect (next param o /)

    Note over B,FA: En subsequent navigations
    B->>FA: GET /api/auth/me (cookie)
    FA-->>B: AuthUser actualizado (recargado de DB)
    B->>B: useAuthStore.hydrate() → status: 'ready'
```

Si el cookie expira o se invalida, cualquier `apiFetch` posterior cae
en 401, `agentService` arroja `AgentClientError` y el resto arroja
`ApiError`. La UI desencadena un logout + redirect a `/login`.

---

## 1. Flujos de ingesta de tablas

### 1.1 Formulario manual

```mermaid
flowchart TD
    A["Usuario abre TableForm<br/>(Add Table o Edit gear)"] --> B["Completa General · Columns ·<br/>Partitioning · Metadata"]
    B --> C["Submit"]
    C --> D{"editingTable?"}
    D -->|"sí"| U["updateTable() — Zustand"]
    D -->|"no"| AD["addTable() — Zustand"]
    U --> CR["cascade rename: actualizar relationships<br/>cuyo sourceTable/targetTable era el name viejo"]
    AD --> RES["Resolver FKs declaradas en columnas:<br/>findColumnId(targetTable, fkRef.column) → addRelationship"]
    CR --> RES
    RES --> RF["DiagramCanvas useEffect detecta cambio<br/>→ TableNode + AnimatedEdges nuevas/renovadas"]
    RES --> SAVE["debounce 2s → modelsService.update"]
    SAVE --> FA["PUT /api/models/{id} en FastAPI"]
    FA --> DB[("Cosmos DB<br/>models + child collections")]
```

**Detalles importantes**:

- `TableForm.emptyColumn()` siempre genera un `id: uuidv4()` para
  cada columna nueva. **Renombrar** una columna no cambia su `id`,
  por lo que las relaciones que la referenciaban siguen apuntando al
  mismo handle de React Flow.
- `handleAddTable` resuelve los `foreignKeyRef` declarados en el form
  (que contienen **nombre** de tabla.columna) a `column.id` mediante
  `findColumnId(allTables, fkRef.table, fkRef.column)`. Si el destino
  no existe, la FK se ignora silenciosamente.
- Al editar, las relaciones existentes se preservan; solo se cascadea
  el cambio de `name` cuando aplica.

### 1.2 Importación desde Excel

```mermaid
flowchart TD
    A[".xlsx drop / file picker"] --> B["FileReader → ArrayBuffer"]
    B --> C["XLSX.read (SheetJS)"]
    C --> D["parseExcelFile<br/>una pestaña por tabla"]
    D --> E["ExcelImportModal preview editable"]
    E --> F["Confirmar"]
    F --> G["sheetsToTables<br/>(asigna id UUID por columna)"]
    G --> H["addTable × N — Zustand"]
    H --> I["Auto-save 2s → PUT /api/models/{id}"]
```

`sheetsToTables` siempre stamp `id: uuidv4()` en cada `TableColumn`
generada desde Excel — los datos de Excel no traen ids estables, así
que se inventan acá.

### 1.3 Editor DBML

```mermaid
flowchart TD
    A["Usuario escribe DBML"] --> B["parseDBML(text)"]
    B --> C{"errores?"}
    C -->|"sí"| ERR["panel de errores con línea/col"]
    C -->|"no"| D["TableModel[] + Relationship[]<br/>(post-process: name → id en relations)"]
    D --> E["setTables / setRelationships<br/>REPLACE total del modelo"]
    E --> F["DiagramCanvas re-render"]
    E --> G["debounce 2s → PUT /api/models/{id}"]

    style ERR fill:#fdd
```

**Capacidades del parser** (`@/features/table-editor/utils/dbmlParser.ts`):

- `Table name { … }` y `Table schema.name { … }` (asigna `TableModel.schema`).
- Settings de columna: `pk`, `sk`, `partition`, `not null`, `unique`,
  `increment`, `default: 'x'`, `note: '…'`, `ref: > t.col`.
- Refs FK con schema: `[ref: > schema.table.column]`.
- Declaraciones `Ref:` independientes.
- `length`/`scale` embebidos en el tipo: `varchar(50)`, `decimal(10,2)`.
- Descripciones de tabla con `Note:` (line o multi-line con `'''…'''`).
- Comentarios `//`.
- **Post-process** crítico al final del parse: cada `Relationship.sourceColumn`
  / `targetColumn` se resuelve de **nombre** a `id` vía `findColumnId`,
  porque DBML solo conoce nombres pero el modelo interno opera con
  ids estables. Si un nombre no resuelve (cross-model ref), se deja
  el nombre tal cual y la canvas lo flagea como huérfano.

**Inverso (`generateDBML()`)**: emite el DBML reproducible. Las
referencias `Ref:` se reescriben de id → nombre con `resolveColumnName`
para que el output sea legible.

> Aplicar DBML **reemplaza** todas las tablas del modelo. Si hay
> trabajo no guardado en otro flujo, el frontend pide confirmación
> con `ConfirmDialog`.

### 1.4 Crear tabla desde SQL (`CreateFromSqlModal`)

```mermaid
flowchart TD
    A["Usuario pega SELECT / CREATE TABLE AS"] --> B["parseSqlToTable<br/>(infiere columnas + JOINs)"]
    B --> C["Modal preview con columnas editables<br/>+ checkboxes por JOIN como FK propuesta"]
    C --> D["Confirmar"]
    D --> E["Construir TableModel + Relationship[]<br/>(joins → rels resueltas a column.id)"]
    E --> F["addTable + addRelationship × M — Zustand"]
    F --> G["Auto-save 2s"]
```

Las relaciones inferidas desde JOINs apuntan a las **tablas existentes**
del modelo (las que el SQL hace JOIN). El resolver
(`findColumnId(existingTables, leftTable, leftColumn)`) descarta joins
contra columnas que no existen.

### 1.5 Agente de IA de modelado

```mermaid
flowchart TD
    A["Usuario abre AI Agent panel"] --> EN["useAgentConversation.ensureSession(modelId, engine)"]
    EN --> CR["agentService.createConversation<br/>(POST /api/conversations)"]
    CR --> ST["useAgentStore.setSession(modelId, conversationId)"]

    A --> UP["Drop archivo de guidelines (opcional)"]
    UP --> UG["agentService.uploadGuidelines<br/>(POST /api/conversations/{id}/guidelines)"]

    A --> M["Drop Excel + click 'Modelar'"]
    M --> SM["agentService.generateModel(...)"]
    SM --> POST["POST /api/conversations/{id}/model<br/>(multipart: excel_file, engine, context_text)"]
    POST --> WAIT["Loading dog state · 5–60s típicos"]
    WAIT --> RES["ModelingResponse:<br/>tables · export_sql · export_markdown<br/>· qa_report (vacío hoy)"]
    RES --> BLOCK["ChatPanel renderiza ModelResultBlock<br/>(tablas + relaciones + DDL preview + QA)"]
    BLOCK -->|"Aplicar al canvas"| MAP["modelingResponseToCanvas:<br/>asigna ids estables a columnas<br/>y resuelve fk_references"]
    MAP --> APPLY["setTables + setRelationships"]
    APPLY --> AUTO["debounce 2s → PUT /api/models/{id}"]

    A -->|"Cerrar chat"| DEL["agentService.deleteConversation<br/>(libera memoria del backend)"]
```

**Características**:

- **Sesión scoped por `modelId`**: cada modelo abierto mantiene un
  `conversation_id` UUID v4 estable mientras dura la pestaña del
  browser. Recargar la página crea una sesión nueva (los mensajes
  del chat son volátiles por diseño).
- **Guidelines por sesión**: el archivo subido aplica solo a esta
  conversación. El backend lo cachea en memoria por `session_id`
  (ver backend doc).
- **Engine pass-through**: el engine del modelo
  (`postgresql` / `databricks_sql` / `sqlserver` / `mysql` / `cosmosdb`)
  se envía en cada turno; el agente genera DDL para ese motor.
- **Volátil en cliente**: los mensajes del chat NO se persisten en
  Cosmos DB. Solo el modelo "aplicado al canvas" llega a la DB.

---

## 2. Ciclo de persistencia (auto-save)

```mermaid
sequenceDiagram
    participant U as User
    participant S as Zustand (useModelStore)
    participant DBC as 2s debouncer
    participant SVC as modelsService
    participant FA as FastAPI
    participant DB as Cosmos DB

    U->>S: Modifica tabla / relación / view
    S->>S: Update optimista (UI re-render inmediato)
    S->>S: saving = true; trigger debouncer
    Note over DBC: 2 segundos de inactividad
    DBC->>SVC: modelsService.update(modelId, patch)
    SVC->>FA: PUT /api/models/{id} (cookie)
    FA->>FA: get_current_user + can_edit_model
    FA->>FA: _ensure_column_ids (safety net)
    FA->>DB: replace_entities (soft-delete + bulkWrite)
    DB-->>FA: ok
    FA-->>SVC: 200 {success, data: DataModel}
    SVC-->>S: payload
    S->>S: saving = false; lastSavedAt = now
```

**Garantías**:

- **Optimismo total**: la UI nunca espera al servidor para reflejar
  cambios. Si el `PUT` falla, se muestra el error pero la UI no
  rollbackea (criterio actual: el usuario corrige y reintenta).
- **Idempotencia**: el body del PUT incluye el modelo completo. El
  backend hace soft-delete de las child entities ausentes y upsert
  de las presentes — repetir el mismo PUT no genera divergencias.
- **Permisos en cada PUT**: el backend revalida `can_edit_model`. Si
  el admin revocó el permiso mid-sesión, el siguiente PUT cae en 403
  y la UI dispara logout/refresh.

---

## 3. Sincronización del canvas (DiagramCanvasInner)

`DiagramCanvasInner` usa dos `useEffect` independientes:

### 3.1 Sync de nodos

Se ejecuta cuando cambia `tables`, `selectedTableId`, `hoveredTableId`
o `activeColsByTable`.

```mermaid
flowchart TD
    A["Cambio en tables / hover / selección"] --> B["Calcular fingerprint estructural<br/>(hash de IDs + nombres + columnas)"]
    B --> C{"¿cambió la estructura?"}
    C -->|"no — solo hover/select"| D["Actualizar 'data' de cada node<br/>(highlight, activeRelationColumns)<br/>SIN reposicionar"]
    C -->|"sí"| E["layoutCompact() para nodos nuevos"]
    E --> F["Conservar posiciones existentes (drag) + asignar las nuevas"]
    D --> G["setNodes()"]
    F --> G
```

`activeColsByTable` es un `Map<tableId, Set<columnId>>` que rellena
la información de qué columnas están conectadas a `activeTableId`.
Como las relaciones almacenan `column.id`, el set también guarda ids.
`TableNode` matchea cada fila con `activeRelCols.includes(col.id)
|| activeRelCols.includes(col.name)` (el segundo término es fallback
para datos legacy pre-migration).

### 3.2 Sync de aristas

Se ejecuta cuando cambia `relationships`, `tables` o `activeTableId`.

- Reconstruye **todas** las edges desde cero (más simple que diff).
- `sourceHandle: ${rel.sourceColumn}-source`,
  `targetHandle: ${rel.targetColumn}-target`. Como `sourceColumn` /
  `targetColumn` son `column.id`, los handles del `TableNode` (ids
  también) matchean directamente.
- Asigna `highlighted` / `dimmed` según la relación con `activeTableId`.
- Asigna `edgeIndex` por par de nodos (offset escalonado para edges
  paralelos).

---

## 4. Hover & selección en el lienzo

```mermaid
flowchart TD
    H["Mouse enters table node<br/>(onNodeMouseEnter)"] --> HS["setHoveredTableId(nodeId)"]
    HS --> AT["activeTableId = hoveredTableId ?? selectedTableId"]
    AT --> CE["Edge useEffect: highlighted/dimmed por arista"]
    AT --> CN["Node useEffect: activeRelationColumns por nodo"]
    CE --> AE["AnimatedEdge: animación stroke + cambio de color"]
    CN --> TN["TableNode: clase active-relation-row en filas matched"]

    C["Click en nodo<br/>(onNodeClick)"] --> SS["setSelectedTableId(nodeId)"]
    SS --> AT

    G["Click en gear ⚙ del nodo"] --> GM["TableNodeGearMenu (Edit / Delete)"]
    GM -->|"Edit"| OE["onEditTable(id)<br/>→ ModelEditorPage abre TableForm modal"]
    GM -->|"Delete"| OD["ConfirmDialog (con skip-for-session)<br/>→ removeTable + removeRelationshipsByTable"]
```

> Hacer click en el cuerpo del nodo (no en el gear) **solo selecciona**.
> El TableForm se abre exclusivamente vía gear → Edit, para evitar
> aperturas accidentales mid-arrastre.

---

## 5. Toggle de vista List ↔ Canvas

```mermaid
flowchart LR
    T["Click en List | Canvas (segmented control)"] --> MV["setMainView('list' | 'canvas')"]
    MV -->|"'list'"| LV["TablesListView<br/>(card grid + búsqueda + tag filter + group-by)"]
    MV -->|"'canvas'"| CV["DiagramCanvas<br/>(React Flow ER)"]
    LV --> EA["Edit → openTableForm(table)<br/>Delete → handleDeleteTable(id)"]
    CV --> GE["Gear → Edit / Delete<br/>(mismos handlers)"]
```

Ambos componentes leen del mismo store. Cambiar de vista nunca
refetcha datos.

---

## 6. Exportación DDL

Tres scopes — cada uno invoca el mismo modal con un dataset distinto:

```mermaid
flowchart TD
    A["Trigger export<br/>(Export DDL toolbar / row ↓ / group ↓)"] --> B{"Scope"}
    B -->|"Modelo"| MS["generateTablesDDL(allTables, allRels, engine, opts)"]
    B -->|"Dominio"| DS["generateTablesDDL(domainTables, allTables, allRels, engine, opts)"]
    B -->|"Tabla"| TS["generateTableDDL(table, allTables, allRels, engine, opts)"]
    MS --> CTX["buildContext (resolveSchema · supportsSchemas · ...)"]
    DS --> CTX
    TS --> CTX
    CTX --> EM["emitSchemas (CREATE SCHEMA)"]
    CTX --> ET["emitTable per row"]
    CTX --> EFK["emitForeignKeysFor<br/>resolveColumnName(rel.sourceColumn → name)"]
    CTX --> ECM["appendComments<br/>(COMMENT ON TABLE / COLUMN)"]
    EM --> O["DDL string"]
    ET --> O
    EFK --> O
    ECM --> O
    O --> M["DDLPreviewModal"]
    M -->|"Copy"| CB["navigator.clipboard"]
    M -->|"Download"| DL["Blob → .sql"]
    M -->|"Toggle option"| RG["regenerar in-memory"]
    RG --> O
```

**Características clave**:

- El generador es **puro**: misma entrada → misma salida. Los toggles
  del modal disparan regeneración en memoria.
- `allTables` siempre se pasa al contexto para que las refs FK puedan
  calificarse con su schema destino, incluso si el scope expone solo
  un subset.
- Las FKs se emiten como `ALTER TABLE` al final → el script aplica
  aunque las tablas referenciadas se creen en cualquier orden.
- **Compat con datos legacy**: si una `Relationship.sourceColumn`
  todavía guarda un nombre (pre-migration), `resolveColumnName` lo
  detecta como fallback y no rompe.

---

## 7. Auto-distribución (Auto-Arrange)

```mermaid
flowchart TD
    A["Click en grid icon de Controls bar"] --> B["AutoArrangePopover"]
    B --> C{"Algoritmo"}
    C -->|"Left-right"| LR["layoutLeftRight()<br/>Kahn topological sort → layers"]
    C -->|"Snowflake"| SF["layoutSnowflake()<br/>BFS rings desde el nodo más conectado"]
    C -->|"Compact"| CP["layoutCompact()<br/>grid ordenado por degree"]
    LR --> P["positions: Record<id, {x,y}>"]
    SF --> P
    CP --> P
    P --> N["setNodes() en memoria"]
    N --> F["fitView animate"]
```

Las posiciones **no se persisten** al backend — son volátiles
mientras dura la sesión.

---

## 8. Manejo centralizado de errores

```mermaid
flowchart LR
    F["fetch (apiFetch o agentService)"] --> S{"status"}
    S -->|"401"| AUTH["throw ApiError(401)"]
    S -->|"403"| FBD["throw ApiError(403)"]
    S -->|"4xx envelope.success=false"| BE["throw ApiError(envelope.error)"]
    S -->|"500 / red caída"| NET["throw ApiError(message, 0|500)"]
    S -->|"OK"| OK["return data"]

    AUTH --> H1["Componente: catch ApiError → useAuthStore.logout()<br/>+ redirect /login"]
    FBD --> H2["Componente: catch ApiError → toast 'Sin permiso'"]
    BE --> H3["Componente: toast con err.message"]
    NET --> H4["Componente: toast 'Sin conexión'"]
```

`ApiError` (en `services/http.ts`) y `AgentClientError` (en
`services/agent.service.ts`) son las dos únicas formas de error que
llegan a la UI desde la capa HTTP. Cualquier componente que haga una
llamada usa `try/catch` y decide si muestra toast / redirige / dispara
un retry. Nunca se inspecciona `json.success` a mano fuera de la capa
service.
