# Design System

The application uses a **light theme** built on cream-to-teal color palette, defined entirely as CSS custom properties in `src/app/globals.css`.

## Color Palette

### Background Colors (light → dark)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg-canvas` | `#FAFAF8` | Diagram canvas background |
| `--color-bg-primary` | `#FBF7EE` | App main background |
| `--color-bg-secondary` | `#F4E9CD` | Champagne — sidebar, cards |
| `--color-bg-elevated` | `#FFFFFF` | Modals, panels, popovers |
| `--color-bg-surface` | `#F7F1E3` | Inputs, dropdowns |
| `--color-bg-hover` | `#EDE5D1` | Hover states |
| `--color-bg-active` | `#E5DBBD` | Active / pressed states |

### Accent Colors

| Token | Hex | Name | Usage |
|-------|-----|------|-------|
| `--color-accent-primary` | `#468189` | Metallic Seaweed | Buttons, table node headers, selected border |
| `--color-accent-primary-hover` | `#3a6d74` | — | Button hover |
| `--color-accent-secondary` | `#77ACA2` | Green Sheen | Edge wires, secondary actions, flow animation |
| `--color-accent-tertiary` | `#9DBEBB` | Opal | Borders, badges, muted accents |
| `--color-accent-muted` | `rgba(70,129,137,0.12)` | — | Active column row highlight background |

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text-primary` | `#031926` | Rich Black — headings, body |
| `--color-text-secondary` | `#3a5a60` | Descriptions, labels |
| `--color-text-muted` | `#6b8f8a` | Placeholders, timestamps |
| `--color-text-inverse` | `#FFFFFF` | Text on dark/gradient surfaces |

### State Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#2e9e5a` | Success confirmations |
| `--color-warning` | `#d4930d` | PK badge background |
| `--color-error` | `#c5403a` | Delete actions, validation errors |
| `--color-info` | `#468189` | Info indicators |

## Typography

### Fonts

- **Inter** (sans-serif) — loaded from Google Fonts; weights 300 / 400 / 500 / 600 / 700
- **JetBrains Mono** (monospace) — DBML editor, column data types, code blocks; weights 400 / 500 / 600

### Type Scale

| Token | `rem` | `px` | Usage |
|-------|-------|------|-------|
| `--text-xs` | 0.75 | 12 | Column data types, badges, tooltips |
| `--text-sm` | 0.8125 | 13 | Body, descriptions, sidebar items |
| `--text-base` | 0.875 | 14 | Default inputs, table names |
| `--text-lg` | 1.0625 | 17 | Section titles |
| `--text-xl` | 1.25 | 20 | Sub-headings |
| `--text-2xl` | 1.5 | 24 | Page headings |
| `--text-3xl` | 1.875 | 30 | Hero / dashboard text |
| `--text-4xl` | 2.25 | 36 | Large display |

## Spacing Scale (4px grid)

| Token | Value |
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

## Border Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Badges, small chips |
| `--radius-md` | 8px | Buttons, inputs, tooltips |
| `--radius-lg` | 12px | Cards, panels, popovers |
| `--radius-xl` | 16px | Modals |
| `--radius-full` | 9999px | Pills, circles |

## Button Variants

| Class | Appearance |
|-------|-----------|
| `.btn-primary` | Gradient (`#468189 → #5a9aa2`), white text, glow shadow |
| `.btn-secondary` | White bg, teal border, primary text |
| `.btn-ghost` | Transparent, muted text; hover adds `bg-hover` |
| `.btn-danger` | Red-tinted bg, red border, red text |
| `.btn-icon` | Square, used for toolbar actions |
| `.btn-sm` | Reduced padding + font size |

## Transitions

| Token | Duration | Usage |
|-------|----------|-------|
| `--transition-fast` | 150ms | Hover states, toggles, color changes |
| `--transition-normal` | 250ms | Panel reveals, card hover |
| `--transition-slow` | 400ms | Page/modal transitions, auto-arrange `fitView` |
| `--transition-spring` | 500ms cubic-bezier(0.34,1.56,0.64,1) | Modal scale-in entry |

## Keyframe Animations

| Name | Effect |
|------|--------|
| `fadeIn` / `fadeOut` | Opacity mount/unmount |
| `slideUp` | Cards/grid items enter from below |
| `slideInRight` | Right panel, chat panel enter from right |
| `scaleIn` | Modal scale + fade entry |
| `pulse` | Loading indicators |
| `shimmer` | Skeleton loading placeholders |
| `erEdgeFlow` | `stroke-dashoffset` animation on active ER edges |

## Table Node Design

```
┌────────────────────────────────────┐
│  table_name                    [N] │  ← Header (#468189 solid bg, white text)
├────────────────────────────────────┤
│  [PK]  id          ◇  integer      │  ← PK row (gold badge)
│  [FK]  user_id     ◇  integer      │  ← FK row (teal badge)
│   •    username       varchar(50)  │  ← Regular column (dot bullet)
├────────────────────────────────────┤
│  Functional definition text…       │  ← Footer (muted, italic, truncated)
└────────────────────────────────────┘
```

- **Header**: `#468189` background, white table name, column-count badge
- **Column rows**: 28px height; key icon (16×16px), column name, nullable diamond `◇`, data type in monospace
- **Key badges**: PK = `--color-warning` gold | FK = Green Sheen teal | SK = Metallic Seaweed | PT = gold (same as PK)
- **Active-relation row** (`.active-relation-row`): `--color-accent-muted` bg + left border `#468189`
- **Selected node**: teal box-shadow glow + border `#468189`
- **Hover tooltip**: dark pill (`#1a2e35`) showing column name, data type, functional definition, FK reference if applicable; appears for **every** column on hover

## Relationship Edge Design

| Property | Value |
|----------|-------|
| Default color | `#5a8fa0` |
| Active/hover color | `#3d7a82` |
| Dimmed color | `#d6dbd9` |
| Line width | 1.5px default / 2px active |
| Path style | Sharp orthogonal step (`borderRadius: 0`) |
| Routing | Same-side (L→L or R→R) when nodes overlap horizontally; opposite-side (R→L) when clear gap |
| Parallel offset | `20 + edgeIndex × 16` px — prevents wires sharing the same vertical line |
| Endpoint circles | 4px hollow circles at source + target |
| Cardinality labels | `*` / `0..1` / `1` positioned near endpoints |
| Flow animation | `er-edge-flow-anim` class: `stroke-dasharray: 6 4`, animates on hover or table selection |

## Auto-Arrange Popover

Floating card (`white`, `border-radius: 12px`, `box-shadow: 0 8px 32px rgba(3,25,38,0.15)`) containing three options. Each option has:
- SVG icon (28×28px, `--color-text-secondary`)
- Bold label + numbered badge
- Small description text (`--color-text-muted`)
