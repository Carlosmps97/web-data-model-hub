# Data Flow

## Overview

This document describes how data moves through the application for each of the three ingestion methods, as well as the persistence and canvas synchronization flows.

## Ingestion Methods

### 1. Manual (Form-Based)

```
User Input --> TableForm Component --> addTable() (Zustand)
                                          |
                                          v
                                    Zustand Store
                                    (tables array)
                                          |
                      +-------------------+-------------------+
                      |                                       |
                      v                                       v
               DiagramCanvas                          Auto-Save (2s debounce)
               (X6 renders nodes)                         |
                                                          v
                                                    PUT /api/models/:id
                                                          |
                                                          v
                                                    jsonStore.updateModel()
                                                          |
                                                          v
                                                    data/models/{id}.json
```

Flow:
1. User opens the Table Form modal
2. Fills in table name, columns (name, type, keys), and functional definitions
3. Configures FK references to existing tables
4. Submits the form
5. `addTable()` action adds the TableModel to the Zustand store
6. FK columns generate Relationship entries via `addRelationship()`
7. The DiagramCanvas component reacts to store changes and renders new X6 nodes
8. After 2 seconds of inactivity, the auto-save triggers a PUT request
9. The API route updates the JSON file on disk

### 2. Semi-Manual (Excel Import)

```
.xlsx File --> FileReader (ArrayBuffer) --> SheetJS Parser
                                               |
                                               v
                                         ParsedSheet[]
                                         (per sheet/tab)
                                               |
                                               v
                                       PreviewModal (editable)
                                               |
                                               v (on confirm)
                                       sheetsToTables()
                                               |
                                               v
                                        TableModel[]
                                               |
                                               v
                                     addTable() x N (Zustand)
                                               |
                                     +---------+----------+
                                     |                    |
                                     v                    v
                              DiagramCanvas          Auto-Save
```

Flow:
1. User uploads an .xlsx file via the dropzone
2. FileReader reads the file as ArrayBuffer
3. SheetJS parses the workbook into sheets
4. Each sheet becomes a ParsedSheet:
   - Sheet name becomes table name
   - Column A = column names
   - Column B = data types
   - Column C = functional definitions
5. Preview modal shows editable tabs for each detected table
6. User can modify column names, types, definitions; add keys and relationships
7. On confirm, `sheetsToTables()` converts ParsedSheet[] to TableModel[]
8. Tables are added to the Zustand store one by one
9. Canvas renders all new nodes; auto-save persists changes

Header detection: If the first row of a sheet contains keywords like "column", "name", "columna", or "nombre", it is treated as a header row and skipped.

### 3. Chat Agent (Shell)

```
User Message + Optional .xlsx --> POST /api/chat
                                       |
                                       v
                                  Mock Response
                                       |
                                       v
                                  ChatPanel UI
                                  (displays message)
```

Current behavior (shell):
1. User types a message and/or attaches an Excel file
2. POST request is sent to `/api/chat`
3. The endpoint returns a mock response acknowledging the input
4. The response is displayed in the chat panel

Future behavior (with agent backend):
1. User message and attachments are forwarded to the AI agent service
2. Agent processes the request and returns structured data
3. Response includes TableModel[] and Relationship[] if applicable
4. Tables are added to the canvas programmatically

## DBML Processing

```
DBML Text --> parseDBML() --> DBMLParseResult
                                 |
                          +------+------+
                          |             |
                          v             v
                    TableModel[]  Relationship[]
                          |             |
                          v             v
                    addTable()   addRelationship()
                                 (Zustand Store)
```

Parser capabilities:
- Table declarations with columns and settings
- Column settings: pk, sk, partition, not null, unique, increment, default, note, ref
- Standalone Ref declarations
- Note declarations for table descriptions
- Comment lines (//)
- Error reporting with line numbers

Reverse generation (`generateDBML()`):
- Takes TableModel[] and Relationship[]
- Outputs valid DBML text
- Preserves column settings and inline refs
- Adds standalone Ref for relationships not defined inline

## Persistence

### Data Directory Structure

```
data/
  projects.json          # Array of Project objects
  models/
    {uuid}.json          # Individual DataModel (tables + relationships)
```

### Save Flow

1. User modifies tables or relationships on the canvas
2. Zustand store updates immediately (optimistic UI)
3. After 2 seconds of no changes (debounce), `saveModel()` is called
4. PUT /api/models/:id sends current tables and relationships
5. API route merges updates and writes to the model JSON file
6. updatedAt timestamp is automatically set

### Load Flow

1. User navigates to a project page
2. GET /api/projects/:id fetches project metadata
3. GET /api/models?projectId=:id fetches all models for the project
4. First model is auto-loaded into the Zustand store
5. DiagramCanvas renders nodes and edges from the loaded data
6. Table positions are preserved from the saved data

## Canvas Synchronization

The DiagramCanvas component uses React effects to keep the X6 graph in sync with the Zustand store:

1. **Table sync**: Compares existing graph nodes with store tables. Adds new nodes, updates existing nodes, removes deleted nodes.
2. **Relationship sync**: Removes all edges and re-creates them from the current relationships array. Edge anchors are computed based on column indices.
3. **Selection sync**: Updates the visual selected state on nodes when `selectedTableId` changes.
4. **Position sync**: When a node is dragged, the `node:moved` event updates the table position in the store.
