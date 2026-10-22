# Estructura del proyecto

Este documento recorre el repositorio de la web: qué hay en la raíz, cómo se organiza `src/`, cómo está
armada una feature, qué reglas de importación se aplican y qué convenciones siguen el código, las pruebas
y los estilos. Cierra con los pasos para agregar una pantalla o una feature. Está dirigido a quien va a
escribir código en el repositorio; la visión por capas y el porqué de cada una están en
[Arquitectura](02-arquitectura.md).

## Contenido

- [Raíz del repositorio](#raíz-del-repositorio)
- [Árbol de `src/`](#árbol-de-src)
- [Anatomía de una feature](#anatomía-de-una-feature)
- [Reglas de importación](#reglas-de-importación)
- [Pruebas de arquitectura](#pruebas-de-arquitectura)
- [Convenciones](#convenciones)
- [Cómo agregar una pantalla](#cómo-agregar-una-pantalla)
- [Cómo agregar una feature](#cómo-agregar-una-feature)
- [Documentos relacionados](#documentos-relacionados)

## Raíz del repositorio

El árbol muestra los archivos versionados de la raíz (la lista completa se obtiene con `git ls-files`).

```text
web-data-model-hub/
├── .github/workflows/
│   ├── deploy-databricks.yml            # Disparo del despliegue por rama → environment
│   └── reusable-databricks-deploy.yml   # Mecánica del despliegue a Databricks Apps
├── docs/                                # Esta documentación
├── public/                              # Archivos estáticos copiados tal cual al build
│   ├── icon.png, apple-icon.png, logo-dog.png
│   └── templates/Plantilla.xlsx         # Plantilla descargable de la carga masiva desde Excel
├── scripts/
│   └── generate-stress-model.mjs        # Generador de un modelo sintético para pruebas de estrés
├── src/                                 # Código de la aplicación (ver abajo)
├── vendor/
│   └── xlsx-0.20.3.tgz                  # Paquete de SheetJS que instala npm (dependencia file:)
├── .env.example                         # Plantilla de variables de entorno locales
├── .gitignore
├── README.md                            # Presentación del repositorio y puesta en marcha
├── app.yaml                             # App spec de Databricks Apps: comando y variables
├── databricks.yml                       # Bundle de Databricks: app, recursos y permisos
├── eslint.config.mjs                    # ESLint (flat config) con la guarda de barrels
├── index.html                           # HTML de entrada de Vite (#root + /src/main.tsx)
├── package.json, package-lock.json      # Dependencias con versión exacta y scripts npm
├── server.mjs                           # Servidor de producción: estáticos + proxy /api + cookie de sesión
├── server.test.mjs                      # Pruebas de server.mjs
├── tsconfig.json                        # TypeScript estricto, alias @/
└── vite.config.ts                       # Vite + plugin React + /api con el proxy de server.mjs + Vitest
```

| Archivo o carpeta | Para qué sirve |
|---|---|
| `server.mjs` | Servidor HTTP de Node sin dependencias que en producción sirve `dist/` con fallback SPA y reenvía `/api` al backend con token M2M y relay de identidad SSO; guarda el token de sesión en una cookie HttpOnly. Se arranca con `npm run start`. Exporta `createApiHandler`, que también usa el servidor de desarrollo. Ver [Arquitectura](02-arquitectura.md). |
| `server.test.mjs` | Pruebas de `server.mjs` (tipos de contenido, `safeJoin`, caché de token, cabeceras, cookie de sesión, CSRF y servidor). Las incluye Vitest. |
| `vite.config.ts` | Plugin `@vitejs/plugin-react`, alias `@` → `./src`, servidor de desarrollo en el puerto 3000 que reenvía `/api` a `BACKEND_API_URL` (por defecto `http://localhost:8000`) con `createApiHandler` de `server.mjs`, y configuración de Vitest (`environment: 'node'`, `include: ['src/**/*.test.{ts,tsx}', 'server.test.mjs']`). |
| `tsconfig.json` | `strict: true`, `target`/`lib` ES2020 con DOM, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit`, alias `@/*` → `./src/*`. Incluye solo `src/`: `server.mjs` no pasa por `tsc`. |
| `eslint.config.mjs` | `@eslint/js` recomendado, `typescript-eslint` recomendado, `react-hooks/exhaustive-deps` como advertencia y la regla `no-restricted-imports` de barrels. Declara los globales de Node para los `.mjs` de la raíz e ignora `dist`, `node_modules`, `.next` y `scripts`. |
| `index.html` | Documento HTML que Vite usa como entrada: contenedor `#root`, íconos y el `<script type="module" src="/src/main.tsx">`. |
| `public/` | Vite copia su contenido a la raíz de `dist/`. `templates/Plantilla.xlsx` es la plantilla que ofrece la carga masiva. |
| `app.yaml` | Comando de arranque (`npm run start`) y variables de la app (`BACKEND_API_URL`, `PROXY_SHARED_SECRET` por `valueFrom`). Databricks Apps lo lee en cada arranque; no debe borrarse. |
| `databricks.yml` | Bundle con la app `frontend`, el recurso `secret` del relay, los permisos (`CAN_MANAGE` para el administrador, `CAN_USE` para el grupo `users`) y el target `prod`. |
| `.github/workflows/` | El workflow de entrada mapea ramas a environments (`deploy-dev` → `dev`, `develop` → `qa`, `main` → `prod`) y llama al reutilizable, que valida variables, inyecta el `app.yaml`, despliega el bundle y aplica permisos entre apps. Ver [Despliegue](09-despliegue.md). |
| `.env.example` | Plantilla de `.env` local con `VITE_API_URL` vacía (mismo origen). Los `.env*` reales están ignorados. |
| `scripts/generate-stress-model.mjs` | Genera un JSON con N tablas, columnas y relaciones para medir rendimiento con modelos grandes (`node scripts/generate-stress-model.mjs --tables=1000 --cols=10`). ESLint no lo revisa. |
| `vendor/xlsx-0.20.3.tgz` | Paquete de SheetJS que `package.json` declara como `file:vendor/xlsx-0.20.3.tgz`. SheetJS publica sus versiones corregidas solo en su CDN; la copia permite que `npm install` no dependa de él. Ver [Stack tecnológico](04-stack-tecnologico.md). |
| `dist/` | Salida de `npm run build` (`tsc --noEmit && vite build`). No se versiona (está en `.gitignore`): en Databricks Apps se genera en cada despliegue o arranque. |

## Árbol de `src/`

El árbol muestra las carpetas y los archivos clave de `src/`. Las pruebas (`*.test.ts`) viven junto a cada
archivo y se omiten.

```text
src/
├── main.tsx                     # Punto de entrada: fuentes, CSS de React Flow, globals.css, <App/>
├── App.tsx                      # Router, guards, ShellLayout y hosts globales (diálogos, overlay, toasts)
├── architecture.test.ts         # Pruebas que imponen reglas de arquitectura sobre el código fuente
├── vite-env.d.ts                # Tipos de import.meta.env (VITE_API_URL) y de assets ?inline
├── app/
│   └── globals.css              # Orquesta los @import de estilos en orden de cascada
├── components/
│   ├── ui/                      # Primitivas del sistema de diseño (barrel index.ts)
│   │   ├── Button, Dialog, Modal, ConfirmDialog, Badge, Avatar, Icon, Tooltip,
│   │   │   SegmentedControl, TagEditor, AffectedTable (lista virtualizada)
│   │   ├── dialogs.tsx          # confirmDialog / promptDialog + DialogHost
│   │   ├── dialogStack.ts, focusTrap.ts, useFloating.ts, affectedRows.ts
│   │   └── index.ts
│   ├── layout/                  # TopNav (navegación + guard de salida), UserMenu
│   ├── BusyOverlay.tsx          # Overlay bloqueante de useBusyStore
│   ├── OpenModelModal.tsx       # Open model: proyecto → versión y modo
│   ├── NewProjectModal.tsx      # New project (vacío o copiando bloques de Data Standards)
│   └── ProjectPicker.tsx        # Selector de proyecto compartido
├── features/
│   ├── modeler/                 # Model: canvas ER, Explorer, paneles, exports del diagrama
│   ├── standards/               # Data Standards: glosario, dominios, UDP, themes, reglas DDL
│   ├── reporting/               # Plantillas de hoja y armado de filas del Reporting
│   ├── ddl/                     # Export DDL (Databricks y Oracle)
│   ├── upload/                  # Carga masiva desde Excel y perfiles de carga
│   ├── admin/                   # Admin: usuarios, roles y matriz de permisos
│   └── auth/                    # LoginScreen, guards, auth.service, sessionKeeper
├── screens/
│   ├── HomeScreen.tsx           # Home
│   ├── ReportingScreen.tsx      # Reporting
│   ├── ReviewScreen.tsx         # Revisión de solicitudes
│   ├── home/                    # VersionToolsModal, TransferVersionDialog
│   └── review/                  # ChangesSummary, ChangesDetailModal, DiffTree, DiffExplorer,
│                                #   CriticalDeletionBlock, ApproveDeletionDialog, RejectDialog,
│                                #   RequestHistory, PublishBlockedPanel y su lógica pura
├── services/
│   ├── http.ts                  # apiFetch, envelope, ApiError, timeouts, observadores
│   ├── apiBase.ts               # API_BASE (VITE_API_URL o mismo origen)
│   ├── warmup.ts                # Warm-up SSO cuando el backend está en otro origen
│   ├── governance.service.ts    # Lecturas y escrituras del modelo conscientes del changeset
│   ├── changeset.service.ts     # Registro de cambios en el changeset (individual y en lote)
│   ├── versioning.service.ts    # Versiones, solicitudes, revisión, publicación
│   ├── projects.service.ts, dashboard.service.ts, reporting.service.ts,
│   ├── views.service.ts, naming.service.ts, themes.service.ts
├── store/
│   ├── useAuthStore.ts, useSessionStore.ts, useModelerStore.ts,
│   ├── useUndoStore.ts, useUiStore.ts, useBusyStore.ts
│   └── resetAppState.ts         # Limpieza del estado por usuario (login, logout, 401)
├── lib/                         # Utilidades puras: facets, colors, udpValue, udpChoices, udpNumber,
│                                #   typeText, logicalName, projects, tags, pool, zip, floating,
│                                #   versionAdmin, permissionHints (motivos de botones
│                                #   deshabilitados por permiso: NO_EXPORT_HINT, newProjectBlock)
├── types/
│   ├── api.ts                   # Envelope ApiResponse<T> y requests
│   ├── model.ts                 # Proyecto, tags, tipos de esquema y de columna
│   └── versioning.ts            # Versiones, solicitudes, diffs, comentarios
└── styles/                      # tokens, base, ui, components, topnav, shell, home, review, reporting
```

### Features

| Feature | Contenido principal | Barrel |
|---|---|---|
| `modeler` | `components/` (WorkspaceScreen, ModelerCanvas, nodos y aristas, Toolbar, Explorer, paneles de propiedades, popups de relación, pegado e inspector), `lib/` (layout ELK, LOD, orden de columnas, sesión y pins, exports SVG/PDF/HTML, wires, colores) y `services/` (modeler, structure, explorer, inspector, schemas, pasteSource). | `WorkspaceScreen`, `pushToast`. |
| `standards` | `components/` (StandardsScreen y una página por bloque: glosario, dominios, UDP, themes, reglas DDL y Output settings), services (`standards.service.ts`, `ddlRules.service.ts`) y lógica pura en la raíz de la feature (`domainForm`, `domainImpact`, `glossaryValidation`, `standardsDiff`, `rollbackPreview`, `themeForm`). | `StandardsScreen`. |
| `reporting` | `components/` (SheetTemplateCard, SheetTemplateEditor), `lib/` (filas de hoja, lecturas en lotes, versiones) y `sheetTemplates.service.ts`. | Componentes y funciones que usa `ReportingScreen`. |
| `ddl` | Generadores Databricks (`generators.ts`) y Oracle (`oracle.ts`), Output settings, puente con las reglas del backend y `components/` (ExportDdlModal, DdlOutputForm, ExportRulesPanel). Su mapa está en `src/features/ddl/README.md`. | `ExportDdlModal`, `viewDDL`, `DdlOutputForm` y tipos. |
| `upload` | `components/` (UploadModal, perfiles, mapeo, reporte), `lib/` (lectura del libro con xlsx, borrador de perfil, destino), `upload.service.ts`, `placeUploaded.ts` y `upload.css`. | `UploadModal`, `ProfileManagerModal`, lectura del libro y el servicio. |
| `admin` | `components/` (AdminScreen, UserModal, RoleModal, PermissionMatrix y `helpers.ts`, con las reglas puras de Admin: único administrador activo, matriz sin administrador, alcance por proyecto y nivel de acceso) y `admin.service.ts`. | `AdminScreen`. |
| `auth` | `LoginScreen.tsx`, `guards.tsx`, `auth.service.ts`, `auth.css`. | Sin barrel: `App.tsx` y los stores importan sus archivos directamente. |

## Anatomía de una feature

Una feature agrupa todo lo de un área funcional y publica lo mínimo en su `index.ts`. La forma habitual es:

```text
features/<nombre>/
├── index.ts               # API pública (barrel): lo único que se importa desde fuera
├── components/            # Componentes React de la feature
├── lib/                   # Lógica pura (sin requests ni stores), con sus pruebas al lado
├── services/              # o <nombre>.service.ts en la raíz: llamadas a la API de la feature
└── <nombre>.css           # Estilos propios, si los hay
```

`features/reporting` es un ejemplo completo y pequeño:

```text
features/reporting/
├── index.ts                         # Exporta SheetTemplateCard y las funciones de filas, lecturas y versiones
├── components/
│   ├── SheetTemplateCard.tsx        # Tarjeta de plantillas de hoja en Reporting (export con plantilla)
│   ├── SheetTemplateEditor.tsx      # Editor de columnas y filtros de una plantilla
│   └── fakeReact.testutil.ts        # Soporte de pruebas: render sin DOM
├── lib/
│   ├── reportRows.ts                # Filas de hoja por nivel (tablas, columnas, relaciones, vistas)
│   ├── reportFetch.ts               # Lecturas en lotes con tope de concurrencia
│   ├── reportVersions.ts            # Opciones y textos de versión del Reporting
│   └── sheetTemplates.ts            # Columnas y filtros de filas de una plantilla
└── sheetTemplates.service.ts        # CRUD de plantillas de hoja contra la API
```

Su barrel publica solo lo que usa `src/screens/ReportingScreen.tsx`:

```ts
// API pública de la feature `reporting`. Se importa desde `@/features/reporting`,
// nunca desde sus subdirectorios.
export { default as SheetTemplateCard } from './components/SheetTemplateCard';
export {
  COLUMN_BATCH, columnSheetRow, joinedSheetRow, relationshipSheetRow, sheetHeaders, sortColumnRows, tableSheetRow,
  udpKeysOf, unionSorted, viewSheetRow,
} from './lib/reportRows';
export type { SheetRow } from './lib/reportRows';
export { fetchColumnsFor, fetchRelationshipsFor, fetchViewsFor } from './lib/reportFetch';
export {
  levelsFileName, ownOpenVersions, productionLabel, readErrorText, vanishedVersionText, VERSION_CLOSED_TEXT, VERSION_TOAST,
  versionGoneText, versionOptionLabel,
} from './lib/reportVersions';
```

Y la pantalla lo consume por el barrel:

```ts
import { SheetTemplateCard, fetchColumnsFor, sheetHeaders } from '@/features/reporting';
```

No todas las features usan las tres subcarpetas: `standards` tiene sus services y su lógica pura en la
raíz de la feature, y `ddl` concentra sus generadores en archivos de la raíz con `components/` aparte. La
regla común es que el barrel define la frontera.

## Reglas de importación

### Alias `@/`

`@/` apunta a `src/` (definido en `vite.config.ts` para el build y en `tsconfig.json` para el editor y
`tsc`). Entre carpetas distintas de `src/` se importa siempre con el alias
(`@/store/useSessionStore`, `@/services/http`); dentro de una misma carpeta o feature, con rutas
relativas (`./components/...`, `../lib/...`).

### Barrels de feature (`no-restricted-imports`)

`eslint.config.mjs` aplica esta regla a todo el código:

```js
'no-restricted-imports': [
  'warn',
  {
    patterns: [
      {
        group: ['@/features/*/**'],
        message:
          "Una feature se importa por su barrel '@/features/<name>', no por su ruta interna. Ver docs/03-estructura-del-proyecto.md.",
      },
    ],
  },
],
```

- Desde fuera de una feature se importa `@/features/<nombre>`.
- La regla es una advertencia (`warn`): `npm run lint` la reporta pero no falla. Hay dependencias internas
  deliberadas que la disparan y que se conservan:
  - `src/store/useModelerStore.ts` y `useUndoStore.ts` usan services y `lib/` de `features/modeler`: el
    store del canvas es parte del Model aunque viva en `src/store`.
  - `features/upload` usa piezas internas de `modeler` (`services/modeler.service`,
    `services/structure.service`, `lib/placeNewMembers`, `lib/canvasFocus`, `components/SearchSelect`,
    `lib/sessionGuard`). El
    barrel de `modeler` exporta `WorkspaceScreen`, cuya `Toolbar` importa `@/features/upload`; pasar por
    el barrel formaría un ciclo entre las dos features.
  - `features/auth` no tiene barrel: `App.tsx`, los stores y algunos componentes importan
    `@/features/auth/guards`, `@/features/auth/auth.service` y `@/features/auth/sessionKeeper`
    directamente.
  - Archivos dentro de una feature que importan otros de la misma feature con el alias en lugar de una
    ruta relativa.
- Un import interno que no esté entre esos casos se considera un error de diseño: se agrega lo necesario
  al barrel de la feature o se mueve la pieza compartida a `src/lib` o `src/components`.

El listado completo de advertencias se obtiene con:

```bash
npx eslint . | grep no-restricted-imports
```

### Otras dependencias

- `src/lib` no importa stores ni services.
- `src/services` no importa componentes, ni sonner, ni el router.
- Los archivos de `features/standards` no importan `services/governance.service` ni `sessionProjectId`
  (lo impone `src/architecture.test.ts`).
- Las pantallas de `src/screens` importan sus subcomponentes con el alias
  (`@/screens/review/ChangesSummary`).

## Pruebas de arquitectura

`src/architecture.test.ts` recorre el código fuente con Vitest y falla si se rompe alguna de estas reglas:

| Bloque | Qué verifica |
|---|---|
| Rutas excluidas de la arquitectura | Que no existan carpetas ni módulos que el diseño excluye, como `features/governance`, `hooks/`, `store/useChangesetStore.ts` o `store/useIdentityStore.ts`: la identidad vive en `useAuthStore` y la versión activa en `useSessionStore`. |
| Data Standards es explícito por proyecto | Ningún archivo de `features/standards` importa `services/governance.service` ni usa `sessionProjectId`: si lo hiciera, sin proyecto de canvas abierto lanzaría un error dentro de un efecto y la pantalla quedaría en blanco. |
| Fondos de popup sin `backdrop-filter` | Ninguna hoja de estilos ni primitiva de diálogo difumina el fondo de un popup: sin aceleración por GPU, el blur satura el proceso de composición del navegador en cada cuadro. Los fondos siguen oscureciendo. |
| Export DDL: vistas del canvas | Ningún archivo de `features/ddl` lee las vistas por tablas (`listViewsForTables`): el export incluye solo las vistas miembro del canvas. |
| Botones con texto se ven como botón | En todos los `.tsx`, un botón con texto usa una variante visible (`rd-btn-secondary`, `rd-btn-danger`, `rd-btn-primary` o `<Button variant="secondary">`); `rd-btn-ghost` queda para botones de ícono y la navegación «← All …». Tampoco se usan clases de enlace como botón. |

Otras pruebas leen el fuente de `features/modeler` para imponer el uso de los pins de sesión
(`pinnedFlows.test.ts`, `undoPins.test.ts`, `workspaceWriteErrors.test.ts`). Ver [Pruebas](10-pruebas.md).

## Convenciones

### Nombres de archivo

| Tipo | Convención | Ejemplo |
|---|---|---|
| Componente React | PascalCase `.tsx`, export por defecto | `SheetTemplateCard.tsx` |
| Hook | `use` + PascalCase `.ts` | `useToolbarFit.ts`, `useFloating.ts` |
| Store Zustand | `use<Nombre>Store.ts` en `src/store` | `useSessionStore.ts` |
| Servicio de API | `<recurso>.service.ts` | `versioning.service.ts` |
| Lógica pura | camelCase `.ts` | `columnOrder.ts`, `reportRows.ts` |
| Prueba | `<archivo>.test.ts` o `.test.tsx` junto al archivo | `reportRows.test.ts` |
| Prueba temática de un archivo grande | `<archivo>.<tema>.test.ts` | `useModelerStore.deleteUndo.test.ts` |
| Soporte de pruebas | `<nombre>.testutil.ts` | `pinnedFlows.testutil.ts` |
| Estilos de feature | `<feature>.css` | `modeler.css`, `upload.css` |

### Pruebas junto al código

Cada prueba vive al lado del archivo que prueba. Vitest las encuentra por el patrón
`src/**/*.test.{ts,tsx}` (más `server.test.mjs`) y corre en entorno `node`: las pruebas de lógica pura no
necesitan DOM, y las de componentes renderizan a HTML estático (`react-dom/server`) o usan soportes propios
sin DOM real. Ver [Pruebas](10-pruebas.md).

### CSS global por prefijos

No hay CSS Modules. `src/app/globals.css` importa, en este orden, `styles/tokens.css`, `base.css`,
`ui.css`, `components.css`, `topnav.css`, `shell.css`, `home.css`, `review.css`, `reporting.css`,
`features/auth/auth.css` y `features/modeler/modeler.css`. `features/upload/upload.css` lo importa
`UploadModal.tsx`. Cada área usa su prefijo de clase:

| Prefijo | Área | Hoja |
|---|---|---|
| `rd-` | Primitivas (botones, menús, pestañas, badges, spinner) | `styles/ui.css` |
| `dmh-` | Chrome y componentes compartidos (`dmh-topnav`, `dmh-dialog`, `dmh-badge`) | `styles/components.css`, `topnav.css`, `shell.css` |
| `dmh-home`, `dmh-vt`, `dmh-openmodel` | Home, Version tools, Open model | `styles/home.css` |
| `dmh-rep` | Reporting | `styles/reporting.css` |
| `dmh-rv`, `dmh-rvd`, `dmh-rvs` | Review | `styles/review.css` |
| `dmh-login` | Login | `features/auth/auth.css` |
| `wk-`, `exd-`, `udp-` | Model (canvas, Explorer, UDP) | `features/modeler/modeler.css` |
| `up-` | Carga desde Excel | `features/upload/upload.css` |

Los colores, tipografías y espacios salen de variables de `styles/tokens.css`. Ver
[Sistema de diseño](11-sistema-de-diseno.md).

### Textos e idioma

Los textos de la UI y los mensajes al usuario están en inglés; los comentarios, docstrings y títulos de
prueba, en español.

## Cómo agregar una pantalla

1. Crear el componente en `src/screens/<Nombre>Screen.tsx` (o, si pertenece a una feature, en
   `features/<feature>/components/` y exportarlo desde su barrel). Los subcomponentes propios van en
   `src/screens/<nombre>/`.
2. Registrar la ruta en `src/App.tsx`, dentro de `<Route element={<ShellLayout />}>` para que tenga sesión
   y `TopNav`. Si requiere un permiso, envolver el elemento:

   ```tsx
   <Route path="/nueva" element={<RequirePermission perm="model.view"><NuevaScreen /></RequirePermission>} />
   ```

3. Si debe aparecer en la navegación, agregar un ítem al arreglo `NAV` de
   `src/components/layout/TopNav.tsx` (con `perm` si corresponde).
4. Agregar sus estilos en `src/styles/<nombre>.css` con un prefijo propio e importarlos en
   `src/app/globals.css`.
5. Si llama a la API, usar un service de `src/services` o de la feature; la pantalla no llama a
   `apiFetch` directamente.
6. Escribir sus pruebas junto al código y correr `npm test`, `npx tsc --noEmit` y `npm run lint`.

## Cómo agregar una feature

1. Crear `src/features/<nombre>/` con `index.ts`, `components/`, `lib/` y su service
   (`<nombre>.service.ts` o `services/`).
2. Construir el service sobre `apiGet`/`apiPost`/`apiPut`/`apiDelete` de `@/services/http` y las rutas
   sobre `API_BASE`. Si depende del proyecto de la sesión de canvas, leerlo con `sessionProjectId()`; si es
   una pantalla por proyecto independiente del canvas (como Data Standards), recibir el `projectId`
   explícito.
3. Si escribe en el modelo, hacerlo por `governance.service` o `changeset.service` (siempre a una versión
   en edición) y, en acciones de varias escrituras, tomar un pin con `pinSession()` y llamar a
   `pin.check()` antes de cada escritura que siga a un `await`.
4. Exportar desde `index.ts` solo lo que otras partes necesitan e importarla desde fuera con
   `@/features/<nombre>`.
5. Si tiene estilos, crear `<nombre>.css` con un prefijo nuevo e importarlo en `src/app/globals.css` (o en
   su componente raíz, como hace `upload`).
6. Si la feature introduce una regla de arquitectura (por ejemplo, un import prohibido), agregar el bloque
   correspondiente en `src/architecture.test.ts`.

## Documentos relacionados

- [Arquitectura](02-arquitectura.md)
- [Stack tecnológico](04-stack-tecnologico.md)
- [Funcionalidades](05-funcionalidades.md)
- [Pruebas](10-pruebas.md)
- [Sistema de diseño](11-sistema-de-diseno.md)
- [Despliegue](09-despliegue.md)
