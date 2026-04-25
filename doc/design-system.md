# Sistema de Diseño

La aplicación usa un **tema claro** basado en una paleta de colores crema-teal, definida íntegramente como propiedades CSS personalizadas en `src/app/globals.css`.

## Paleta de Colores

### Colores de Fondo (claro → oscuro)

| Token | Hex | Uso |
|-------|-----|-----|
| `--color-bg-canvas` | `#FAFAF8` | Fondo del lienzo de diagrama |
| `--color-bg-primary` | `#FBF7EE` | Fondo principal de la app |
| `--color-bg-secondary` | `#F4E9CD` | Champagne — barra lateral, tarjetas |
| `--color-bg-elevated` | `#FFFFFF` | Modales, paneles, popovers |
| `--color-bg-surface` | `#F7F1E3` | Inputs, desplegables |
| `--color-bg-hover` | `#EDE5D1` | Estados de hover |
| `--color-bg-active` | `#E5DBBD` | Estados activos / presionados |

### Colores de Acento

| Token | Hex | Nombre | Uso |
|-------|-----|--------|-----|
| `--color-accent-primary` | `#468189` | Metallic Seaweed | Botones, encabezados de nodo de tabla, borde seleccionado |
| `--color-accent-primary-hover` | `#3a6d74` | — | Hover de botón |
| `--color-accent-secondary` | `#77ACA2` | Green Sheen | Conexiones de aristas, acciones secundarias, animación de flujo |
| `--color-accent-tertiary` | `#9DBEBB` | Opal | Bordes, insignias, acentos atenuados |
| `--color-accent-muted` | `rgba(70,129,137,0.12)` | — | Fondo de resaltado de fila de columna activa |

### Colores de Texto

| Token | Hex | Uso |
|-------|-----|-----|
| `--color-text-primary` | `#031926` | Rich Black — títulos, cuerpo |
| `--color-text-secondary` | `#3a5a60` | Descripciones, etiquetas |
| `--color-text-muted` | `#6b8f8a` | Placeholders, marcas de tiempo |
| `--color-text-inverse` | `#FFFFFF` | Texto sobre superficies oscuras/degradado |

### Colores de Estado

| Token | Hex | Uso |
|-------|-----|-----|
| `--color-success` | `#2e9e5a` | Confirmaciones de éxito |
| `--color-warning` | `#d4930d` | Fondo de insignia PK |
| `--color-error` | `#c5403a` | Acciones de eliminación, errores de validación |
| `--color-info` | `#468189` | Indicadores informativos |

## Tipografía

### Fuentes

- **Inter** (sans-serif) — cargada desde Google Fonts; pesos 300 / 400 / 500 / 600 / 700
- **JetBrains Mono** (monoespaciada) — editor DBML, tipos de dato de columnas, bloques de código; pesos 400 / 500 / 600

### Escala Tipográfica

| Token | `rem` | `px` | Uso |
|-------|-------|------|-----|
| `--text-xs` | 0.75 | 12 | Tipos de dato de columnas, insignias, tooltips |
| `--text-sm` | 0.8125 | 13 | Cuerpo, descripciones, elementos de barra lateral |
| `--text-base` | 0.875 | 14 | Inputs por defecto, nombres de tabla |
| `--text-lg` | 1.0625 | 17 | Títulos de sección |
| `--text-xl` | 1.25 | 20 | Sub-títulos |
| `--text-2xl` | 1.5 | 24 | Títulos de página |
| `--text-3xl` | 1.875 | 30 | Texto hero / dashboard |
| `--text-4xl` | 2.25 | 36 | Display grande |

## Escala de Espaciado (cuadrícula de 4px)

| Token | Valor |
|-------|-------|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--space-16` | 64px |

## Radios de Borde

| Token | Valor | Uso |
|-------|-------|-----|
| `--radius-sm` | 6px | Insignias, chips pequeños |
| `--radius-md` | 8px | Botones, inputs, tooltips |
| `--radius-lg` | 12px | Tarjetas, paneles, popovers |
| `--radius-xl` | 16px | Modales |
| `--radius-full` | 9999px | Pills, círculos |

## Variantes de Botón

| Clase | Apariencia |
|-------|------------|
| `.btn-primary` | Degradado (`#468189 → #5a9aa2`), texto blanco, sombra luminosa |
| `.btn-secondary` | Fondo blanco, borde teal, texto primario |
| `.btn-ghost` | Transparente, texto atenuado; hover agrega `bg-hover` |
| `.btn-danger` | Fondo rojo suave, borde rojo, texto rojo |
| `.btn-icon` | Cuadrado, usado para acciones de barra de herramientas |
| `.btn-sm` | Padding y tamaño de fuente reducidos |

## Transiciones

| Token | Duración | Uso |
|-------|----------|---------|
| `--transition-fast` | 150ms | Estados de hover, alternancias, cambios de color |
| `--transition-normal` | 250ms | Revelado de paneles, hover en tarjetas |
| `--transition-slow` | 400ms | Transiciones de página/modal, `fitView` de auto-arrange |
| `--transition-spring` | 500ms cubic-bezier(0.34,1.56,0.64,1) | Entrada del modal con escala |

## Animaciones de Keyframe

| Nombre | Efecto |
|--------|--------|
| `fadeIn` / `fadeOut` | Opacidad al montar/desmontar |
| `slideUp` | Tarjetas/ítems de cuadrícula entran desde abajo |
| `slideInRight` | Panel derecho, panel de chat entran desde la derecha |
| `scaleIn` | Entrada de modal con escala + fundido |
| `pulse` | Indicadores de carga |
| `shimmer` | Placeholders de carga tipo esqueleto |
| `erEdgeFlow` | Animación `stroke-dashoffset` en aristas ER activas |

## Diseño del Nodo de Tabla

```
┌────────────────────────────────────┐
│  table_name                    [N] │  ← Encabezado (#468189 fondo sólido, texto blanco)
├────────────────────────────────────┤
│  [PK]  id          ◇  integer      │  ← Fila PK (insignia dorada)
│  [FK]  user_id     ◇  integer      │  ← Fila FK (insignia teal)
│   •    username       varchar(50)  │  ← Columna regular (punto)
├────────────────────────────────────┤
│  Texto de definición funcional…     │  ← Pie de página (atenuado, itálica, truncado)
└────────────────────────────────────┘
```

- **Encabezado**: fondo `#468189`, nombre de tabla en blanco, insignia con conteo de columnas
- **Filas de columna**: altura 28px; ícono de llave (16×16px), nombre de columna, diamante de nulabilidad `◇`, tipo de dato en monoespaciado
- **Insignias de llave**: PK = dorado `--color-warning` | FK = teal Green Sheen | SK = Metallic Seaweed | PT = dorado (igual que PK)
- **Fila de relación activa** (`.active-relation-row`): fondo `--color-accent-muted` + borde izquierdo `#468189`
- **Nodo seleccionado**: sombra luminosa teal + borde `#468189`
- **Tooltip de hover**: píldora oscura (`#1a2e35`) mostrando nombre de columna, tipo de dato, definición funcional y referencia FK si aplica; aparece en **todas** las columnas al pasar el cursor

## Diseño de Aristas de Relación

| Propiedad | Valor |
|-----------|-------|
| Color por defecto | `#5a8fa0` |
| Color activo/hover | `#3d7a82` |
| Color atenuado | `#d6dbd9` |
| Ancho de línea | 1.5px por defecto / 2px activo |
| Estilo de trayectoria | Paso ortogonal anguloso (`borderRadius: 0`) |
| Enrutamiento | Mismo lado (L→L o R→R) cuando los nodos se superponen horizontalmente; lado opuesto (R→L) cuando hay espacio libre |
| Desplazamiento paralelo | `20 + edgeIndex × 16` px — evita que las conexiones compartan la misma línea vertical |
| Círculos de extremo | Círculos huecos de 4px en origen y destino |
| Etiquetas de cardinalidad | `*` / `0..1` / `1` posicionadas cerca de los extremos |
| Animación de flujo | Clase `er-edge-flow-anim`: `stroke-dasharray: 6 4`, anima al hacer hover o al seleccionar una tabla |

## Popover de Distribución Automática

Tarjeta flotante (`white`, `border-radius: 12px`, `box-shadow: 0 8px 32px rgba(3,25,38,0.15)`) con tres opciones. Cada opción tiene:
- Ícono SVG (28×28px, `--color-text-secondary`)
- Etiqueta en negrita + insignia numerada
- Texto de descripción pequeño (`--color-text-muted`)

## Encabezado del Editor (clases `ed-*`)

El editor de modelos usa un encabezado de **dos filas** con su propio namespace de clases para evitar colisión con la cabecera global de la app.

| Clase | Rol |
|-------|-----|
| `.ed-header` | Contenedor sticky, fondo `--color-bg-elevated`, borde inferior |
| `.ed-header-row` | Fila individual; min-height 48px, padding lateral `--space-5` |
| `.ed-header-identity` | Variante de fila con borde inferior sutil (separa identidad de toolbar) |
| `.ed-header-toolbar` | Variante de fila con fondo `--color-bg-surface` |
| `.ed-back` | Botón cuadrado de 32px para volver |
| `.ed-breadcrumb` / `.ed-crumb` / `.ed-crumb-link` / `.ed-crumb-current` / `.ed-crumb-sep` | Breadcrumb clickeable |
| `.ed-save-pill` (`.saved` / `.saving`) | Pill de estado verde / ámbar; `.ed-save-dot` con animación `pulse` cuando guarda |
| `.ed-engine-wrap` / `.ed-engine-label` | Wrapper del selector de motor |
| `.ed-segmented` / `.ed-segmented-btn` | Control segmentado para `List \| Canvas` |
| `.ed-action-btn` | Botón base del toolbar (icono + label, padding `7×14px`) |
| `.ed-action-primary` | Variante teal acentuada (Export DDL) |
| `.ed-action-ai` (`.active`) | Variante índigo activable (AI Agent) |
| `.ed-toolbar-divider` | Línea vertical de 1×22px que agrupa secciones del toolbar |

## Tarjeta de Columna del Edit Table (clases `tf-col-*` y `tf-key-chip`)

La pestaña Columns del formulario usa cards independientes con jerarquía visual clara, no un grid denso de checkboxes.

| Clase | Rol |
|-------|-----|
| `.tf-col-cards` | Contenedor flex vertical con `gap: --space-3` |
| `.tf-col-card` | Tarjeta individual: borde `#e2e8f0`, radio `--radius-lg`, hover ligero |
| `.tf-col-card-top` | Cabecera: índice + nombre + tipo + papelera |
| `.tf-col-index` | Círculo numérico de 22px, fondo `--color-bg-active` |
| `.tf-col-name` | Input grande con underline al focus |
| `.tf-col-type` | Pill mono con dropdown nativo (chevron como background-image) |
| `.tf-col-delete` | Botón papelera; hover tiñe a `--color-error` |
| `.tf-chip-row` | Fila flex-wrap con los chips de constraints |
| `.tf-key-chip` | Chip base (gris, círculo `tf-key-chip-dot`) |
| `.tf-chip-pk.active` | Ámbar `#d97706` |
| `.tf-chip-fk.active` | Azul `#2563eb` |
| `.tf-chip-sk.active` | Púrpura `#7c3aed` |
| `.tf-chip-uq.active` | Verde `#16a34a` |
| `.tf-chip-nn.active` | Slate `#475569` |
| `.tf-col-fields` / `.tf-field` / `.tf-field-label` / `.tf-field-input` / `.tf-field-grow` | Pills inline para Length / Scale / Default / Description |
| `.tf-fk-banner` / `.tf-fk-banner-icon` / `.tf-fk-banner-text` / `.tf-fk-banner-dot` / `.tf-fk-select` | Banner azul que aparece cuando se activa el chip FK, con dos selectores `schema.table` y `column` |

> Tipografías alineadas con el resto de la app: nombres y chips usan `--font-sans` (Inter); solo el tipo de dato usa `--font-mono` por ser un token de código. Sin `text-transform: uppercase` agresivo — los acrónimos como `PK` o `NOT NULL` ya vienen así en el JSX.
