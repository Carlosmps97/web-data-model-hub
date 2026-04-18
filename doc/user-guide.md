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

El editor de modelos tiene dos áreas principales:

- **Panel izquierdo** — agrega tablas manualmente, pega código DBML o importa desde Excel
- **Área de trabajo principal** — alterna entre Vista de Lista y Vista de Lienzo mediante los botones de alternancia en la parte superior derecha

### Alternancia de Vista — Lista vs Lienzo

| Botón | Descripción |
|-------|-------------|
| **List** | Cuadrícula de tarjetas con todas las tablas, búsqueda, insignias de clasificación y filtros por etiqueta |
| **Canvas** | Diagrama ER interactivo con posicionamiento por arrastre y conexiones de relaciones |

La vista activa se resalta en color teal. Cambiar de vista no pierde datos ni el estado de posiciones.

### Motor de Base de Datos

Usa el **selector de motor** (desplegable junto al nombre del modelo en el encabezado) para etiquetar el modelo con su plataforma de base de datos de destino:
PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, Databricks, BigQuery, Redshift, SQLite o MongoDB.

El motor seleccionado se muestra como una insignia de color y se guarda con el modelo.

---

## Agregar Tablas

### Método 1 — Formulario Manual

1. Haz clic en el botón **+** en el encabezado del panel izquierdo (o **New Table** en la Vista de Lista)
2. Completa los campos:
   - **Table Name** — identificador obligatorio (ej. `user_accounts`)
   - **Functional Definition** — descripción en texto libre del propósito de la tabla (opcional)
   - **Clasificación** (opcional) — para organizar catálogos grandes:
     - **App Code** — la aplicación o sistema dueño de esta tabla
     - **Domain** — dominio de negocio (ej. `Ventas`, `Finanzas`)
     - **Subdomain** — agrupación más fina dentro del dominio (ej. `Facturación`, `Pagos`)
   - **Tags** — etiquetas libres; escribe una etiqueta y presiona **Enter** o **,** para agregarla; haz clic en la × del chip para eliminarla
   - **Columns** — agrega filas con:
     - **Name** — identificador de la columna
     - **Type** — selecciona del listado de tipos de datos
     - **PK** toggle — Llave Primaria
     - **FK** toggle — Llave Foránea
     - **SK** toggle — Llave Sustituta
     - **Null** toggle — permite nulos
     - **Column description** — nota opcional por columna visible como tooltip en el lienzo
3. Para columnas FK aparece una sección **Foreign Key References** — selecciona la tabla y columna destino
4. Haz clic en **Add Table** (o **Update Table** al editar)

### Método 2 — Editor DBML

1. Haz clic en el botón **`<>`** en el panel izquierdo
2. Escribe DBML en el editor:

```dbml
Table users {
  id integer [pk, increment]
  username varchar(50) [not null]
  email varchar(100) [unique, note: 'Correo de contacto']
  created_at timestamp
  Note: 'Información de cuentas de usuario'
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal(10,2)
  status varchar(20) [default: 'pending']
  Note: 'Registros de pedidos de clientes'
}
```

3. Haz clic en **Apply DBML** para analizar y crear las tablas en el lienzo
4. Usa el botón **Syntax Reference** para un resumen rápido de sintaxis

**Configuraciones de columna en DBML:**

| Configuración | Significado |
|---------------|-------------|
| `pk` | Llave Primaria |
| `sk` | Llave Sustituta |
| `partition` | Llave de Partición |
| `not null` | No permite nulos |
| `unique` | Restricción de unicidad |
| `increment` | Auto-incremento |
| `default: 'x'` | Valor predeterminado |
| `note: 'texto'` | Definición funcional de la columna |
| `ref: > t.col` | FK → uno a muchos |
| `ref: - t.col` | FK → uno a uno |
| `ref: < t.col` | FK → muchos a muchos |

Ref independiente: `Ref: orders.user_id > users.id`  
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

## Vista de Lista

La **Vista de Lista** muestra cada tabla del modelo como una tarjeta, con metadatos de clasificación y chips de etiquetas.

### Búsqueda y Filtrado

- **Barra de búsqueda** — filtra por nombre de tabla, descripción, código de app, dominio, subdominio o etiqueta (sin distinción entre mayúsculas y minúsculas)
- **Chips de etiquetas** (debajo de la barra de búsqueda, cuando existen etiquetas) — haz clic en una etiqueta para filtrar solo las tablas que la tengan; haz clic de nuevo o en la × para limpiar el filtro
- **Contador** — muestra cuántas tablas coinciden con el filtro actual vs el total

### Tarjetas de Tabla

Cada tarjeta muestra:
- **Nombre de la tabla** y **número de columnas**
- **Definición funcional** (si se proporcionó)
- **Insignias de clasificación**: chips de color `app`, `domain`, `sub`
- **Chips de etiquetas** — haz clic en cualquier chip para activarlo como filtro de etiqueta
- Botones de acción **Editar** (lápiz) y **Eliminar** (papelera)

### Acciones

| Acción | Cómo |
|--------|------|
| Agregar una tabla | Haz clic en el botón **New Table** (parte superior derecha de la barra de herramientas) |
| Editar una tabla | Haz clic en el **ícono de lápiz** de la tarjeta |
| Eliminar una tabla | Haz clic en el **ícono de papelera** de la tarjeta |

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
