# Flujos de Datos

> Cómo se mueven los datos del browser al backend FastAPI (y viceversa) para cada
> acción. Arquitectura project-centric: **no hay rutas API en Next.js**, la
> persistencia vive en Cosmos DB y se accede con `apiFetch` cross-origin + cookie
> JWT. El estado de canvas vive en `useProjectStore`.

## 0. Login y bootstrap del estado

```mermaid
sequenceDiagram
    participant B as Browser
    participant SVC as authService
    participant FA as FastAPI :8000

    B->>SVC: login({username, password})
    SVC->>FA: POST /api/auth/login (credentials: 'include')
    FA->>FA: ensure_bootstrap_admin + bcrypt + sign_token (HS256, 10h)
    FA-->>B: 200 {success, data: AuthUser} + Set-Cookie modeler-auth
    B->>B: useAuthStore.setUser(user) + router.replace(next ?? '/')

    Note over B,FA: AppLayout monta → hydrate()
    B->>FA: GET /api/auth/me (cookie)
    FA-->>B: AuthUser (recargado de DB) → status 'ready'
```

Si la cookie expira, cualquier `apiFetch` cae en 401 → la UI redirige a `/login`.

---

## 1. Cargar un proyecto (hub / editor)

```mermaid
flowchart TD
    A["Entrar a /projects/{id}[/editor]"] --> B["useProjectStore.loadProject(id)"]
    B --> C["Promise.all:<br/>projectsService.getProject(id)<br/>canvasService.getCanvas(id)"]
    C --> D["set: currentProject (engines/layers/domains)<br/>tables · relationships · scope = fullScope(project)"]
    D --> E["Editor: seed de posiciones con layoutByLayer + scope inicial (?layer / ?domain)"]
```

`currentProject` trae la jerarquía embebida; `tables`/`relationships` vienen del
canvas. El **scope** inicial es todo el modelo, o la capa/dominio indicado por el
query param de entrada.

---

## 2. Ingesta de tablas — 4 caminos

Todos terminan mutando `useProjectStore` (update optimista) y disparando el
autosave del canvas (§3).

### 2.1 Formulario manual (`TableForm`)
Nombre · Schema · Modelo(capa) · Dominio (fija el color) · Subdominio · Definición
+ filas de columna (PK/FK/SK + Nullable + tipo). `addTable` / `updateTable`.

### 2.2 Desde tablas existentes (`CreateFromSqlModal` + `builders.tableFromSources`)
Elegir ≤2 fuentes (filtro En scope / Todas) → marcar columnas a heredar (dedup
por nombre) → meta (Nombre/Schema/Modelo/Dominio) → opción "Mantener relación a
los padres" (FK 1:N hacia la PK de cada padre). `addTable` + `addRelationship×M`.

### 2.3 Escribir DBML (`DBMLModal` + `builders.parseDBML`)
El editor abre con `genDBML(tables)`. "Aplicar DBML" **reemplaza** todo el canvas
(`setTables` + `setRelationships`); las refs `ref: >` se vuelven relaciones 1:N.

### 2.4 Importar Excel (`ExcelImportModal`)
Subir `.xlsx` → `POST /api/excel-import/preview` → revisar hojas (cada hoja = una
tabla) → "Importar". **Añade** tablas a las existentes; heredan capa/dominio del
scope cuando es único.

---

## 3. Persistencia del canvas (autosave)

```mermaid
sequenceDiagram
    participant U as User
    participant S as useProjectStore
    participant DBC as debounce 800ms
    participant SVC as canvasService
    participant FA as FastAPI

    U->>S: Modifica tabla / relación / vista
    S->>S: Update optimista (re-render inmediato)
    Note over DBC: 800ms de inactividad (indicador "Saving…")
    DBC->>S: persistCanvas()
    S->>S: stripear `position` de cada tabla
    S->>SVC: saveCanvas(projectId, {tables, relationships})
    SVC->>FA: PUT /api/projects/{id}/canvas (cookie)
    FA->>FA: check_project_access('edit') + _ensure_column_ids
    FA-->>S: { tables, relationships } → indicador "Saved"
```

- **Optimista**: la UI nunca espera al servidor. Si el PUT falla, se loguea el
  error pero no hay rollback.
- **Idempotente**: el PUT reemplaza el canvas en bloque; repetirlo no diverge.
- **Posiciones aparte**: `persistCanvas` quita `position`. (El editor actual no
  persiste posiciones — las recalcula con los layouts al abrir.)
- **Jerarquía del proyecto** (engines/layers/domains): se guarda por separado con
  `persistProjectMeta()` → `PUT /api/projects/{id}` (desde el hub).

---

## 4. Interacciones del canvas (hand-rolled, `ERCanvas`)

```mermaid
flowchart TD
    H["hover/seleccionar una tabla"] --> F["focusId = hover ?? selected"]
    F --> R["resaltar columnas relacionadas (activeCols)<br/>+ wire teal que 'fluye'; atenuar el resto"]
    G["engranaje del nodo"] --> GM["Editar tabla · color de cabecera · Eliminar"]
    C["modo Conectar"] --> C1["clic columna origen → clic columna destino (otra tabla)"]
    C1 --> C2["addRelationship(cardinalidad) + marca FK en la columna origen"]
    C2 --> CL{"gap de capas"}
    CL -->|"0"| OK["wire neutro"]
    CL -->|"1 (adyacente)"| TEAL["etiqueta teal A→B + toast"]
    CL -->|"≥2 (salto)"| WARN["ámbar punteado + ! + toast de aviso"]
```

El pan/zoom/fit/minimap son estado local del componente (no tocan el store). Las
posiciones (`positions`) son estado local del editor.

---

## 5. Scope (alcance de edición)

```mermaid
flowchart LR
    SC["ScopeControl (presets + checkboxes Modelos×Dominios)"] --> SS["useProjectStore.setScope({layers, domains})"]
    SS --> FT["isTableInScope(t, scope) filtra:"]
    FT --> V1["tablas/relaciones visibles en canvas + rail"]
    FT --> V2["fuentes en 'Desde tablas existentes'"]
    FT --> V3["capa/dominio default al importar Excel"]
    FT --> V4["opción 'Solo el scope' al exportar DDL"]
```

`scopeLabel(project, scope)` produce el texto del breadcrumb
(`Todo el modelo` / `UDV` / `Finanzas (vertical)` / `N modelos · M dom.`).

---

## 6. Exportación DDL (`features/ddl/`)

```mermaid
flowchart TD
    A["Export en la barra superior / 'Exportar DDL con vistas' en el Inspector"] --> M["DDLPreviewModal"]
    M --> O1["toggle 'Solo el scope actual'"]
    M --> O2["toggle 'Incluir vistas'"]
    O1 --> G["genDDL(tables, {name, engineLabel, includeViews})"]
    O2 --> G
    G --> SQL["CREATE TABLE (+NOT NULL, PRIMARY KEY)<br/>+ ALTER TABLE ADD FOREIGN KEY<br/>+ (opcional) CREATE VIEW por vista"]
    SQL --> CP["Copiar DDL → portapapeles"]
```

El generador es **puro**: misma entrada → misma salida; los toggles regeneran en
memoria.

---

## 7. Manejo centralizado de errores

```mermaid
flowchart LR
    F["apiFetch"] --> S{"resultado"}
    S -->|"OK envelope"| OK["return data"]
    S -->|"401"| A["ApiError(401) → UI redirige a /login"]
    S -->|"403"| FB["ApiError(403) → toast 'sin permiso'"]
    S -->|"success=false / no-2xx"| BE["ApiError(error, status) → toast"]
    S -->|"red caída"| NET["ApiError(message, 0)"]
```

`ApiError` (en `services/http.ts`) es la única forma de error que llega a la UI
desde la capa HTTP. Los componentes hacen `try/catch` y deciden toast / redirect.
Nunca se inspecciona `json.success` a mano fuera de `services/`.
