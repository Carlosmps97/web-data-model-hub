# Data Model Hub

Aplicación web profesional para diseñar, visualizar y gobernar modelos de datos a
través de múltiples proyectos. Construida con **Next.js 16** y **React 19**, con
un **canvas ER hecho a mano** (sin librería de diagramas) y el design system
**"Aurora"**. Tema claro único, sin Tailwind — la UI se estiliza por completo con
CSS custom properties.

> **MVP abierto/anónimo**: no hay login ni permisos (el modelo de roles/permisos
> se reintroduce al final como una matriz robusta). El agente de IA está fuera del
> MVP. Se despliega a **Databricks Apps** (ver [`../DEPLOY-databricks.md`](../DEPLOY-databricks.md)).

## Tabla de contenidos

- [Resumen general](#resumen-general)
- [Jerarquía](#jerarquía)
- [Funcionalidades](#funcionalidades)
- [Stack tecnológico](#stack-tecnológico)
- [Primeros pasos](#primeros-pasos)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Guía de uso](#guía-de-uso)
- [Documentación](#documentación)

## Resumen general

Data Model Hub organiza el trabajo como **Proyecto → Modelo (nivel) → Dominio →
Tabla → Columnas + Vistas**. Cada proyecto tiene un **único canvas ER guiado por
el scope**. Los equipos diseñan esquemas manualmente, heredando de tablas
existentes, desde DBML o importando Excel; navegan todo en un catálogo
cross-project (Model Center); y exportan DDL específico por engine.

El frontend **no expone rutas API propias** — habla directamente con el backend
de la plataforma [`backend-data-model-hub`](../backend-data-model-hub) (FastAPI +
Cosmos DB) por CORS, vía la capa `src/services/*` (`NEXT_PUBLIC_API_URL`).

## Jerarquía

| Nivel | Qué es |
|-------|--------|
| **Proyecto** | Un repositorio de datos (p. ej. "Lakehouse"). Es dueño de sus engines, niveles y dominios; tiene un único canvas. |
| **Modelo (nivel)** | Una capa del proyecto — RDV·UDV·DDV, o la que definas. Su orden controla las bandas izquierda→derecha del canvas y la adyacencia entre capas. |
| **Dominio** | Un producto de datos (Finanzas, Clientes…). **Vertical**: el mismo dominio abarca varios niveles. Lleva owner, steward, sensibilidad y subdominios. |
| **Tabla** | Vive en un nivel y (opcionalmente) un dominio; hereda el color del dominio; embebe **vistas** SQL específicas por rol. |

## Funcionalidades

- **Canvas ER hecho a mano** — pan/zoom, arrastre, ajustar a pantalla y minimapa propios (sin React Flow / ELK).
- **Scope** — un límite de edición `{niveles, dominios}` que filtra qué tablas son visibles y editables. Presets (todo el modelo · un nivel · un dominio) más una matriz Modelos×Dominios.
- **Modo conectar + cardinalidad** — clic en columna origen → columna destino de otra tabla; eliges `1:1 / 1:N / N:N`. La columna origen se vuelve FK.
- **Conciencia cross-layer** — relaciones entre niveles adyacentes con etiqueta teal `A→B`; los "saltos" no adyacentes en ámbar/punteado con advertencia.
- **Auto-organizar** — tres layouts tipo masonry (Por modelo · Snowflake · Compacto) que consideran la altura y nunca se solapan.
- **Inspector** — panel por tabla con pestañas Columnas / **Vistas (SQL por rol)** / Links, más badges de gobierno.
- **Cuatro caminos de ingesta** — formulario manual · desde tablas existentes (hereda columnas) · editor DBML · importación de Excel (`.xlsx`).
- **Vistas SQL por rol** — proyecciones con enmascaramiento (`sha256`, `regexp_replace`…) y filtros `WHERE`; se exportan junto al DDL.
- **Exportación de DDL** — `CREATE TABLE` + PK + `ALTER … ADD FOREIGN KEY` (+ `CREATE VIEW`), por scope o todo el modelo, según el engine.
- **Model Center** — catálogo cross-project (Overview · Tables · Views · Columns) con gobierno de salud del modelo.
- **Centro de ayuda in-app** — artículos + drawer de ayuda rápida ("?").
- **Guardado automático** — persistencia con debounce de 800 ms (las posiciones de los nodos son por sesión, recalculadas por los layouts al abrir).

## Stack tecnológico

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| Next.js (App Router, Turbopack) | 16.2.3 | UI (sin rutas API; sin middleware) |
| React | 19.2.4 | Renderizado de componentes |
| TypeScript | ^5 | Tipado en todo el proyecto |
| Zustand | ^5.0.12 | Estado del cliente (`useProjectStore`, `useUIStore`, `useMetadataStore`) |
| sonner | ^2.0.7 | Toasts |
| SheetJS (xlsx) | ^0.18.5 | Parseo de Excel |
| uuid | ^13.0.0 | Ids estables de entidades / columnas |
| next/font | — | Manrope (UI) + JetBrains Mono (tipos de dato / SQL) |

> Sin Tailwind, sin React Flow, sin CodeMirror, sin ELK — el canvas ER, el editor DBML y el design system son todos propios.

## Primeros pasos

### Requisitos previos

- Node.js 20+ y npm (Databricks Apps usa Node 22).
- El backend [`backend-data-model-hub`](../backend-data-model-hub) (Python 3.12) en `http://localhost:8000`.

### Instalación

```bash
cd web-data-model-hub
npm install
cp .env.example .env     # NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Desarrollo

```bash
# Terminal 1 — backend de la plataforma
cd ../backend-data-model-hub && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd ../web-data-model-hub && npm run dev   # → http://localhost:3000
```

Abre `http://localhost:3000` — **sin login** (MVP abierto).

### Compilación de producción

```bash
npm run build && npm start
```

> En **Databricks Apps** el build corre en el deploy y `NEXT_PUBLIC_API_URL` (URL
> del backend) va en `.env.production`. Ver [`../DEPLOY-databricks.md`](../DEPLOY-databricks.md).

## Estructura del proyecto

```
web-data-model-hub/
├── src/
│   ├── app/                          # App Router — shells finos (SIN rutas /api, sin middleware)
│   │   ├── layout.tsx                # fuentes + import único de globals.css
│   │   ├── page.tsx                  # → <ModelCenterScreen/>  (features/model-center)
│   │   ├── projects/page.tsx                       # → <ProjectsScreen/>
│   │   ├── projects/[projectId]/page.tsx           # → <ProjectHubScreen/>
│   │   ├── projects/[projectId]/editor/page.tsx    # → <EditorScreen/>  (features/editor)
│   │   ├── docs/page.tsx             # → <HelpCenterScreen/>   (features/help)
│   │   └── globals.css               # solo @import de styles/ + el .css de cada feature
│   ├── components/
│   │   ├── layout/                   # AppLayout, Sidebar (rail 64px), Header
│   │   └── ui/                       # Icon, Modal, ConfirmDialog, TagEditor, …
│   ├── features/<name>/              # components/ [hooks/ lib/ services/ store/] + <name>.css + index.ts + README.md
│   │   ├── model-center/ · editor/ · projects/                # screens de las rutas
│   │   ├── diagram/ · table-editor/ · views/ · ddl/           # canvas, tablas, vistas, DDL
│   │   ├── levels/ · domains/ · engines/ · excel-import/      # CRUD del hub, engines, Excel
│   │   ├── metadata/ · help/                                  # metadata, ayuda
│   │   └── _template/                # esqueleto para una feature nueva
│   ├── styles/                       # tokens.css · base.css · ui.css · shell.css (CSS global)
│   ├── store/                        # useProjectStore · useUIStore · useMetadataStore
│   ├── services/                     # http · projects · canvas · metadata
│   ├── types/model.ts                # Project, ModelLevel, Domain, Table, View, Relationship, TableColumn
│   └── lib/                          # hierarchy.ts (scope/layerGap), columnRef.ts, tags.ts
└── doc/                              # Documentación completa
```

> Cada `features/<name>/` es autocontenida y se importa **solo** por su barrel `index.ts` (`@/features/<name>`). Las rutas de `app/` son shells finos que renderizan el *screen* de una feature. Convención en [doc/feature-architecture.md](doc/feature-architecture.md).

Persistencia: proyectos, tablas y relaciones viven en **Cosmos DB** vía
`backend-data-model-hub` (`projects`, `project_tables`, `project_relationships`).
El frontend no mantiene almacenamiento local.

## Guía de uso

### Crear un proyecto y abrir el canvas

1. **Projects → Nuevo proyecto**, ponle nombre.
2. En el **hub** del proyecto, agrega **Modelos (niveles)** y **Dominios**.
3. **Abrir canvas**, o clic en una tarjeta de nivel/dominio para abrir el editor con ese scope.

### Agregar tablas — cuatro caminos

- **Formulario manual** — `New → Nueva tabla`: nombre, schema, nivel, dominio, subdominio, y columnas con toggles PK/FK/SK, Nullable y tipo.
- **Desde tablas existentes** — hereda columnas de hasta dos tablas padre.
- **Editor DBML** — escribe/pega DBML; **Aplicar reemplaza el canvas**.
- **Importar Excel** — suelta un `.xlsx`; cada hoja → una tabla (A = nombre, B = tipo, C = definición). **Agrega** a las tablas existentes.

### Controles del canvas

| Acción | Cómo |
|--------|------|
| Pan / Zoom | Arrastra el fondo · rueda del mouse / dock − / + |
| Seleccionar / editar tabla | Clic / doble clic en un nodo |
| Conectar | Dock → Conectar, luego columna origen → columna destino |
| Auto-organizar / Ajustar | Dock → Auto-organizar (Por modelo · Snowflake · Compacto) / ajustar |
| Editar / recolorear / eliminar | Menú del engranaje del nodo |

### Exportar DDL

Barra superior **Export** → *Solo el scope actual* / *Incluir vistas* → **Copiar DDL**.

## Documentación

| Archivo | Contenido |
|---------|-----------|
| [doc/architecture.md](doc/architecture.md) | Arquitectura del frontend, estructura, decisiones técnicas |
| [doc/feature-architecture.md](doc/feature-architecture.md) | Convención de features (barrels) y cómo agregar una |
| [doc/data-flow.md](doc/data-flow.md) | Flujos de ingesta, autosave del canvas, scope, DDL |
| [doc/api-reference.md](doc/api-reference.md) | Endpoints del backend consumidos + tipos compartidos |
| [doc/design-system.md](doc/design-system.md) | Tokens Aurora, tipografía, clases CSS |
| [doc/user-guide.md](doc/user-guide.md) | Instrucciones de uso detalladas |
| [doc/deployment.md](doc/deployment.md) | Dev local + despliegue a Databricks Apps |

## Licencia

Software propietario.
