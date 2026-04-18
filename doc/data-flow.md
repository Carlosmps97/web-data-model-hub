# Data Flow

## Overview

This document describes how data moves through the application for each ingestion method, the persistence cycle, canvas synchronization, and the diagram interaction flows.

## Ingestion Flows

### 1. Manual Form

```mermaid
flowchart TD
    A["User fills TableForm\n(name, columns, FK refs, definitions)"] --> B["addTable() — Zustand"]
    B --> C["FK columns → addRelationship() — Zustand"]
    C --> D["DiagramCanvas useEffect reacts\n→ new React Flow node + edges"]
    B --> E["2s debounce timer"]
    E --> F["PUT /api/models/:id"]
    F --> G["jsonStore.updateModel()"]
    G --> H["data/models/{uuid}.json"]
```

**Steps:**
1. User opens Table Form, fills name, columns with types/keys, per-column functional definitions, and FK references
2. `addTable()` adds `TableModel` to Zustand; FK columns trigger `addRelationship()`
3. `DiagramCanvasInner` `useEffect` detects store change → adds React Flow node + edges
4. 2-second debounce fires `saveModel()` → `PUT /api/models/:id` → disk

### 2. Excel Import

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

**Sheet format:**

| Column A | Column B | Column C |
|----------|----------|----------|
| column_name | data_type | functional_definition |

Header row detection: if the first row contains keywords like `column`, `name`, `columna`, or `nombre`, it is skipped automatically.

### 3. DBML Editor

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

**Parser capabilities:**
- `Table` declarations with columns and inline settings
- Column settings: `pk`, `sk`, `partition`, `not null`, `unique`, `increment`, `default`, `note`, `ref`
- Standalone `Ref:` declarations
- `Note:` table descriptions
- `//` comment lines
- Error reporting with line numbers

**Reverse (`generateDBML()`):** takes `TableModel[]` + `Relationship[]` and emits valid DBML text.

### 4. Chat Agent (Shell)

```mermaid
flowchart TD
    A["User types message\n± Excel attachment"] --> B["POST /api/chat"]
    B --> C["Mock response (current)"]
    C --> D["ChatPanel displays message"]
```

> Future: `/api/chat` forwards to AI agent → agent returns `TableModel[]` → tables auto-added to canvas.

## Persistence Cycle

```mermaid
sequenceDiagram
    participant U as User
    participant S as Zustand Store
    participant API as Next.js API
    participant FS as Filesystem

    U->>S: Modify table / relationship
    S->>S: Optimistic update (immediate UI)
    Note over S: 2s debounce
    S->>API: PUT /api/models/:id
    API->>FS: Write data/models/{uuid}.json
    FS-->>API: OK
    API-->>S: { success: true, data: DataModel }
```

### Data Directory

```
data/
├── projects.json            # Project[] registry
└── models/
    └── {uuid}.json          # Full DataModel (tables + relationships + positions)
```

## Canvas Synchronization

`DiagramCanvasInner` uses two `useEffect` hooks:

### Node sync (tables)

Runs when `tables`, `selectedTableId`, `hoveredTableId`, or `activeColsByTable` changes.

- Computes a **structural fingerprint** of the tables array
- If only display state changed (hover/selection), updates `data` in-place without re-positioning
- If structure changed (column added/removed), runs `layoutLeftRight()` to compute fresh positions for new tables (existing dragged positions are preserved in-memory)
- **Positions are never persisted** — they are computed from the layout algorithm each time the model is loaded
- Passes `activeRelationColumns` array to each node so `TableNode` can highlight connected columns

### Edge sync (relationships)

Runs when `relationships`, `tables`, or `activeTableId` changes.

- Rebuilds all edges from scratch
- Assigns `highlighted` / `dimmed` based on `activeTableId`
- Assigns `edgeIndex` per node-pair to offset parallel wires

## Hover & Selection Interaction Flow

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
```

## Auto-Arrange Flow

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
