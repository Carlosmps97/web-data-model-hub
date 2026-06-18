# Data Model Hub

Aplicación web profesional para diseñar, visualizar y gobernar modelos de datos a
través de múltiples proyectos. Construida con **Next.js 16** y **React 19**, con
un **canvas ER hecho a mano** (sin librería de diagramas) y el design system
**"Aurora"**. Tema claro único, sin Tailwind — la UI se estiliza por completo con
CSS custom properties.

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
Cosmos DB) por CORS con el cookie `modeler-auth`. Un proxy de Next.js
(`proxy.ts`) verifica el JWT de sesión en cada navegación.

## Jerarquía

| Nivel | Qué es |
|-------|--------|
| **Proyecto** | Un repositorio de datos (p. ej. "Lakehouse"). Es dueño de sus engines, niveles y dominios; es la unidad de acceso; tiene un único canvas. |
| **Modelo (nivel)** | Una capa del proyecto — RDV·UDV·DDV, o la que definas. Su orden controla las bandas izquierda→derecha del canvas y la adyacencia entre capas. |
| **Dominio** | Un producto de datos (Finanzas, Clientes…). **Vertical**: el mismo dominio abarca varios niveles. Lleva owner, steward, sensibilidad y subdominios. |
| **Tabla** | Vive en un nivel y (opcionalmente) un dominio; hereda el color del dominio; embebe **vistas** SQL específicas por rol. |

## Funcionalidades

- **Canvas ER hecho a mano** — pan/zoom, arrastre, ajustar a pantalla y minimapa propios (sin React Flow / ELK).
- **Scope** — un límite de edición seguro `{niveles, dominios}` que filtra qué tablas son visibles y editables. Presets (todo el modelo · un nivel · un dominio) más una matriz personalizada Modelos×Dominios.
- **Modo conectar + cardinalidad** — clic en una columna origen, luego en una columna destino de otra tabla; eliges `1:1 / 1:N / N:N`. La columna origen se vuelve FK.
- **Conciencia cross-layer** — las relaciones entre niveles adyacentes muestran una etiqueta teal `A→B`; los "saltos" no adyacentes se dibujan en ámbar/punteado con una advertencia.
- **Flujo animado al hover/selección** — las columnas conectadas se resaltan y el wire activo "fluye"; los wires no relacionados se atenúan.
- **Auto-organizar** — tres layouts tipo masonry que consideran la altura (Por modelo · Snowflake · Compacto) y nunca se solapan, sin importar la dispersión de columnas.
- **Inspector** — panel por tabla con pestañas Columnas / **Vistas (SQL por rol)** / Links, más badges de gobierno (nivel, dominio, owner/steward).
- **Cuatro caminos de ingesta de tablas** — formulario manual · desde tablas existentes (hereda columnas) · editor DBML · importación de Excel (`.xlsx`).
- **Vistas SQL específicas por rol** — proyecciones por rol con enmascaramiento (`sha256`, `regexp_replace`…) y filtros `WHERE`; se exportan junto al DDL.
- **Exportación de DDL** — `CREATE TABLE` + PK + `ALTER … ADD FOREIGN KEY` (+ `CREATE VIEW` opcional), por scope o por todo el modelo, según el engine.
- **Model Center** — un catálogo cross-project (Overview · Tables · Views · Columns) con gobierno de salud del modelo (tablas sin PK, sin dominio, sin vista, columnas PII).
- **Centro de ayuda in-app** — artículos orientados a la acción más un drawer de ayuda rápida ("?").
- **Usuarios y permisos** — roles (admin/editor/viewer) y permisos `view`/`edit` por proyecto.
- **Guardado automático** — persistencia con debounce de 800 ms de tablas y relaciones (las posiciones de los nodos son por sesión, recalculadas por los layouts al abrir).
- **Agente de modelado IA (desacoplado)** — la feature `chat-agent` apunta al servicio aparte [`app-agents-modeler`](../app-agents-modeler); el botón "AI Agent" del editor por ahora es un placeholder y se reconectará en una versión futura.

## Stack tecnológico

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| Next.js (App Router, Turbopack) | 16.2.3 | UI + SSR + middleware de auth `proxy.ts` (sin rutas API) |
| React | 19.2.4 | Renderizado de componentes |
| TypeScript | ^5 | Tipado en todo el proyecto |
| Zustand | ^5.0.12 | Estado del cliente (`useProjectStore`, `useAuthStore`, `useUIStore`) |
| jose | ^6.2.3 | Verificación de JWT en el proxy Edge (HS256, `AUTH_SECRET` compartido) |
| sonner | ^2.0.7 | Toasts |
| SheetJS (xlsx) | ^0.18.5 | Parseo de Excel |
| uuid | ^13.0.0 | Ids estables de entidades / columnas |
| next/font | — | Manrope (UI) + JetBrains Mono (tipos de dato / SQL) |

> Sin Tailwind, sin React Flow, sin CodeMirror, sin ELK — el canvas ER, el editor DBML y el design system son todos propios.

## Primeros pasos

### Requisitos previos

- Node.js 20+ y npm
- El backend de la plataforma (Python 3.12): [`backend-data-model-hub`](../backend-data-model-hub) en `http://localhost:8000` — auth, proyectos, canvas, persistencia.
- *(Opcional, próximamente)* el servicio del agente [`app-agents-modeler`](../app-agents-modeler) para el chat IA.

### Instalación

```bash
cd web-data-model-hub
npm install
cp .env.example .env
```

Configura en `.env`:

- `NEXT_PUBLIC_API_URL=http://localhost:8000` — backend de la plataforma (auth + persistencia).
- `NEXT_PUBLIC_AGENT_API_URL=http://localhost:8001` — servicio del agente (opcional; solo se usa cuando se reconecte el chat IA).
- `AUTH_SECRET=...` — **debe coincidir** con `AUTH_SECRET` en `backend-data-model-hub/.env`.

Las URLs `NEXT_PUBLIC_*` son visibles desde el navegador: el frontend llama a FastAPI directamente. La autenticación contra el backend de la plataforma usa el cookie `modeler-auth` (enviado cross-origin vía `credentials: 'include'`).

### Desarrollo

```bash
# Terminal 1 — backend de la plataforma
cd ../backend-data-model-hub
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd ../web-data-model-hub
npm run dev          # → http://localhost:3000
```

Abre `http://localhost:3000` → `/login`. En el primer arranque, el backend crea `admin / dogadmin2019` — cambia la contraseña desde **Usuarios** de inmediato.

### Compilación de producción

```bash
npm run build
npm start
```

## Estructura del proyecto

```
web-data-model-hub/
├── proxy.ts                          # middleware Next 16 (export `proxy`) — verifica JWT + redirect
├── src/
│   ├── app/                          # App Router — shells finos (SIN rutas /api)
│   │   ├── layout.tsx                # fuentes + import único de globals.css
│   │   ├── page.tsx                  # → <ModelCenterScreen/>  (features/model-center)
│   │   ├── login/page.tsx            # → <LoginScreen/>        (features/auth)
│   │   ├── projects/page.tsx                       # → <ProjectsScreen/>
│   │   ├── projects/[projectId]/page.tsx           # → <ProjectHubScreen/>
│   │   ├── projects/[projectId]/editor/page.tsx    # → <EditorScreen/>  (features/editor)
│   │   ├── docs/page.tsx             # → <HelpCenterScreen/>   (features/help)
│   │   ├── admin/users/page.tsx      # → <AdminUsersScreen/>
│   │   └── globals.css               # solo @import de styles/ + el .css de cada feature
│   ├── components/
│   │   ├── layout/                   # AppLayout, Sidebar (rail 64px), Header
│   │   └── ui/                       # Icon, Modal, ConfirmDialog, TagEditor, …
│   ├── features/<name>/              # components/ [hooks/ lib/ services/ store/] + <name>.css + index.ts + README.md
│   │   ├── model-center/ · editor/ · projects/ · auth/        # screens de las rutas
│   │   ├── diagram/ · table-editor/ · views/ · ddl/           # canvas, tablas, vistas, DDL
│   │   ├── levels/ · domains/ · engines/ · excel-import/      # CRUD del hub, engines, Excel
│   │   ├── metadata/ · admin-users/ · help/ · chat-agent/     # metadata, usuarios, ayuda, IA
│   │   └── _template/                # esqueleto para una feature nueva
│   ├── styles/                       # tokens.css · base.css · ui.css · shell.css (CSS global)
│   ├── store/                        # useProjectStore · useAuthStore · useUIStore · useMetadataStore
│   ├── services/                     # http, auth, projects, canvas, admin, metadata
│   ├── types/model.ts                # Project, ModelLevel, Domain, Table, View, Relationship, TableColumn
│   ├── lib/                          # hierarchy.ts (scope/layerGap), columnRef.ts, tags.ts, auth/permissions.ts
│   └── server/auth/jwt.ts            # signAuthToken / verifyAuthToken (jose)
└── doc/                              # Documentación completa
```

> Cada `features/<name>/` es autocontenida y se importa **solo** por su barrel `index.ts` (`@/features/<name>`), nunca por rutas internas. Las rutas de `app/` son shells finos que renderizan el *screen* de una feature. Convención completa en [doc/feature-architecture.md](doc/feature-architecture.md).

Persistencia: los proyectos, tablas, relaciones y usuarios viven en **Cosmos DB** vía `backend-data-model-hub` (`projects`, `project_tables`, `project_relationships`, `users`). El frontend no mantiene almacenamiento local.

## Guía de uso

### Crear un proyecto y abrir el canvas

1. **Projects → Nuevo proyecto** (admin), ponle nombre.
2. En el **hub** del proyecto, agrega **Modelos (niveles)** y **Dominios**.
3. **Abrir canvas**, o haz clic en una tarjeta de nivel/dominio para abrir el editor con ese scope aplicado.

### Agregar tablas — cuatro caminos

- **Formulario manual** — barra lateral `New → Nueva tabla`: nombre, schema, nivel, dominio, subdominio, y columnas con toggles PK/FK/SK, Nullable y tipo.
- **Desde tablas existentes** — hereda columnas de hasta dos tablas padre; opcionalmente mantiene una FK a cada padre.
- **Editor DBML** — escribe/pega DBML; **Aplicar reemplaza el canvas**.

```dbml
Table users {
  id integer [pk]
  email varchar(100) [not null]
}
Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
}
```

- **Importar Excel** — suelta un `.xlsx`; cada hoja → una tabla (A = nombre, B = tipo, C = definición). **Agrega** a las tablas existentes.

### Controles del canvas

| Acción | Cómo |
|--------|------|
| Pan | Arrastra el fondo del canvas |
| Zoom | Rueda del mouse · dock − / + |
| Seleccionar / editar tabla | Clic / doble clic en un nodo |
| Mover tabla | Arrastra el header |
| Conectar | Dock → Conectar, luego clic en columna origen → columna destino |
| Auto-organizar | Dock → Auto-organizar → Por modelo · Snowflake · Compacto |
| Ajustar a pantalla | Dock → ajustar |
| Editar / recolorear / eliminar | Menú del engranaje del nodo |

### Exportar DDL

Barra superior **Export** → alterna *Solo el scope actual* / *Incluir vistas* → **Copiar DDL**.

## Documentación

| Archivo | Contenido |
|---------|-----------|
| [doc/architecture.md](doc/architecture.md) | Arquitectura del frontend, estructura, decisiones técnicas |
| [doc/feature-architecture.md](doc/feature-architecture.md) | Convención de features (barrels) y cómo agregar una |
| [doc/data-flow.md](doc/data-flow.md) | Login, flujos de ingesta, autosave del canvas, scope, DDL |
| [doc/api-reference.md](doc/api-reference.md) | Endpoints del backend consumidos + tipos compartidos |
| [doc/design-system.md](doc/design-system.md) | Tokens Aurora, tipografía, clases CSS |
| [doc/user-guide.md](doc/user-guide.md) | Instrucciones de uso detalladas |
| [doc/deployment.md](doc/deployment.md) | Configuración del entorno y despliegue |

## Licencia

Software propietario.
