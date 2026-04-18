# API Reference

> All API routes live under `src/app/api/` and are served by Next.js.  
> Data is persisted to `data/` on the server filesystem via `src/lib/storage/jsonStore.ts`.

## Base URL

```
http://localhost:3000/api
```

## Endpoints

### Projects

#### List Projects

```
GET /api/projects
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Sales Analytics",
      "description": "Data model for sales pipeline",
      "createdAt": "2026-04-11T00:00:00.000Z",
      "updatedAt": "2026-04-11T00:00:00.000Z"
    }
  ]
}
```

#### Create Project

```
POST /api/projects
Content-Type: application/json

{
  "name": "Sales Analytics",
  "description": "Data model for sales pipeline"
}
```

Response (201):
```json
{
  "success": true,
  "data": {
    "id": "generated-uuid",
    "name": "Sales Analytics",
    "description": "Data model for sales pipeline",
    "createdAt": "2026-04-11T00:00:00.000Z",
    "updatedAt": "2026-04-11T00:00:00.000Z"
  }
}
```

#### Get Project

```
GET /api/projects/:id
```

#### Update Project

```
PUT /api/projects/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Project

```
DELETE /api/projects/:id
```

Note: Deleting a project also deletes all associated models.

---

### Models

#### List Models

```
GET /api/models
GET /api/models?projectId=uuid
```

The optional `projectId` query parameter filters models by project.

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "projectId": "project-uuid",
      "name": "Main Data Model",
      "description": null,
      "tables": [],
      "relationships": [],
      "createdAt": "2026-04-11T00:00:00.000Z",
      "updatedAt": "2026-04-11T00:00:00.000Z"
    }
  ]
}
```

#### Create Model

```
POST /api/models
Content-Type: application/json

{
  "projectId": "project-uuid",
  "name": "Main Data Model",
  "description": "Primary ER model",
  "tables": [],
  "relationships": []
}
```

#### Get Model

```
GET /api/models/:id
```

Returns the full model including all tables and relationships.

#### Update Model

```
PUT /api/models/:id
Content-Type: application/json

{
  "tables": [
    {
      "id": "table-uuid",
      "name": "users",
      "columns": [
        {
          "name": "id",
          "dataType": "integer",
          "isPrimaryKey": true
        },
        {
          "name": "email",
          "dataType": "varchar",
          "isNullable": false
        }
      ]
    }
  ],
  "relationships": [
    {
      "id": "rel-uuid",
      "sourceTable": "orders",
      "sourceColumn": "user_id",
      "targetTable": "users",
      "targetColumn": "id",
      "type": "one-to-many"
    }
  ]
}
```

#### Delete Model

```
DELETE /api/models/:id
```

---

### Chat (Shell — mock)

> **Current status:** returns mock responses. Future: will forward to an AI agent backend that returns `TableModel[]` to auto-populate the canvas.

```
POST /api/chat
Content-Type: application/json

{
  "message": "Create a user management schema",
  "attachments": [
    {
      "name": "schema.xlsx",
      "type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "data": {
    "message": "I've received your request...",
    "timestamp": "2026-04-11T00:00:00.000Z"
  }
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Description of the error"
}
```

Common HTTP status codes:
- 400: Bad request (missing required fields)
- 404: Resource not found
- 500: Internal server error

## Data Types

### Project

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| name | string | Project name |
| description | string? | Optional description |
| createdAt | string (ISO 8601) | Creation timestamp |
| updatedAt | string (ISO 8601) | Last update timestamp |

### DataModel

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| projectId | string (UUID) | Parent project ID |
| name | string | Model name |
| description | string? | Optional description |
| tables | TableModel[] | Array of table definitions |
| relationships | Relationship[] | Array of relationships |
| createdAt | string (ISO 8601) | Creation timestamp |
| updatedAt | string (ISO 8601) | Last update timestamp |

### TableModel

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| name | string | Table name |
| schema | string? | Optional schema name |
| columns | TableColumn[] | Array of columns |
| functionalDefinition | string? | Table description |

### TableColumn

| Field | Type | Description |
|-------|------|-------------|
| name | string | Column name |
| dataType | string | Data type |
| isPrimaryKey | boolean? | Primary key flag |
| isSurrogateKey | boolean? | Surrogate key flag |
| isPartitionKey | boolean? | Partition key flag |
| isForeignKey | boolean? | Foreign key flag |
| foreignKeyRef | {table, column}? | FK reference |
| isNullable | boolean? | Nullable flag |
| defaultValue | string? | Default value |
| functionalDefinition | string? | Column description |

### Relationship

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| sourceTable | string | Source table name |
| sourceColumn | string | Source column name |
| targetTable | string | Target table name |
| targetColumn | string | Target column name |
| type | enum | one-to-one, one-to-many, many-to-many |
