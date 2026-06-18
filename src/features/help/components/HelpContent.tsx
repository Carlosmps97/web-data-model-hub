'use client';

// Help Center content + shared renderer.
//
// The articles are written against the *current* product (project-centric
// "Aurora"): Project → Modelo (nivel) → Dominio (vertical) → Tabla → Columnas +
// Vistas. They are organized by user ACTION, not by source module. Keep the
// article ids referenced as "popular" stable: a_scope, a_fromsql, a_views,
// a_hier, a_connect (see `docs/page.tsx` and `HelpDrawer.tsx`).

import React, { useMemo, useState } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';

export interface Cat { id: string; icon: IconName; title: string; desc: string; color: string }

export type Block =
  | { type: 'p' | 'h' | 'tip' | 'note' | 'warn'; t: string }
  | { type: 'steps'; items: string[] };

export interface Article { id: string; cat: string; title: string; read: number; summary: string; blocks: Block[] }

export const CATS: Cat[] = [
  { id: 'start', icon: 'bolt', title: 'Primeros pasos', desc: 'La jerarquía de la plataforma, tu primer proyecto y un recorrido por la interfaz.', color: '#4f46e5' },
  { id: 'canvas', icon: 'columns', title: 'Trabajar en el canvas', desc: 'Navega, conecta tablas y organiza el diagrama entidad-relación.', color: '#0d9488' },
  { id: 'structure', icon: 'folder', title: 'Modelos, dominios y scope', desc: 'Define capas (RDV·UDV·DDV), productos de datos y el alcance de edición.', color: '#7c3aed' },
  { id: 'tables', icon: 'database', title: 'Crear y poblar tablas', desc: 'A mano, heredando de tablas existentes, desde DBML o importando Excel.', color: '#0e7490' },
  { id: 'views', icon: 'eye', title: 'Vistas y SQL por rol', desc: 'Proyecciones por rol con enmascarado, filtros y preview en vivo.', color: '#b45309' },
  { id: 'export', icon: 'download', title: 'Exportar e interoperar', desc: 'Genera DDL por alcance y haz ida y vuelta con DBML.', color: '#15a34a' },
  { id: 'center', icon: 'layers', title: 'Model Center y gobierno', desc: 'El catálogo único: busca y vigila la salud del modelo.', color: '#4338ca' },
  { id: 'account', icon: 'users', title: 'Cuenta, usuarios y permisos', desc: 'Inicio de sesión, roles y acceso por proyecto.', color: '#475569' },
  { id: 'ai', icon: 'sparkles', title: 'Asistente IA', desc: 'El copiloto de modelado y su estado actual.', color: '#be123c' },
];

const P = (t: string): Block => ({ type: 'p', t });
const H = (t: string): Block => ({ type: 'h', t });
const TIP = (t: string): Block => ({ type: 'tip', t });
const NOTE = (t: string): Block => ({ type: 'note', t });
const WARN = (t: string): Block => ({ type: 'warn', t });
const STEPS = (items: string[]): Block => ({ type: 'steps', items });

export const ARTICLES: Article[] = [
  // ───────────────────────── Primeros pasos ─────────────────────────
  {
    id: 'a_hier', cat: 'start', title: 'Cómo se organiza la plataforma', read: 4,
    summary: 'La jerarquía Proyecto → Modelo (nivel) → Dominio → Tabla → Columnas + Vistas.',
    blocks: [
      P('Toda la información en Data Model Hub cuelga de una jerarquía de cuatro niveles que refleja cómo trabaja una organización con datos. Entenderla es lo único que necesitas antes de empezar.'),
      H('Los cuatro niveles'),
      STEPS([
        'Proyecto — un repositorio de datos completo (por ejemplo “Lakehouse”). Es la unidad de acceso y tiene un único canvas.',
        'Modelo (nivel / capa) — las capas del proyecto, como RDV, UDV y DDV. Su orden define las bandas de izquierda a derecha en el canvas y qué relaciones se consideran “entre capas”.',
        'Dominio — un producto de datos (Finanzas, Clientes, Riesgo…). Es VERTICAL: el mismo dominio aparece en varias capas a la vez.',
        'Tabla — vive en exactamente una capa y, opcionalmente, un dominio. Contiene columnas y puede embeber vistas SQL por rol.',
      ]),
      P('Dicho de forma corta: una tabla es la intersección de un Modelo (en qué capa está) y un Dominio (a qué producto de datos pertenece).'),
      H('Por qué el dominio es “vertical”'),
      P('Un dominio como Finanzas no es una carpeta dentro de una capa: atraviesa RDV, UDV y DDV. Por eso un dominio declara en qué capas vive, y sus tablas se reparten por esas capas. Esto te deja ver “todo Finanzas de punta a punta” o “toda la capa UDV” según convenga.'),
      H('Engines y color'),
      P('Cada proyecto declara uno o más engines de base de datos (PostgreSQL, Databricks SQL, SQL Server, MySQL o Cosmos DB) y cada Modelo (nivel) puede fijar el suyo. El engine determina el schema por defecto y cómo se genera el DDL. Los dominios y los modelos llevan su propio color, que las tablas heredan para identificarse de un vistazo.'),
      NOTE('No existe el concepto de “un diagrama por modelo”: hay un único canvas por proyecto, y lo que ves en él se controla con el Scope (alcance de edición).'),
    ],
  },
  {
    id: 'a_firstproj', cat: 'start', title: 'Crea tu primer proyecto y abre el canvas', read: 3,
    summary: 'De cero a un canvas listo para modelar.',
    blocks: [
      P('Crear estructura lleva menos de un minuto. Necesitas rol de administrador para crear proyectos; cualquier usuario con permiso de edición puede modelar dentro.'),
      H('1 · Crea el proyecto'),
      STEPS([
        'Ve a Projects en el rail izquierdo.',
        'Pulsa “Nuevo proyecto”, ponle nombre y una descripción breve.',
        'Al crearlo entras directo al hub del proyecto.',
      ]),
      H('2 · Define modelos y dominios'),
      STEPS([
        'En la sección “Modelos (niveles)” pulsa “Nuevo modelo” y crea tus capas (p. ej. RDV, UDV, DDV) con su código, nombre completo y color.',
        'En “Dominios (productos de datos)” pulsa “Nuevo dominio” y define owner, steward, sensibilidad y en qué capas vive.',
      ]),
      H('3 · Abre el canvas'),
      STEPS([
        'Pulsa “Abrir canvas” arriba a la derecha para entrar con todo el modelo a la vista.',
        'O haz clic en una tarjeta de Modelo o en una fila de Dominio: el editor arranca con ese Scope ya aplicado.',
      ]),
      TIP('Entrar por un Modelo o un Dominio fija el alcance inicial. Es la forma más cómoda de trabajar enfocado en una sola capa o en un solo producto de datos.'),
      NOTE('Puedes crear modelos y dominios también más tarde; las tablas que se queden sin capa o sin dominio se marcan como “sin asignar”.'),
    ],
  },
  {
    id: 'a_nav', cat: 'start', title: 'Recorrido por la interfaz', read: 3,
    summary: 'El rail, las migas de pan, el guardado automático y la ayuda rápida.',
    blocks: [
      P('La aplicación tiene una sola barra de navegación: un rail estrecho de iconos a la izquierda, presente en todas las pantallas.'),
      H('El rail (barra lateral)'),
      STEPS([
        'Model Center — el catálogo de todos los proyectos (es también la pantalla de inicio).',
        'Projects — la lista de proyectos y el acceso a cada hub.',
        'Documentación — este centro de ayuda.',
        'Usuarios — gestión de cuentas y permisos (solo administradores).',
        'Abajo: el botón “?” abre la Ayuda rápida sin salir de la pantalla, y el avatar permite cerrar sesión.',
      ]),
      H('Migas de pan y acciones'),
      P('La barra superior de cada pantalla muestra las migas de pan (por ejemplo Projects › Lakehouse › Finanzas (vertical)) y, a la derecha, las acciones de esa pantalla. En el editor incluye el control de Scope, el cambio List/Canvas, Export y el indicador de guardado.'),
      H('Guardado automático'),
      P('En el editor no hay botón “Guardar”: los cambios en tablas y relaciones se guardan solos poco después de cada edición. El indicador de la barra superior pasa de “Saving…” a “Saved” cuando termina.'),
      NOTE('La posición de los nodos en el canvas es por sesión: si reorganizas y vuelves a entrar, usa Auto-organizar para recomponer el layout. Lo que sí se conserva son las tablas, columnas, relaciones y vistas.'),
    ],
  },

  // ───────────────────────── Canvas ─────────────────────────
  {
    id: 'a_move', cat: 'canvas', title: 'Navegar el lienzo: pan, zoom y enfoque', read: 2,
    summary: 'Moverte por el diagrama y ajustarlo a pantalla.',
    blocks: [
      P('El canvas es un lienzo infinito con un dock de herramientas abajo al centro y un minimapa abajo a la derecha.'),
      STEPS([
        'Arrastra el fondo para desplazarte (pan). Arrastra la cabecera de una tabla para moverla.',
        'Usa la rueda del ratón para hacer zoom hacia el cursor.',
        'En el dock: “Ajustar a pantalla” encuadra todo lo visible; los botones − / + y el porcentaje controlan el zoom con precisión.',
        'El minimapa muestra el conjunto completo y resalta la tabla seleccionada.',
      ]),
      TIP('“Ajustar a pantalla” recalcula el encuadre solo con las tablas dentro del Scope actual; es la forma rápida de reorientarte tras cambiar de alcance.'),
    ],
  },
  {
    id: 'a_connect', cat: 'canvas', title: 'Crear relaciones (entidad-relación)', read: 4,
    summary: 'El modo Conectar, la cardinalidad y las claves foráneas.',
    blocks: [
      P('Las relaciones se dibujan columna a columna con el modo Conectar. Crear una relación marca automáticamente la columna origen como clave foránea (FK).'),
      H('Conectar dos columnas'),
      STEPS([
        'En el dock, activa la herramienta Conectar (el icono de enlace).',
        'Elige la cardinalidad en la tarjeta “Modo conectar” que aparece: 1:1, 1:N o N:N (por defecto 1:N).',
        'Haz clic en la columna origen y luego en una columna de OTRA tabla como destino.',
        'La relación se crea, la columna origen pasa a FK y el wire “fluye” en color teal al pasar el cursor o seleccionar la tabla.',
      ]),
      H('Cómo se dibujan las puntas'),
      P('Las puntas de pata de gallo (crow’s foot) se derivan de la cardinalidad y de si la columna admite nulos; no las defines a mano. Al enfocar una tabla, sus columnas relacionadas se resaltan y las demás relaciones se atenúan para que sigas el vínculo con la vista.'),
      TIP('¿Te equivocaste de columna? Selecciona la tabla y abre la pestaña Links del Inspector para revisar cada relación; elimina la tabla o ajusta sus columnas para rehacer el vínculo.'),
      NOTE('Conectar columnas de la misma tabla no está permitido: el destino debe estar en otra tabla.'),
    ],
  },
  {
    id: 'a_crosslayer', cat: 'canvas', title: 'Relaciones entre capas: avisos y estilos', read: 3,
    summary: 'Qué pasa cuando una relación salta de RDV a UDV… o se salta capas.',
    blocks: [
      P('Como cada Modelo (nivel) tiene un orden, la plataforma sabe cuándo una relación cruza capas y cuánto las separa. Lo refleja con color y un aviso.'),
      H('Adyacente vs. salto'),
      STEPS([
        'Dentro de la misma capa — wire neutro, sin etiqueta.',
        'Entre capas adyacentes (p. ej. RDV → UDV) — se permite, se muestra una etiqueta “A→B” en teal y un aviso de confirmación.',
        'Saltando capas no adyacentes (p. ej. RDV → DDV directo) — el wire se vuelve ámbar y discontinuo, con un “!” y la etiqueta de las capas; aparece un aviso para que lo revises.',
      ]),
      WARN('Un salto de capas no adyacentes no está prohibido, pero suele indicar que falta una tabla intermedia. Revísalo antes de darlo por bueno.'),
      NOTE('La adyacencia depende del orden de tus Modelos (niveles). Si reordenas las capas cambia qué se considera “salto”.'),
    ],
  },
  {
    id: 'a_arrange', cat: 'canvas', title: 'Auto-organizar, recolorear y la vista de lista', read: 3,
    summary: 'Layouts automáticos, el menú de engranaje y List/Canvas.',
    blocks: [
      P('Cuando el diagrama crece, el dock ofrece tres layouts automáticos y cada tabla tiene un menú rápido en su engranaje.'),
      H('Auto-organizar'),
      STEPS([
        'Por modelo — bandas por nivel, en su orden (izquierda a derecha). Ideal para leer el flujo entre capas.',
        'Snowflake — disposición radial alrededor de la tabla central.',
        'Compacto — una grilla ordenada con el mínimo espacio.',
      ]),
      H('Menú de engranaje de la tabla'),
      STEPS([
        'Editar tabla — abre el editor completo.',
        'Color de cabecera — elige entre la paleta para distinguirla (sobrescribe el color heredado del dominio).',
        'Eliminar tabla — la quita junto con sus relaciones (con confirmación).',
      ]),
      H('Lista en lugar de canvas'),
      P('El conmutador List/Canvas de la barra superior cambia el lienzo por una grilla de tarjetas con las primeras columnas de cada tabla — útil para revisar muchas tablas de un vistazo. El rail de tablas y el Inspector se mantienen en ambos modos.'),
      TIP('Tras un Auto-organizar, pulsa “Ajustar a pantalla” para encuadrar el nuevo layout.'),
    ],
  },

  // ───────────────────────── Estructura: modelos, dominios, scope ─────────────────────────
  {
    id: 'a_levels', cat: 'structure', title: 'Crear y administrar Modelos (niveles)', read: 3,
    summary: 'Las capas del proyecto: RDV·UDV·DDV o las que tú definas.',
    blocks: [
      P('Un Modelo (nivel) es una capa agnóstica del proyecto: una zona, etapa o nivel de tu arquitectura. Se gestionan desde el hub del proyecto.'),
      STEPS([
        'Abre el proyecto y ve a la sección “Modelos (niveles)”.',
        'Pulsa “Nuevo modelo”.',
        'Define el Código (corto, p. ej. RDV), el Nombre completo (p. ej. Raw Data Vault), una descripción y un color.',
        'Guarda: el modelo aparece como tarjeta con su recuento de tablas y dominios.',
      ]),
      P('El orden en que creas los modelos define su posición de izquierda a derecha en el canvas y la adyacencia que se usa para los avisos entre capas.'),
      TIP('Haz clic en la tarjeta de un modelo para abrir el canvas filtrado a esa capa (todas sus tablas, de todos los dominios).'),
      WARN('Eliminar un modelo no borra sus tablas: quedan “sin asignar” hasta que les des otra capa.'),
    ],
  },
  {
    id: 'a_domains', cat: 'structure', title: 'Crear y administrar Dominios (productos de datos)', read: 4,
    summary: 'Owners, stewards, sensibilidad, capas y subdominios.',
    blocks: [
      P('Un Dominio es un producto de datos vertical, con responsables y metadatos de gobierno. Se gestiona a nivel de proyecto y abarca varias capas a la vez.'),
      H('Crear un dominio'),
      STEPS([
        'En el hub del proyecto, sección “Dominios”, pulsa “Nuevo dominio”.',
        'Define nombre y color.',
        'Asigna Owner y Steward (responsables del producto de datos).',
        'Elige la Sensibilidad: Public, Internal, Confidential, Restricted o PII.',
        'Marca las “Capas donde vive” (los modelos que atraviesa).',
        'Añade Subdominios (etiquetas libres) que luego podrás seleccionar en cada tabla.',
      ]),
      H('Para qué sirven los metadatos'),
      P('La sensibilidad ayuda a priorizar el enmascarado en las vistas y se resalta en el catálogo. Owner y Steward aparecen en el Inspector de cada tabla del dominio y en la grilla del Model Center. El color del dominio se hereda como color de cabecera de sus tablas.'),
      TIP('Haz clic en una fila de dominio en el hub para abrir el canvas con ese dominio vertical ya enfocado.'),
      NOTE('Necesitas crear al menos un Modelo (nivel) antes de poder indicar en qué capas vive un dominio.'),
    ],
  },
  {
    id: 'a_layers', cat: 'structure', title: 'Asignar capa, dominio y subdominio a una tabla', read: 3,
    summary: 'Dónde vive cada tabla y de dónde toma su color.',
    blocks: [
      P('Cada tabla pertenece a una capa (Modelo) y, opcionalmente, a un dominio y un subdominio. Lo defines al crear o editar la tabla.'),
      STEPS([
        'Abre el editor de la tabla (doble clic en el rail, o el engranaje → Editar tabla).',
        'Elige Modelo (capa) y Dominio en los desplegables.',
        'Selecciona un Subdominio: si el dominio tiene subdominios definidos, aparecen como lista; si no, puedes escribir uno libre.',
      ]),
      P('Al elegir dominio, la tabla toma su color de cabecera automáticamente, de modo que en el canvas distingues los productos de datos por color. El rail de tablas puede agruparse por Dominio o por Modelo con el conmutador de su cabecera.'),
      TIP('Agrupa por Modelo cuando revisas una capa de punta a punta, y por Dominio cuando trabajas un producto de datos completo.'),
    ],
  },
  {
    id: 'a_scope', cat: 'structure', title: 'Editar con seguridad usando el Scope', read: 5,
    summary: 'Limita qué ves y qué editas por jerarquía.',
    blocks: [
      P('El Scope (alcance de edición) es la red de seguridad del canvas: define qué tablas son visibles y editables. Trabaja siempre en el nivel más pequeño que necesites para no tocar por error otras capas o dominios.'),
      H('Presets rápidos'),
      STEPS([
        'Todo el modelo — todas las capas y todos los dominios.',
        '“<Modelo> completa” — todos los dominios de una capa (p. ej. UDV completa).',
        '“<Dominio> (vertical)” — un dominio en todas las capas donde vive.',
      ]),
      H('Alcance personalizado'),
      P('Bajo los presets hay dos columnas de casillas — Modelos y Dominios. Marca y desmarca para combinar a mano (por ejemplo RDV + UDV, solo Finanzas + Clientes). Siempre debe quedar al menos un modelo y un dominio seleccionados.'),
      H('Qué filtra el Scope'),
      STEPS([
        'Las tablas y relaciones visibles en el canvas y en el rail.',
        'Las fuentes ofrecidas al crear una tabla “Desde tablas existentes”.',
        'La capa y el dominio por defecto al importar Excel (cuando el alcance es único).',
        'La opción “Solo el scope actual” al exportar DDL.',
      ]),
      TIP('Si entras al editor desde una tarjeta de Modelo o una fila de Dominio, el Scope inicial ya viene aplicado a esa capa o ese producto de datos.'),
      NOTE('Las tablas sin capa o sin dominio solo aparecen cuando ese eje está completamente seleccionado, para que no se pierdan al filtrar.'),
    ],
  },

  // ───────────────────────── Tablas ─────────────────────────
  {
    id: 'a_tableeditor', cat: 'tables', title: 'Crear y editar tablas a mano', read: 4,
    summary: 'Nombre, schema, ubicación, columnas y claves.',
    blocks: [
      P('El editor de tabla es la vía directa para declarar una entidad y sus columnas. Lo abres desde “New → Nueva tabla”, con doble clic en una tabla del rail, o desde el engranaje del nodo.'),
      H('Cabecera de la tabla'),
      STEPS([
        'Nombre de tabla (físico) y Schema.',
        'Modelo (capa), Dominio y Subdominio — dónde vive y de qué color será.',
        'Definición — una frase de qué representa la tabla; se muestra en el pie del nodo y en el Inspector.',
      ]),
      H('Columnas y claves'),
      STEPS([
        'Pulsa “Añadir columna”. En cada fila defines nombre y tipo de dato.',
        'Marca las claves con los chips: PK (primaria), FK (foránea) o SK (surrogate / sustituta).',
        'El conmutador a la derecha de cada fila es Nullable (admite nulos); apágalo para NOT NULL.',
        'Usa el icono de papelera para quitar una columna.',
      ]),
      P('Los tipos de dato son libres pero se sugiere usar los canónicos (integer, bigint, varchar, decimal, timestamp, boolean, json, uuid…), que viajan limpios al DDL y a la importación.'),
      NOTE('Además de PK/FK/SK, existe la clave de partición (PT): aparece en columnas que llegan por importación, herencia o el agente, y el nodo muestra un indicador de particionado cuando la tabla tiene alguna.'),
      TIP('Renombrar una columna es seguro: su identificador interno es estable, así que las relaciones y vistas que la usan no se rompen.'),
    ],
  },
  {
    id: 'a_fromsql', cat: 'tables', title: 'Crear una tabla desde tablas existentes', read: 4,
    summary: 'Hereda columnas de hasta dos “padres” sin redeclararlas.',
    blocks: [
      P('Cuando una tabla deriva de otras, no hace falta volver a escribir sus columnas: las heredas y, si quieres, conservas el vínculo a las tablas padre.'),
      STEPS([
        'New → “Desde tablas existentes”.',
        'En la columna izquierda elige hasta 2 tablas fuente. Cambia entre “En scope” y “Todas”, y usa el buscador si hay muchas.',
        'En el centro marca las columnas a heredar. Tienes buscador entre todas las fuentes y un “Seleccionar todo” por tabla.',
        'Abajo define Nombre, Schema, Modelo y Dominio de la nueva tabla.',
        'Decide si activas “Mantener relación a las tablas padre” y pulsa “Crear tabla”.',
      ]),
      NOTE('Si dos fuentes tienen una columna con el mismo nombre, se hereda una sola vez (gana la primera). Las propiedades de clave y el tipo de cada columna se conservan.'),
      TIP('Con “Mantener relación a las tablas padre” activado, se crea una FK 1:N desde la columna heredada hacia la clave primaria de cada padre, así el linaje queda dibujado en el canvas.'),
    ],
  },
  {
    id: 'a_import', cat: 'tables', title: 'Importar desde DBML o Excel', read: 4,
    summary: 'Carga masiva: DBML reemplaza el canvas; Excel añade tablas.',
    blocks: [
      P('Para poblar rápido tienes dos entradas en el menú “New”, con comportamientos distintos: presta atención a cuál reemplaza y cuál añade.'),
      H('Escribir DBML'),
      STEPS([
        'New → “Escribir DBML”. El editor se abre con el DBML del canvas actual.',
        'Escribe o pega tablas en sintaxis DBML (cada columna con sus flags: pk, not null, ref: > tabla.columna).',
        'Pulsa “Aplicar DBML”.',
      ]),
      WARN('Aplicar DBML REEMPLAZA todo el canvas (tablas y relaciones) por lo que hayas escrito. Úsalo para reconstruir desde cero, no para añadir a lo existente.'),
      H('Importar Excel'),
      STEPS([
        'New → “Importar Excel” y suelta un archivo .xlsx o .xlsm.',
        'La plataforma lee el archivo y muestra una vista previa: cada hoja se convierte en una tabla con sus columnas y tipos.',
        'Revisa y pulsa “Importar N tablas”.',
      ]),
      NOTE('A diferencia de DBML, la importación de Excel AÑADE las tablas nuevas a las que ya existen. Cuando el Scope es una sola capa o un solo dominio, las hojas importadas heredan esa ubicación.'),
    ],
  },

  // ───────────────────────── Vistas ─────────────────────────
  {
    id: 'a_views', cat: 'views', title: 'Crear vistas por rol con SQL', read: 5,
    summary: 'Proyecciones de una tabla pensadas para un rol concreto.',
    blocks: [
      P('Una vista es una proyección SQL de una tabla, pensada para un rol (qué columnas ve y con qué filtros). Las vistas se embeben en la tabla, no aparecen en el diagrama ER, y se exportan junto con el DDL.'),
      H('Crear una vista'),
      STEPS([
        'Selecciona una tabla y abre la pestaña Views del Inspector (panel derecho).',
        'Pulsa “Nueva vista”.',
        'Define Nombre (p. ej. vw_…), Tipo (Business o Technical) y Rol (p. ej. Analista, Engineer).',
        'Escribe el SELECT: una expresión por línea. Pueden ser columnas simples o expresiones (CONCAT, CASE, sha256…). Usa los chips “Insertar columna” para añadirlas rápido.',
        'Escribe el WHERE: una condición por línea; se unen con AND.',
        'El preview muestra el CREATE VIEW resultante en vivo. Guarda cuando esté listo.',
      ]),
      H('Business vs. Technical'),
      P('El tipo es una etiqueta organizativa: las vistas de negocio describen proyecciones orientadas a consumo; las técnicas, transformaciones o staging. Puede haber más de una de cada tipo por tabla, y el Inspector las agrupa por tipo.'),
      TIP('Cada vista muestra en su tarjeta cuántas expresiones y filtros tiene, y cuántas columnas van “protegidas” (enmascaradas). Es un resumen rápido de su superficie de exposición.'),
    ],
  },
  {
    id: 'a_masking', cat: 'views', title: 'Enmascarar columnas sensibles y filtrar por rol', read: 4,
    summary: 'Hash, máscaras y condiciones para limitar el acceso a datos.',
    blocks: [
      P('Las vistas son la herramienta para exponer datos sin filtrar información sensible: enmascaras columnas en el SELECT y acotas filas en el WHERE.'),
      H('Enmascarar en el SELECT'),
      STEPS([
        'Sustituye la columna sensible por una expresión protegida, por ejemplo sha256(CAST(email AS varchar)) AS email_hash.',
        'También sirven md5(), regexp_replace() o funciones de máscara/crypt según tu engine.',
        'Mantén visibles solo las columnas que ese rol necesita.',
      ]),
      P('La plataforma detecta automáticamente las expresiones de enmascarado (sha256, md5, hash, regexp_replace, crypt, mask) y las cuenta como columnas “protegidas” en la tarjeta de la vista.'),
      H('Acotar filas en el WHERE'),
      P('Cada línea del WHERE es una condición y todas se combinan con AND. Por ejemplo status = \'paid\' en una línea y region = \'EU\' en otra restringen lo que ese rol puede consultar.'),
      TIP('Cruza la sensibilidad del dominio (PII, Restricted…) con las vistas: para un dominio PII, crea una vista “segura” por cada rol que deba acceder, enmascarando los identificadores personales.'),
      NOTE('Desde la pestaña Views puedes “Exportar DDL con vistas” para llevarte la tabla y todas sus vistas como CREATE VIEW.'),
    ],
  },

  // ───────────────────────── Exportar ─────────────────────────
  {
    id: 'a_export', cat: 'export', title: 'Exportar DDL (con o sin vistas)', read: 3,
    summary: 'Genera el SQL del modelo por todo o por alcance.',
    blocks: [
      P('Export convierte tus tablas en DDL listo para ejecutar: CREATE TABLE con sus columnas, NOT NULL y PRIMARY KEY, más un ALTER TABLE … ADD FOREIGN KEY por cada relación.'),
      STEPS([
        'Pulsa Export en la barra superior del editor.',
        'Activa “Solo el scope actual” para exportar únicamente las tablas dentro de tu alcance (aparece cuando estás filtrando una parte del modelo).',
        'Activa “Incluir vistas” para añadir un CREATE VIEW por cada vista de negocio y técnica.',
        'Pulsa “Copiar DDL” para llevártelo al portapapeles.',
      ]),
      P('La cabecera del DDL indica el nombre del modelo y el engine, y el conteo de tablas y vistas exportadas se muestra en el subtítulo.'),
      NOTE('El interruptor “Incluir vistas” se desactiva si las tablas seleccionadas no tienen ninguna vista definida.'),
    ],
  },
  {
    id: 'a_dbml', cat: 'export', title: 'Ida y vuelta con DBML', read: 3,
    summary: 'Usa DBML como formato de intercambio del diagrama.',
    blocks: [
      P('DBML es un formato de texto compacto para describir tablas y relaciones. El editor DBML te da el modelo actual ya serializado y puede volver a parsear texto editado.'),
      STEPS([
        'New → “Escribir DBML” abre el editor con el DBML del canvas.',
        'Cada tabla se escribe como Table nombre { … } con una línea por columna; los flags van entre corchetes: [pk], [not null], [ref: > tabla.columna].',
        'Usa “Copiar” para exportar el texto, o edítalo y pulsa “Aplicar DBML” para regenerar el canvas a partir de él.',
      ]),
      WARN('“Aplicar DBML” reemplaza por completo el canvas. Si solo quieres exportar, usa “Copiar” y cierra sin aplicar.'),
      TIP('Las referencias (ref: > …) se convierten en relaciones 1:N al aplicar, así que es una forma rápida de bosquejar un modelo con sus FKs en texto.'),
    ],
  },

  // ───────────────────────── Model Center ─────────────────────────
  {
    id: 'a_center', cat: 'center', title: 'Buscar en todo el catálogo', read: 4,
    summary: 'Tablas, vistas y columnas de todos los proyectos en un solo sitio.',
    blocks: [
      P('El Model Center es un catálogo único que agrega todos los proyectos. Es la pantalla de inicio y tiene cuatro pestañas: Overview, Tables, Views y Columns.'),
      H('Overview'),
      P('Arriba, cinco contadores (Projects, Data Models, Tables, Views, Columns) y dos paneles de barras: tablas por engine y tablas por dominio. Debajo, el panel de salud y gobierno del modelo.'),
      H('Tables, Views, Columns'),
      STEPS([
        'Tables — grilla densa con Proyecto · Modelo, Engine, Dominio, Owner y conteos de columnas, vistas y FKs.',
        'Views — todas las vistas con su tabla, proyecto, tipo y rol.',
        'Columns — todas las columnas con su tipo, clave y tabla de origen.',
      ]),
      P('Todas las grillas se ordenan haciendo clic en la cabecera y se filtran por engine (y, en Tables, también por modelo y dominio). El buscador acota por nombre. En Tables, al seleccionar una fila se abre un panel de detalle con acceso directo a “Abrir proyecto”.'),
      TIP('Para encontrar algo concreto, escribe en el buscador de la pestaña correspondiente: busca por nombre de tabla, de vista, de columna o de proyecto.'),
    ],
  },
  {
    id: 'a_governance', cat: 'center', title: 'Vigilar la salud y el gobierno del modelo', read: 3,
    summary: 'Detecta tablas sin clave, sin dominio, sin vista o con datos sensibles.',
    blocks: [
      P('El panel de gobierno del Overview resume cuatro señales de calidad. Cada tarjeta es un acceso directo: al pulsarla saltas a la lista filtrada con esos casos.'),
      STEPS([
        'Tablas sin clave primaria — entidades sin PK; conviene revisarlas porque rompen integridad y relaciones.',
        'Tablas sin dominio — tablas que no están asignadas a ningún producto de datos.',
        'Tablas sin ninguna vista — candidatas a definir al menos una proyección por rol.',
        'Columnas sensibles (PII) — columnas cuyo nombre sugiere datos personales (email, teléfono, documento, nombre, tarjeta…).',
      ]),
      P('Los valores en ámbar o rojo señalan que hay casos pendientes; en verde, que está limpio. Pulsar “Columnas sensibles (PII)” te lleva a la pestaña Columns ya buscando candidatas a enmascarar.'),
      TIP('Usa estas señales como checklist de cierre: idealmente cada tabla con PK, con dominio asignado y con vistas para los roles que la consumen.'),
    ],
  },

  // ───────────────────────── Cuenta / usuarios ─────────────────────────
  {
    id: 'a_account', cat: 'account', title: 'Iniciar y cerrar sesión', read: 2,
    summary: 'Tu sesión y cómo salir.',
    blocks: [
      P('El acceso es por usuario y contraseña. La sesión se mantiene durante la jornada (unas 10 horas) mediante una cookie segura; pasado ese tiempo se pide iniciar sesión de nuevo.'),
      STEPS([
        'Introduce usuario y contraseña en la pantalla de login y pulsa “Ingresar”.',
        'Para salir, abre el avatar al final del rail izquierdo y elige cerrar sesión.',
      ]),
      NOTE('Si tu sesión caduca mientras trabajas, la aplicación te devolverá al login conservando a dónde querías ir. La primera cuenta de administrador se crea automáticamente en el arranque inicial; cámbiale la contraseña cuanto antes.'),
    ],
  },
  {
    id: 'a_users', cat: 'account', title: 'Gestionar usuarios y permisos', read: 4,
    summary: 'Roles y acceso por proyecto (solo administradores).',
    blocks: [
      P('La sección Usuarios del rail (solo administradores) lista las cuentas y permite crear, editar y desactivar usuarios. El proyecto es la unidad de acceso: hay un canvas por proyecto, así que no existen permisos a nivel de modelo.'),
      H('Roles'),
      STEPS([
        'Administrador — acceso total a todos los proyectos y a la gestión de usuarios.',
        'Editor — puede editar los proyectos donde tenga permiso de “Editar”.',
        'Solo lectura — puede ver los proyectos donde tenga permiso de “Ver”.',
      ]),
      H('Permisos por proyecto'),
      STEPS([
        'Al crear o editar un usuario no administrador, aparece una tabla con todos los proyectos.',
        'Para cada proyecto elige Sin acceso, Ver o Editar.',
        'Los administradores tienen acceso total automáticamente, sin necesidad de permisos individuales.',
      ]),
      NOTE('La contraseña es obligatoria al crear (mínimo 6 caracteres); al editar, déjala vacía para no cambiarla. Puedes desactivar una cuenta sin borrarla, y no puedes eliminar tu propia cuenta.'),
    ],
  },

  // ───────────────────────── IA ─────────────────────────
  {
    id: 'a_ai', cat: 'ai', title: 'El Asistente IA y su estado actual', read: 2,
    summary: 'Tu copiloto de modelado, desacoplado por ahora.',
    blocks: [
      P('El Asistente IA está pensado para ayudarte a generar tablas, sugerir relaciones y documentar dominios a partir de lenguaje natural. Encuentras su botón (en violeta) en la barra superior del editor.'),
      NOTE('Este módulo está desacoplado del resto de la plataforma y se reconectará en una versión próxima. Mientras tanto, el botón te avisará de que aún no está disponible; todo lo demás del editor funciona con normalidad.'),
    ],
  },
];

export const catOf = (id: string): Cat => CATS.find((c) => c.id === id) ?? CATS[0];
const slug = (t: string) => 's-' + t.toLowerCase().replace(/\s+/g, '-');

export function BlockView({ b }: { b: Block }) {
  if (b.type === 'p') return <p className="doc-p">{b.t}</p>;
  if (b.type === 'h') return <h3 className="doc-h" id={slug(b.t)}>{b.t}</h3>;
  if (b.type === 'steps') return <ol className="doc-steps">{b.items.map((s, i) => <li key={i}><span className="doc-step-n">{i + 1}</span><span>{s}</span></li>)}</ol>;
  const map: Record<'tip' | 'note' | 'warn', [IconName, string, string]> = {
    tip: ['bolt', 'Tip', 'tip'], note: ['info', 'Nota', 'note'], warn: ['filter', 'Advertencia', 'warn'],
  };
  const [ic, label, cls] = map[b.type];
  return (
    <div className={`doc-callout ${cls}`}>
      <span className="doc-callout-ico"><Icon name={ic} size={15} /></span>
      <div><div className="doc-callout-t">{label}</div><div className="doc-callout-b">{b.t}</div></div>
    </div>
  );
}

export function ArticleBody({ a, compact }: { a: Article; compact?: boolean }) {
  const heads = a.blocks.filter((b) => b.type === 'h') as { type: 'h'; t: string }[];
  return (
    <div className={`doc-article${compact ? ' compact' : ''}`}>
      <div className="doc-col">{a.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>
      {!compact && heads.length > 1 && (
        <div className="doc-toc">
          <div className="doc-toc-lbl">En esta página</div>
          {heads.map((h, i) => <a key={i} className="doc-toc-link" href={`#${slug(h.t)}`}>{h.t}</a>)}
        </div>
      )}
    </div>
  );
}

export function useHelpSearch() {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return [];
    return ARTICLES.filter((a) => a.title.toLowerCase().includes(ql) || a.summary.toLowerCase().includes(ql) || catOf(a.cat).title.toLowerCase().includes(ql)).slice(0, 7);
  }, [q]);
  return { q, setQ, results };
}
