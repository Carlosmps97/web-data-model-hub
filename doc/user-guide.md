# Guía de Usuario

> Cómo usar `web-data-model-hub` (rediseño *Aurora*, project-centric). Asume que
> el backend `backend-data-model-hub` está corriendo y conectado a Cosmos DB.
> Hay también un **Centro de ayuda dentro de la app** (rail → Documentación, y el
> botón "?" para la ayuda rápida).

## 1. Acceso

**MVP abierto**: no hay login. Abre `http://localhost:3000` y entras directo al
**Model Center**. (El control de acceso por roles/permisos vuelve al final como
una matriz robusta; entonces la identidad la dará el proxy de Databricks Apps.)

---

## 2. Navegación: el rail (64 px)

| Icono | Destino |
|---|---|
| Capas | **Model Center** (`/`) — catálogo cross-project |
| Grilla | **Projects** (`/projects`) |
| Libro | **Documentación** (`/docs`) |
| "?" (abajo) | **Ayuda rápida** (drawer off-canvas) |

La barra superior de cada pantalla muestra las migas de pan y las acciones de esa pantalla.

---

## 3. Model Center (pantalla de inicio)

Catálogo único de **todos** los proyectos. Pestañas:

- **Overview** — 5 contadores (Projects · Data Models · Tables · Views · Columns),
  barras "tablas por engine" y "por dominio", y el panel de **salud y gobierno**:
  tablas sin clave primaria, sin dominio, sin ninguna vista, columnas sensibles
  (PII). Cada tarjeta de salud salta a la lista filtrada.
- **Tables / Views / Columns** — grillas densas, ordenables, con filtros (engine,
  modelo, dominio) y buscador. En Tables, seleccionar una fila abre un panel de
  detalle con "Abrir proyecto".

---

## 4. Projects y el hub del proyecto

### 4.1 Lista (`/projects`)
Tarjetas con engines, nº de modelos y fecha de actualización. Buscador. "Nuevo
proyecto" y borrado disponibles para todos (MVP sin permisos).

### 4.2 Hub (`/projects/{id}`)
Dos secciones CRUD + "Abrir canvas" arriba a la derecha:

- **Modelos (niveles)** — tarjetas con código, nombre completo, descripción y
  conteos (tablas, dominios). "Nuevo modelo" abre el editor de nivel. Clic en una
  tarjeta abre el canvas filtrado a esa capa.
- **Dominios (productos de datos)** — grilla `Dominio · Owner · Steward ·
  Sensibilidad · Capas · Tablas`. "Nuevo dominio" abre el editor. Clic en una fila
  abre el canvas con ese dominio vertical enfocado.

Editar niveles/dominios persiste vía `PUT /api/projects/{id}`. Eliminar uno deja
sus tablas "sin asignar".

---

## 5. Editor (`/projects/{id}/editor`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Proyecto › <scope>   [engine]   [Scope ▾]   [List|Canvas]  Export  ✓Saved
├───────────────┬────────────────────────────────────────┬─────────────┤
│ Tablas  [+New▾]│                                        │  Inspector  │
│ buscar…        │     Canvas ER  (o vista de lista)      │ Columns·Views·Links │
│ [Dominio|Modelo]│                                        │             │
│ grupos…        │     [dock]            [minimap]         │             │
└───────────────┴────────────────────────────────────────┴─────────────┘
```

### 5.1 Scope
El control **Scope** limita qué ves y editás. Presets (Todo el modelo · "<Modelo>
completa" · "<Dominio> (vertical)") + casillas Modelos×Dominios.

### 5.2 Rail de tablas
Contador + **New ▾** (Nueva tabla · Desde tablas existentes · Escribir DBML ·
Importar Excel) · búsqueda · **agrupar por Dominio/Modelo**. Clic = seleccionar,
doble clic = editar.

### 5.3 Canvas
Pan (arrastrar fondo), zoom (rueda / dock), **Ajustar a pantalla**, minimapa. Cada
nodo: header tintado por dominio. Hover/selección resalta las columnas
relacionadas y el wire "fluye".

- **Dock**: Seleccionar · **Conectar** · **Auto-organizar** (Por modelo /
  Snowflake / Compacto) · Fit · zoom.
- **Conectar**: clic columna origen → clic columna destino de otra tabla →
  cardinalidad (1:1 / 1:N / N:N). Relaciones **entre capas adyacentes** muestran
  etiqueta teal; **saltos** (no adyacentes) salen en ámbar con un aviso.
- **Engranaje** del nodo: Editar tabla · color de cabecera · Eliminar.

### 5.4 Inspector (panel derecho)
Auto-abre al seleccionar. Tabs **Columns** · **Views** (CRUD de vistas SQL por
rol) · **Links** (relaciones de la tabla con su cardinalidad).

---

## 6. Crear y poblar tablas (modales)

| Vía | Modal | Qué hace |
|---|---|---|
| Nueva tabla | `TableForm` | Nombre/Schema/Modelo/Dominio/Subdominio/Definición + columnas (PK/FK/SK, Nullable, tipo). |
| Desde existentes | `CreateFromSqlModal` | Hereda columnas de ≤2 tablas padre; opción de mantener la FK al padre. |
| Escribir DBML | `DBMLModal` | Editor DBML; **Aplicar reemplaza el canvas**. |
| Importar Excel | `ExcelImportModal` | Cada hoja → una tabla; **añade** a lo existente. |

---

## 7. Vistas y SQL por rol

En el Inspector → Views → "Nueva vista" (`ViewForm`): Nombre · Tipo
(Business/Technical) · Rol · **SELECT** (una expresión por línea) · **WHERE** (una
condición por línea, AND) · preview `CREATE VIEW` en vivo. Las vistas no van en el
diagrama ER pero se exportan con el DDL.

---

## 8. Exportar DDL

Export (barra superior) abre `DDLPreviewModal`:
- **Solo el scope actual** — exporta únicamente lo visible en tu alcance.
- **Incluir vistas** — añade un `CREATE VIEW` por vista.
- **Copiar DDL** — al portapapeles.

Genera `CREATE TABLE` (+ NOT NULL, PRIMARY KEY) + `ALTER TABLE … ADD FOREIGN KEY`,
respetando el engine del proyecto.

---

## 9. Usuarios y permisos (próximamente)

En este MVP la app es **abierta**: no hay usuarios, roles ni permisos. El modelo
de control de acceso (roles `admin/editor/viewer` + permisos `view`/`edit` por
proyecto) se reintroducirá al final como una **matriz de permisos robusta**, con
la identidad provista por el proxy de Databricks Apps.

---

## 10. Guardado automático

El editor **no tiene botón Guardar**: cada cambio en tablas/relaciones dispara un
debounce de **800 ms** → `PUT /api/projects/{id}/canvas`. El indicador de la barra
pasa de "Saving…" a "Saved". Las **posiciones del canvas son per-sesión** (al
reabrir, Auto-organizar recompone el layout). Los cambios de Modelos/Dominios se
guardan al confirmar el modal en el hub.

---

## 11. Troubleshooting rápido

| Síntoma | Causa probable | Acción |
|---|---|---|
| La app no carga datos | backend caído o sin Cosmos | revisar `GET /api/health` (`db_connected`) |
| Auto-save muestra error | backend caído mid-sesión | refrescar; revisar el backend |
| Excel no detecta tablas | header fuera de la primera fila | limpiar el Excel (1ª fila = header) y reintentar |
| El canvas "se desordena" al abrir | las posiciones no se persisten | usar Auto-organizar; es por diseño |
| Pestaña con bundle viejo tras un refactor | caché del navegador | `Cmd+Shift+R` (hard reload) |
