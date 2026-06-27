# Design System — Aurora

> Sistema visual del frontend `web-data-model-hub`. Tema claro único, **sin dark mode, sin emoji**.
> Los tokens viven como CSS custom properties en `src/app/globals.css` (`:root`); las clases
> base (`rd-*`, `dmh-*`, `ed-*`, `mc-*`, `doc-*`) están en ese mismo archivo. Portado del
> prototipo `newStyleWeb/Redesign/{redesign.css, app/app.css}`.

## Tipografía
- **UI:** Manrope (400/500/600/700/800) — `var(--ui)`, cargada con `next/font` (`--font-manrope`).
- **Mono** (tipos de dato, SQL, identificadores): JetBrains Mono — `var(--mono)` (`--font-jbmono`).
- Escala: h1 26/800, h2 19/700, h3 15/700, body 13.5–15.5/1.6–1.75, small 12, mono 10.5–12.
- Ancho de lectura en docs ~72ch.

## Color (tokens)
| Token | Valor | Uso |
|---|---|---|
| `--primary` | `#4f46e5` | marca / acciones primarias (indigo) |
| `--primary-700` | `#4338ca` | hover/active |
| `--primary-soft` | `#eef0fe` | tintes, filas seleccionadas |
| `--flow` | `#0d9488` | **teal** — wire de relación activo + acentos "flow" |
| `--flow-700` | `#0f766e` | énfasis flow |
| `--accent2` | `#7c3aed` | violeta — acento (reservado) |
| `--ink` `#14161c` · `--ink-2` `#3d4453` · `--muted` `#6b7280` · `--subtle` `#99a1ae` | | escala de texto |
| `--surface` `#ffffff` · `--surface-2` `#fafbfc` · `--bg` `#f5f6f8` · `--canvas` `#eceff4` | | superficies |
| `--border` `#e4e7ec` · `--border-soft` `#eef0f3` · `--border-strong` `#d3d8e0` | | bordes |
| `--success` `#15a34a` · `--warning` `#d97706` · `--error` `#dc2626` | | semánticos (+ `*-soft`) |

**Chips de clave ER:** PK `--k-pk #b45309` · FK `--k-fk #0d9488` · SK `--k-sk #7c3aed` · PT `--k-pt #0e7490` (cada uno sobre su tinte `*-soft`).

**Dominios y Modelos llevan su propio color** (almacenado por entidad); badges/pills/headers lo derivan.

## Forma / elevación
- Radios: `--r-sm 7` · `--r 11` · `--r-lg 15` · `--r-xl 20` · `--r-full`.
- Sombras: `--shadow-xs/sm/md/lg` (suaves, bajo contraste).
- Espaciado base 4px. Densidad equilibrada.

## Iconografía
- Set de un solo trazo (1.5–2px) en `src/components/ui/Icon.tsx` (portado de `Redesign/parts/icons.jsx`). **Sin emoji.**

## Componentes base (clases)
- Botones `rd-btn` (+ `-primary/-secondary/-ghost/-danger`, `-sm/-lg/-icon`).
- Badges `rd-badge` (+ `-primary/-neutral/-success/-warning/-flow`), engine chip `rd-engine`, key chip `rd-key`.
- Inputs `rd-input` + `rd-label` + `rd-search`; segmented `rd-seg`; toggle `rd-toggle`; tabs `rd-tabs`; menú `rd-menu`; tooltip `rd-tip`; card `rd-card`.
- Shell: rail `dmh-rail` (64px), top bar `dmh-top` + breadcrumbs `dmh-crumbs`, página `dmh-page`, cards de proyecto `dmh-pcard`, modal `dmh-backdrop`/`dmh-modal` (`Modal` shell), toasts (`sonner`).
- Editor: `ed-side` (rail de tablas), `ed-canvas`/`er-*` (canvas propio, sin React Flow), `rd-node`/`rd-row` (nodo ER), `rd-dock` (dock flotante), `ed-minimap`, `ed-inspector`/`ins-*`, `ed-scope-*` (scope).
- Model Center: `dash-*` / `mc-*` (stat cards, barras, data grid).
- Help Center: `doc-*` (hero, cards, artículo, callouts, steps, drawer).
