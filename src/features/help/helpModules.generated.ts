// GENERADO desde el workflow help-content (doc funcional por modulo, EN+ES).
// No editar a mano: regenerar si cambian las funcionalidades.
import type { ModuleDoc } from './helpContent';

export const MODULES: ModuleDoc[] = [
  {
    "id": "home",
    "card": {
      "titleEn": "Home / Hub",
      "titleEs": "Inicio / Hub",
      "blurbEn": "The Data Model Hub landing page: workspace metrics at a glance, the change requests assigned to you, read-only version status, and the global top navigation.",
      "blurbEs": "La página de entrada de Data Model Hub: métricas del workspace de un vistazo, las solicitudes de cambio asignadas a ti, el estado de las versiones en solo lectura y la navegación superior global.",
      "bulletsEn": [
        "Read workspace metrics: Tables, Views, Relationships, Subject Areas and Projects",
        "Filter those metrics by one or more projects using the project chips",
        "See the change requests assigned to you for review and open them in Review",
        "Browse every version in read-only with its status (Production, In review, Draft, Rejected, Historical)",
        "Jump to Model to choose or create a working version",
        "Move between Home, Reporting, Model, Data Standards and Admin, search, and manage your session from the top bar"
      ],
      "bulletsEs": [
        "Leer las métricas del workspace: Tablas, Vistas, Relaciones, Áreas temáticas y Proyectos",
        "Filtrar esas métricas por uno o varios proyectos con los chips de proyecto",
        "Ver las solicitudes de cambio asignadas a ti para revisar y abrirlas en Revisión",
        "Recorrer todas las versiones en solo lectura con su estado (Producción, En revisión, Borrador, Rechazada, Histórica)",
        "Ir a Model para elegir o crear una versión de trabajo",
        "Moverte entre Inicio, Reporting, Model, Data Standards y Admin, buscar y gestionar tu sesión desde la barra superior"
      ]
    },
    "deep": {
      "headingEn": "Home / Hub — the workspace landing",
      "headingEs": "Inicio / Hub — la página de entrada del workspace",
      "sections": [
        {
          "subEn": "Global top navigation bar",
          "subEs": "Barra de navegación superior global",
          "bodyEn": "A persistent bar sits above every screen. On the left, a navy logo square with a database glyph and the wordmark \"Data Model Hub\"; clicking it returns you to Home. In the center are the main sections, with the active one highlighted in blue. On the right, a search field and your user avatar. Which sections you see depends on your role: Data Standards appears if you can view the model, and Admin only if you have admin permissions.",
          "bodyEs": "Una barra fija se muestra encima de cada pantalla. A la izquierda, un cuadro de logo azul marino con un ícono de base de datos y el nombre \"Data Model Hub\"; al hacer clic vuelves a Inicio. En el centro están las secciones principales, con la activa resaltada en azul. A la derecha, un campo de búsqueda y el avatar de tu usuario. Las secciones que ves dependen de tu rol: Data Standards aparece si puedes ver el modelo, y Admin solo si tienes permisos de administración.",
          "itemsEn": [
            "Home — this landing / hub page",
            "Reporting — reporting and query designer",
            "Model — the canvas/modeler where you open or create versions",
            "Data Standards — glossary, domains and standards (needs model-view permission)",
            "Admin — users, roles and permissions (needs admin permission)",
            "Search field (placeholder \"Search…\") on the right",
            "User avatar menu: shows your name, email and role, with \"Cerrar sesión\" (log out)"
          ],
          "itemsEs": [
            "Home — esta página de inicio / hub",
            "Reporting — reportes y diseñador de consultas",
            "Model — el lienzo/modelador donde abres o creas versiones",
            "Data Standards — glosario, dominios y estándares (requiere permiso de ver el modelo)",
            "Admin — usuarios, roles y permisos (requiere permiso de administración)",
            "Campo de búsqueda (texto guía \"Search…\") a la derecha",
            "Menú del avatar de usuario: muestra tu nombre, correo y rol, con \"Cerrar sesión\""
          ]
        },
        {
          "subEn": "Unsaved-changes guard",
          "subEs": "Aviso de cambios sin guardar",
          "bodyEn": "If you try to leave the Model canvas while you are editing a version and have unsaved changes, a confirmation dialog titled \"Cambios sin guardar\" appears before navigation continues. It warns that leaving without saving will lose your work and offers three choices: Cancelar (stay), Salir sin guardar (leave and discard), or Guardar y salir (save first, then leave). This guard only triggers when navigating out of Model with pending edits.",
          "bodyEs": "Si intentas salir del lienzo de Model mientras editas una versión y tienes cambios sin guardar, aparece un cuadro de confirmación titulado \"Cambios sin guardar\" antes de continuar la navegación. Advierte que salir sin guardar perderá tu trabajo y ofrece tres opciones: Cancelar (quedarte), Salir sin guardar (salir y descartar) o Guardar y salir (guardar primero y luego salir). Este aviso solo se activa al salir de Model con ediciones pendientes."
        },
        {
          "subEn": "Welcome header and access to Model",
          "subEs": "Encabezado de bienvenida y acceso a Model",
          "bodyEn": "At the top of Home you see a \"Workspace overview\" eyebrow and a personalized greeting, \"Welcome back, {your first name}\". To the right, a short note reminds you that version creation lives in the canvas: \"Open Model (canvas) to choose or create a version\", where \"Model (canvas)\" is a link that takes you straight to the modeler. The Home page itself is informational and read-only — you don't create or edit versions here.",
          "bodyEs": "En la parte superior de Inicio ves un rótulo \"Workspace overview\" y un saludo personalizado, \"Welcome back, {tu nombre}\". A la derecha, una nota breve te recuerda que la creación de versiones vive en el lienzo: \"Open Model (canvas) to choose or create a version\", donde \"Model (canvas)\" es un enlace que te lleva directo al modelador. La página de Inicio es informativa y de solo lectura: aquí no creas ni editas versiones."
        },
        {
          "subEn": "Project filter strip",
          "subEs": "Franja de filtro por proyectos",
          "bodyEn": "Below the header is a \"Projects\" strip with one chip per project (each with a database icon). Clicking a chip selects it; you can select several at once. The selection re-scopes the five metric cards below to the union of the chosen projects — with no chips selected, the cards show global totals. By default only the first six projects are shown; a \"+N more\" button reveals the rest and turns into \"Show less\" to collapse again. When at least one project is selected, a \"Clear\" button appears to reset the filter to global totals.",
          "bodyEs": "Debajo del encabezado hay una franja \"Projects\" con un chip por proyecto (cada uno con un ícono de base de datos). Al hacer clic en un chip lo seleccionas; puedes seleccionar varios a la vez. La selección reajusta las cinco tarjetas de métricas de abajo a la unión de los proyectos elegidos; sin chips seleccionados, las tarjetas muestran los totales globales. Por defecto solo se muestran los primeros seis proyectos; un botón \"+N more\" revela el resto y cambia a \"Show less\" para volver a contraer. Cuando hay al menos un proyecto seleccionado, aparece un botón \"Clear\" para volver a los totales globales.",
          "itemsEn": [
            "Project chips — click to toggle; multi-select supported",
            "\"+N more\" — expand to show all projects beyond the first six",
            "\"Show less\" — collapse back to the first six",
            "\"Clear\" — remove all filters and return to global totals"
          ],
          "itemsEs": [
            "Chips de proyecto — clic para activar/desactivar; admite selección múltiple",
            "\"+N more\" — expandir para ver todos los proyectos más allá de los primeros seis",
            "\"Show less\" — contraer de nuevo a los primeros seis",
            "\"Clear\" — quitar todos los filtros y volver a los totales globales"
          ]
        },
        {
          "subEn": "Workspace metric cards",
          "subEs": "Tarjetas de métricas del workspace",
          "bodyEn": "A row of five cards shows the key counts for your workspace, each a single large number that reflects the current project filter (or global totals when no project is selected). While loading, each card shows a placeholder. The five metrics are Tables, Views, Relationships, Subject Areas and Projects. When you filter by project, the counts reflect only what that project's canvases reference: Tables counts the distinct tables its canvases use, Views the views tied to those tables, Relationships the relationships whose two ends are both inside the project, Subject Areas the project's canvases, and Projects the number of selected projects.",
          "bodyEs": "Una fila de cinco tarjetas muestra los conteos clave de tu workspace, cada una con un número grande que refleja el filtro de proyecto actual (o los totales globales si no hay proyecto seleccionado). Mientras carga, cada tarjeta muestra un marcador de posición. Las cinco métricas son Tablas, Vistas, Relaciones, Áreas temáticas y Proyectos. Al filtrar por proyecto, los conteos reflejan solo lo que referencian los canvases de ese proyecto: Tablas cuenta las tablas distintas que usan sus canvases, Vistas las vistas atadas a esas tablas, Relaciones las relaciones cuyos dos extremos están dentro del proyecto, Áreas temáticas los canvases del proyecto, y Proyectos la cantidad de proyectos seleccionados.",
          "itemsEn": [
            "Tables — number of tables (project scope = distinct tables referenced by its canvases)",
            "Views — number of views (project scope = views bound to those tables)",
            "Relationships — number of relationships (project scope = both ends inside the project)",
            "Subject Areas — number of canvases",
            "Projects — number of projects in scope"
          ],
          "itemsEs": [
            "Tables — número de tablas (alcance por proyecto = tablas distintas que referencian sus canvases)",
            "Views — número de vistas (alcance por proyecto = vistas atadas a esas tablas)",
            "Relationships — número de relaciones (alcance por proyecto = ambos extremos dentro del proyecto)",
            "Subject Areas — número de canvases (áreas temáticas)",
            "Projects — número de proyectos en el alcance"
          ]
        },
        {
          "subEn": "Change requests assigned to you",
          "subEs": "Solicitudes de cambio asignadas a ti",
          "bodyEn": "The left column is the \"Requests\" panel: \"Change requests across projects waiting for review\". It lists the publish requests where you are the assigned reviewer. A header badge shows \"{N} pending\" when there are any, and a \"Review requests\" button opens the Review screen. Each request row shows the requester's avatar and name, the request title (or its version label, or \"Untitled request\"), the project it belongs to, whether it is a snapshot of a given version, and a relative timestamp (e.g. \"2h ago\"). Clicking a row — or the \"Review\" action on it — opens that specific request in Review. If nothing is assigned, it reads \"No requests waiting for your review.\"",
          "bodyEs": "La columna izquierda es el panel \"Requests\": \"Solicitudes de cambio entre proyectos esperando revisión\". Lista las solicitudes de publicación donde tú eres el revisor asignado. Una insignia en el encabezado muestra \"{N} pending\" cuando las hay, y un botón \"Review requests\" abre la pantalla de Revisión. Cada fila de solicitud muestra el avatar y nombre de quien la solicita, el título de la solicitud (o su etiqueta de versión, o \"Untitled request\"), el proyecto al que pertenece, si es un snapshot de una versión dada y una marca de tiempo relativa (por ejemplo \"2h ago\"). Al hacer clic en una fila —o en la acción \"Review\" de esa fila— se abre esa solicitud específica en Revisión. Si no tienes nada asignado, dice \"No requests waiting for your review.\"",
          "itemsEn": [
            "\"{N} pending\" badge — count of requests awaiting your review",
            "\"Review requests\" button — opens the Review screen",
            "Request row — opens that request directly in Review",
            "Empty state — \"No requests waiting for your review.\""
          ],
          "itemsEs": [
            "Insignia \"{N} pending\" — cantidad de solicitudes esperando tu revisión",
            "Botón \"Review requests\" — abre la pantalla de Revisión",
            "Fila de solicitud — abre esa solicitud directamente en Revisión",
            "Estado vacío — \"No requests waiting for your review.\""
          ]
        },
        {
          "subEn": "Versions (read-only)",
          "subEs": "Versiones (solo lectura)",
          "bodyEn": "The right column lists every version across all projects, read-only. The header shows \"{N} total · all projects\". The published/production version is pinned first (highlighted), followed by the rest ordered by most recent activity. Each row shows the version label (color-coded), a meta line with the project and owner, and a status pill. A footer note clarifies the intent: \"Read-only · manage versions inside Model\" — to actually open, create or work on a version you go to the Model canvas. If there are none, it reads \"No versions yet.\"",
          "bodyEs": "La columna derecha lista todas las versiones de todos los proyectos, en solo lectura. El encabezado muestra \"{N} total · all projects\". La versión publicada/de producción se fija primero (resaltada), seguida por el resto ordenado por actividad más reciente. Cada fila muestra la etiqueta de la versión (con color), una línea con el proyecto y el propietario, y una etiqueta de estado. Una nota al pie aclara la intención: \"Read-only · manage versions inside Model\" — para abrir, crear o trabajar realmente una versión vas al lienzo de Model. Si no hay ninguna, dice \"No versions yet.\"",
          "itemsEn": [
            "Production — the live published version (green, pinned first)",
            "In review — a version submitted for approval (blue)",
            "Editing (draft) — a working copy still being edited",
            "Rejected — a version whose review was rejected",
            "Historical — a previously approved version (hollow marker)"
          ],
          "itemsEs": [
            "Production — la versión publicada en vivo (verde, fijada primero)",
            "In review — una versión enviada a aprobación (azul)",
            "Editing (draft) — una copia de trabajo aún en edición",
            "Rejected — una versión cuya revisión fue rechazada",
            "Historical — una versión aprobada anteriormente (marcador hueco)"
          ]
        }
      ]
    }
  },
  {
    "id": "canvas",
    "card": {
      "titleEn": "Model (Canvas)",
      "titleEs": "Modelo (Canvas)",
      "blurbEn": "Visual ER modeler where you open a model version and design tables, columns and relationships on a canvas.",
      "blurbEs": "Modelador ER visual donde abres una versión del modelo y diseñas tablas, columnas y relaciones sobre un lienzo.",
      "bulletsEn": [
        "Open a model as read-only production, snapshot a new version, or resume one of your drafts",
        "Create tables and columns (PK/FK, parent domain, data type, nullable, partition) and edit them in the properties panel",
        "Draw identifying (solid) and non-identifying (dashed) relationships with crow's-foot cardinalities, composite key pairs and Erwin-style role names",
        "Organize the canvas: move/zoom tables, auto-arrange, search a table, add shapes and text notes",
        "Attach SQL views, User Defined Properties and functional definitions to tables and columns",
        "Save your working copy and publish it for reviewer approval, or export Databricks DDL / a PNG image"
      ],
      "bulletsEs": [
        "Abrir un modelo como producción de solo lectura, sacar una nueva versión (snapshot) o retomar uno de tus borradores",
        "Crear tablas y columnas (PK/FK, dominio padre, tipo de dato, nullable, partición) y editarlas en el panel de propiedades",
        "Dibujar relaciones identifying (sólidas) y non-identifying (punteadas) con cardinalidades pata de gallo, pares de llave compuesta y role names estilo Erwin",
        "Organizar el lienzo: mover/hacer zoom en tablas, auto-organizar, buscar una tabla, agregar formas y notas de texto",
        "Adjuntar vistas SQL, User Defined Properties y definiciones funcionales a tablas y columnas",
        "Guardar tu copia de trabajo y publicarla para aprobación de revisores, o exportar DDL de Databricks / una imagen PNG"
      ]
    },
    "deep": {
      "headingEn": "Model (Canvas) — Functional detail",
      "headingEs": "Modelo (Canvas) — Detalle funcional",
      "sections": [
        {
          "subEn": "Opening a model — version and mode",
          "subEs": "Abrir un modelo — versión y modo",
          "bodyEn": "You cannot interact with the canvas until you choose a version. Entering the Model module with no version selected forces the \"Open model\" chooser, and the toolbar's \"Open model\" button reopens it any time to switch. The dialog offers three radio-card modes, and a Continue button that only activates when the chosen mode has a valid target. Cancel or Esc closes it; dismissing without choosing sends you back Home.",
          "bodyEs": "No puedes interactuar con el lienzo hasta elegir una versión. Entrar al módulo Modelo sin versión seleccionada fuerza el selector \"Open model\", y el botón \"Open model\" de la barra lo vuelve a abrir en cualquier momento para cambiar. El diálogo ofrece tres modos en tarjetas de radio y un botón Continue que solo se activa cuando el modo elegido tiene un destino válido. Cancel o Esc lo cierra; si lo cierras sin elegir, te devuelve al Home.",
          "itemsEn": [
            "View production (read-only): explore the current published version; several people can view it at once without locking it. Shows the version label with a \"current\" tag.",
            "Create new version from production: takes a snapshot of production into your own editable working copy (on publish, production is overwritten — last to publish wins).",
            "Continue a working version: pick one of your own drafts (working copies) from a list showing its version label, title and owner, and resume where you left off."
          ],
          "itemsEs": [
            "View production (solo lectura): explora la versión publicada actual; varias personas pueden verla a la vez sin bloquearla. Muestra la etiqueta de versión con la marca \"current\".",
            "Create new version from production: toma un snapshot de producción hacia tu propia copia de trabajo editable (al publicar, producción se sobrescribe — gana el último en publicar).",
            "Continue a working version: elige uno de tus borradores (copias de trabajo) de una lista que muestra su etiqueta de versión, título y dueño, y retoma donde lo dejaste."
          ]
        },
        {
          "subEn": "Session modes — Editing vs Viewer",
          "subEs": "Modos de sesión — Editing vs Viewer",
          "bodyEn": "The right side of the toolbar shows a status pill: \"Editing · <version>\" (blue) or \"Viewer · <version>\" (read-only). In Editing mode you have a valid draft working copy and every action is enabled. In Viewer/read-only mode you can still open and inspect everything — click a table to open its properties panel as a reader — but you cannot move tables, draw or edit relationships, create shapes, or use the explorer's context menus; disabled controls show a \"Read-only — published version\" tooltip. The app defends this automatically: if your draft is submitted, decided or owned by someone else mid-session, the canvas quietly drops to read-only with a toast explaining why. Leaving the tab with unsaved changes triggers a native browser warning.",
          "bodyEs": "La derecha de la barra muestra una píldora de estado: \"Editing · <versión>\" (azul) o \"Viewer · <versión>\" (solo lectura). En modo Editing tienes una copia de trabajo (draft) válida y todas las acciones están habilitadas. En modo Viewer/solo lectura igual puedes abrir e inspeccionar todo — al hacer clic en una tabla se abre su panel de propiedades como lector — pero no puedes mover tablas, dibujar o editar relaciones, crear formas ni usar los menús contextuales del explorer; los controles deshabilitados muestran el tooltip \"Solo lectura — versión publicada\". La app se protege sola: si tu draft es enviado, decidido o pasa a ser de otra persona a mitad de sesión, el lienzo baja a solo lectura con un aviso explicando por qué. Salir de la pestaña con cambios sin guardar dispara un aviso nativo del navegador."
        },
        {
          "subEn": "Model Explorer — Projects, Folders, Canvases",
          "subEs": "Model Explorer — Proyectos, Carpetas, Canvases",
          "bodyEn": "The left panel is a hierarchical tree: Projects → nested Folders → Canvases (each canvas is one Subject Area / ER diagram). Expanding a project or folder is navigation only — you can have several projects open at once and it never changes the canvas you're working on. The canvas only switches when you click a different canvas (a spinner shows while its diagram loads). Hovering a node reveals a three-dots button that opens a context menu; creating and renaming use an inline input, and deleting uses a confirmation dialog.",
          "bodyEs": "El panel izquierdo es un árbol jerárquico: Proyectos → Carpetas anidadas → Canvases (cada canvas es una Subject Area / diagrama ER). Expandir un proyecto o carpeta es solo navegación — puedes tener varios proyectos abiertos a la vez y nunca cambia el canvas en el que trabajas. El canvas solo cambia cuando haces clic en otro canvas (aparece un spinner mientras carga su diagrama). Al pasar el mouse sobre un nodo aparece un botón de tres puntos que abre un menú contextual; crear y renombrar usan un input en línea, y eliminar usa un diálogo de confirmación.",
          "itemsEn": [
            "New project: the \"+\" button in the \"Model Explorer\" header.",
            "Project menu: New folder · New canvas · Rename · Delete (deleting removes all its folders and canvases).",
            "Folder menu: New folder · New canvas · Rename · Delete (deleting a folder moves its canvases to the project root).",
            "Canvas menu: Rename · Delete.",
            "Deleting shows a red confirmation dialog stating exactly what will be removed; the dialog stays busy with a spinner until it finishes."
          ],
          "itemsEs": [
            "Nuevo proyecto: el botón \"+\" en el encabezado \"Model Explorer\".",
            "Menú de proyecto: New folder · New canvas · Rename · Delete (eliminar borra todas sus carpetas y canvases).",
            "Menú de carpeta: New folder · New canvas · Rename · Delete (eliminar una carpeta mueve sus canvases a la raíz del proyecto).",
            "Menú de canvas: Rename · Delete.",
            "Eliminar muestra un diálogo rojo de confirmación que indica exactamente qué se borrará; el diálogo queda ocupado con spinner hasta terminar."
          ]
        },
        {
          "subEn": "The canvas surface — move, zoom, navigate",
          "subEs": "El lienzo — mover, zoom, navegar",
          "bodyEn": "The canvas is a dotted-grid surface where tables and shapes live. You pan by dragging empty space and zoom with the mouse/controls (zoom range is very wide so even huge auto-arranged models fit on screen). A bottom-left Controls widget (zoom in/out, fit view, lock) and a pannable, zoomable MiniMap help you navigate large diagrams. Tables are draggable in Editing mode; each drop persists that table's position. Table nodes auto-size to their content (they grow with longer names and more columns, within a min/max width), so there is no manual width handle. Clicking a table selects it and opens its properties panel; clicking a relationship selects it and highlights it; double-clicking a relationship opens its edit popup; clicking empty space clears the selection. Hovering a table or wire highlights the connected relationships and dims the rest.",
          "bodyEs": "El lienzo es una superficie con grilla de puntos donde viven las tablas y formas. Te desplazas (pan) arrastrando el espacio vacío y haces zoom con el mouse/controles (el rango de zoom es muy amplio para que hasta modelos enormes auto-organizados entren en pantalla). Un widget de Controls abajo a la izquierda (zoom, ajustar vista, bloquear) y un MiniMapa navegable y con zoom ayudan a moverte por diagramas grandes. Las tablas se arrastran en modo Editing; cada soltada guarda la posición de esa tabla. Los nodos de tabla se autoajustan a su contenido (crecen con nombres más largos y más columnas, dentro de un ancho mínimo/máximo), por eso no hay un manejador de ancho manual. Hacer clic en una tabla la selecciona y abre su panel de propiedades; hacer clic en una relación la selecciona y la resalta; doble clic en una relación abre su popup de edición; hacer clic en el vacío limpia la selección. Al pasar el mouse por una tabla o wire se resaltan las relaciones conectadas y se atenúa el resto."
        },
        {
          "subEn": "Logical / Physical view",
          "subEs": "Vista Lógica / Física",
          "bodyEn": "A segmented toggle in the bottom status bar switches every table and column between showing its Logical name or its Physical name (default is Physical). In each table node the chosen name is the main title and the opposite name appears as a subtitle, so you always see both. The toggle is disabled until a model is open.",
          "bodyEs": "Un interruptor segmentado en la barra de estado inferior alterna cada tabla y columna entre mostrar su nombre Lógico o su nombre Físico (por defecto Físico). En cada nodo de tabla el nombre elegido es el título principal y el opuesto aparece como subtítulo, así siempre ves ambos. El interruptor está deshabilitado hasta que hay un modelo abierto."
        },
        {
          "subEn": "Toolbar — Structure group",
          "subEs": "Barra de herramientas — grupo Structure",
          "bodyEn": "The Structure group holds two creation actions, both disabled in read-only. \"New table\" opens the New table dialog (see below). \"CTAS\" opens the Create-Table-As-Select dialog to build a table from columns of existing tables. Both write into your active working copy as unpublished changes.",
          "bodyEs": "El grupo Structure tiene dos acciones de creación, ambas deshabilitadas en solo lectura. \"New table\" abre el diálogo Nueva tabla (ver abajo). \"CTAS\" abre el diálogo Create-Table-As-Select para armar una tabla a partir de columnas de tablas existentes. Ambas escriben en tu copia de trabajo activa como cambios sin publicar."
        },
        {
          "subEn": "New table dialog — Blank / Import existing",
          "subEs": "Diálogo Nueva tabla — Blank / Import existing",
          "bodyEn": "The New table dialog has two tabs. \"Blank table\" creates a brand-new entity: Logical Name, Physical Name (auto-derived from the logical name via naming rules, editable as an override) and Schema (free text). \"Create table\" adds it to the current canvas. \"Import existing\" brings a table already in the universal catalog into the canvas: a server-side search box (works even against very large catalogs) plus a schema filter, and each result row shows the physical name, logical name and how many modules already use it, with an \"Add\" button (turns to \"Added\"). Imported tables are universal — editing their structure propagates to every module that references them.",
          "bodyEs": "El diálogo Nueva tabla tiene dos pestañas. \"Blank table\" crea una entidad nueva: Logical Name, Physical Name (auto-derivado del nombre lógico por reglas de naming, editable como override) y Schema (texto libre). \"Create table\" la agrega al canvas actual. \"Import existing\" trae al canvas una tabla que ya existe en el catálogo universal: un buscador server-side (funciona incluso con catálogos enormes) más un filtro por schema, y cada fila de resultado muestra el nombre físico, el lógico y en cuántos módulos ya se usa, con un botón \"Add\" (pasa a \"Added\"). Las tablas importadas son universales — editar su estructura se propaga a todos los módulos que las referencian."
        },
        {
          "subEn": "CTAS — Create Table As Select",
          "subEs": "CTAS — Create Table As Select",
          "bodyEn": "The CTAS dialog builds a new table from other tables in two steps. Step 1: check the source tables, then check which of their columns to inherit (candidate columns are deduplicated by physical name). Step 2: define the new table's Schema and Table Name; a live \"Generated SQL\" preview shows the CREATE TABLE … AS SELECT … FROM … it will produce, with a running count of picked columns and source tables. \"Create table\" adds it to the canvas as an unpublished change (requires a name and at least one column).",
          "bodyEs": "El diálogo CTAS arma una tabla nueva a partir de otras en dos pasos. Paso 1: marca las tablas fuente y luego marca cuáles de sus columnas heredar (las columnas candidatas se deduplican por nombre físico). Paso 2: define el Schema y el Table Name de la nueva tabla; una previsualización en vivo de \"Generated SQL\" muestra el CREATE TABLE … AS SELECT … FROM … que producirá, con un conteo de columnas elegidas y tablas fuente. \"Create table\" la agrega al canvas como cambio sin publicar (requiere nombre y al menos una columna)."
        },
        {
          "subEn": "Toolbar — Locate & center (Find a Table)",
          "subEs": "Barra de herramientas — Locate & center (Find a Table)",
          "bodyEn": "The \"Find a Table\" box filters the open canvas by logical or physical name and shows up to 8 matches in a dropdown (each showing the logical name and the physical name). Picking one centers and fits the canvas on that table with a smooth animation and, in Editing mode, opens its properties panel (in read-only it only centers). Cmd/Ctrl+K focuses the box from anywhere; Enter selects the first match; Esc clears and closes it. It's disabled until a model is open.",
          "bodyEs": "La caja \"Find a Table\" filtra el canvas abierto por nombre lógico o físico y muestra hasta 8 coincidencias en un desplegable (cada una con el nombre lógico y el físico). Elegir una centra y encuadra el canvas sobre esa tabla con una animación suave y, en modo Editing, abre su panel de propiedades (en solo lectura solo centra). Cmd/Ctrl+K enfoca la caja desde cualquier lado; Enter selecciona la primera coincidencia; Esc limpia y cierra. Está deshabilitada hasta que hay un modelo abierto."
        },
        {
          "subEn": "Toolbar — Relationships group and drawing a relationship",
          "subEs": "Barra de herramientas — grupo Relationships y dibujar una relación",
          "bodyEn": "This group lets you pre-set the cardinality of each end before drawing. There are two rows, Parent (the PK side) and Child (the FK side), each with four crow's-foot buttons: Exactly one, Zero or one, One or more, and Zero or many. On the right there are TWO drawing tools, like Erwin's toolbox: \"Identifying\" (solid-line icon — the migrated FK becomes part of the child's primary key) and \"Non-identifying\" (dashed-line icon — plain FK). Arming one disarms the other; while armed, a hint banner appears at the bottom and table columns expose connection handles. You then drag FROM the parent column TO the child column: the parent column is automatically promoted to primary key (the relationship is born from the parent's PK), and the child column is marked as a foreign key (plus primary key if the relationship is identifying). A semi-transparent \"ghost\" wire appears on drop and is replaced by the real one once it persists. Everything here is disabled in read-only.",
          "bodyEs": "Este grupo te permite preconfigurar la cardinalidad de cada extremo antes de dibujar. Hay dos filas, Parent (lado PK) y Child (lado FK), cada una con cuatro botones pata de gallo: Exactly one, Zero or one, One or more y Zero or many. A la derecha hay DOS herramientas de dibujo, como la toolbox de Erwin: \"Identifying\" (ícono de línea sólida — la FK migrada pasa a formar parte de la primary key del hijo) y \"Non-identifying\" (ícono de línea punteada — FK simple). Armar una desarma la otra; mientras está armada aparece un banner de ayuda abajo y las columnas de las tablas muestran conectores. Luego arrastras DESDE la columna del padre HACIA la columna del hijo: la columna padre se promueve automáticamente a primary key (la relación nace de la PK del padre) y la columna hija se marca como foreign key (y como primary key si la relación es identifying). Al soltar aparece un wire \"fantasma\" semitransparente que se reemplaza por el real cuando se persiste. Todo esto está deshabilitado en solo lectura."
        },
        {
          "subEn": "Editing and deleting a relationship",
          "subEs": "Editar y eliminar una relación",
          "bodyEn": "Relationships render with standard crow's-foot notation on each end (a bar for one, a circle for zero, a fork opening toward the table for many). Identifying relationships draw as a SOLID line; non-identifying as a DASHED line — Erwin convention. Double-clicking a wire opens the Relationship popup: a Parent → Child header, the type as radio buttons (switching to Identifying promotes the child columns of every pair into the PK; switching back demotes them unless another identifying relationship still needs them), Parent/Child cardinality dropdowns (6 options each), and the \"Migrated columns\" grid — one row per column pair. There you can add extra pairs for COMPOSITE keys (the parent side is restricted to its PK columns; the child side can be an existing column or \"create new column\", which migrates the parent column into the child), remove pairs, and assign an Erwin-style ROLE NAME per pair: applying it renames the child FK column (logical + derived physical name), or — if that column is shared with another relationship (\"unified\") — creates a NEW column with the role name and re-points only this pair (the classic split, e.g. one currency code migrated three times as soles/dollars/euros). The properties panel's Links tab lists every relationship of the selected table with all its pairs. Deleting a relationship (or removing a pair) cleans up the foreign-key flag on columns that no longer participate in any relationship.",
          "bodyEs": "Las relaciones se dibujan con notación pata de gallo estándar en cada extremo (una barra para uno, un círculo para cero, una horqueta que ABRE hacia la tabla para muchos). Las identifying van con línea SÓLIDA; las non-identifying, PUNTEADA — convención Erwin. Doble clic en un wire abre el popup Relationship: encabezado Parent → Child, el tipo como radios (pasar a Identifying promueve a PK las columnas hijas de todos los pares; volver a Non-identifying las demueve salvo que otra relación identifying las necesite), desplegables de cardinalidad Parent/Child (6 opciones cada uno) y la grilla \"Migrated columns\" — una fila por par de columnas. Ahí puedes agregar pares extra para llaves COMPUESTAS (el lado padre se restringe a sus columnas PK; el hijo puede ser una columna existente o \"crear columna nueva\", que migra la columna del padre al hijo), quitar pares y asignar un ROLE NAME estilo Erwin por par: aplicarlo renombra la columna FK del hijo (lógico + físico derivado por naming), o — si esa columna está compartida con otra relación (\"unificada\") — crea una columna NUEVA con el role name y repunta solo este par (el split clásico: un código de moneda migrado tres veces como soles/dólares/euros). La pestaña Links del panel de propiedades lista todas las relaciones de la tabla seleccionada con todos sus pares. Eliminar una relación (o quitar un par) limpia el flag de foreign key de las columnas que ya no participan en ninguna relación."
        },
        {
          "subEn": "Toolbar — Drawing group (shapes and notes)",
          "subEs": "Barra de herramientas — grupo Drawing (formas y notas)",
          "bodyEn": "The Drawing group has eight shape buttons that each drop a shape at the center of the current view, behind the tables: Rectangle, Square, Circle, Ellipse, Line, Star, Diamond and Text. Shapes are draggable and their position/size persist. Selecting a shape shows a mini-toolbar with six color swatches and a delete (×) button. A Text shape is edited by double-clicking it to type (Esc cancels, Cmd/Ctrl+Enter commits). All shape actions are hidden/disabled in read-only.",
          "bodyEs": "El grupo Drawing tiene ocho botones de forma que colocan una forma en el centro de la vista actual, detrás de las tablas: Rectángulo, Cuadrado, Círculo, Elipse, Línea, Estrella, Rombo y Texto. Las formas se arrastran y su posición/tamaño se guardan. Al seleccionar una forma aparece una mini-barra con seis muestras de color y un botón de eliminar (×). Una forma de Texto se edita con doble clic para escribir (Esc cancela, Cmd/Ctrl+Enter confirma). Todas las acciones de forma están ocultas/deshabilitadas en solo lectura."
        },
        {
          "subEn": "Toolbar — Actions group",
          "subEs": "Barra de herramientas — grupo Actions",
          "bodyEn": "The Actions group has three buttons. \"Autoarrange\" runs an automatic layered layout (Sugiyama/ELK) that repositions every table to minimize crossings using each table's real measured size, then reloads the canvas (shows a spinner while it runs; disabled in read-only). \"Export DDL\" opens the DDL export dialog (available whenever a model is open, even read-only). \"Export image\" fits the whole model into view and downloads a high-resolution PNG named after the canvas.",
          "bodyEs": "El grupo Actions tiene tres botones. \"Autoarrange\" ejecuta un layout automático por capas (Sugiyama/ELK) que reposiciona todas las tablas para minimizar cruces usando el tamaño real medido de cada una y luego recarga el canvas (muestra un spinner mientras corre; deshabilitado en solo lectura). \"Export DDL\" abre el diálogo de exportación de DDL (disponible siempre que haya un modelo abierto, incluso en solo lectura). \"Export image\" encuadra todo el modelo y descarga un PNG en alta resolución con el nombre del canvas."
        },
        {
          "subEn": "Table node — reading and quick actions",
          "subEs": "Nodo de tabla — lectura y acciones rápidas",
          "bodyEn": "Each table node shows a header (table glyph, optional schema prefix, the table name, and the opposite-naming subtitle) and its columns. Primary-key columns are grouped at the top with a key icon, separated by a divider from the rest; foreign-key columns show a link icon and their name is styled distinctly. Each column row shows the name and its data type. In Editing mode the header has a \"+\" button to add a column directly. Tables with no columns show an empty state.",
          "bodyEs": "Cada nodo de tabla muestra un encabezado (glifo de tabla, prefijo de schema opcional, el nombre de la tabla y el subtítulo con el naming opuesto) y sus columnas. Las columnas primary key se agrupan arriba con un ícono de llave, separadas por un divisor del resto; las columnas foreign key muestran un ícono de eslabón y su nombre se estiliza distinto. Cada fila de columna muestra el nombre y su tipo de dato. En modo Editing el encabezado tiene un botón \"+\" para agregar una columna directamente. Las tablas sin columnas muestran un estado vacío."
        },
        {
          "subEn": "Adding a column",
          "subEs": "Agregar una columna",
          "bodyEn": "Adding a column (from the table's \"+\", or the panel's \"Add column\") opens the New column dialog. A Logical/Physical segmented toggle picks how you name it: in Logical mode you type words and see a live physicalized preview; in Physical mode you type the physical name directly. You can also assign a Parent Domain (a typed classification that carries a default data type, shown as \"name (type)\") and an optional Type override. \"Add\" creates the column in the current working copy.",
          "bodyEs": "Agregar una columna (desde el \"+\" de la tabla o desde \"Add column\" del panel) abre el diálogo Nueva columna. Un interruptor segmentado Logical/Physical elige cómo la nombras: en modo Logical escribes palabras y ves una previsualización físicalizada en vivo; en modo Physical escribes el nombre físico directo. También puedes asignar un Parent Domain (una clasificación tipada que trae un tipo de dato por defecto, mostrada como \"nombre (tipo)\") y un Type override opcional. \"Add\" crea la columna en la copia de trabajo actual."
        },
        {
          "subEn": "Properties panel — Definition tab",
          "subEs": "Panel de propiedades — pestaña Definition",
          "bodyEn": "Selecting a table opens the right-side properties panel: a header with the physical name and a \"schema X · table\" subtitle (plus a \"Read-only\" badge when you can't edit), a close button, and five underlined tabs (Columns and Views show a count). The Definition tab edits the table's Logical name, Physical name (with a lightning button to derive it from the logical name via the glossary), Schema, and a Functional definition text area, saved with the \"Save\" button. In read-only every field is shown but disabled.",
          "bodyEs": "Seleccionar una tabla abre el panel de propiedades a la derecha: un encabezado con el nombre físico y un subtítulo \"schema X · table\" (más una insignia \"Read-only\" cuando no puedes editar), un botón de cerrar, y cinco pestañas subrayadas (Columns y Views muestran un contador). La pestaña Definition edita el Logical name, Physical name (con un botón de rayo para derivarlo del nombre lógico vía glosario), Schema y un área de texto de Functional definition, que se guarda con el botón \"Save\". En solo lectura todos los campos se muestran pero deshabilitados."
        },
        {
          "subEn": "Properties panel — Columns tab",
          "subEs": "Panel de propiedades — pestaña Columns",
          "bodyEn": "The Columns tab lists every column of the table as compact rows (drag handle, PK/FK/Partition icon, logical name, physical name, data type, and PK/FK/PART badges). Clicking a row expands an \"Editing column\" card; dragging a row's handle reorders columns (persisted). The expanded editor edits Logical name and Physical name, a Parent Domain selector plus its data type (choosing a domain inherits its default type unless you've overridden it), a Functional definition, and four flag checkboxes — PK, FK, Nullable and Partition — plus a delete button. Edits autosave (debounced) into the working copy. \"Add column\" at the top opens the New column dialog.",
          "bodyEs": "La pestaña Columns lista todas las columnas de la tabla como filas compactas (manija de arrastre, ícono PK/FK/Partition, nombre lógico, nombre físico, tipo de dato y badges PK/FK/PART). Hacer clic en una fila expande una tarjeta \"Editing column\"; arrastrar la manija de una fila reordena las columnas (se persiste). El editor expandido edita Logical name y Physical name, un selector de Parent Domain más su tipo de dato (elegir un dominio hereda su tipo por defecto salvo que lo hayas sobrescrito), una Functional definition, y cuatro checkboxes de flags — PK, FK, Nullable y Partition — más un botón de eliminar. Los cambios se autoguardan (con debounce) en la copia de trabajo. \"Add column\" arriba abre el diálogo Nueva columna."
        },
        {
          "subEn": "Properties panel — Views tab",
          "subEs": "Panel de propiedades — pestaña Views",
          "bodyEn": "The Views tab lists the SQL views associated with the table (each with its qualified name and tag count) and, in Editing mode, lets you create, edit and delete them. The view editor (New view / Edit view) pre-fills a View name (the table name plus \"_v\") and Schema, and provides Tags (key/value), a free-text Filter (WHERE), and a repeatable Sources list where each row has a source table, an output alias and an expression (add/remove rows). A live Preview composes the CREATE VIEW … AS SELECT … FROM … WHERE … so you can see the shape of the view before saving.",
          "bodyEs": "La pestaña Views lista las vistas SQL asociadas a la tabla (cada una con su nombre calificado y cantidad de tags) y, en modo Editing, te permite crear, editar y eliminarlas. El editor de vistas (New view / Edit view) precarga un View name (el nombre de la tabla más \"_v\") y Schema, y ofrece Tags (clave/valor), un Filter de texto libre (WHERE), y una lista repetible de Sources donde cada fila tiene una tabla fuente, un alias de salida y una expresión (agregar/quitar filas). Un Preview en vivo compone el CREATE VIEW … AS SELECT … FROM … WHERE … para que veas la forma de la vista antes de guardar."
        },
        {
          "subEn": "Properties panel — Links and Metadata tabs",
          "subEs": "Panel de propiedades — pestañas Links y Metadata",
          "bodyEn": "The Links tab shows all relationships touching the table as cards, each labeled PARENT or CHILD (the role of the other table relative to this one), with parent→child names, ALL the joining column pairs (composite keys show every pair plus an \"N pares\" note), the cardinality (e.g. \"1 : 0..N\") and an \"identifying\" note, plus a delete button in Editing mode. The Metadata tab is read-only reference data — physical name, logical name, schema, column count, a relationship summary (links / parents / children), the functional definition and the table ID — followed by a \"User Defined Properties\" section to assign values to table-level UDP tags.",
          "bodyEs": "La pestaña Links muestra todas las relaciones que tocan la tabla como tarjetas, cada una etiquetada PARENT o CHILD (el rol de la otra tabla respecto de esta), con nombres padre→hijo, TODOS los pares de columnas de la unión (una llave compuesta muestra cada par más la nota \"N pares\"), la cardinalidad (ej. \"1 : 0..N\") y una nota \"identifying\", más un botón de eliminar en modo Editing. La pestaña Metadata es información de referencia de solo lectura — nombre físico, nombre lógico, schema, cantidad de columnas, un resumen de relaciones (links / parents / children), la definición funcional y el ID de la tabla — seguida de una sección \"User Defined Properties\" para asignar valores a las etiquetas UDP a nivel tabla."
        },
        {
          "subEn": "User Defined Properties (UDP)",
          "subEs": "User Defined Properties (UDP)",
          "bodyEn": "UDP are key-value classification tags defined centrally in Data Standards and assigned here. Tables get their UDP in the Metadata tab; columns get theirs inside the expanded column editor. Each defined property shows its name and the right input for its type — a dropdown for list-type properties (with the allowed values and a default), or a typed text/number/date input otherwise. Only properties that apply to the current level (table or column) are shown; if none are defined, a hint points you to Data Standards → UDP.",
          "bodyEs": "Los UDP son etiquetas de clasificación clave-valor definidas de forma central en Data Standards y asignadas aquí. Las tablas reciben sus UDP en la pestaña Metadata; las columnas los reciben dentro del editor de columna expandido. Cada propiedad definida muestra su nombre y el input adecuado a su tipo — un desplegable para propiedades tipo lista (con los valores permitidos y un default), o un input tipado de texto/número/fecha si no. Solo se muestran las propiedades que aplican al nivel actual (tabla o columna); si no hay ninguna definida, un aviso te dirige a Data Standards → UDP."
        },
        {
          "subEn": "Saving your work",
          "subEs": "Guardar tu trabajo",
          "bodyEn": "The blue \"Save\" button in the toolbar's right cluster persists your working copy — it flushes the full canvas layout (all table positions) and all shapes at once and clears the \"unsaved changes\" state. Most structural edits (creating tables/columns/relationships, editing fields, reordering) already persist to the working copy as you go; Save mainly commits pending layout/drawing moves. The button shows \"Saving…\" while in flight and is disabled in read-only.",
          "bodyEs": "El botón azul \"Save\" del clúster derecho de la barra persiste tu copia de trabajo — vuelca de una vez todo el layout del canvas (todas las posiciones de tablas) y todas las formas, y limpia el estado de \"cambios sin guardar\". La mayoría de las ediciones estructurales (crear tablas/columnas/relaciones, editar campos, reordenar) ya se persisten en la copia de trabajo a medida que trabajas; Save principalmente confirma los movimientos de layout/dibujos pendientes. El botón muestra \"Saving…\" mientras corre y está deshabilitado en solo lectura."
        },
        {
          "subEn": "Publishing — request approval",
          "subEs": "Publicar — solicitar aprobación",
          "bodyEn": "The green \"Publish\" button opens the \"Publish — request approval\" dialog over the dimmed canvas. You fill a Title and Description, and pick one or more Reviewers from a list of avatar chips (at least one is required; \"Send for Approval\" stays disabled until then). Sending submits your working copy for review: it becomes read-only and the canvas transitions to viewing production, with a toast confirming the request was sent. If the dialog is opened without an editable working copy, it shows a hint and sending is disabled until you open an editable version.",
          "bodyEs": "El botón verde \"Publish\" abre el diálogo \"Publish — request approval\" sobre el lienzo atenuado. Completas un Title y una Description, y eliges uno o más Reviewers de una lista de chips con avatar (se requiere al menos uno; \"Send for Approval\" queda deshabilitado hasta entonces). Enviar somete tu copia de trabajo a revisión: pasa a solo lectura y el canvas transiciona a ver producción, con un aviso confirmando que el request se envió. Si el diálogo se abre sin una copia de trabajo editable, muestra un aviso y el envío queda deshabilitado hasta que abras una versión editable."
        },
        {
          "subEn": "Export DDL (Databricks)",
          "subEs": "Export DDL (Databricks)",
          "bodyEn": "The Export DDL dialog generates Databricks DDL live from the current canvas and shows it in a dark preview panel. You choose which tables to export from a checklist (with a filter box and All/None links, showing column counts). The target dialect is Databricks (Oracle is shown but locked). Options include: Include toggles for Views, Primary & foreign keys, Comments, Partitions and Indexes; a table format chip selector (delta, parquet, avro, orc, csv, json); Unity Catalog (with catalog and default-schema fields); External table (with a storage LOCATION); and custom TBLPROPERTIES key/value pairs. The footer downloads the result as a single .sql file (named after the table when only one is selected) or copies it to the clipboard.",
          "bodyEs": "El diálogo Export DDL genera DDL de Databricks en vivo desde el canvas actual y lo muestra en un panel de previsualización oscuro. Eliges qué tablas exportar desde una lista de verificación (con caja de filtro y enlaces All/None, mostrando conteos de columnas). El dialecto destino es Databricks (Oracle se muestra pero bloqueado). Las opciones incluyen: interruptores Include para Views, Primary & foreign keys, Comments, Partitions e Indexes; un selector de formato de tabla en chips (delta, parquet, avro, orc, csv, json); Unity Catalog (con campos de catalog y schema por defecto); External table (con un LOCATION de almacenamiento); y pares clave/valor de TBLPROPERTIES personalizados. El pie descarga el resultado como un único archivo .sql (con el nombre de la tabla cuando solo hay una seleccionada) o lo copia al portapapeles."
        }
      ]
    }
  },
  {
    "id": "standards",
    "card": {
      "titleEn": "Data Standards",
      "titleEs": "Estándares de Datos",
      "blurbEn": "The restricted governance module where you define the naming glossary, reusable data domains, and user-defined properties that automatically shape physical names and data types across every project.",
      "blurbEs": "El módulo de gobierno restringido donde defines el glosario de nombres, los dominios de datos reutilizables y las propiedades definidas por el usuario que dan forma automáticamente a los nombres físicos y tipos de dato en todos los proyectos.",
      "bulletsEn": [
        "Manage the Glossary: add, edit and delete terms with abbreviations and word types (prime/class/modifier) used to derive physical names.",
        "Set naming rules per scope (column or table): separator (underscore, none, hyphen) and case (UPPER, lower, camelCase), with a live physical-name preview.",
        "Create and edit Parent Domains (reusable data-type templates) and cascade a new default type to all columns without a manual override.",
        "Define UDP properties by level (Table or Column) with type Text/Number/Boolean/Date/List, allowed values and a default.",
        "Review every change in Version history and roll back to any prior applied version (rollback is logged as a new version).",
        "See the Overview card with counts, recent changes and who can edit; editing requires the standards.edit permission."
      ],
      "bulletsEs": [
        "Gestiona el Glossary: agrega, edita y elimina términos con abreviaturas y tipo de palabra (prime/class/modifier) que se usan para derivar los nombres físicos.",
        "Define reglas de naming por alcance (columna o tabla): separador (guion bajo, ninguno, guion) y caja (UPPER, lower, camelCase), con vista previa en vivo del nombre físico.",
        "Crea y edita Parent Domains (plantillas de tipo de dato reutilizables) y cascada un nuevo tipo por defecto a todas las columnas sin override manual.",
        "Define propiedades UDP por nivel (Tabla o Columna) con tipo Texto/Número/Booleano/Fecha/Lista, valores permitidos y un valor por defecto.",
        "Revisa cada cambio en el historial de versiones y revierte a cualquier versión aplicada anterior (el rollback se registra como una versión nueva).",
        "Consulta el card de Overview con conteos, cambios recientes y quién puede editar; editar requiere el permiso standards.edit."
      ]
    },
    "deep": {
      "headingEn": "Data Standards — functional guide",
      "headingEs": "Estándares de Datos — guía funcional",
      "sections": [
        {
          "subEn": "Module shell and access",
          "subEs": "Estructura del módulo y acceso",
          "bodyEn": "Data Standards is a self-contained, restricted governance module with a purple 'Restricted module' badge in the top bar. It is organized into four sub-tabs across the top: Overview, Glossary, Parent Domains and UDP. Because standards are global (not tied to a single model), they live in their own module separated from the canvas. A persistent footer at the bottom shows the latest applied version ('Última versión' with its label and author) and a 'Version history' button. Two access levels exist: users with the standards.edit permission can edit and apply changes; all other roles see everything in read-only mode.",
          "bodyEs": "Estándares de Datos es un módulo de gobierno autónomo y restringido, con una insignia morada de 'Restricted module' en la barra superior. Se organiza en cuatro subpestañas en la parte de arriba: Overview, Glossary, Parent Domains y UDP. Como los estándares son globales (no dependen de un solo modelo), viven en su propio módulo separado del canvas. Un pie de página fijo muestra la última versión aplicada ('Última versión' con su etiqueta y autor) y un botón de 'Version history'. Hay dos niveles de acceso: quienes tienen el permiso standards.edit pueden editar y aplicar cambios; el resto de los roles ve todo en modo solo lectura.",
          "itemsEn": [
            "Sub-tabs: Overview, Glossary, Parent Domains, UDP.",
            "'Restricted module' badge signals that editing is permission-gated.",
            "Footer always shows the latest version label + author and a Version history button.",
            "Read-only vs edit is driven by the standards.edit permission."
          ],
          "itemsEs": [
            "Subpestañas: Overview, Glossary, Parent Domains, UDP.",
            "La insignia 'Restricted module' indica que la edición está restringida por permiso.",
            "El pie de página siempre muestra la etiqueta de la última versión + autor y un botón de Version history.",
            "El modo solo lectura vs. edición depende del permiso standards.edit."
          ]
        },
        {
          "subEn": "Overview tab (Governance)",
          "subEs": "Pestaña Overview (Governance)",
          "bodyEn": "The Overview is the module home, labeled 'Governance' with the title 'Naming & domain standards'. A prominent amber warning explains the global scope: editing a naming rule or a domain re-derives physical names and data types across every table of every project, so it is not scoped to one model. Below sit three clickable summary cards that jump to each area and show live counts: 'Glossary · Naming rules' (Terms & abbreviations · physical naming, with the term count), 'Parent Domains' (Reusable data domains, with the domain count), and 'UDP' (User Defined Properties · etiquetas, with the properties count). At the bottom, a 'Recent standard changes' panel lists the last three versions (title, author, version label and a Baseline/Applied status pill) with a 'View all versions' link, and a 'Who can manage standards' panel shows your editor identity when you have edit rights (or a note that your role can only view), plus a reminder that edit access is granted from Admin · Permisos via the standards.edit permission.",
          "bodyEs": "El Overview es la portada del módulo, rotulado 'Governance' con el título 'Naming & domain standards'. Un aviso ámbar destacado explica el alcance global: editar una regla de naming o un dominio re-deriva nombres físicos y tipos de dato en toda tabla de todo proyecto, así que no está acotado a un solo modelo. Debajo hay tres cards resumen clicables que llevan a cada área y muestran conteos en vivo: 'Glossary · Naming rules' (Términos y abreviaturas · naming físico, con el número de términos), 'Parent Domains' (Dominios de datos reutilizables, con el número de dominios) y 'UDP' (User Defined Properties · etiquetas, con el número de propiedades). Al final, un panel de 'Recent standard changes' lista las últimas tres versiones (título, autor, etiqueta de versión y una píldora de estado Baseline/Applied) con un enlace 'View all versions', y un panel 'Who can manage standards' muestra tu identidad de editor cuando tienes permiso (o una nota de que tu rol solo puede ver), más un recordatorio de que el acceso de edición se otorga desde Admin · Permisos con el permiso standards.edit.",
          "itemsEn": [
            "Global-scope warning banner (changes ripple across all projects).",
            "Three summary cards with live counts that navigate to Glossary, Parent Domains and UDP.",
            "'Recent standard changes' shows the last 3 versions with Baseline/Applied pills and a 'View all versions' link.",
            "'Who can manage standards' shows your editor identity or a view-only note, and points to Admin · Permisos (standards.edit)."
          ],
          "itemsEs": [
            "Banner de alcance global (los cambios repercuten en todos los proyectos).",
            "Tres cards resumen con conteos en vivo que navegan a Glossary, Parent Domains y UDP.",
            "'Recent standard changes' muestra las últimas 3 versiones con píldoras Baseline/Applied y un enlace 'View all versions'.",
            "'Who can manage standards' muestra tu identidad de editor o una nota de solo lectura, y remite a Admin · Permisos (standards.edit)."
          ]
        },
        {
          "subEn": "Glossary — terms & abbreviations",
          "subEs": "Glossary — términos y abreviaturas",
          "bodyEn": "The Glossary is where you define the terms and abbreviations that the engine uses to turn a logical/business phrase into a physical name. A scope toggle at the top switches between 'Per column' and 'Per table' (each scope keeps its own terms and rules; the toggle is locked while editing). In read-only mode a banner reminds you nothing can change; with edit rights, 'Edit standards' opens edit mode. The terms table has three columns — Term, Abbrev. and Word type — where Word type is a colored badge: prime (blue), class (green) or modifier (purple). A search box filters by term or abbreviation and a counter shows how many terms exist. In edit mode you can 'Add term' (each new row has editable Term, Abbrev. and a Word type selector prime/class/modifier), edit any existing row inline, and delete rows. A live 'Preview · physical name' panel takes the sample phrase 'monto deuda dólares' and shows the resulting physical name in real time as you edit terms and rules (using a longest-match over the terms plus the separator and case). The footer counts unsaved changes and offers Cancel or 'Save & apply'.",
          "bodyEs": "El Glossary es donde defines los términos y abreviaturas que el motor usa para convertir una frase lógica/de negocio en un nombre físico. Un selector arriba alterna entre 'Per column' y 'Per table' (cada alcance mantiene sus propios términos y reglas; el selector se bloquea mientras editas). En modo solo lectura un banner recuerda que nada puede cambiar; con permiso, 'Edit standards' abre el modo edición. La tabla de términos tiene tres columnas — Term, Abbrev. y Word type — donde Word type es una insignia de color: prime (azul), class (verde) o modifier (morado). Un buscador filtra por término o abreviatura y un contador muestra cuántos términos hay. En modo edición puedes 'Add term' (cada fila nueva trae Term y Abbrev. editables y un selector de Word type prime/class/modifier), editar cualquier fila en línea y eliminar filas. Un panel 'Preview · physical name' toma la frase de ejemplo 'monto deuda dólares' y muestra el nombre físico resultante en tiempo real mientras editas términos y reglas (usando coincidencia de frase más larga sobre los términos más el separador y la caja). El pie cuenta los cambios sin guardar y ofrece Cancel o 'Save & apply'.",
          "itemsEn": [
            "Scope toggle 'Per column' / 'Per table' (locked during editing).",
            "Terms table: Term, Abbrev. and Word type (prime / class / modifier badges).",
            "Add / edit inline / delete terms; searchable and counted.",
            "Live physical-name preview using the sample 'monto deuda dólares'."
          ],
          "itemsEs": [
            "Selector de alcance 'Per column' / 'Per table' (bloqueado durante la edición).",
            "Tabla de términos: Term, Abbrev. y Word type (insignias prime / class / modifier).",
            "Agregar / editar en línea / eliminar términos; con búsqueda y contador.",
            "Vista previa en vivo del nombre físico con el ejemplo 'monto deuda dólares'."
          ]
        },
        {
          "subEn": "Naming rules (separator & case)",
          "subEs": "Reglas de naming (separador y caja)",
          "bodyEn": "The naming rules live inside the Glossary tab, alongside the terms, and apply to the currently selected scope (column or table). There are two settings: 'Separator between terms', a dropdown offering '_ underscore', '(none) · join' or '- hyphen'; and 'Upper / lower case', a dropdown offering UPPER, lower or camelCase. In read-only mode these show as chips; in edit mode they become dropdowns and immediately update the physical-name preview. Changing either rule counts as a standard change and is included in the 'Save & apply' confirmation. When you save, a dialog titled 'Apply naming rules to catalog' lists exactly what changed, grouped as added (green), edited and removed (red) — including any separator/case change — and warns that physical names are re-derived catalog-wide and cannot be partially undone (though the version can be rolled back). Only genuinely new or edited terms are applied, so the impact stays accurate.",
          "bodyEs": "Las reglas de naming viven dentro de la pestaña Glossary, junto a los términos, y aplican al alcance seleccionado (columna o tabla). Hay dos ajustes: 'Separator between terms', un desplegable con '_ underscore', '(none) · join' o '- hyphen'; y 'Upper / lower case', un desplegable con UPPER, lower o camelCase. En modo solo lectura se muestran como chips; en modo edición se vuelven desplegables y actualizan al instante la vista previa del nombre físico. Cambiar cualquiera de las reglas cuenta como un cambio de estándar y se incluye en la confirmación de 'Save & apply'. Al guardar, un diálogo titulado 'Apply naming rules to catalog' lista exactamente qué cambió, agrupado en added (verde), edited y removed (rojo) — incluyendo cualquier cambio de separador/caja — y advierte que los nombres físicos se re-derivan en todo el catálogo y no se pueden deshacer parcialmente (aunque la versión sí se puede revertir). Solo se aplican los términos realmente nuevos o editados, para que el impacto se mantenga exacto.",
          "itemsEn": [
            "Separator options: '_ underscore', '(none) · join', '- hyphen'.",
            "Case options: UPPER, lower, camelCase.",
            "Rules are per-scope and feed the live preview.",
            "Apply dialog shows added/edited/removed and warns changes re-derive names catalog-wide."
          ],
          "itemsEs": [
            "Opciones de separador: '_ underscore', '(none) · join', '- hyphen'.",
            "Opciones de caja: UPPER, lower, camelCase.",
            "Las reglas son por alcance y alimentan la vista previa en vivo.",
            "El diálogo de aplicar muestra added/edited/removed y advierte que los cambios re-derivan nombres en todo el catálogo."
          ]
        },
        {
          "subEn": "Parent Domains — reusable data-type templates",
          "subEs": "Parent Domains — plantillas de tipo de dato reutilizables",
          "bodyEn": "Parent Domains are reusable data-type templates: instead of typing a data type on every column, you point columns at a domain (for example 'Importe' → DECIMAL(18,2)) and they inherit its default. The screen has a left list of domains with a count, a search box ('Search domains…') and a 'New' button, where each card shows the domain name and its default data type. The detail pane on the right shows the domain name, the Default data type (monospace, e.g. DECIMAL(18,2)) and a Description. In view mode an impact card summarizes usage: 'Usado por N columnas' with '● N se actualizan' and '● N con override (skip)'. With edit rights you can create a new domain, edit an existing one, or delete it. When you change the default data type and apply, a cascade re-types every column on that domain that does NOT have a manual override — columns with a manual type override are respected and skipped. The apply dialog shows the old → new type and how many columns will be re-typed versus skipped; creating shows a simple confirmation. Deleting a domain asks for confirmation and warns that columns keep their current type but lose the link to the domain.",
          "bodyEs": "Los Parent Domains son plantillas de tipo de dato reutilizables: en lugar de escribir un tipo en cada columna, apuntas las columnas a un dominio (por ejemplo 'Importe' → DECIMAL(18,2)) y heredan su valor por defecto. La pantalla tiene una lista de dominios a la izquierda con un contador, un buscador ('Search domains…') y un botón 'New', donde cada card muestra el nombre del dominio y su tipo de dato por defecto. El panel de detalle a la derecha muestra el nombre del dominio, el Default data type (monoespaciado, p. ej. DECIMAL(18,2)) y una Description. En modo vista un card de impacto resume el uso: 'Usado por N columnas' con '● N se actualizan' y '● N con override (skip)'. Con permiso puedes crear un dominio nuevo, editar uno existente o eliminarlo. Cuando cambias el tipo de dato por defecto y aplicas, una cascada re-tipa cada columna de ese dominio que NO tenga override manual — las columnas con override manual de tipo se respetan y se saltan. El diálogo de aplicar muestra el tipo viejo → nuevo y cuántas columnas se re-tipan frente a las que se saltan; crear muestra una confirmación simple. Eliminar un dominio pide confirmación y advierte que las columnas conservan su tipo actual pero pierden el vínculo al dominio.",
          "itemsEn": [
            "Left list with count, search and 'New'; each card shows name + default data type.",
            "Detail fields: Domain name, Default data type (template), Description.",
            "Impact card: columns using the domain, how many update vs. how many are overridden (skipped).",
            "Actions: create, edit (with type cascade respecting manual overrides), and delete (columns keep type, lose the link)."
          ],
          "itemsEs": [
            "Lista izquierda con contador, búsqueda y 'New'; cada card muestra nombre + tipo por defecto.",
            "Campos de detalle: Domain name, Default data type (plantilla), Description.",
            "Card de impacto: columnas que usan el dominio, cuántas se actualizan vs. cuántas tienen override (se saltan).",
            "Acciones: crear, editar (con cascada de tipo que respeta overrides manuales) y eliminar (las columnas conservan el tipo, pierden el vínculo)."
          ]
        },
        {
          "subEn": "UDP — user-defined properties",
          "subEs": "UDP — propiedades definidas por el usuario",
          "bodyEn": "UDP (User Defined Properties) are custom key-value labels you can attach to tables or columns. A 'Class' segmented control at the top switches the level between Table and Column; each UDP definition belongs to exactly one level, and switching levels shows only that level's properties. A 'New property' button opens the editor. The list is a table with Name, Type and Default columns (plus a delete action per row); the empty state prompts you to create one. Selecting a row (or New) opens a details panel on the right where you set: Name; Type (Text, Number, Boolean, Date or List); Default value; and, only when Type is List, an 'Allowed values (uno por línea)' textarea to define the permitted options — for List types the Default becomes a dropdown limited to those allowed values. There is also a Description field. 'Save & apply' persists the definition as a new version, and each property can be deleted (with a confirmation warning that already-assigned values become orphaned and are ignored). The properties defined here are what users then fill in from the Metadata/Properties panel on tables and columns.",
          "bodyEs": "Los UDP (User Defined Properties) son etiquetas clave-valor personalizadas que puedes adjuntar a tablas o columnas. Un control segmentado 'Class' arriba alterna el nivel entre Table y Column; cada definición UDP pertenece a exactamente un nivel, y cambiar de nivel muestra solo las propiedades de ese nivel. Un botón 'New property' abre el editor. La lista es una tabla con columnas Name, Type y Default (más una acción de eliminar por fila); el estado vacío invita a crear una. Al seleccionar una fila (o New) se abre un panel de detalle a la derecha donde defines: Name; Type (Texto, Número, Booleano, Fecha o Lista); Default (valor por defecto); y, solo cuando el tipo es Lista, un textarea 'Allowed values (uno por línea)' para definir las opciones permitidas — en tipos Lista el Default se vuelve un desplegable limitado a esos valores permitidos. También hay un campo Description. 'Save & apply' guarda la definición como una versión nueva, y cada propiedad puede eliminarse (con una confirmación que advierte que los valores ya asignados quedan huérfanos y se ignoran). Las propiedades definidas aquí son las que luego los usuarios completan desde el panel de Metadata/Properties en tablas y columnas.",
          "itemsEn": [
            "Level (Class) selector: Table or Column — each property belongs to one level.",
            "List columns: Name, Type, Default; row delete action; empty-state prompt.",
            "Editor fields: Name, Type (Text/Number/Boolean/Date/List), Default, Description.",
            "For List type: 'Allowed values (one per line)' and a Default restricted to those values.",
            "Save & apply creates a new version; delete warns assigned values become orphaned."
          ],
          "itemsEs": [
            "Selector de nivel (Class): Table o Column — cada propiedad pertenece a un nivel.",
            "Columnas de la lista: Name, Type, Default; acción de eliminar por fila; mensaje de estado vacío.",
            "Campos del editor: Name, Type (Texto/Número/Booleano/Fecha/Lista), Default, Description.",
            "Para el tipo Lista: 'Allowed values (uno por línea)' y un Default limitado a esos valores.",
            "Save & apply crea una versión nueva; eliminar advierte que los valores asignados quedan huérfanos."
          ]
        },
        {
          "subEn": "Versioning, history & rollback",
          "subEs": "Versionado, historial y rollback",
          "bodyEn": "Standards are versioned independently: every apply (glossary, naming, domain, UDP) and every delete is recorded as a distinct version. The 'Version history' dialog (opened from the footer or the Overview 'View all versions' link) lists all versions newest-first, each with an icon by kind (domain, rollback or glossary/other), a version label, a title, the author, and an impact summary ('N names · N tables'). The very first version is a 'Baseline'; later ones are marked 'Applied'. If you have edit rights, any non-baseline version that isn't the current one shows a 'Roll back' button. Rolling back opens a confirmation ('Roll back to <label>?') that explains it restores the standards state of that version and re-derives the affected names and types, and that the rollback itself is logged as a new version. Importantly, columns edited since then keep their newer names/types when they carry a manual override — so a rollback re-derives only what wasn't manually overridden.",
          "bodyEs": "Los estándares se versionan de forma independiente: cada aplicación (glossary, naming, domain, UDP) y cada eliminación se registra como una versión distinta. El diálogo 'Version history' (que se abre desde el pie o desde el enlace 'View all versions' del Overview) lista todas las versiones de la más reciente a la más antigua, cada una con un icono por tipo (domain, rollback o glossary/otro), una etiqueta de versión, un título, el autor y un resumen de impacto ('N names · N tables'). La primera versión es un 'Baseline'; las siguientes se marcan 'Applied'. Si tienes permiso, toda versión que no sea baseline ni la actual muestra un botón 'Roll back'. Revertir abre una confirmación ('Roll back to <etiqueta>?') que explica que restaura el estado de estándares de esa versión y re-deriva los nombres y tipos afectados, y que el propio rollback se registra como una versión nueva. Importante: las columnas editadas desde entonces conservan sus nombres/tipos más nuevos cuando tienen un override manual — así el rollback re-deriva solo lo que no fue anulado manualmente.",
          "itemsEn": [
            "Every apply and delete becomes its own version (kinds include glossary, naming, domain, udp, rollback, baseline).",
            "Version history lists all versions newest-first with icon, label, title, author and impact (names · tables).",
            "First version is Baseline; others are Applied; only non-baseline, non-current versions can be rolled back.",
            "Rollback re-derives names/types to the chosen version, is logged as a new version, and respects manual overrides."
          ],
          "itemsEs": [
            "Cada aplicación y eliminación se vuelve su propia versión (los tipos incluyen glossary, naming, domain, udp, rollback, baseline).",
            "El historial lista todas las versiones de la más reciente a la más antigua con icono, etiqueta, título, autor e impacto (names · tables).",
            "La primera versión es Baseline; las demás son Applied; solo las versiones no-baseline y que no son la actual se pueden revertir.",
            "El rollback re-deriva nombres/tipos a la versión elegida, se registra como versión nueva y respeta los overrides manuales."
          ]
        }
      ]
    }
  },
  {
    "id": "reporting",
    "card": {
      "titleEn": "Reporting",
      "titleEs": "Reportes",
      "blurbEn": "A tabular view of all your model metadata — tables, columns, relationships and projects — with live filters, Excel export by detail level, at-a-glance summaries, and a full Report Designer with visual builder and SQL.",
      "blurbEs": "Una vista tabular de toda la metadata de tu modelo — tablas, columnas, relaciones y proyectos — con filtros en vivo, exportación a Excel por nivel de detalle, resúmenes rápidos y un Diseñador de Reportes completo con constructor visual y SQL.",
      "bulletsEn": [
        "Browse a metadata grid of tables with schema, subject areas, column/relationship counts, projects and functional definitions",
        "Filter the grid live by table name search, schema, project and subject area (faceted, cumulative filters)",
        "Select rows and export to Excel, choosing which detail levels (Tables, Columns, Relationships, Definitions) become sheets",
        "See instant summaries: tables by subject area and the most-related / most-shared tables",
        "Open the Report Designer to build custom queries visually or write SQL, with nested AND/OR filters and UDP support",
        "Run queries against a virtualized results grid with infinite scroll, sort, CSV export, and save/load of reports"
      ],
      "bulletsEs": [
        "Explora una grilla de metadata de tablas con esquema, áreas temáticas, conteo de columnas/relaciones, proyectos y definiciones funcionales",
        "Filtra la grilla en vivo por búsqueda de nombre de tabla, esquema, proyecto y área temática (filtros facetados y acumulativos)",
        "Selecciona filas y expórtalas a Excel, eligiendo qué niveles de detalle (Tablas, Columnas, Relaciones, Definiciones) se vuelven hojas",
        "Revisa resúmenes al instante: tablas por área temática y las tablas más relacionadas / más compartidas",
        "Abre el Diseñador de Reportes para armar consultas de forma visual o escribir SQL, con filtros AND/OR anidados y soporte de UDP",
        "Ejecuta consultas sobre una grilla virtualizada con scroll infinito, ordenamiento, exportación a CSV y guardado/carga de reportes"
      ]
    },
    "deep": {
      "headingEn": "Reporting — functional detail",
      "headingEs": "Reportes — detalle funcional",
      "sections": [
        {
          "subEn": "Purpose and layout",
          "subEs": "Propósito y disposición",
          "bodyEn": "The Reporting screen gives you a spreadsheet-style, read-only view of your model's metadata so you can review, filter and hand it off without opening the canvas. The screen opens with a header (\"Reporting\" title and a short description), a main area on the left with a filter bar and a metadata table, and a right rail with the Excel export panel, two summary cards and the entry point to the Report Designer.",
          "bodyEs": "La pantalla de Reportes te da una vista de solo lectura, estilo hoja de cálculo, de la metadata de tu modelo para revisarla, filtrarla y compartirla sin abrir el lienzo. La pantalla abre con un encabezado (título \"Reporting\" y una breve descripción), un área principal a la izquierda con una barra de filtros y una tabla de metadata, y un panel derecho con el módulo de exportación a Excel, dos tarjetas de resumen y el acceso al Diseñador de Reportes."
        },
        {
          "subEn": "Metadata grid",
          "subEs": "Grilla de metadata",
          "bodyEn": "The central table lists one row per table with these columns: a selection checkbox, Table (physical name plus the logical name underneath when it differs), Schema, Subject area (shown as chips, or a dash when none), #Columns, #Relations, Projects (chips), and Functional definition (or \"No definition\" when empty). Rows have zebra striping, hover highlight and a sticky header. While data loads you see skeleton rows; if nothing matches you get a \"No tables match your filters\" state, and if the model has no tables yet you get a \"No tables to report yet\" state.\n\nFor performance the grid loads only the first 50 tables up front (a hint reads \"first 50 — filter to load all\"); the moment you apply any filter it loads the full set so filtering and faceting stay accurate over everything.",
          "bodyEs": "La tabla central lista una fila por tabla con estas columnas: una casilla de selección, Table (nombre físico y, debajo, el nombre lógico cuando difiere), Schema, Subject area (mostrada como chips, o un guion cuando no hay), #Columns, #Relations, Projects (chips) y Functional definition (o \"No definition\" cuando está vacía). Las filas tienen rayado tipo cebra, resaltado al pasar el cursor y encabezado fijo. Mientras cargan los datos ves filas de esqueleto; si nada coincide aparece el estado \"No tables match your filters\", y si el modelo aún no tiene tablas aparece \"No tables to report yet\".\n\nPor rendimiento la grilla carga solo las primeras 50 tablas al inicio (con el aviso \"first 50 — filter to load all\"); en cuanto aplicas cualquier filtro carga el conjunto completo para que el filtrado y el facetado sean exactos sobre todo el modelo."
        },
        {
          "subEn": "Filters and search",
          "subEs": "Filtros y búsqueda",
          "bodyEn": "The filter bar above the grid has four controls plus a counter. A search box (\"Search tables by name…\") matches against both the physical and logical table name. Three multi-select dropdowns — Schema, Project and Subject area — each open a checklist where you tick one or more values; a small badge shows how many are selected. The filters are faceted and cumulative: each dropdown's options reflect the rows that pass the other filters, so they narrow each other, while your own selections always stay visible so you can untick them. A \"Clear\" button appears whenever any filter is active and resets all of them at once. To the right, a counter reads \"X selected · Y tables\".",
          "bodyEs": "La barra de filtros sobre la grilla tiene cuatro controles más un contador. Un cuadro de búsqueda (\"Search tables by name…\") busca tanto en el nombre físico como en el lógico de la tabla. Tres desplegables de selección múltiple — Schema, Project y Subject area — abren una lista de casillas donde marcas uno o varios valores; una insignia indica cuántos están seleccionados. Los filtros son facetados y acumulativos: las opciones de cada desplegable reflejan las filas que pasan los otros filtros, así se van acotando entre sí, mientras que tus propias selecciones siempre quedan visibles para poder desmarcarlas. Un botón \"Clear\" aparece cuando hay algún filtro activo y los reinicia todos de una vez. A la derecha, un contador muestra \"X selected · Y tables\"."
        },
        {
          "subEn": "Row selection",
          "subEs": "Selección de filas",
          "bodyEn": "Selection starts empty. Each row has a checkbox, and the header has a \"select all\" checkbox that ticks or unticks every currently visible (filtered) row. Only selected rows count toward the Excel export, and the counter and the export panel both reflect how many are selected. Selected rows are visually highlighted.",
          "bodyEs": "La selección comienza vacía. Cada fila tiene una casilla, y el encabezado tiene una casilla de \"seleccionar todo\" que marca o desmarca todas las filas visibles (filtradas). Solo las filas seleccionadas cuentan para la exportación a Excel, y tanto el contador como el módulo de exportación reflejan cuántas están seleccionadas. Las filas seleccionadas quedan resaltadas."
        },
        {
          "subEn": "Export to Excel",
          "subEs": "Exportar a Excel",
          "bodyEn": "The right-rail \"Export to Excel\" card lets you build a workbook from the selected rows, where each detail level you tick becomes its own sheet. There are four levels (Tables and Columns are checked by default):\n\n· Tables overview — one row per table: Table, Logical name, Schema, Subject areas, #Columns, #Relations, Projects.\n· Columns detail — every field: Table, Column, Logical name, Data type, Parent domain, PK, FK, Nullable, Partition, Definition.\n· Relationships — relationship totals per table (only tables that have relationships): Table, Schema, #Relations.\n· Definitions — the functional definition text per table: Table, Logical name, Functional definition.\n\nThe \"Download .xlsx\" button generates the file (named data-model-hub-report-YYYY-MM-DD.xlsx). It is disabled while exporting, when no level is checked, when nothing is selected, or while data is loading, and a note reminds you that only the selected rows are exported. If you try to export with no level or no selection you get an error toast.",
          "bodyEs": "La tarjeta \"Export to Excel\" del panel derecho arma un libro de Excel a partir de las filas seleccionadas, donde cada nivel de detalle que marcas se convierte en su propia hoja. Hay cuatro niveles (Tables y Columns vienen marcados por defecto):\n\n· Tables overview — una fila por tabla: Table, Logical name, Schema, Subject areas, #Columns, #Relations, Projects.\n· Columns detail — cada campo: Table, Column, Logical name, Data type, Parent domain, PK, FK, Nullable, Partition, Definition.\n· Relationships — totales de relaciones por tabla (solo tablas que tienen relaciones): Table, Schema, #Relations.\n· Definitions — el texto de la definición funcional por tabla: Table, Logical name, Functional definition.\n\nEl botón \"Download .xlsx\" genera el archivo (con nombre data-model-hub-report-YYYY-MM-DD.xlsx). Se deshabilita mientras exporta, cuando no hay ningún nivel marcado, cuando no hay nada seleccionado o mientras cargan los datos, y una nota te recuerda que solo se exportan las filas seleccionadas. Si intentas exportar sin nivel o sin selección, aparece un aviso de error."
        },
        {
          "subEn": "Summary cards",
          "subEs": "Tarjetas de resumen",
          "bodyEn": "Below the export panel, two cards summarize whatever is currently in view (they follow your filters). \"Tables by subject area\" shows the top five subject areas as horizontal bars with counts. \"Most related / in most projects\" lists the top five tables ranked by number of relationships (then by number of projects), each showing its relationship and project counts. Both show a loading or empty message when there is nothing to display.",
          "bodyEs": "Debajo del módulo de exportación, dos tarjetas resumen lo que esté en vista (siguen tus filtros). \"Tables by subject area\" muestra las cinco áreas temáticas principales como barras horizontales con sus conteos. \"Most related / in most projects\" lista las cinco tablas con más relaciones (y luego más proyectos), cada una con su cantidad de relaciones y de proyectos. Ambas muestran un mensaje de carga o de vacío cuando no hay nada que mostrar."
        },
        {
          "subEn": "Report Designer — overview",
          "subEs": "Diseñador de Reportes — visión general",
          "bodyEn": "The \"Design report\" button at the bottom of the right rail (captioned \"Query engine · SQL & UDP filters\") opens the full-screen Report Designer, a query engine that goes beyond the fixed grid. Its header has: a title (\"Report Designer\"); a view selector to choose what you query — columns, tables, relationships or views; a Builder / SQL toggle; a \"Saved reports…\" dropdown (shown when you have saved reports); and the action buttons Save, CSV, Run and a close (X) that returns you to the main Reporting screen.",
          "bodyEs": "El botón \"Design report\" al pie del panel derecho (con la leyenda \"Query engine · SQL & UDP filters\") abre el Diseñador de Reportes a pantalla completa, un motor de consulta que va más allá de la grilla fija. Su encabezado tiene: un título (\"Report Designer\"); un selector de vista para elegir qué consultas — columns, tables, relationships o views; un interruptor Builder / SQL; un desplegable \"Saved reports…\" (visible cuando tienes reportes guardados); y los botones de acción Save, CSV, Run y una X de cerrar que te devuelve a la pantalla principal de Reportes."
        },
        {
          "subEn": "Report Designer — visual builder",
          "subEs": "Diseñador de Reportes — constructor visual",
          "bodyEn": "In Builder mode you compose a query without writing code. On the left, a \"Columns · group\" field list shows every available field for the selected view; each has a checkbox to show it as a column and, for groupable fields, a \"GRP\" button to group by it (grouping automatically adds a count aggregation). UDP fields are marked with a purple diamond (◆).\n\nOn the right, the Filters area (FilterBuilder) lets you build conditions. Each group has an AND / OR toggle (\"of these conditions\"). A condition is a field + operator + value; operators include = , ≠ , in, not in, contains, starts with, > , ≥ , < , ≤ , between, is set and is empty (the last two need no value). The value editor adapts to the field: a typeahead dropdown with server-side options for domain/schema/dataType-style fields, an enum dropdown, a multi-select for in/not in, a true/false dropdown for booleans, or a number/date/text input. You add rows with \"Condición\", nest sub-groups with \"+ grupo\" (up to two levels deep) for mixed AND/OR logic, and remove conditions (X) or whole groups (\"quitar grupo\"). Clicking a sortable column header sorts server-side and re-runs the query, with ↑/↓ arrows showing the direction.",
          "bodyEs": "En modo Builder armas una consulta sin escribir código. A la izquierda, la lista de campos \"Columns · group\" muestra todos los campos disponibles para la vista elegida; cada uno tiene una casilla para mostrarlo como columna y, en los campos agrupables, un botón \"GRP\" para agrupar por él (agrupar agrega automáticamente una agregación de conteo). Los campos UDP se marcan con un rombo morado (◆).\n\nA la derecha, el área de Filters (FilterBuilder) te deja armar condiciones. Cada grupo tiene un interruptor AND / OR (\"de estas condiciones\"). Una condición es campo + operador + valor; los operadores incluyen = , ≠ , in, not in, contains, starts with, > , ≥ , < , ≤ , between, is set y is empty (los dos últimos no necesitan valor). El editor de valor se adapta al campo: un desplegable con typeahead y opciones del servidor para campos tipo dominio/schema/dataType, un desplegable de enum, una selección múltiple para in/not in, un desplegable true/false para booleanos, o un campo de número/fecha/texto. Agregas filas con \"Condición\", anidas subgrupos con \"+ grupo\" (hasta dos niveles) para lógica AND/OR mixta, y quitas condiciones (X) o grupos completos (\"quitar grupo\"). Al hacer clic en el encabezado de una columna ordenable, ordena del lado del servidor y vuelve a ejecutar la consulta, con flechas ↑/↓ que indican la dirección."
        },
        {
          "subEn": "Report Designer — SQL box",
          "subEs": "Diseñador de Reportes — caja SQL",
          "bodyEn": "In SQL mode you write a text query directly. A hint reminds you it is SQL-like over the columns · tables · relationships · views datasets, that UDP fields are referenced as udp.\"Name\", and that JOINs and subqueries are not supported. The editor supports SELECT, WHERE, GROUP BY, ORDER BY and LIMIT — the placeholder shows an example selecting physicalName, dataType and a UDP column, filtered by schema and a UDP value, ordered and limited. The \"Validar → builder\" button validates the SQL on the server; on success it shows \"✓ SQL válido\" and converts the query into the visual builder (switching to Builder mode) so you can keep editing; on failure it lists errors with the offending line number.",
          "bodyEs": "En modo SQL escribes una consulta de texto directamente. Un aviso te recuerda que es SQL-like sobre los conjuntos columns · tables · relationships · views, que los campos UDP se referencian como udp.\"Nombre\", y que no se admiten JOINs ni subconsultas. El editor soporta SELECT, WHERE, GROUP BY, ORDER BY y LIMIT — el marcador de posición muestra un ejemplo que selecciona physicalName, dataType y una columna UDP, filtrado por schema y por un valor UDP, ordenado y con límite. El botón \"Validar → builder\" valida el SQL en el servidor; si es válido muestra \"✓ SQL válido\" y convierte la consulta al constructor visual (pasando a modo Builder) para que sigas editando; si falla, lista los errores con el número de línea correspondiente."
        },
        {
          "subEn": "Report Designer — results, export and saving",
          "subEs": "Diseñador de Reportes — resultados, exportación y guardado",
          "bodyEn": "Pressing Run executes the current builder query or SQL and shows the results in a virtualized grid that can handle very large result sets. Above the grid a status line reads the row count (with a \"+\" when more are available) and column count, plus a scan indicator (green \"index\" for an indexed scan, amber otherwise) and a \"cargando…\" note while loading. Columns are dynamic and include UDP columns (marked ◆); number columns are right-aligned in monospace, booleans show ✓ or ·, and empty cells show a dash. The header is sticky and clicking a sortable column (non-UDP, non-grouped) sorts server-side. Scrolling near the bottom loads the next page automatically (cursor-based infinite scroll), so the browser never pulls the whole dataset at once.\n\nThe CSV button streams the current query to a downloadable file (report-<view>.csv). The Save button prompts for a name and stores the report; saved reports then appear in the \"Saved reports…\" dropdown, and picking one loads its view and full spec back into the builder.",
          "bodyEs": "Al presionar Run se ejecuta la consulta actual del builder o el SQL y los resultados se muestran en una grilla virtualizada capaz de manejar conjuntos muy grandes. Sobre la grilla, una línea de estado indica la cantidad de filas (con un \"+\" cuando hay más disponibles) y de columnas, más un indicador de scan (verde \"index\" para un escaneo indexado, ámbar en otro caso) y un aviso \"cargando…\" mientras carga. Las columnas son dinámicas e incluyen columnas UDP (marcadas con ◆); las columnas numéricas se alinean a la derecha en monoespaciado, los booleanos muestran ✓ o ·, y las celdas vacías muestran un guion. El encabezado es fijo y hacer clic en una columna ordenable (que no sea UDP ni esté agrupada) ordena del lado del servidor. Al hacer scroll cerca del final se carga la siguiente página automáticamente (scroll infinito por cursor), de modo que el navegador nunca trae todo el conjunto de una vez.\n\nEl botón CSV transmite la consulta actual a un archivo descargable (report-<vista>.csv). El botón Save pide un nombre y guarda el reporte; los reportes guardados aparecen luego en el desplegable \"Saved reports…\", y al elegir uno se cargan su vista y su especificación completa de vuelta en el builder."
        }
      ]
    }
  },
  {
    "id": "admin",
    "card": {
      "titleEn": "Admin",
      "titleEs": "Administración",
      "blurbEn": "Control center for users, roles, and the permission matrix that governs who can do what across Data Model Hub.",
      "blurbEs": "Centro de control de usuarios, roles y la matriz de permisos que define quién puede hacer qué en Data Model Hub.",
      "bulletsEn": [
        "Add, edit, activate/deactivate, or delete users and assign each one a role and projects",
        "Create, edit, and delete roles, and see how many users hold each role",
        "Turn each permission on or off per role in a visual matrix (view, edit, approve, publish, export, standards, admin)",
        "Assign users to specific projects or grant access to all projects",
        "Filter and search the user list by name, email, username, or role",
        "See each user's effective access level: Full control, Edit, or Read only"
      ],
      "bulletsEs": [
        "Agregar, editar, activar/desactivar o eliminar usuarios y asignarles rol y proyectos",
        "Crear, editar y eliminar roles, y ver cuántos usuarios tiene cada rol",
        "Activar o desactivar cada permiso por rol en una matriz visual (ver, editar, aprobar, publicar, exportar, estándares, admin)",
        "Asignar usuarios a proyectos específicos o darles acceso a todos los proyectos",
        "Filtrar y buscar en la lista de usuarios por nombre, email, usuario o rol",
        "Ver el nivel de acceso efectivo de cada usuario: Control total, Edición o Solo lectura"
      ]
    },
    "deep": {
      "headingEn": "Admin — Users, Roles & Permissions",
      "headingEs": "Administración — Usuarios, roles y permisos",
      "sections": [
        {
          "subEn": "Who can access Admin",
          "subEs": "Quién puede acceder a Administración",
          "bodyEn": "Admin is a restricted module. The \"Admin\" item only appears in the top navigation bar for users whose role has the \"Administer users and permissions\" (admin.manage) permission turned on; everyone else never sees the link. If someone tries to open the /admin URL directly without that permission, they are sent back to Home. You also have to be logged in first — an unauthenticated visitor is redirected to the login screen. Every admin action is protected on the server by the same admin.manage rule, so the module is effectively for administrators only.",
          "bodyEs": "Administración es un módulo restringido. El ítem \"Admin\" solo aparece en la barra de navegación superior para los usuarios cuyo rol tiene activado el permiso \"Administrar usuarios y permisos\" (admin.manage); el resto nunca ve el enlace. Si alguien intenta abrir la URL /admin directamente sin ese permiso, es enviado de vuelta a Home. Además hay que haber iniciado sesión — a un visitante no autenticado se lo redirige a la pantalla de login. Cada acción de administración está protegida también en el servidor por la misma regla admin.manage, así que el módulo es de hecho solo para administradores.",
          "itemsEn": [
            "\"Admin\" tab visible only with the admin.manage permission",
            "Direct access to /admin without the permission redirects to Home",
            "Requires an active session (otherwise sent to login)"
          ],
          "itemsEs": [
            "Pestaña \"Admin\" visible solo con el permiso admin.manage",
            "El acceso directo a /admin sin el permiso redirige a Home",
            "Requiere sesión activa (si no, va al login)"
          ]
        },
        {
          "subEn": "Screen layout",
          "subEs": "Disposición de la pantalla",
          "bodyEn": "The screen is titled \"Permissions and access levels\" under the \"Administration\" eyebrow. On the left is a sidebar listing the defined roles. The main area holds, top to bottom: a search box plus an \"Add user\" button, the users table, and the per-role permission matrix. While data loads you see a loading message; if loading fails, an error card offers a \"Retry\" button.",
          "bodyEs": "La pantalla se titula \"Permisos y niveles de acceso\" bajo el rótulo \"Administración\". A la izquierda hay una barra lateral con los roles definidos. El área principal contiene, de arriba a abajo: un buscador junto a un botón \"Agregar usuario\", la tabla de usuarios y la matriz de permisos por rol. Mientras cargan los datos ves un mensaje de carga; si la carga falla, una tarjeta de error ofrece un botón \"Reintentar\"."
        },
        {
          "subEn": "Roles sidebar (Defined roles)",
          "subEs": "Barra lateral de roles (Roles definidos)",
          "bodyEn": "The left sidebar, headed \"Defined roles\", lists every role as a card. Each card shows the role name, a badge with the number of users assigned to that role, and the role's description if it has one. Clicking a card filters the users table to just that role; clicking it again clears the filter. Each card has an edit (pencil) button and a delete (trash) button. A \"New role\" button at the bottom creates a role. If there are no roles yet, the sidebar shows \"No roles yet. Create the first one.\"",
          "bodyEs": "La barra lateral izquierda, con el encabezado \"Roles definidos\", lista cada rol como una tarjeta. Cada tarjeta muestra el nombre del rol, un contador con la cantidad de usuarios asignados a ese rol y la descripción del rol si tiene una. Al hacer clic en una tarjeta se filtra la tabla de usuarios por ese rol; al hacer clic de nuevo se quita el filtro. Cada tarjeta tiene un botón de editar (lápiz) y uno de eliminar (papelera). Un botón \"Nuevo rol\" al pie crea un rol. Si todavía no hay roles, la barra muestra \"Sin roles todavía. Creá el primero.\"",
          "itemsEn": [
            "Role name + user-count badge + optional description",
            "Click a role to filter the users table by it (click again to clear)",
            "Edit (pencil) and Delete (trash) buttons per role",
            "\"New role\" button to create a role"
          ],
          "itemsEs": [
            "Nombre del rol + contador de usuarios + descripción opcional",
            "Clic en un rol para filtrar la tabla de usuarios por él (clic de nuevo para quitar)",
            "Botones de Editar (lápiz) y Eliminar (papelera) por rol",
            "Botón \"Nuevo rol\" para crear un rol"
          ]
        },
        {
          "subEn": "Creating and editing roles",
          "subEs": "Crear y editar roles",
          "bodyEn": "The New role / Edit role dialog has two fields: role name (required) and description (optional). When creating, it shows the auto-generated key (a slug derived from the name) and the role starts with no permissions granted. When editing, the key is fixed and shown as a subtitle, and existing permissions are preserved. Permissions are not set in this dialog — you assign them afterward in the permission matrix. Buttons are Cancel and Create role / Save changes.",
          "bodyEs": "El cuadro de diálogo Nuevo rol / Editar rol tiene dos campos: nombre del rol (obligatorio) y descripción (opcional). Al crear, muestra la clave autogenerada (un slug derivado del nombre) y el rol arranca sin permisos otorgados. Al editar, la clave queda fija y se muestra como subtítulo, y los permisos existentes se conservan. Los permisos no se definen en este diálogo — los asignás después en la matriz de permisos. Los botones son Cancelar y Crear rol / Guardar cambios."
        },
        {
          "subEn": "Users table",
          "subEs": "Tabla de usuarios",
          "bodyEn": "The users table lists every user with these columns: User (round avatar with initials, full name, and email), Role (the assigned role shown as a chip), Access level (a colored chip: Full control, Edit, or Read only), Projects (the list of assigned project IDs, or \"All\" when none are set), Status (Active, Invited, or Inactive chip), and a row-actions cell with Edit (pencil) and Delete (trash) buttons. A search box above the table filters by name, email, or username. When a role is selected in the sidebar, a \"Filtering by <role>\" chip appears with an X to remove it. Empty states read \"No users yet. Add the first one.\" or \"No user matches the filter.\"",
          "bodyEs": "La tabla de usuarios lista a cada usuario con estas columnas: Usuario (avatar redondo con iniciales, nombre completo y email), Rol (el rol asignado como chip), Nivel de acceso (un chip de color: Control total, Edición o Solo lectura), Proyectos (la lista de IDs de proyectos asignados, o \"Todos\" cuando no hay ninguno), Estado (chip Activo, Invitado o Inactivo) y una celda de acciones con botones de Editar (lápiz) y Eliminar (papelera). Un buscador sobre la tabla filtra por nombre, email o usuario. Cuando hay un rol seleccionado en la barra lateral, aparece un chip \"Filtrando por <rol>\" con una X para quitarlo. Los estados vacíos dicen \"No hay usuarios todavía. Agregá el primero.\" o \"Ningún usuario coincide con el filtro.\"",
          "itemsEn": [
            "User (avatar + name + email)",
            "Role chip",
            "Access level chip: Full control / Edit / Read only",
            "Projects (assigned IDs or \"All\")",
            "Status chip: Active / Invited / Inactive",
            "Per-row Edit and Delete buttons"
          ],
          "itemsEs": [
            "Usuario (avatar + nombre + email)",
            "Chip de Rol",
            "Chip de Nivel de acceso: Control total / Edición / Solo lectura",
            "Proyectos (IDs asignados o \"Todos\")",
            "Chip de Estado: Activo / Invitado / Inactivo",
            "Botones de Editar y Eliminar por fila"
          ]
        },
        {
          "subEn": "Access level (how it is derived)",
          "subEs": "Nivel de acceso (cómo se calcula)",
          "bodyEn": "The Access level chip is computed automatically from the role's permissions, not set by hand. If the role has \"Administer users and permissions\" it shows Full control (red). Otherwise, if it has \"Create/edit tables\", \"Edit Data Standards\", or \"Publish to production\", it shows Edit (amber). If none of those, it shows Read only (green). This gives an at-a-glance summary of what each user's role really lets them do.",
          "bodyEs": "El chip de Nivel de acceso se calcula automáticamente a partir de los permisos del rol, no se define a mano. Si el rol tiene \"Administrar usuarios y permisos\" muestra Control total (rojo). Si no, y tiene \"Crear/editar tablas\", \"Editar Data Standards\" o \"Publicar a producción\", muestra Edición (ámbar). Si no tiene ninguno de esos, muestra Solo lectura (verde). Esto da un resumen de un vistazo de lo que el rol de cada usuario realmente le permite hacer."
        },
        {
          "subEn": "Adding and editing users",
          "subEs": "Agregar y editar usuarios",
          "bodyEn": "The \"Add user\" button (and the row Edit button) opens the user dialog. Fields: Username (required when creating; read-only when editing), Full name (required), Email (required), Role (dropdown of existing roles, required), Status (Active / Invited / Inactive), Projects (comma-separated project IDs — leaving it empty grants access to all projects), and Password. On creation the password is required and acts as the initial password; when editing, leaving the password blank keeps the current one unchanged. Buttons are Cancel and Create user / Save changes. This is where you activate or deactivate a user, by setting Status to Active or Inactive.",
          "bodyEs": "El botón \"Agregar usuario\" (y el botón Editar de la fila) abre el diálogo de usuario. Campos: Usuario/username (obligatorio al crear; de solo lectura al editar), Nombre completo (obligatorio), Email (obligatorio), Rol (desplegable de los roles existentes, obligatorio), Estado (Activo / Invitado / Inactivo), Proyectos (IDs de proyecto separados por coma — dejarlo vacío da acceso a todos los proyectos) y Contraseña. Al crear, la contraseña es obligatoria y funciona como contraseña inicial; al editar, dejar la contraseña en blanco mantiene la actual sin cambios. Los botones son Cancelar y Crear usuario / Guardar cambios. Acá es donde activás o desactivás a un usuario, poniendo el Estado en Activo o Inactivo.",
          "itemsEn": [
            "Username (fixed after creation), Full name, Email",
            "Role (required) and Status (Active / Invited / Inactive)",
            "Projects: comma-separated IDs, or empty for all projects",
            "Password: required on create; blank on edit = keep current"
          ],
          "itemsEs": [
            "Usuario (fijo tras crear), Nombre completo, Email",
            "Rol (obligatorio) y Estado (Activo / Invitado / Inactivo)",
            "Proyectos: IDs separados por coma, o vacío para todos los proyectos",
            "Contraseña: obligatoria al crear; en blanco al editar = mantener la actual"
          ]
        },
        {
          "subEn": "Deleting users and roles",
          "subEs": "Eliminar usuarios y roles",
          "bodyEn": "Deleting a user or a role always opens a confirmation dialog before anything happens. For a user it warns that the account will be removed and the action cannot be undone. For a role it names the role and warns how many users currently have it assigned, and that the action cannot be undone; if that role was being used as the table filter, the filter is cleared afterward. The confirm button shows \"Deleting…\" while it works, and if the deletion fails the dialog stays open with an error message.",
          "bodyEs": "Eliminar un usuario o un rol siempre abre un diálogo de confirmación antes de que pase nada. Para un usuario advierte que la cuenta se eliminará y que la acción no se puede deshacer. Para un rol nombra el rol y advierte cuántos usuarios lo tienen asignado actualmente, y que la acción no se puede deshacer; si ese rol se estaba usando como filtro de la tabla, el filtro se limpia después. El botón de confirmar muestra \"Eliminando…\" mientras trabaja, y si la eliminación falla el diálogo permanece abierto con un mensaje de error."
        },
        {
          "subEn": "Permission matrix (RBAC)",
          "subEs": "Matriz de permisos (RBAC)",
          "bodyEn": "The \"Permission matrix by role\" section is a grid with one row per permission and one column per role. Each cell is a toggle: a green check means the permission is granted, a grey dash means it is not. Clicking a cell flips it and saves immediately; the change applies at once to every user with that role, and each user's access-level chip updates to stay in sync. A legend below explains Granted / Not granted and notes that changes take effect immediately for all users of the role. Each row shows a friendly label plus the technical permission key.",
          "bodyEs": "La sección \"Matriz de permisos por rol\" es una grilla con una fila por permiso y una columna por rol. Cada celda es un interruptor: un tilde verde significa que el permiso está otorgado, un guion gris significa que no. Al hacer clic en una celda se invierte y se guarda de inmediato; el cambio se aplica al instante a cada usuario con ese rol, y el chip de nivel de acceso de cada usuario se actualiza para mantenerse en sync. Una leyenda debajo explica Permitido / No permitido y aclara que los cambios se aplican de inmediato a todos los usuarios del rol. Cada fila muestra una etiqueta legible más la clave técnica del permiso.",
          "itemsEn": [
            "Rows = permissions, columns = roles; each cell is a grant toggle",
            "Green check = granted, grey dash = not granted",
            "Toggling saves instantly and applies to all users of that role",
            "Legend: Granted / Not granted"
          ],
          "itemsEs": [
            "Filas = permisos, columnas = roles; cada celda es un interruptor de permiso",
            "Tilde verde = permitido, guion gris = no permitido",
            "Al alternar se guarda al instante y aplica a todos los usuarios del rol",
            "Leyenda: Permitido / No permitido"
          ]
        },
        {
          "subEn": "The permission catalog (what each permission grants)",
          "subEs": "El catálogo de permisos (qué otorga cada permiso)",
          "bodyEn": "Seven permissions make up the matrix. Each one gates a concrete capability across the product.",
          "bodyEs": "Siete permisos componen la matriz. Cada uno habilita una capacidad concreta en el producto.",
          "itemsEn": [
            "View model / Canvas (model.view) — open and view models and the canvas",
            "Create / edit tables (model.edit) — create and edit tables and columns",
            "Approve / reject requests (review.decide) — decide on change requests",
            "Publish to production (publish) — publish models to production",
            "Export DDL / metadata (export) — export DDL and metadata",
            "Edit Data Standards (standards.edit) — edit glossary, domains and standards",
            "Administer users and permissions (admin.manage) — full access to this Admin module"
          ],
          "itemsEs": [
            "Ver modelo / Canvas (model.view) — abrir y ver modelos y el canvas",
            "Crear / editar tablas (model.edit) — crear y editar tablas y columnas",
            "Aprobar / rechazar solicitudes (review.decide) — decidir sobre solicitudes de cambio",
            "Publicar a producción (publish) — publicar modelos a producción",
            "Exportar DDL / metadata (export) — exportar DDL y metadata",
            "Editar Data Standards (standards.edit) — editar glosario, dominios y estándares",
            "Administrar usuarios y permisos (admin.manage) — acceso total a este módulo de Administración"
          ]
        },
        {
          "subEn": "Audit trail",
          "subEs": "Auditoría (registro de acciones)",
          "bodyEn": "An audit trail of administrative actions is captured on the backend — each entry records who did it (actor), what happened (action), the affected item (target and its type), a timestamp, and extra details. A read endpoint to list recent audit entries exists in the application (with a configurable limit). Note, at the functional level, that the current Admin screen does not yet render an audit panel: the log is recorded and available via the API, but it is not surfaced as a visible section inside this UI.",
          "bodyEs": "En el backend se captura una auditoría de las acciones administrativas — cada entrada registra quién la hizo (actor), qué ocurrió (acción), el elemento afectado (objetivo y su tipo), una marca de tiempo y detalles adicionales. Existe en la aplicación un endpoint de lectura para listar las entradas recientes de auditoría (con un límite configurable). A nivel funcional, ten en cuenta que la pantalla de Administración actual todavía no muestra un panel de auditoría: el registro se guarda y está disponible por API, pero no se expone como una sección visible dentro de esta interfaz."
        }
      ]
    }
  },
  {
    "id": "workflow",
    "card": {
      "titleEn": "Review & Publish (Governance)",
      "titleEs": "Revisar y Publicar (Gobierno)",
      "blurbEn": "The approval workflow that takes a model change from a working draft, through reviewer approval, to the single production version.",
      "blurbEs": "El flujo de aprobación que lleva un cambio del modelo desde un borrador de trabajo, pasando por la aprobación del revisor, hasta la única versión en producción.",
      "bulletsEn": [
        "Create a new version by snapshotting production, or continue one of your drafts",
        "Send your working copy for approval with a title, description and one or more reviewers",
        "Review incoming requests: read the impact, diff and requester note before deciding",
        "Approve or reject as the assigned reviewer, or leave a comment on any request",
        "Withdraw a request in review, or reopen a rejected one, to go back to editing",
        "Track versions as In review, Approved/Production or Rejected — only one version is live in production"
      ],
      "bulletsEs": [
        "Crea una versión nueva tomando un snapshot de producción, o continúa uno de tus borradores",
        "Envía tu copia de trabajo a aprobación con título, descripción y uno o más revisores",
        "Revisa las solicitudes que llegan: mira el impacto, el diff y la nota del solicitante antes de decidir",
        "Aprueba o rechaza como revisor asignado, o deja un comentario en cualquier solicitud",
        "Retira una solicitud en revisión, o reabre una rechazada, para volver a editar",
        "Sigue las versiones como En revisión, Aprobada/Producción o Rechazada — solo una versión está viva en producción"
      ]
    },
    "deep": {
      "headingEn": "Review & Publish (Governance) — functional guide",
      "headingEs": "Revisar y Publicar (Gobierno) — guía funcional",
      "sections": [
        {
          "subEn": "Sessions and changesets: the basics",
          "subEs": "Sesiones y changesets: lo básico",
          "bodyEn": "An editing session is the state of the canvas while you work: it's opened in one of two modes — read-only (you're looking at production and can't change anything) or editing (you're mutating a working copy). A changeset is that working copy: a draft that layers your edits on top of the current production model without touching it until it's approved. Each changeset carries a version label, a title, its owner, a status, the assigned reviewers, their decisions and a comment thread; the actual edits live separately, so the diff and the 'effective' model are always computed from them. Everything below is about moving one changeset from draft to production.",
          "bodyEs": "Una sesión de edición es el estado del lienzo mientras trabajas: se abre en uno de dos modos — solo lectura (estás viendo producción y no puedes cambiar nada) o edición (estás modificando una copia de trabajo). Un changeset es esa copia de trabajo: un borrador que superpone tus cambios sobre el modelo de producción actual sin tocarlo hasta que se apruebe. Cada changeset lleva una etiqueta de versión, un título, su dueño, un estado, los revisores asignados, sus decisiones y un hilo de comentarios; los cambios en sí viven aparte, así que el diff y el modelo 'efectivo' siempre se calculan a partir de ellos. Todo lo de abajo trata de mover un changeset de borrador a producción.",
          "itemsEn": [
            "Read-only mode: view production or peek at a request without being able to edit",
            "Editing mode: a draft working copy you own, where changes are recorded",
            "One production version at a time; drafts and requests overlay it, never replace it silently"
          ],
          "itemsEs": [
            "Modo solo lectura: ver producción o espiar una solicitud sin poder editar",
            "Modo edición: una copia de trabajo (borrador) tuya, donde se registran los cambios",
            "Una sola versión en producción a la vez; los borradores y solicitudes la superponen, nunca la reemplazan en silencio"
          ]
        },
        {
          "subEn": "Create a new version (Open model)",
          "subEs": "Crear una versión nueva (Abrir modelo)",
          "bodyEn": "From Home you open the 'Open model' dialog, which asks how you want to work before entering the canvas. It offers three radio-card options and a Continue button (plus Cancel / Esc to close without navigating):",
          "bodyEs": "Desde el Inicio abres el diálogo 'Abrir modelo', que te pregunta cómo quieres trabajar antes de entrar al lienzo. Ofrece tres opciones tipo tarjeta con radio y un botón Continuar (más Cancelar / Esc para cerrar sin navegar):",
          "itemsEn": [
            "View production (read-only): explore the current production version; several people can view it at once without locking it. Disabled if nothing has been published yet.",
            "Create new version from production: takes a snapshot of production and creates a fresh draft (your own working copy) that opens in editing mode. On publish, production is overwritten (last to publish wins). Disabled until a production version exists.",
            "Continue a working version: pick one of your own drafts from the list (shown with its version label, title and owner) and resume editing where you left off. Disabled if you have no drafts in progress."
          ],
          "itemsEs": [
            "Ver producción (solo lectura): explora la versión de producción actual; varias personas pueden verla a la vez sin bloquearla. Deshabilitada si aún no se publicó nada.",
            "Crear versión nueva desde producción: toma un snapshot de producción y crea un borrador nuevo (tu propia copia de trabajo) que se abre en modo edición. Al publicar, producción se sobrescribe (gana el último en publicar). Deshabilitada hasta que exista una versión de producción.",
            "Continuar una versión de trabajo: elige uno de tus borradores de la lista (se muestra con su etiqueta de versión, título y dueño) y retoma la edición donde la dejaste. Deshabilitada si no tienes borradores en curso."
          ]
        },
        {
          "subEn": "Send for approval (publish request)",
          "subEs": "Enviar a aprobación (solicitud de publicación)",
          "bodyEn": "When your working copy is ready, the green Publish button on the canvas toolbar opens the 'Publish — request approval' dialog. Here you turn a private draft into a request that reviewers can act on. You fill in a Title (short summary of the change) and an optional Description (what changed and why), then pick one or more Reviewers from toggle chips that show each person's avatar and name (at least one is required). 'Send for Approval' submits the working copy — its status becomes In review. If you opened read-only (no working copy), a hint tells you to open an editable version first and sending is disabled. After sending, the canvas drops to read-only production, because the submitted version is locked from further edits, and you're told the request was sent.",
          "bodyEs": "Cuando tu copia de trabajo está lista, el botón verde Publicar de la barra del lienzo abre el diálogo 'Publicar — solicitar aprobación'. Aquí conviertes un borrador privado en una solicitud sobre la que los revisores pueden actuar. Completas un Título (resumen corto del cambio) y una Descripción opcional (qué cambió y por qué), luego eliges uno o más Revisores desde chips que muestran el avatar y el nombre de cada persona (se requiere al menos uno). 'Enviar a aprobación' envía la copia de trabajo — su estado pasa a En revisión. Si abriste en solo lectura (sin copia de trabajo), un aviso te dice que primero abras una versión editable y el envío queda deshabilitado. Tras enviar, el lienzo baja a producción en solo lectura, porque la versión enviada queda bloqueada para más ediciones, y se te avisa que la solicitud fue enviada.",
          "itemsEn": [
            "Title, Description (optional), and Reviewers (1 or more, chosen as chips)",
            "At least one reviewer is required; 'Send for Approval' stays disabled until then",
            "A note reminds you: assigned reviewers must approve before it can be published"
          ],
          "itemsEs": [
            "Título, Descripción (opcional) y Revisores (1 o más, elegidos como chips)",
            "Se requiere al menos un revisor; 'Enviar a aprobación' queda deshabilitado hasta entonces",
            "Un aviso te recuerda: los revisores asignados deben aprobar antes de poder publicar"
          ]
        },
        {
          "subEn": "The Requests screen: list and filters",
          "subEs": "La pantalla de Solicitudes: lista y filtros",
          "bodyEn": "'Requests · review & approval' is a cross-project inbox with two panels. The left panel filters and lists requests; the right panel shows the open request's detail. Two dropdown filters sit on top: From (the requester — Anyone or a specific person) and Reviewer (defaults to 'Me', the current user, and can be set to Anyone or another person). A count shows '{N} requests'. Each request appears as a card with: a status badge (In review / Approved / Rejected / Editing), an 'Assigned to you' tag when you're a reviewer, a 'snap · {version}' label, the requester → reviewer avatars and names, and a project chip. The list excludes drafts and the current production version, and is sorted newest first. The first request is auto-selected so the detail is always populated (except right after a withdraw/reopen, to avoid confusion).",
          "bodyEs": "'Solicitudes · revisión y aprobación' es una bandeja de entrada entre proyectos con dos paneles. El panel izquierdo filtra y lista las solicitudes; el derecho muestra el detalle de la solicitud abierta. Arriba hay dos filtros desplegables: De (el solicitante — Cualquiera o una persona específica) y Revisor (por defecto 'Yo', el usuario actual, y puede fijarse en Cualquiera u otra persona). Un contador muestra '{N} solicitudes'. Cada solicitud aparece como una tarjeta con: una insignia de estado (En revisión / Aprobada / Rechazada / Editando), una etiqueta 'Asignada a ti' cuando eres revisor, una etiqueta 'snap · {versión}', los avatares y nombres solicitante → revisor, y un chip de proyecto. La lista excluye los borradores y la versión de producción actual, y se ordena de más nueva a más antigua. La primera solicitud se selecciona automáticamente para que el detalle siempre esté poblado (excepto justo tras un retiro/reapertura, para evitar confusión)."
        },
        {
          "subEn": "Reviewing a request: the detail panel",
          "subEs": "Revisar una solicitud: el panel de detalle",
          "bodyEn": "Opening a request shows its full context so you can decide with confidence. The header has the request title and status badge, plus a meta line: From {owner} · snapshot of {version} · {date} · Reviewer {names}. Below sit impact chips (tables touched, columns touched, projects affected) and a legend counting added / modified / deleted entities. If any entity was changed in production after this version edited it, a conflict alert warns that approving will overwrite those production changes. The requester's note appears as a card (author, 'requester' role, date, text). Then 'Changes · N' lists every touched entity as a diff row: a +/~/− sign, the entity name (struck through when deleted) with its verb (added/modified/deleted), a colored pill, a 'changed in production' flag on conflicting rows, and an entity-type label (Table, Column, Relationship, View, Parent Domain, UDP term). Large diffs paginate with a 'Show N more' button. At the bottom is the reviewer comment thread and an input to add your own.",
          "bodyEs": "Abrir una solicitud muestra todo su contexto para que decidas con confianza. El encabezado tiene el título y la insignia de estado de la solicitud, más una línea de metadatos: De {dueño} · snapshot de {versión} · {fecha} · Revisor {nombres}. Debajo hay chips de impacto (tablas tocadas, columnas tocadas, proyectos afectados) y una leyenda que cuenta entidades agregadas / modificadas / eliminadas. Si alguna entidad cambió en producción después de que esta versión la editó, una alerta de conflicto advierte que aprobar sobrescribirá esos cambios de producción. La nota del solicitante aparece como tarjeta (autor, rol 'solicitante', fecha, texto). Luego 'Cambios · N' lista cada entidad tocada como una fila de diff: un signo +/~/−, el nombre de la entidad (tachado si se eliminó) con su verbo (agregada/modificada/eliminada), una píldora de color, una marca 'cambió en producción' en las filas en conflicto, y una etiqueta de tipo (Tabla, Columna, Relación, Vista, Dominio Padre, término UDP). Los diffs grandes se paginan con un botón 'Mostrar N más'. Abajo está el hilo de comentarios del revisor y un campo para agregar el tuyo."
        },
        {
          "subEn": "Approve or reject (the reviewer's role)",
          "subEs": "Aprobar o rechazar (el rol del revisor)",
          "bodyEn": "Approve and Reject are only active for the assigned reviewer, only while the request is In review, and only if you haven't already voted. In any other case both buttons are disabled and a lock note explains why — e.g. 'Only the assigned reviewer {names} can approve or reject this request. You can still leave a comment.', 'You already recorded your decision on this request.', or 'This request is {status}.'. Approving or rejecting records your decision instantly and toasts the result. The outcome rule: if any reviewer rejects, the request becomes Rejected; if there are reviewers and all of them approve, it becomes Approved and is applied to production; while approvals are still missing, it stays In review with your decision saved. If you're not the assigned reviewer, the server refuses the action and you get a clear message.",
          "bodyEs": "Aprobar y Rechazar solo están activos para el revisor asignado, solo mientras la solicitud está En revisión, y solo si aún no votaste. En cualquier otro caso ambos botones quedan deshabilitados y una nota con candado explica por qué — p. ej. 'Solo el revisor asignado {nombres} puede aprobar o rechazar esta solicitud. Igual puedes dejar un comentario.', 'Ya registraste tu decisión sobre esta solicitud.', o 'Esta solicitud está {estado}.'. Aprobar o rechazar registra tu decisión al instante y muestra el resultado. La regla del desenlace: si algún revisor rechaza, la solicitud pasa a Rechazada; si hay revisores y todos aprueban, pasa a Aprobada y se aplica a producción; mientras falten aprobaciones, sigue En revisión con tu decisión guardada. Si no eres el revisor asignado, el servidor rechaza la acción y recibes un mensaje claro.",
          "itemsEn": [
            "Approve: records your approval; when the last reviewer approves, it publishes to production",
            "Reject: marks the request Rejected (the version is never deleted)",
            "Both disabled with an explanatory note when you can't act (not assigned, already voted, or not in review)"
          ],
          "itemsEs": [
            "Aprobar: registra tu aprobación; cuando el último revisor aprueba, se publica a producción",
            "Rechazar: marca la solicitud como Rechazada (la versión nunca se elimina)",
            "Ambos deshabilitados con una nota explicativa cuando no puedes actuar (no asignado, ya votaste, o no está en revisión)"
          ]
        },
        {
          "subEn": "Comment on a request",
          "subEs": "Comentar una solicitud",
          "bodyEn": "Anyone can comment, including people who aren't assigned reviewers — this is how you ask questions or give context without deciding. The 'Comment' action focuses the input at the bottom of the detail. Type your message and press Enter or Send; it's added to the thread with your avatar, name, a 'reviewer' tag if you're one of the assigned reviewers, and the date. Sending is disabled while empty or in flight.",
          "bodyEs": "Cualquiera puede comentar, incluso quienes no son revisores asignados — así es como haces preguntas o das contexto sin decidir. La acción 'Comentar' enfoca el campo al pie del detalle. Escribe tu mensaje y presiona Enter o Enviar; se agrega al hilo con tu avatar, nombre, una etiqueta 'revisor' si eres uno de los asignados, y la fecha. El envío queda deshabilitado si está vacío o mientras se envía."
        },
        {
          "subEn": "Publishing to production (approval applies the change)",
          "subEs": "Publicar a producción (la aprobación aplica el cambio)",
          "bodyEn": "There's no separate manual 'publish to production' button in review: publication happens automatically the moment the last required reviewer approves. At that point the changeset is applied on top of production and stamped as applied — that stamp is what makes it the live production version. There is always at most one production version: the most recently approved-and-applied changeset. Because a snapshot edits a copy of production, publishing overwrites whatever is in production (last to publish wins); the conflict flags in the diff are the warning that some entities changed in production since the snapshot and will be overwritten.",
          "bodyEs": "No hay un botón manual aparte de 'publicar a producción' en la revisión: la publicación ocurre automáticamente en el momento en que el último revisor requerido aprueba. En ese punto el changeset se aplica sobre producción y se marca como aplicado — esa marca es lo que lo convierte en la versión viva de producción. Siempre hay como máximo una versión en producción: el changeset aprobado-y-aplicado más reciente. Como un snapshot edita una copia de producción, publicar sobrescribe lo que haya en producción (gana el último en publicar); las marcas de conflicto en el diff son el aviso de que algunas entidades cambiaron en producción desde el snapshot y serán sobrescritas."
        },
        {
          "subEn": "Version states: Editing, In review, Approved/Production, Rejected",
          "subEs": "Estados de versión: Editando, En revisión, Aprobada/Producción, Rechazada",
          "bodyEn": "A version's badge reflects its lifecycle: Editing (draft — a private working copy, not yet a request), In review (submitted — waiting on reviewers), Approved (all reviewers approved; once applied it is the production version), and Rejected (a reviewer rejected it). The Requests inbox lists submitted, approved and rejected versions but hides plain drafts and the current production row. Historical versions are the previously approved ones that were replaced when a newer version was published — production always keeps just the single latest applied version live.",
          "bodyEs": "La insignia de una versión refleja su ciclo de vida: Editando (borrador — una copia de trabajo privada, aún no es solicitud), En revisión (enviada — esperando a los revisores), Aprobada (todos los revisores aprobaron; una vez aplicada es la versión de producción), y Rechazada (un revisor la rechazó). La bandeja de Solicitudes lista las versiones enviadas, aprobadas y rechazadas, pero oculta los borradores simples y la fila de producción actual. Las versiones históricas son las aprobadas previamente que fueron reemplazadas cuando se publicó una versión más nueva — producción siempre mantiene viva solo la última versión aplicada."
        },
        {
          "subEn": "Withdraw a request in review",
          "subEs": "Retirar una solicitud en revisión",
          "bodyEn": "While a request is In review, its owner (only the owner) can Withdraw it to go back to editing. A confirmation dialog explains that the request returns to draft so you can keep editing the version, that any reviewer decisions recorded so far are discarded, and that you can send it for approval again later. After withdrawing, the version leaves the review queue and the panel shows an empty state ('The version is a draft again') with a 'Continue editing in canvas' button; you can also find it later under Open model → Continue a working version. If a reviewer decided at the same moment, the withdraw is safely refused and the panel refreshes.",
          "bodyEs": "Mientras una solicitud está En revisión, su dueño (solo el dueño) puede Retirarla para volver a editar. Un diálogo de confirmación explica que la solicitud vuelve a borrador para que sigas editando la versión, que cualquier decisión de revisor registrada hasta ahora se descarta, y que puedes enviarla a aprobación de nuevo más tarde. Tras retirarla, la versión sale de la cola de revisión y el panel muestra un estado vacío ('La versión volvió a borrador') con un botón 'Continuar editando en el lienzo'; también puedes encontrarla luego en Abrir modelo → Continuar una versión de trabajo. Si un revisor decidió en ese mismo instante, el retiro se rechaza de forma segura y el panel se actualiza."
        },
        {
          "subEn": "Reopen a rejected request",
          "subEs": "Reabrir una solicitud rechazada",
          "bodyEn": "A reject never deletes the version. When a request is Rejected, its owner (only the owner) sees 'Reopen as draft'. A confirmation dialog explains that the rejected request goes back to draft so you can fix the version and send it for approval again, that the recorded rejection is cleared, and that the version is never deleted. After reopening you land on the same 'draft again' empty state with the option to continue editing in the canvas.",
          "bodyEs": "Un rechazo nunca elimina la versión. Cuando una solicitud está Rechazada, su dueño (solo el dueño) ve 'Reabrir como borrador'. Un diálogo de confirmación explica que la solicitud rechazada vuelve a borrador para que corrijas la versión y la envíes a aprobación de nuevo, que el rechazo registrado se limpia, y que la versión nunca se elimina. Tras reabrir aterrizas en el mismo estado vacío 'volvió a borrador' con la opción de continuar editando en el lienzo."
        },
        {
          "subEn": "Opening a request in the canvas (edit vs. read-only)",
          "subEs": "Abrir una solicitud en el lienzo (editar vs. solo lectura)",
          "bodyEn": "From the detail header you can open the request in the canvas. The button adapts to who you are and the request's state: if it's your own draft, it reads 'Open in canvas' and opens your working copy for editing; in every other case (someone else's, or a submitted/decided request) it reads 'View in canvas' and opens read-only over that request's content — you see exactly what was submitted but can't mutate it or re-publish. A tooltip spells this out, and reminds that editing only comes back through Withdraw or Reopen. This read-only guard is deliberate: it prevents accidentally editing (or re-submitting over) a version that's already under review.",
          "bodyEs": "Desde el encabezado del detalle puedes abrir la solicitud en el lienzo. El botón se adapta a quién eres y al estado de la solicitud: si es tu propio borrador, dice 'Abrir en el lienzo' y abre tu copia de trabajo para editar; en cualquier otro caso (de otra persona, o una solicitud enviada/decidida) dice 'Ver en el lienzo' y abre en solo lectura sobre el contenido de esa solicitud — ves exactamente lo que se envió pero no puedes modificarlo ni republicarlo. Un tooltip lo aclara, y recuerda que la edición solo vuelve mediante Retirar o Reabrir. Este candado de solo lectura es intencional: evita editar por accidente (o reenviar sobre) una versión que ya está en revisión."
        },
        {
          "subEn": "Empty, loading and error states",
          "subEs": "Estados vacíos, de carga y de error",
          "bodyEn": "The screen guides you when there's nothing to show. With no selection, the detail panel shows 'Select a request to review'. While a request loads, it shows a skeleton placeholder. If the request can't be found it shows 'Request not found'. The list itself shows 'Loading requests…' while fetching and 'No requests match these filters.' when the filters exclude everything. Failures (loading, deciding, withdrawing, reopening, commenting) surface as toast messages, and permission errors are rewritten into plain language.",
          "bodyEs": "La pantalla te guía cuando no hay nada que mostrar. Sin selección, el panel de detalle muestra 'Selecciona una solicitud para revisar'. Mientras una solicitud carga, muestra un esqueleto de marcador. Si la solicitud no se encuentra muestra 'Solicitud no encontrada'. La lista misma muestra 'Cargando solicitudes…' mientras trae los datos y 'Ninguna solicitud coincide con estos filtros.' cuando los filtros excluyen todo. Los fallos (al cargar, decidir, retirar, reabrir, comentar) aparecen como mensajes tipo toast, y los errores de permiso se reescriben en lenguaje sencillo."
        }
      ]
    }
  }
];
