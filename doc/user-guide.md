# User Guide

## Getting Started

### Creating Your First Project

1. Open the application at `http://localhost:3000`
2. Click **New Project** in the top-right corner
3. Enter a project name (required) and optional description
4. Click **Create Project** → redirected to the diagram editor

### Creating a Data Model

1. Inside a project, click **Create First Model** (or **New Model** if models exist)
2. Enter a model name → **Create Model**
3. The diagram canvas appears with the sidebar on the left

---

## Adding Tables

### Method 1 — Manual Form

1. Click **+** in the sidebar header
2. Fill in:
   - **Table Name** — required (e.g. `user_accounts`)
   - **Functional Definition** — optional description of the table's business purpose
   - **Columns** — add rows with:
     - **Name** — column identifier
     - **Type** — select from the data type list
     - **PK** toggle — Primary Key
     - **FK** toggle — Foreign Key
     - **SK** toggle — Surrogate Key
     - **Null** toggle — nullable
     - **Column description** — optional per-column functional definition (shown in hover tooltip)
3. For FK columns, a **Foreign Key References** section appears — select target table + column
4. Click **Add Table**

### Method 2 — DBML Editor

1. Click the `<>` button in the sidebar
2. Write DBML in the editor:

```dbml
Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique, note: 'Contact email address']
  created_at timestamp
  Note: 'User account information'
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal(10,2)
  status varchar(20) [default: 'pending']
  Note: 'Customer order records'
}
```

3. Click **Apply DBML** to parse and create tables
4. Use the **Syntax Reference** button for a quick cheatsheet

**DBML column settings:**

| Setting | Meaning |
|---------|---------|
| `pk` | Primary Key |
| `sk` | Surrogate Key |
| `partition` | Partition Key |
| `not null` | Non-nullable |
| `unique` | Unique constraint |
| `increment` | Auto-increment |
| `default: 'x'` | Default value |
| `note: 'text'` | Column functional definition |
| `ref: > t.col` | FK → one-to-many |
| `ref: - t.col` | FK → one-to-one |
| `ref: < t.col` | FK → many-to-many |

Standalone ref: `Ref: orders.user_id > users.id`  
Comments: `// this is a comment`

### Method 3 — Excel Import

1. Click the upload button in the sidebar
2. Drag and drop a `.xlsx` file (or click to browse)
3. Each **sheet/tab** becomes one table:
   - Column A = column names
   - Column B = data types
   - Column C = functional definitions (optional)
4. Review + edit in the preview modal
5. Click **Import N Tables** to add to canvas

> First row is auto-skipped if it looks like a header (contains words like "column", "name", "columna", "nombre").

---

## Working with the Canvas

### Navigation

| Action | Input |
|--------|-------|
| Pan | Drag on empty canvas |
| Zoom | Mouse wheel |
| Zoom in/out | Controls bar ±/magnifier buttons |
| Fit all tables | Controls bar fit-view button |
| Mini-map pan | Drag inside the mini-map |

### Hover Interactions

Move your mouse over any **table block** to:
- **Highlight** the connected relationship wires with an animated flow
- **Dim** all unrelated wires
- **Glow** the columns involved in the relationship on both tables
- See a **tooltip** on any column with its name, data type, functional definition, and FK reference

### Selecting Tables

- Click a table node → highlights it + opens the right panel with details
- Click empty canvas → deselects
- Hover takes visual priority over click selection

### Moving Tables

- Drag a table node to reposition it
- Positions are **in-memory only** — on reload, the layout algorithm re-computes optimal positions automatically

### Editing a Table

1. Select the table → click **Edit** (pencil icon) in the right panel
2. Modify any fields in the form modal
3. Click **Update Table**

### Deleting a Table

1. Select the table → click **Delete** (trash icon) in the right panel
2. The table and all its relationships are removed

---

## Auto-Arrange Layouts

Click the **grid icon** in the bottom controls bar to open the **Auto Arrange** popover.

### Left-right (1)
Arranges tables in topological layers from left to right, following relationship direction. Tables with no incoming relationships appear on the leftmost column. Ideal for **ETL pipelines and lineage diagrams**.

### Snowflake (2)
Places the most-connected table at the center, then arranges connected tables in concentric radial rings. Ideal for **star schemas and data warehouses**.

### Compact (3)
Places tables in a grid sorted by connection count. Ideal for **diagrams with few relationships** or when you want a clean overview.

> After applying any layout, the canvas auto-fits to show all tables. Positions are kept in-memory for the current session.

---

## AI Chat (Preview)

1. Click the chat bubble button in the sidebar → panel slides in from the right
2. Type a message describing your data model needs
3. Optionally attach an Excel file with the paperclip button
4. Click Send

> **Note:** The AI backend is not yet connected — this is the UI shell for future integration.

---

## Auto-Save

All changes persist automatically **2 seconds** after the last modification. A "Saving…" indicator appears in the page header while saving.

## Model Switching

If a project has multiple models, use the dropdown in the header to switch. Each model maintains its own tables, relationships, and layout positions.
