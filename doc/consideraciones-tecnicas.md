# Consideraciones técnicas del frontend — canvas, layout y escala

Última actualización: 2026-07-31.

Este documento registra las decisiones técnicas de rendimiento y layout del frontend del Data Model Hub: por qué el auto-arrange usa ELK y con qué configuración exacta, cómo se resolvió la renderización de canvases gigantes (LOD / zoom semántico, doc 33 de `plan-implementacion/` del backend) y qué otras palancas de escala existen dentro y fuera del canvas. Todos los números y opciones citados están verificados contra el código del repositorio a la fecha indicada.

Contexto general de la aplicación en [architecture.md](architecture.md); el detalle de suites de verificación y límites conocidos en [testing.md](testing.md).

---

## 1. Auto-layout con ELK (elkjs)

### 1.1 Qué es ELK y por qué esta build

El botón "Autoarrange" del canvas no usa matemática de posicionamiento hecha a mano: delega el layout completo al **Eclipse Layout Kernel (ELK)**, un motor de layout de grafos del ecosistema Eclipse con más de una década de investigación en dibujo automático de diagramas. El frontend consume su port a JavaScript, **`elkjs` 0.11.1** (pineado exacto en `package.json`, política `==` del owner), a través de la build `elk.bundled.js`:

```ts
// src/features/modeler/lib/elkLayout.ts
import ELK from 'elkjs/lib/elk.bundled.js';
const elk = new ELK();
```

Razones de la elección:

- La build *bundled* es JS puro autocontenido (el kernel Java transpilado con GWT): corre directamente en el navegador, sin worker obligatorio, sin WASM y sin fetch de recursos externos — compatible con la política de la app de no depender de CDNs y de funcionar igual en dev que detrás del `server.mjs` de producción.
- Es el único punto del frontend que importa `elkjs`, y ese módulo se carga con **import dinámico** desde `autoOrganize` (`useModelerStore`): el peso del kernel no entra al bundle inicial de la SPA, se paga recién al pulsar "Autoarrange" por primera vez (ver §1.5).
- El mismo bundle sirve para el batch del backend sin instalar nada adicional (§1.6).

### 1.2 El algoritmo `layered` (familia Sugiyama)

Se usa `elk.algorithm: 'layered'`, la implementación ELK del método de Sugiyama para grafos dirigidos. El pipeline interno tiene cinco fases; conocerlas explica qué controla cada opción de la configuración del §1.3:

1. **Eliminación de ciclos.** El método exige un grafo acíclico. ELK detecta ciclos (una tabla que resulta padre e hijo de otra por caminos distintos) e invierte temporalmente el mínimo de aristas necesario; al final del layout las restaura. El modelador puede producir ciclos legítimos, así que esta fase es la que hace viable aplicar Sugiyama a un modelo ER real sin pre-procesamiento propio.
2. **Asignación de capas.** Cada nodo recibe una capa (columna vertical, porque `elk.direction: 'RIGHT'`) de modo que toda arista avance hacia adelante. En un modelo ER esto se traduce en que las tablas padre quedan a la izquierda de sus hijas, y una vista queda a la derecha de sus tablas fuente.
3. **Minimización de cruces.** Dentro de cada capa se decide el ORDEN vertical de los nodos para que los wires se crucen lo menos posible. La estrategia configurada es `LAYER_SWEEP`: barridos repetidos capa por capa (ida y vuelta), reordenando cada capa con heurísticas de ordenamiento (baricentro/mediana de los vecinos de la capa contigua) y quedándose con el mejor resultado encontrado. `elk.layered.thoroughness: '10'` sube el esfuerzo respecto del default (7): más CPU a cambio de menos cruces — intercambio correcto porque el arrange es una acción puntual, no un costo por frame.
4. **Posicionamiento de nodos.** Con el orden fijado, se asignan coordenadas exactas. La estrategia es `BRANDES_KOEPF`, un algoritmo de alineación por bloques: agrupa nodos en cadenas verticales alineadas, calcula cuatro alineaciones extremas y las balancea. Produce columnas equilibradas y favorece que las aristas salgan rectas; se complementa con `favorStraightEdges: 'true'`.
5. **Ruteo de aristas.** `elk.edgeRouting: 'ORTHOGONAL'` hace que ELK reserve espacio para canales ortogonales entre capas; los spacings de wires del §1.3 operan sobre esta fase.

Un algoritmo por capas calza con los diagramas ER de la plataforma porque las relaciones son **dirigidas padre→hijo** (doc 19: el edge siempre va del lado PK al lado FK) y las derivaciones tabla→vista también tienen dirección natural. Con `direction: RIGHT` el resultado se lee como flujo de dependencias izquierda→derecha, coherente con los handles de los nodos (source en el lado derecho, target en el izquierdo). Alternativas como layouts de fuerza (force/stress) no garantizan esa lectura direccional ni la separación en columnas que un modelador espera.

### 1.3 Configuración exacta

Las opciones viven en `src/features/modeler/lib/elkLayout.ts` y son idénticas (copia mantenida en sync, ver §1.6) en `scripts/arrange_all.cjs` del backend:

| Opción ELK | Valor | Qué controla |
|---|---|---|
| `elk.algorithm` | `layered` | Método Sugiyama por capas (§1.2). |
| `elk.direction` | `RIGHT` | Flujo de dependencias izquierda→derecha; coincide con los handles (src=Right, tgt=Left). |
| `elk.edgeRouting` | `ORTHOGONAL` | Ruteo ortogonal en la fase 5 (reserva de canales entre capas). |
| `elk.separateConnectedComponents` | `true` | Los subgrafos SUELTOS (tablas sin relaciones, islas) se tratan como componentes independientes y se empaquetan en bloques compactos en vez de una tira larga. Crítico en canvases con muchas tablas aisladas. |
| `elk.spacing.componentComponent` | `64` | Separación entre esos componentes empaquetados. |
| `elk.layered.spacing.nodeNodeBetweenLayers` | `140` | Separación horizontal entre capas (holgada para nodos anchos y wires con marcadores de cardinalidad). |
| `elk.spacing.nodeNode` | `72` | Separación vertical entre nodos de la misma capa. |
| `elk.spacing.edgeNode` | `28` | Aire wire↔nodo: los wires no se pegan a las cajas. |
| `elk.spacing.edgeEdge` | `16` | Aire wire↔wire: los canales no se superponen visualmente. |
| `elk.layered.spacing.edgeNodeBetweenLayers` | `28` | Aire wire↔nodo dentro del canal entre capas. |
| `elk.layered.nodePlacement.strategy` | `BRANDES_KOEPF` | Posicionamiento por bloques alineados: columnas balanceadas, aristas rectas (§1.2, fase 4). |
| `elk.layered.nodePlacement.favorStraightEdges` | `true` | Sesga el balanceo hacia aristas horizontales rectas. |
| `elk.layered.crossingMinimization.strategy` | `LAYER_SWEEP` | Barridos capa por capa con heurísticas de ordenamiento (§1.2, fase 3). |
| `elk.layered.thoroughness` | `10` | Esfuerzo de la minimización de cruces (default 7): más calidad por más CPU en una acción puntual. |

### 1.4 Tamaños reales de los nodos y división del trabajo con React Flow

ELK recibe el ancho/alto **medido** de cada nodo, no un tamaño fijo:

```ts
// elkLayout.ts — construcción del grafo ELK
children: nodes.map((n) => ({
  id: n.id,
  width: n.measured?.width ?? (typeof n.width === 'number' ? n.width : NODE_W),    // NODE_W = 240
  height: n.measured?.height ?? (typeof n.height === 'number' ? n.height : NODE_H), // NODE_H = 160
})),
edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
```

`n.measured` es la medición del DOM que mantiene React Flow 12 (`@xyflow/react` 12.11.0); el fallback 240×160 solo aplica si un nodo aún no fue medido — caso raro, porque el arrange se dispara con el canvas visible. Como el ancho de un nodo es dinámico (max-content de su fila más larga, acotado — ver la fórmula en §2.2), pasar el tamaño real es lo que evita que tablas anchas o altas (30 columnas ≈ 700 px) se superpongan tras el arrange, un defecto que sí ocurría con tamaño fijo.

La división del trabajo es deliberada: **ELK solo posiciona**. `elkLayout()` devuelve `{id: {x, y}}` y descarta los bend points que ELK calcula en su fase de ruteo. El ruteo VISUAL de los wires lo dibuja React Flow en cada frame:

- Los edges de relación (`CrowFootEdge`) usan `getSmoothStepPath` — camino ortogonal con esquinas suaves, eligiendo el mejor lado de anclaje por posición relativa de los nodos.
- Los edges de derivación tabla→vista (`DerivationEdge`) usan `getBezierPath` con curvatura 0.35 — bezier continuo, distinto a propósito de las relaciones para diferenciarse a simple vista.

Así los wires siguen a los nodos durante el drag sin re-ejecutar layout alguno: ELK corre una vez por arrange, React Flow rutea siempre.

### 1.5 El flujo del botón "Autoarrange"

`autoOrganize` en `useModelerStore` orquesta el arrange del canvas activo:

1. Importa `elkLayout` (y `viewSourceIds` de `viewGraph`) por **import dinámico** — primera carga del kernel bajo demanda.
2. Toma los tamaños **medidos** de los nodos vivos vía la instancia de React Flow (`flow.getNodes()`).
3. Arma el grafo con las tablas del diagrama Y las vistas visibles (las que tienen alguna fuente en el canvas), agregando por cada vista sus wires de derivación como edges — ELK las ubica junto a sus fuentes en la capa siguiente.
4. Ejecuta `elkLayout(nodes, edges)` y persiste el resultado con `setSubjectAreaLayout(saId, pos)`: el backend MERGEA el layout sobre `subject_areas.layout` (mapa `nodeId → {x, y}`, mismo espacio de claves para tablas y vistas).
5. Recarga el diagrama (`reload()`); el botón muestra spinner mientras tanto (estado `arranging` del `Toolbar`).

El movimiento manual de un nodo usa el mismo destino de persistencia: `onNodeDragStop` → `saveLayout(tableId, pos)` → merge sobre `subject_areas.layout`. Por eso arrange y ajustes manuales conviven sin pisarse entre sí más que en los nodos afectados.

### 1.6 Paridad front/backend: `arrange_all`

El backend tiene una herramienta batch que reordena TODOS los canvases con el mismo motor: `scripts/arrange_all.py` (repo `backend-data-model-hub`). El pipeline es Python (prepara datos) → subprocess `node scripts/arrange_all.cjs` (elkjs) → Python (persiste posiciones):

```bash
.venv/bin/python scripts/arrange_all.py [--project "Modelo de Datos DDV_FISICO"]
```

Puntos clave de la paridad:

- `arrange_all.cjs` usa la **misma configuración** de la tabla del §1.3 (comentario en el archivo: "Idéntica a elkLayout.ts (mantener en sync)") y la **misma librería**: resuelve el bundle de elkjs sin dependencia propia, probando en orden la env `ELKJS_PATH` → `web-data-model-hub/node_modules/elkjs/lib/elk.bundled.js` del repo hermano → `require('elkjs/lib/elk.bundled.js')`.
- Como en batch no hay DOM que medir, `arrange_all.py` **estima** el tamaño de cada nodo replicando las métricas CSS reales de `.wk-node`/`.wk-vnode` — las mismas fórmulas de `lodSize.ts` (§2.2) —, con un matiz deliberado: para el header toma el nombre MÁS LARGO entre físico y lógico, porque el layout persistido debe servir en ambos modos de vista sin solaparse. Para las filas de vista, donde el batch no tiene el tipo colapsado a mano, aproxima con un margen fijo mayor (+12 caracteres ≈ tipo + `fx` + gaps) donde el front usa la longitud real del tipo (+6).
- Incluye **tablas Y nodos de vista** con sus wires de derivación: si solo se arreglaran las tablas, el front colocaría cada vista a +280 px de su fuente (default de `viewGraph.ts`) y con tablas anchas la vista quedaría encima de su tabla.
- Persiste con `bulk_write` de `UpdateOne` sobre `subject_areas.layout` en lotes de 200.
- `--project` (doc 32b) limita el arrange a los canvases de UN proyecto — imprescindible en cargas incrementales de la familia DDV (~15 archivos del mismo modelo) para no pisar los layouts ya trabajados de archivos anteriores.

Consecuencia: el resultado del batch post-migración y el del botón "Autoarrange" en la web son consistentes — mismo motor, misma configuración, mismas métricas de nodo.

---

## 2. Renderización a escala: el problema de la cantidad de elementos

### 2.1 El caso real (2026-07-25, doc 33)

Tras la carga del XML2 "Otros" (doc 32b), el canvas **Analytics** quedó con **392 nodos**: 196 tablas + 196 vistas espejo. En volumen de contenido:

| Métrica | Valor |
|---|---:|
| Nodos (tablas + vistas) | 392 |
| Filas de columna (tablas) | 49,550 |
| Filas de source (vistas) | 49,535 |
| Total de filas | ≈ 99,000 |
| Elementos DOM por fila (2 handles + 3 spans + ícono) | ~5–6 |
| **Elementos DOM totales en fit view** | **~400,000–500,000** |

El fit view inicial se trababa (segundos de bloqueo del hilo principal). El diagnóstico descartó a los sospechosos obvios:

- **NO era la base de datos**: Lakebase en reposo durante el cuelgue (RAM/CPU bajas, 0 deadlocks, cache hit ~100%, BD de ~215 MB).
- **NO era el backend ni la red**: el diagrama llega en UNA sola respuesta (§3.3); no hay re-consultas durante la navegación.
- **Era el costo de pintar** ~medio millón de elementos que además eran ilegibles: al zoom de fit view de ese canvas (~0.03–0.08), una fila de 12 px mide **menos de 1 píxel**. El navegador pagaba style, layout, paint y composición de contenido que nadie podía leer.
- `onlyRenderVisibleElements` (la virtualización de viewport de React Flow, §3.2) no poda nada en fit view: en fit view **todos** los nodos son visibles por definición.

### 2.2 La solución: LOD / zoom semántico

La respuesta fue nivel de detalle (LOD) por zoom, implementada solo en el frontend — cero backend, cero cambios de data. Bajo un umbral de zoom, cada nodo se pinta como una **caja compacta** del MISMO tamaño que el nodo detallado; sobre el umbral vuelve el detalle completo. La condición de diseño del owner fue que "visualmente el canvas no debe perder información": a ese zoom las filas ya medían menos de 1 px, así que lo único que se deja de pintar es lo que de todos modos no se veía.

**Umbrales con histéresis** (`src/features/modeler/lib/lodSize.ts`):

```ts
export const LOD_ENTER = 0.1;   // entra a compacto al bajar de 0.10
export const LOD_EXIT = 0.2;    // vuelve a detalle recién al superar 0.20

export function nextLod(current: boolean, zoom: number): boolean {
  if (current) return zoom <= LOD_EXIT;   // en compacto: sale recién sobre EXIT
  return zoom < LOD_ENTER;                // en detalle: entra recién bajo ENTER
}
```

La banda muerta entre 0.10 y 0.20 evita el parpadeo cuando el usuario navega justo en el borde del umbral. Los valores fueron **calibrados en vivo por el owner el 2026-07-25** sobre el canvas Analytics: con umbrales más altos el compacto aparecía sintiéndose aún "cerca" del modelo; a 0.10 una fila de 12 px mide 1.2 px — nada legible se pierde. Regla si se re-calibra: mantener ENTER < EXIT con una brecha de ~0.1.

**Evaluación del umbral** (`ModelerCanvas.tsx`): el handler `onMove` de React Flow evalúa `nextLod(lod, viewport.zoom)` en cada pan/zoom. `setLod` en el store solo escribe **al cruzar** el umbral:

```ts
// useModelerStore.ts
setLod: (v) => { if (get().lod !== v) set({ lod: v }); },
```

Así el pan normal no genera ni un render por LOD. Al cruzar, un efecto parchea **solo `data.lod`** de los nodos (posiciones, selección y edges quedan intactos). En `onInit` el LOD se evalúa de inmediato y otra vez tras el fitView inicial con doble `requestAnimationFrame` — React Flow no emite `onMove` por el movimiento programático del fit, y el doble rAF garantiza medir el viewport ya asentado.

**Caja compacta del MISMO tamaño**: `lodSize.ts` replica las métricas reales de `.wk-node`/`.wk-vnode` — las mismas fórmulas que usa `arrange_all` del backend (§1.6):

```
ancho = clamp(chars·8 + 72, 240, 880)     // max-content de la fila más larga
alto  = 32 (header) + filas·28
```

`tableLodSize(table, columns, viewMode)` calcula `chars` como el máximo entre el header (`schema.nombre` del modo activo) y la fila de columna más larga (+3 de margen), y devuelve además `pkRows` para pintar la **franja PK** proporcional (`pkRows·28` px de alto): de lejos, la masa de cada tabla y el bloque de su llave primaria SON información visual, y se conservan. `viewLodSize` hace lo propio para las vistas, que mantienen su identidad de "card medio plomo": borde punteado envolvente y hatch diagonal del cuerpo (`.wk-lod-body`). Como compacto y detallado miden lo mismo, el cruce de umbral **no mueve el layout**: nada salta, ni durante la navegación ni respecto de las posiciones persistidas por ELK.

**Edges intactos — handles fantasma**: el nodo compacto no tiene filas, pero deja `Handle`s invisibles con los **MISMOS ids** que las filas del modo detallado. `ModelerCanvas` calcula por tabla las columnas ancladas por algún wire (el par 0 de cada relación) y las pasa como `data.refCols`; el nodo compacto las materializa:

```tsx
// TableNode.tsx — rama LOD
{(refCols ?? []).map((cid) => (
  <span key={cid}>
    <Handle type="source" position={Position.Right} id={`${cid}__src`} isConnectable={false} ... />
    <Handle type="target" position={Position.Left}  id={`${cid}__tgt`} isConnectable={false} ... />
  </span>
))}
```

Más `__hdr_src` en tablas y `__hdr_tgt` en vistas para los wires de derivación. Resultado: los edges **nunca se re-arman** al cruzar el umbral — sus anclas existen en ambos modos y el cambio es atómico en un solo commit de React (cero frames sin wires).

**Primera pintura liviana**: `lod` arranca en `true` en `useModelerStore`. Un canvas grande ya se monta compacto en su primera pintura — el momento más caro —, y el doble rAF de `onInit` lo corrige de inmediato en canvases chicos, donde el fit view queda por encima del umbral.

**Candado del export SVG** (`Toolbar.tsx`, `exportImage`): la captura de imagen va SIEMPRE con detalle completo. Antes de capturar se activa `lodLock` y se fuerza `lod = false`; `onMove` respeta el lock (`if (st.lodLock) return`), porque el `fitView` del export baja el zoom y sin candado re-activaría el compacto a mitad de captura. Tras `fitView({ padding: 0.15 })` + doble rAF se captura con `toSvg` de `html-to-image` y en el `finally` se libera el lock y se re-evalúa el LOD contra el viewport final. En canvases gigantes el export tarda unos segundos: precio aceptado de la foto completa.

**Resultado**: el fit view del canvas Analytics pasa de **~450 mil a ~2 mil elementos DOM** (392 cajas + wires simples). Sin cambios en MiniMap, selección/zIndex, popup de relación, hover, viewer-lock, stores de data ni endpoints. Las fórmulas y la histéresis están cubiertas por `lodSize.test.ts` (vitest).

### 2.3 Palanca pendiente (NO implementada): dieta del payload

El diagrama de Analytics trae ~99 mil filas cuyo campo `description` el canvas no pinta (solo lo usan el PropertiesPanel y el ViewEditor). Adelgazar el payload del endpoint del diagrama es la segunda palanca identificada en el doc 33, y quedó condicionada: **solo si tras el LOD la APERTURA del canvas sigue lenta**, y midiendo primero con la pestaña Network del navegador (tamaño y timing reales del response, ya con GZip) antes de tocar el backend. A 2026-07-31 no se implementó.

---

## 3. Otras palancas de rendimiento del canvas

Además del LOD, el canvas acumula decisiones de rendimiento que aplican a cualquier tamaño de modelo.

### 3.1 Memoización y selectores estables

- **`React.memo` en los 4 componentes custom** (`TableNode`, `ViewNode`, `CrowFootEdge`, `DerivationEdge`): React Flow re-renderiza los componentes custom en cada update del grafo (pan/zoom/drag); sin memo, un canvas de 100 tablas × 30 columnas repintaría ~3,000 filas y ~6,000 handles por frame.
- **Selección como booleano por nodo**: `TableNode` se suscribe a `s.selectedTableId === table.id`, no al id crudo. Con el id, cambiar la selección re-renderizaba los 100 nodos del canvas; con el booleano, solo los 2 afectados (el que se selecciona y el que se deselecciona).
- **`hotColsKey` como string estable**: el resaltado de columnas al pasar el mouse por un wire usa un selector que devuelve `''` para toda tabla no afectada y un string `id1|id2|…` para las 2 tablas de la relación. El hover de un wire solo re-renderiza esos 2 nodos, no el canvas entero. Los edges usan el mismo patrón con booleanos derivados (`active`/`dimmed`).
- El traer-al-frente del nodo seleccionado es un update liviano de `zIndex` (los nodos no afectados devuelven la misma referencia), sin re-armar el diagrama.

### 3.2 Props de React Flow

| Prop | Valor | Por qué |
|---|---|---|
| `onlyRenderVisibleElements` | activada | Virtualización de viewport: solo montan DOM los nodos visibles. Palanca principal en la navegación con zoom cercano; su límite es el fit view, donde todos los nodos son visibles (§2.1) — ahí releva el LOD. |
| `minZoom` | `0.02` | Los canvases enormes (un auto-arrange de 100 tablas ocupa ≈14,000×19,000 px) necesitan bajar del default 0.5 para verse completos. `fitViewOptions={{ padding: 0.12, minZoom: 0.02 }}` hace que el auto-fit inicial respete el mismo piso. |
| `deleteKeyCode` | `null` | El default (Backspace) borraba tablas/wires solo en pantalla, sin persistir — engañoso en edición y una violación del viewer-lock en readonly. Los borrados reales van por la UI explícita (panel / popup de relación). |
| `connectionMode` | `ConnectionMode.Loose` | (doc 27) Una relación puede empezar y terminar en cualquier lado del nodo — cada columna tiene handle a izquierda y derecha; `onConnect` reorienta padre/hijo según el gesto antes de persistir. |
| `nodesDraggable` | `!readonly` | Viewer-lock: en modo lectura se navega pero no se mueve nada. |

### 3.3 Transporte: una respuesta y GZip

El diagrama completo de un canvas llega en **UNA respuesta**: `GET /api/subject-areas/{sa_id}/diagram` devuelve tablas, columnas, relaciones y vistas de una vez. El pan/zoom no dispara re-consultas: toda la navegación posterior es local al cliente.

Del lado del backend, `GZipMiddleware` (`minimum_size=1024`) comprime todo payload relevante: la metadata del modelo (claves JSON repetidas, nombres) comprime **5–10×** — a escala (diagramas de cientos de tablas, diffs de review), la diferencia entre cientos de KB y varios MB por request.

---

## 4. Escala fuera del canvas

### 4.1 Grilla del reporting virtualizada

`src/features/reporting/components/ResultsGrid.tsx` (Report Designer) usa `@tanstack/react-virtual` 3.14.5 — el único consumidor de esa dependencia:

```ts
const virt = useVirtualizer({
  count: rows.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 34,   // alto estimado por fila (px)
  overscan: 12,             // filas de colchón fuera del viewport
});
```

- Solo montan DOM las filas visibles más el overscan; cada fila se posiciona con `translateY` absoluto sobre un contenedor de alto total `virt.getTotalSize()`.
- **Scroll infinito por cursor keyset**: al quedar a menos de 400 px del fondo (`scrollHeight - scrollTop - clientHeight < 400`) se dispara `onLoadMore` y el backend entrega la página siguiente por cursor — la grilla nunca trae las 400 mil filas del catálogo al navegador.
- **Sort server-side** por click en el header, solo sobre campos indexados (las columnas UDP y los resultados agrupados no son ordenables desde la grilla); el header es sticky.

### 4.2 Export SVG con import dinámico

La captura de imagen del canvas usa `html-to-image` 1.11.13 cargado con `await import('html-to-image')` recién al pulsar "Export image" — la dependencia no infla el bundle inicial de la SPA (mismo criterio que elkjs en §1.1).

El formato es SVG (vectorial) y no PNG: se mantiene nítido a cualquier zoom, es navegable en el navegador, y no rasteriza un bitmap gigante que congele la pestaña en canvases grandes (el PNG con `pixelRatio` 2 lo hacía). Un post-proceso (`injectCrowFootDefs`) inyecta en el SVG exportado los `<defs>` de los marcadores crow's-foot — que viven en un `<svg>` aparte, fuera del viewport capturado — y resuelve las CSS vars a colores literales, para que la imagen standalone muestre cardinalidades y colores idénticos a la pantalla.

---

## Referencias

- [architecture.md](architecture.md) — arquitectura general del frontend (shell, features, stores, servicios).
- [testing.md](testing.md) — suites de verificación y límites conocidos.
- Detalle histórico del diagnóstico y diseño del LOD: doc 33 de `plan-implementacion/` (repo backend). Kit de migración multi-archivo y `arrange_all --project`: docs 32/32b.
