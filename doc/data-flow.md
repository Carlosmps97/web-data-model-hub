# Flujo de Datos

## Visión General

Este documento describe cómo se mueven los datos a través de la aplicación para cada método de ingesta, el ciclo de persistencia, la sincronización del lienzo y los flujos de interacción con el diagrama.

## Flujos de Ingesta

### 1. Formulario Manual

```mermaid
flowchart TD
    A["User fills TableForm\n(name, columns, FK refs,\nfunctionalDefinition,\nappCode, domain, subdomain, tags)"] --> B["addTable() — Zustand"]
    B --> C["FK columns → addRelationship() — Zustand"]
    C --> D["DiagramCanvas useEffect reacts\n→ new React Flow node + edges"]
    B --> E["2s debounce timer"]
    E --> F["PUT /api/models/:id"]
    F --> G["jsonStore.updateModel()"]
    G --> H["data/models/{uuid}.json"]
```

**Pasos:**
1. El usuario abre el formulario de tabla, completa el nombre, columnas con tipos/llaves, definiciones funcionales por columna, referencias FK, y metadatos de clasificación opcionales (código de app, dominio, subdominio) y etiquetas libres
2. `addTable()` agrega el `TableModel` a Zustand; las columnas FK disparan `addRelationship()`
3. El `useEffect` de `DiagramCanvasInner` detecta el cambio en el store → agrega nodo + aristas en React Flow
4. El debounce de 2 segundos dispara `saveModel()` → `PUT /api/models/:id` → disco

Los metadatos de clasificación (`applicationCode`, `domain`, `subdomain`, `tags`) se almacenan en el objeto `TableModel` y se persisten en el JSON del modelo. No se usan en el renderizado del lienzo, pero impulsan el filtrado y la visualización de insignias en la **Vista de Lista**.

### 2. Importación desde Excel

```mermaid
flowchart TD
    A[".xlsx file dropped/selected"] --> B["FileReader → ArrayBuffer"]
    B --> C["SheetJS workbook.Sheets"]
    C --> D["ParsedSheet[] — one per tab"]
    D --> E["ExcelImportModal preview\n(editable table per sheet)"]
    E --> F["User confirms"]
    F --> G["sheetsToTables() → TableModel[]"]
    G --> H["addTable() × N — Zustand"]
    H --> I["DiagramCanvas renders nodes"]
    H --> J["Auto-save → disk"]
```

**Formato de hoja:**

| Columna A | Columna B | Columna C |
|-----------|-----------|-----------|
| column_name | data_type | functional_definition |

Detección de encabezado: si la primera fila contiene palabras clave como `column`, `name`, `columna` o `nombre`, se omite automáticamente.

### 3. Editor DBML

```mermaid
flowchart TD
    A["User writes DBML text"] --> B["parseDBML()"]
    B --> C{"Parse result"}
    C -->|"errors"| D["Error list shown in editor"]
    C -->|"success"| E["TableModel[] + Relationship[]"]
    E --> F["addTable() + addRelationship()\n— Zustand (replaces existing)"]
    F --> G["Canvas re-renders"]
    F --> H["Auto-save → disk"]
```

**Capacidades del parser** (`src/utils/dbmlParser.ts`):
- Declaraciones `Table name { … }` y `Table schema.name { … }` (asigna `TableModel.schema`)
- Configuraciones de columna: `pk`, `sk`, `partition`, `not null`, `unique`, `increment`, `default`, `note`, `ref`
- Refs FK calificables con schema: `[ref: > schema.table.column]`
- Declaraciones `Ref:` independientes
- Length / scale embebidos en el tipo: `varchar(50)`, `decimal(10,2)` → `length` + `scale` en `TableColumn`
- Descripciones de tabla con `Note:`
- Líneas de comentario `//`
- Reporte de errores con números de línea

**Inverso (`generateDBML()`):** toma `TableModel[]` + `Relationship[]` y genera texto DBML válido. Emite `Table schema.name { … }` cuando el schema está definido y respeta `length` / `scale` en la firma del tipo.

### 4. Agente de Chat (Shell)

```mermaid
flowchart TD
    A["El usuario escribe un mensaje\n± adjunto Excel"] --> B["POST /api/chat"]
    B --> C["Respuesta simulada (actual)"]
    C --> D["ChatPanel muestra el mensaje"]
```

> Futuro: `/api/chat` redirige al agente IA → el agente retorna `TableModel[]` → las tablas se agregan automáticamente al lienzo.

## Ciclo de Persistencia

```mermaid
sequenceDiagram
    participant U as User
    participant S as Zustand Store
    participant API as Next.js API
    participant FS as Filesystem

    U->>S: Modifica tabla / relación
    S->>S: Actualización optimista (UI inmediata)
    Note over S: Debounce 2s
    S->>API: PUT /api/models/:id
    API->>FS: Escribe data/models/{uuid}.json
    FS-->>API: OK
    API-->>S: { success: true, data: DataModel }
```

### Directorio de Datos

```
data/
├── projects.json            # Registro de Project[]
└── models/
    └── {uuid}.json          # DataModel completo (tablas + relaciones + posiciones)
```

## Sincronización del Lienzo

`DiagramCanvasInner` utiliza dos hooks `useEffect`:

### Sincronización de nodos (tablas)

Se ejecuta cuando cambia `tables`, `selectedTableId`, `hoveredTableId` o `activeColsByTable`.

- Calcula una **huella estructural** del arreglo de tablas
- Si solo cambió el estado de visualización (hover/selección), actualiza `data` en el lugar sin reposicionar
- Si cambió la estructura (columna agregada/eliminada), ejecuta `layoutLeftRight()` para calcular posiciones nuevas (las posiciones arrastradas existentes se conservan en memoria)
- **Las posiciones nunca se persisten** — se calculan desde el algoritmo de distribución cada vez que se carga el modelo
- Pasa el arreglo `activeRelationColumns` a cada nodo para que `TableNode` resalte las columnas conectadas

### Sincronización de aristas (relaciones)

Se ejecuta cuando cambia `relationships`, `tables` o `activeTableId`.

- Reconstruye todas las aristas desde cero
- Asigna `highlighted` / `dimmed` según `activeTableId`
- Asigna `edgeIndex` por par de nodos para separar conexiones paralelas

## Flujo de Interacción por Hover y Selección

```mermaid
flowchart TD
    H["Mouse enters table node\nonNodeMouseEnter"] --> HS["setHoveredTableId(nodeId)"]
    HS --> AT["activeTableId = hoveredTableId ?? selectedTableId"]
    AT --> CE["Edge useEffect: highlighted/dimmed per edge"]
    AT --> CN["Node useEffect: activeRelationColumns per node"]
    CE --> AE["AnimatedEdge: flow animation overlay\n+ wire color change"]
    CN --> TN["TableNode: active-relation-row CSS on matched columns"]

    C["Click table node\nonNodeClick"] --> SS["setSelectedTableId(nodeId)"]
    SS --> AT

    G["Click gear icon ⚙ on table node\nhandleGearClick"] --> GM["TableNodeGearMenu\n(Edit / Delete options)"]
    GM -->|"Edit"| OE["onEditTable(id)\n→ ModelEditorPage opens TableForm modal"]
    GM -->|"Delete"| OD["onDeleteTable(id)\n→ removeTable() + removeRelationshipsByTable()"]
```

> **Nota:** Hacer clic en el cuerpo de la tabla (no en el engranaje) solo dispara `setSelectedTableId` para resaltado visual. El formulario de edición se abre exclusivamente a través de la ruta engranaje → Edit.

## Flujo de Alternancia de Vista

```mermaid
flowchart TD
    T["User clicks List / Canvas toggle\nin ModelEditorPage header"] --> MV["setMainView('list' | 'canvas')"]
    MV -->|"'list'"| LV["Renders TablesListView\n(card grid, search, tag filter)"]
    MV -->|"'canvas'"| CV["Renders DiagramCanvas\n(React Flow ER diagram)"]
    LV --> EA["Edit → openTableForm(table)\nDelete → handleDeleteTable(id)"]
    CV --> GE["Gear menu → Edit / Delete\n(same handlers)"]
```

Ambas vistas comparten las mismas `tables` y `relationships` del store de Zustand — cambiar de vista nunca provoca una recarga de datos.

## Flujo de Exportación DDL

```mermaid
flowchart TD
    A["User triggers export\n(Export DDL button / row ↓ / group ↓)"] --> B{"Scope"}
    B -->|"Model"| MS["generateTablesDDL(allTables, …)"]
    B -->|"Domain group"| DS["generateTablesDDL(groupTables, allTables, …)"]
    B -->|"Single table"| TS["generateTableDDL(table, allTables, …)"]
    MS --> CTX["buildContext()\nresolveSchema per table"]
    DS --> CTX
    TS --> CTX
    CTX --> EM["emitSchemas (CREATE SCHEMA)"]
    CTX --> ET["emitTable per row\n(types via TYPE_MAP, quoting,\nPK inline, partition / cluster suffix)"]
    CTX --> EFK["emitForeignKeys\n(ALTER TABLE … ADD CONSTRAINT …)"]
    CTX --> ECM["appendComments\n(COMMENT ON TABLE / COLUMN)"]
    EM --> O["DDL string"]
    ET --> O
    EFK --> O
    ECM --> O
    O --> M["DDLPreviewModal"]
    M -->|"Copy"| CB["navigator.clipboard"]
    M -->|"Download"| DL["Blob → .sql download"]
    M -->|"Toggle option"| RG["regenerate via the same generator"]
    RG --> O
```

**Características clave:**
- El generador es **puro** — misma entrada produce misma salida; los toggles del modal disparan una regeneración en memoria.
- `allTables` siempre se pasa al contexto para que las refs FK puedan calificarse con su schema destino, incluso si el scope solo expone un subset.
- Los `ALTER TABLE` de FKs se emiten al final para que el script aplique aunque las tablas referenciadas se creen en cualquier orden.

## Flujo de Distribución Automática

```mermaid
flowchart TD
    A["User clicks grid icon\nin Controls bar"] --> B["AutoArrangePopover opens"]
    B --> C{"Algorithm selected"}
    C -->|"Left-right"| LR["layoutLeftRight()\nKahn topological sort → layers"]
    C -->|"Snowflake"| SF["layoutSnowflake()\nBFS rings from most-connected"]
    C -->|"Compact"| CP["layoutCompact()\nGrid sorted by degree"]
    LR --> P["positions Record — id → x,y"]
    SF --> P
    CP --> P
    P --> N["setNodes() — update positions in-memory"]
    N --> F["fitView() — animate to show all"]
```
