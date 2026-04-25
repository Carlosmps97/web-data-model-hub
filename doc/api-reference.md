# Referencia de API

> Todas las rutas de API viven en `src/app/api/` y son servidas por Next.js.  
> Los datos se persisten en `data/` en el sistema de archivos del servidor a través de `src/lib/storage/jsonStore.ts`.

## URL Base

```
http://localhost:3000/api
```

## Endpoints

### Proyectos

#### Listar Proyectos

```
GET /api/projects
```

Respuesta:
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

#### Crear Proyecto

```
POST /api/projects
Content-Type: application/json

{
  "name": "Sales Analytics",
  "description": "Data model for sales pipeline"
}
```

Respuesta (201):
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

#### Obtener Proyecto

```
GET /api/projects/:id
```

#### Actualizar Proyecto

```
PUT /api/projects/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Eliminar Proyecto

```
DELETE /api/projects/:id
```

Nota: Eliminar un proyecto también elimina todos sus modelos asociados.

---

### Modelos

#### Listar Modelos

```
GET /api/models
GET /api/models?projectId=uuid
```

El parámetro de consulta opcional `projectId` filtra los modelos por proyecto.

Respuesta:
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

#### Crear Modelo

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

#### Obtener Modelo

```
GET /api/models/:id
```

Retorna el modelo completo incluyendo todas las tablas y relaciones.

#### Actualizar Modelo

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

#### Eliminar Modelo

```
DELETE /api/models/:id
```

---

### Chat (Shell — simulado)

> **Estado actual:** devuelve respuestas simuladas. En el futuro, redirigirá a un backend de agente IA que retornará `TableModel[]` para poblar el lienzo automáticamente.

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

Respuesta:
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

## Respuestas de Error

Todas las respuestas de error siguen este formato:

```json
{
  "success": false,
  "error": "Description of the error"
}
```

Códigos de estado HTTP comunes:
- 400: Solicitud incorrecta (campos obligatorios faltantes)
- 404: Recurso no encontrado
- 500: Error interno del servidor

## Tipos de Datos

### Project

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string (UUID) | Identificador único |
| name | string | Nombre del proyecto |
| description | string? | Descripción opcional |
| createdAt | string (ISO 8601) | Fecha de creación |
| updatedAt | string (ISO 8601) | Fecha de última actualización |

### DataModel

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string (UUID) | Identificador único |
| projectId | string (UUID) | ID del proyecto padre |
| name | string | Nombre del modelo |
| description | string? | Descripción opcional |
| engine | DatabaseEngine? | Motor de base de datos destino (ver abajo) |
| tables | TableModel[] | Arreglo de definiciones de tablas |
| relationships | Relationship[] | Arreglo de relaciones |
| createdAt | string (ISO 8601) | Fecha de creación |
| updatedAt | string (ISO 8601) | Fecha de última actualización |

### DatabaseEngine

Valores válidos para el campo `engine` (límite intencional a los motores con DDL de primera clase):

| Valor | Nombre mostrado | Schema por defecto | Particionamiento | Clustering |
|-------|-----------------|---------------------|------------------|------------|
| `postgresql` | PostgreSQL | `public` | RANGE · LIST · HASH | No |
| `oracle` | Oracle | `HR` | RANGE · LIST · HASH | No |
| `databricks` | Databricks SQL | `default` | RANGE · LIST · BUCKET | Sí (Z-ORDER) |

### TableModel

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string (UUID) | Identificador único |
| schema | string? | Namespace SQL. Obligatorio en el formulario; cuando está ausente, los generadores DDL aplican el default del motor. |
| name | string | Nombre de la tabla |
| columns | TableColumn[] | Arreglo de columnas |
| functionalDefinition | string? | Descripción de negocio de la tabla |
| applicationCode | string? | Aplicación o sistema dueño de esta tabla |
| domain | string? | Clasificación de dominio de negocio (ej. `Ventas`) |
| subdomain | string? | Agrupación dentro del dominio (ej. `Facturación`) |
| tags | string[]? | Etiquetas libres para filtrado y agrupación |
| color | string? | Color de visualización opcional para el nodo del lienzo |
| partition | PartitionSpec? | Especificación de particionamiento aware del motor (ver abajo) |

### TableColumn

| Campo | Tipo | Descripción |
|-------|------|-------------|
| name | string | Nombre de la columna |
| dataType | string | Tipo de dato canónico (`integer`, `varchar`, `decimal`…) o dialect-specific con paréntesis para mantenerse literal |
| length | number? | Longitud para tipos char-like (varchar(N)) o decimal(N) |
| scale | number? | Escala para tipos decimal/numeric (decimal(N, M)) |
| isPrimaryKey | boolean? | Indica llave primaria |
| isSurrogateKey | boolean? | Indica llave sustituta |
| isPartitionKey | boolean? | _Legacy_ — flag a nivel columna. El generador prefiere `TableModel.partition.columns`. |
| isForeignKey | boolean? | Indica llave foránea |
| foreignKeyRef | {table, column}? | Referencia FK |
| isNullable | boolean? | Indica si acepta nulos |
| isUnique | boolean? | Indica restricción de unicidad |
| defaultValue | string? | Valor predeterminado |
| functionalDefinition | string? | Descripción de la columna |

### PartitionSpec

| Campo | Tipo | Descripción |
|-------|------|-------------|
| strategy | enum | `NONE` · `RANGE` · `LIST` · `HASH` · `DATE` · `INGESTION_TIME` · `BUCKET`. La UI filtra por las soportadas en cada motor. |
| columns | string[] | Columnas que dirigen la partición. El orden importa. |
| buckets | number? | Conteo de cubetas para `HASH` / `BUCKET`. |
| granularity | enum? | `DAY` · `MONTH` · `YEAR` · `HOUR` para particionado por fecha. |
| clusteringColumns | string[]? | Columnas adicionales para clustering / Z-ORDER (Databricks). |

### Relationship

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | string (UUID) | Identificador único |
| sourceTable | string | Nombre de la tabla origen |
| sourceColumn | string | Nombre de la columna origen |
| targetTable | string | Nombre de la tabla destino |
| targetColumn | string | Nombre de la columna destino |
| type | enum | one-to-one, one-to-many, many-to-many |
