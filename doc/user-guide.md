# User Guide

## Getting Started

### Creating Your First Project

1. Open the application at http://localhost:3000
2. Click the "New Project" button in the top-right corner
3. Enter a project name (required) and optional description
4. Click "Create Project"
5. You will be redirected to the diagram editor

### Creating a Data Model

Within a project, you can create multiple data models:

1. Click "Create First Model" (if no models exist) or "New Model"
2. Enter a model name
3. Click "Create Model"
4. The diagram canvas will appear with the sidebar and toolbar

## Adding Tables

### Method 1: Manual (Form)

The form-based editor provides full control over table definition.

1. Click the "+" button in the sidebar header
2. Fill in the fields:
   - **Table Name**: Required. Use lowercase with underscores (e.g., `user_accounts`)
   - **Functional Definition**: Optional description of the table's purpose
   - **Columns**: Add one or more columns with:
     - Name: The column identifier
     - Type: Select from the data type dropdown
     - PK: Toggle for Primary Key
     - FK: Toggle for Foreign Key
     - SK: Toggle for Surrogate Key
     - Null: Toggle for nullable
3. For FK columns, a "Foreign Key References" section appears below
   - Select the target table and column
4. Click "Add Table" to create the table on the canvas

### Method 2: DBML Editor

Write table definitions using the DBML markup language.

1. Click the code brackets button (`<>`) in the sidebar
2. Write your DBML in the editor. Example:

```dbml
Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique]
  created_at timestamp
  Note: 'Stores user account information'
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal(10,2)
  status varchar(20) [default: 'pending']
}
```

3. Use the "Syntax Reference" button to see all available settings
4. Click "Apply DBML" to parse and create the tables
5. Tables appear on the canvas with auto-computed positions

#### DBML Syntax Reference

Table definition:
```
Table table_name {
  column_name data_type [settings]
  Note: 'Table description'
}
```

Column settings (placed in square brackets):
- `pk` - Primary Key
- `sk` - Surrogate Key
- `partition` - Partition Key
- `not null` - Not nullable
- `unique` - Unique constraint
- `increment` - Auto-increment
- `default: 'value'` - Default value
- `note: 'description'` - Column description
- `ref: > table.column` - Foreign key reference (one-to-many)
- `ref: - table.column` - Foreign key reference (one-to-one)
- `ref: < table.column` - Foreign key reference (many-to-many)

Standalone relationship:
```
Ref: source_table.column > target_table.column
```

Comments:
```
// This is a comment line
```

### Method 3: Excel Import

Import table definitions from .xlsx files.

1. Click the file upload button in the sidebar
2. Upload a .xlsx file by dragging it to the dropzone or clicking to browse
3. The application will parse each sheet as a table:
   - **Sheet/tab name** = table name
   - **Column A** = column names
   - **Column B** = data types
   - **Column C** = functional definitions (optional)
4. Review the parsed data in the tabbed preview
5. Edit any values directly in the preview table
6. Click "Import N Tables" to add all tables to the canvas

Expected Excel format:

| Column A | Column B | Column C |
|----------|----------|----------|
| id | integer | Unique identifier |
| username | varchar | User login name |
| email | varchar | Contact email |
| created_at | timestamp | Account creation date |

If the first row contains headers (e.g., "Column", "Name", "Type"), it will be automatically skipped.

## Working with the Canvas

### Navigation

- **Pan**: Click and drag on empty canvas space
- **Zoom**: Mouse wheel scroll
- **Zoom In/Out**: Toolbar buttons (magnifying glass icons)
- **Fit to View**: Toolbar button (expand arrows) - fits all tables in view
- **Center**: Toolbar button (target icon) - centers the content

### Selecting Tables

- Click a table node on the canvas to select it
- The selected table is highlighted with an accent border
- Table details appear in the right panel
- Click empty canvas space to deselect

### Moving Tables

- Click and drag any table node to reposition it
- Positions are automatically saved

### Viewing Table Details

When a table is selected, the right panel shows:
- Table name and action buttons (edit, delete, close)
- Functional definition (if defined)
- Complete column list with key type badges
- Related relationships

### Editing Tables

1. Select a table on the canvas or in the sidebar
2. Click the edit (pencil) button in the right panel
3. The table form modal opens with pre-filled data
4. Make changes and click "Update Table"

### Deleting Tables

1. Select a table
2. Click the delete (trash) button in the right panel
3. The table and all its relationships are removed

## AI Chat (Preview)

1. Click the chat bubble button in the sidebar
2. The chat panel slides in from the right
3. Type a message describing your data model needs
4. Optionally attach an Excel file using the paperclip button
5. Click send

Note: The AI backend is not yet connected. This is a preview of the interface that will be available when the agent backend is integrated.

## Auto-Save

All changes are automatically saved 2 seconds after the last modification. A "Saving..." indicator appears in the header during the save operation.

## Model Switching

If a project has multiple models, use the dropdown in the header to switch between them. Each model maintains its own set of tables, relationships, and positions.
