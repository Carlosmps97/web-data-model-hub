# Guía de Usuario

## Primeros Pasos

### Crear tu Primer Proyecto

1. Abre la aplicación en `http://localhost:3000`
2. Haz clic en **New Project** (parte superior derecha)
3. Ingresa un nombre de proyecto (obligatorio) y una descripción opcional
4. Haz clic en **Create Project** → serás redirigido a la página de detalle del proyecto

### Crear un Modelo de Datos

1. Dentro de un proyecto, haz clic en **Create First Model** (o **New Model** si ya existen modelos)
2. Ingresa un nombre para el modelo → **Create Model**
3. El editor de modelos se abre en **Vista de Lista** por defecto

---

## Editor de Modelos

El editor presenta un encabezado de **dos filas** y un área de trabajo central.

### Fila Superior — Identidad y Estado

- **Botón volver** (`‹`) — regresa a la lista de modelos del proyecto
- **Breadcrumb clickeable**: `Projects › Nombre del Proyecto › Nombre del Modelo`. Cualquier segmento previo navega a esa ruta
- **Pill de estado** — _Saving…_ en ámbar mientras se persiste, _Saved_ en verde tras el debounce de 2 s
- **Selector de motor** — desplegable con PostgreSQL / Oracle / Databricks SQL, alineado a la derecha

### Fila Inferior — Toolbar

| Botón | Descripción |
|-------|-------------|
| **List \| Canvas** | Control segmentado para alternar entre la cuadrícula de tarjetas y el diagrama ER |
| **Import Excel** | Sube un `.xlsx`; cada hoja se convierte en una tabla con previsualización editable |
| **Export DDL** | Acción primaria (acentuada en teal) que abre el modal de exportación DDL para todo el modelo |
| **AI Agent** | Acentuado en índigo cuando está activo; muestra el panel del asistente |

La fila superior es la identidad inmutable del modelo (qué estoy editando, en qué motor, si está guardado). La fila inferior agrupa acciones de trabajo.

### Panel Izquierdo

- **Add Table** — abre el formulario en blanco
- **Editor DBML** (`<>`) — escribe / pega DBML y sincroniza con el modelo
- **Importación Excel** (`↑`) — atajo equivalente al botón del toolbar

### Motor de Base de Datos

El motor seleccionado etiqueta el modelo y dirige toda la generación de DDL: tipo de datos por columna, sintaxis de partition / cluster, comillas para identificadores y comentarios. **Solo se soportan tres motores con DDL de primera clase:**

| Motor | Color | Schema por defecto | Particionamiento | Clustering |
|-------|-------|---------------------|------------------|------------|
| **PostgreSQL** | `#336791` (azul) | `public` | RANGE · LIST · HASH | No |
| **Oracle** | `#c54138` (rojo) | `HR` | RANGE · LIST · HASH | No |
| **Databricks SQL** | `#ff3621` (coral) | `default` | RANGE · LIST · BUCKET | Sí (Z-ORDER) |

> Cambiar el motor de un modelo existente no traduce el contenido automáticamente. La generación DDL toma el motor del modelo en tiempo de exportación; los tipos canónicos se mapean al dialecto destino en cada llamada.

---

## Agregar / Editar Tablas

El diálogo **Edit Table** se abre desde tres puntos: _Add Table_ en el panel izquierdo, _New Table_ en la Vista de Lista, o el menú de engranaje sobre un nodo del lienzo. Internamente está dividido en **cuatro pestañas**.

### Método 1 — Formulario Manual

#### Pestaña 1 — General

| Campo | Obligatorio | Notas |
|-------|-------------|-------|
| **Schema** | Sí | Namespace SQL al que pertenece la tabla. Si lo dejas en blanco, se rellena con el schema convencional del motor (`public` / `HR` / `default`). |
| **Table Name** | Sí | Identificador SQL (snake_case recomendado). Se valida no-vacío al guardar. |
| **Functional Definition** | No | Descripción de negocio. Aparece en tooltips del lienzo, en la tarjeta de la Vista de Lista y como `COMMENT ON TABLE` en el DDL. |

Bajo el nombre se muestra una previsualización en vivo `schema.table_name`, exactamente como saldrá en el DDL.

#### Pestaña 2 — Columns

Cada columna es una **tarjeta independiente** con jerarquía visual clara, no un grid denso de checkboxes:

- **Cabecera de la tarjeta**: índice numerado · nombre (input grande) · selector de tipo (pill) · papelera
- **Fila de chips semánticos**: `PK` (ámbar) · `FK` (azul) · `SK` (púrpura) · `UNIQUE` (verde) · `NOT NULL` (slate). Cada chip apagado es gris; al activarlo se tiñe con su color semántico.
- **Pills de parámetros inline**: Length / Scale (cuando aplican al tipo) · Default · Description.
- **Banner FK**: cuando activas el chip FK aparece un banner azul claro con un ícono de cadena, etiqueta _references_ y dos selectores (`schema.table` y `column`). Solo se listan tablas existentes en el modelo.

> Length aplica a tipos char-like (`varchar`, `char`, `nvarchar`, `string`). Scale aparece adicionalmente en `decimal` / `numeric`. Para tipos como `integer` / `boolean` / `timestamp` los pills de Length / Scale se ocultan automáticamente.

#### Pestaña 3 — Partitioning

Define la `PartitionSpec` de la tabla. Las opciones disponibles dependen del motor (ver _Esquemas y Particionamiento_).

| Campo | Descripción |
|-------|-------------|
| **Strategy** | `NONE` · `RANGE` · `LIST` · `HASH` · `BUCKET` (filtrado por motor) |
| **Columns** | Una o más columnas que dirigen la partición. El orden importa. |
| **Buckets** | Solo para `HASH` / `BUCKET` — número de cubetas. |
| **Granularity** | Solo para `DATE` — `DAY` / `MONTH` / `YEAR` / `HOUR`. |
| **Clustering Columns** | Solo Databricks — columnas adicionales para Z-ORDER. |

#### Pestaña 4 — Metadata

| Campo | Descripción |
|-------|-------------|
| **Application Code** | Código de la aplicación / sistema dueño (CRM, ERP, MDM…) |
| **Domain** | Área de negocio de alto nivel (Ventas, Finanzas, RRHH…) |
| **Subdomain** | Agrupación más fina dentro del dominio |
| **Tags** | Etiquetas libres. Enter o coma para agregar, × para eliminar |

Finalmente haz clic en **Add Table** (o **Update Table** al editar).

### Método 2 — Editor DBML

1. Haz clic en el botón **`<>`** en el panel izquierdo
2. Escribe DBML en el editor (soporta `Table schema.name { … }` para fijar schema desde DBML):

```dbml
Table sales.users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique, note: 'Correo de contacto']
  created_at timestamp
  Note: 'Información de cuentas de usuario'
}

Table sales.orders {
  id integer [pk]
  user_id integer [ref: > sales.users.id]
  total decimal(10,2)
  status varchar(20) [default: 'pending']
  Note: 'Registros de pedidos de clientes'
}
```

3. Haz clic en **Apply DBML** para analizar y crear las tablas en el lienzo
4. Usa el botón **Syntax Reference** para un resumen rápido de sintaxis

> Aplicar DBML reemplaza todas las tablas actuales del modelo. Si necesitas conservar el estado actual, expórtalo primero como DDL.

**Configuraciones de columna en DBML:**

| Configuración | Significado |
|---------------|-------------|
| `pk` | Llave Primaria |
| `sk` | Llave Sustituta |
| `partition` | Llave de Partición (legacy column-level; preferir `PartitionSpec`) |
| `not null` | No permite nulos |
| `unique` | Restricción de unicidad |
| `increment` | Auto-incremento |
| `default: 'x'` | Valor predeterminado |
| `note: 'texto'` | Definición funcional de la columna |
| `ref: > t.col` o `ref: > schema.t.col` | FK → uno a muchos (opcionalmente calificada con schema) |
| `ref: - t.col` | FK → uno a uno |
| `ref: < t.col` | FK → muchos a muchos |

Ref independiente: `Ref: sales.orders.user_id > sales.users.id`  
Comentarios: `// esto es un comentario`

### Método 3 — Importación desde Excel

1. Haz clic en el botón de carga (↑) en el panel izquierdo
2. Arrastra y suelta un archivo `.xlsx` (o haz clic para explorar)
3. Cada **hoja/pestaña** se convierte en una tabla:
   - Columna A = nombres de columnas
   - Columna B = tipos de datos
   - Columna C = definiciones funcionales (opcional)
4. Revisa y edita en el modal de vista previa
5. Haz clic en **Import N Tables** para agregar al modelo

> La primera fila se omite automáticamente si parece un encabezado (contiene palabras como "column", "name", "columna", "nombre").

---

## Esquemas y Particionamiento

### Schemas — obligatorio en el formulario

Cada tabla pertenece a un **schema** (namespace SQL). El campo es obligatorio en el formulario; si lo dejas vacío al guardar, se rellena con el schema convencional del motor. La búsqueda en la Vista de Lista ya considera el schema, y el lienzo lo muestra como prefijo gris en el encabezado del nodo (`schema.table_name`).

El parser DBML acepta dos sintaxis equivalentes:

```dbml
Table orders { id integer [pk] }

Table sales.orders {     // schema.name — fija schema desde DBML
  id integer [pk]
}
```

### PartitionSpec — más allá del flag legacy

La forma correcta de declarar particionamiento es la pestaña _Partitioning_ del formulario, que pobla la propiedad `partition` en la tabla. El flag `isPartitionKey` a nivel columna se mantiene por compatibilidad pero el generador DDL prioriza `partition.columns`.

| Strategy | Sintaxis emitida | Motores |
|----------|------------------|---------|
| `NONE` | _(sin cláusula)_ | todos |
| `RANGE` | `PARTITION BY RANGE (cols)` | PostgreSQL, Oracle, Databricks |
| `LIST` | `PARTITION BY LIST (cols)` | PostgreSQL, Oracle, Databricks |
| `HASH` | `PARTITION BY HASH (cols)` | PostgreSQL, Oracle |
| `BUCKET` | `CLUSTERED BY (cols) INTO N BUCKETS` | Databricks |
| `DATE` | `PARTITION BY (col)` _con granularidad anotada_ | reservado para BigQuery |
| `INGESTION_TIME` | `PARTITION BY _PARTITIONTIME` | reservado para BigQuery |

> `DATE` e `INGESTION_TIME` existen en el tipo `PartitionStrategy` pero hoy ningún motor soportado los emite — quedan como contrato preparado para una futura extensión a BigQuery.

### Clustering / Z-ORDER

Solo Databricks expone clustering: la propiedad `clusteringColumns` de `PartitionSpec` se traduce en una cláusula `CLUSTER BY (…)` seguida de `ZORDER BY (…)` en el DDL final.

---

## Exportación DDL

El generador de DDL produce SQL listo para ejecutar adaptado al motor del modelo. Hay tres niveles de granularidad:

| Origen | Cómo se invoca | Resultado |
|--------|----------------|-----------|
| **Modelo completo** | Botón _Export DDL_ en el toolbar del editor | `CREATE SCHEMA` por cada schema + `CREATE TABLE` de todas las tablas + `ALTER TABLE` FKs al final |
| **Por dominio** | Icono `↓` junto al header de un grupo en la Vista de Lista (cuando está agrupada) | Subset del modelo — solo tablas del grupo, FKs hacia tablas externas omitidas |
| **Una sola tabla** | Icono `↓` en cada tarjeta de la Vista de Lista | `CREATE SCHEMA` + `CREATE TABLE` de esa tabla con sus FKs salientes |

### Modal de Vista Previa

Al disparar cualquier exportación se abre un modal con:

- **Editor con sintaxis SQL** — monoespaciado, con scroll, en modo sólo lectura
- **Toggles de opciones**: _Emit schemas_ (`CREATE SCHEMA` al inicio) · _Emit foreign keys_ (`ALTER TABLE` al final) · _Emit comments_ (`COMMENT ON TABLE` / `COLUMN`)
- **Copy** — copia al portapapeles
- **Download** — descarga como `.sql` con nombre derivado del scope (modelo / dominio / tabla) y el motor

### Pipeline de Generación

1. **Resolución de schemas** — toda tabla sin `schema` recibe el default del motor.
2. **Resolución de tipos** — tipos canónicos (`integer`, `varchar`, `decimal`…) se mapean al dialecto destino. Si el usuario escribió ya un tipo dialect-specific con paréntesis (ej. `VARCHAR2(50)`), se respeta tal cual.
3. **Quoting** — los identificadores se entrecomillan solo si contienen caracteres no SQL-safe. PostgreSQL / Oracle usan dobles comillas; Databricks usa backticks.
4. **Constraints inline** — `PRIMARY KEY` se emite en línea; `UNIQUE` de columna única también.
5. **Particionamiento / Clustering** — la cláusula `PARTITION BY` / `CLUSTER BY` se añade tras la lista de columnas.
6. **Foreign keys** — se emiten como `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` al final, para que el script aplique aunque las tablas referenciadas se creen en cualquier orden.
7. **Comentarios** — si _Emit comments_ está activo, las definiciones funcionales se traducen a `COMMENT ON TABLE` / `COMMENT ON COLUMN`.

---

## Vista de Lista

La **Vista de Lista** muestra cada tabla del modelo como una tarjeta, con metadatos de clasificación y chips de etiquetas.

### Búsqueda y Filtrado

- **Barra de búsqueda** — filtra por schema, nombre de tabla, descripción, código de app, dominio, subdominio o etiqueta (sin distinción entre mayúsculas y minúsculas)
- **Chips de etiquetas** (debajo de la barra de búsqueda, cuando existen etiquetas) — haz clic en una etiqueta para filtrar solo las tablas que la tengan; haz clic de nuevo o en la × para limpiar el filtro
- **Contador** — muestra cuántas tablas coinciden con el filtro actual vs el total

### Agrupamiento

El selector **Group by** en la barra de filtros ofrece tres modos:

| Modo | Cabecera de grupo | Cuándo usar |
|------|-------------------|-------------|
| **By schema** | Icono de cilindro + nombre del schema + conteo | Cuando organizas el catálogo por namespace SQL (default) |
| **By domain** | Icono de carpeta + dominio + conteo | Cuando trabajas por área de negocio |
| **Flat** | _— sin grupos, todas las tarjetas seguidas —_ | Para una vista plana cuando filtras por búsqueda |

> Cuando estás agrupado por schema, las tarjetas _no_ repiten el prefijo `schema.` en el título (la cabecera del grupo ya lo indica). Al pasar a _Flat_ o _By domain_ el prefijo vuelve para no perder la referencia.

### Tarjetas de Tabla

Cada tarjeta muestra:
- **Ícono + nombre de la tabla** (con prefijo de schema cuando no está agrupado por schema) y **pill de conteo de columnas**
- **Acciones**: `↓` (descargar DDL de esta tabla) · lápiz (editar) · papelera (eliminar)
- **Definición funcional** (si se proporcionó)
- **Insignias de clasificación**: chips de color `app`, `domain`, `sub` y chip de _partition_ si aplica
- **Chips de etiquetas** — haz clic en cualquier chip para activarlo como filtro de etiqueta

---

## Vista de Lienzo (Diagrama ER)

### Navegación

| Acción | Entrada |
|--------|---------|
| Desplazar | Arrastrar en un área vacía del lienzo |
| Zoom | Rueda del ratón |
| Acercar/Alejar | Botones ± / lupa de la barra de controles |
| Ajustar todas las tablas | Botón de ajuste de vista en la barra de controles |
| Desplazar minimapa | Arrastrar dentro del minimapa superpuesto |

### Interacciones al Pasar el Cursor

Pasa el cursor sobre cualquier **bloque de tabla** para:
- **Resaltar** las conexiones de relaciones con una animación de flujo
- **Atenuar** todas las conexiones no relacionadas
- **Resaltar** las columnas específicas involucradas en la relación en ambas tablas
- Ver un **tooltip** en cada columna con su nombre, tipo de dato, definición funcional y referencia FK

### Seleccionar Tablas

- **Clic en el nodo de tabla** → lo selecciona (resaltado con borde teal); NO abre ningún formulario de edición
- **Clic en el lienzo vacío** → deselecciona
- El resaltado por cursor tiene prioridad visual sobre la selección por clic

### Editar una Tabla desde el Lienzo

1. Pasa el cursor sobre un nodo de tabla → aparece un **ícono de engranaje (⚙)** en la esquina superior derecha
2. Haz clic en el engranaje → aparece un menú pequeño con las opciones **Edit** y **Delete**
3. Haz clic en **Edit** → el modal del formulario se abre con los datos precargados
4. Realiza los cambios → **Update Table**

> Hacer clic en el cuerpo de la tabla solo la selecciona visualmente; el formulario de edición se abre exclusivamente a través del menú de engranaje.

### Eliminar una Tabla desde el Lienzo

Haz clic en el engranaje → **Delete** → la tabla y todas sus relaciones son eliminadas.

### Mover Tablas

- Arrastra cualquier nodo de tabla para reubicarlo
- Las posiciones son **solo en memoria** — al recargar, el algoritmo de distribución recalcula las posiciones automáticamente (las posiciones arrastradas dentro de una sesión se conservan hasta recargar la página)

---

## Distribución Automática

Haz clic en el **ícono de cuadrícula** en la barra de controles inferior para abrir el panel de **Auto Arrange**.

### Izquierda-Derecha (1)
Ordena las tablas en capas topológicas de izquierda a derecha, siguiendo la dirección de las relaciones. Las tablas sin relaciones entrantes aparecen en la columna más a la izquierda. Ideal para **pipelines ETL y diagramas de linaje**.

### Copo de Nieve (2)
Coloca la tabla más conectada al centro y organiza las demás en anillos radiales concéntricos. Ideal para **esquemas estrella y almacenes de datos**.

### Compacto (3)
Coloca las tablas en una cuadrícula ordenada por número de conexiones. Ideal para **diagramas con pocas relaciones** o cuando se desea una vista limpia y resumida.

> Al aplicar cualquier distribución, el lienzo se ajusta automáticamente para mostrar todas las tablas. Las posiciones se conservan en memoria durante la sesión actual.

---

## Lienzo Global

Cada proyecto expone un **Lienzo Global** que renderiza todas las tablas de todos sus modelos en un diagrama combinado, con código de colores por modelo.

- Accede mediante el enlace **"Global canvas"** en la tarjeta del proyecto en la página de Proyectos
- La vista global es de solo lectura — no se pueden agregar ni editar tablas desde ella
- Útil para tener una visión general de alto nivel de todo el panorama de datos del proyecto

---

## Chat con IA (Vista previa)

1. Haz clic en el botón de **burbuja de chat** en el panel izquierdo → el panel de chat se desliza desde la derecha
2. Escribe un mensaje describiendo tus necesidades de modelo de datos
3. Opcionalmente adjunta un archivo Excel con el botón de **clip**
4. Haz clic en **Send**

> **Nota:** El backend de IA aún no está conectado — esta es la interfaz de usuario para una integración futura.

---

## Guardado Automático

Todos los cambios se guardan automáticamente **2 segundos** después de la última modificación. Un indicador "Saving…" aparece en el encabezado de la página mientras se está guardando.

---

## Cambio de Modelo

Si un proyecto tiene varios modelos, usa el **desplegable de modelos** en el encabezado del editor para cambiar entre ellos. Cada modelo mantiene sus propias tablas, relaciones, motor y posiciones en memoria.
