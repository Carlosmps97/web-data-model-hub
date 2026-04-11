# Design System

## Color Palette

The application uses a carefully curated dark color palette that maintains visual consistency and readability across all components.

### Primary Colors

| Token | Hex | Name | Usage |
|-------|-----|------|-------|
| `--color-bg-primary` | #031926 | Rich Black FOGRA 29 | Main background, canvas |
| `--color-bg-secondary` | #071f2e | Dark Navy | Sidebar, cards, panels |
| `--color-bg-elevated` | #0c2d40 | Deep Teal | Elevated surfaces, hover states |
| `--color-bg-surface` | #0f3547 | Steel Teal | Inputs, dropdowns |

### Accent Colors

| Token | Hex | Name | Usage |
|-------|-----|------|-------|
| `--color-accent-primary` | #468189 | Metallic Seaweed | Primary buttons, active states, accents |
| `--color-accent-secondary` | #77ACA2 | Green Sheen | Relationship edges, secondary actions |
| `--color-accent-tertiary` | #9DBEBB | Opal | Borders, secondary text, badges |

### Text Colors

| Token | Hex | Name | Usage |
|-------|-----|------|-------|
| `--color-text-primary` | #F4E9CD | Champagne | Primary text, headings |
| `--color-text-secondary` | #9DBEBB | Opal | Secondary text, descriptions |
| `--color-text-muted` | #5d8e87 | Muted Teal | Labels, placeholders, timestamps |
| `--color-text-inverse` | #031926 | Rich Black | Text on gradient buttons |

### State Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | #6ecf8e | Success states, confirmations |
| `--color-warning` | #f0c674 | Primary key badges, warnings |
| `--color-error` | #e06c75 | Delete actions, errors |
| `--color-info` | #77ACA2 | Info badges, tooltips |

## Typography

### Font Families

- **Sans-serif (UI text)**: Inter - Google Fonts
  - Weights used: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semi-bold), 700 (Bold)
- **Monospace (Code)**: JetBrains Mono - Google Fonts
  - Used for: DBML editor, data types, code references
  - Weights used: 400 (Regular), 500 (Medium), 600 (Semi-bold)

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 0.75rem (12px) | Labels, badges, column details |
| `--text-sm` | 0.8125rem (13px) | Body text, descriptions |
| `--text-base` | 0.9375rem (15px) | Default text, inputs |
| `--text-lg` | 1.125rem (18px) | Section titles, modal headers |
| `--text-xl` | 1.3125rem (21px) | Sub-headings |
| `--text-2xl` | 1.625rem (26px) | Page headings |
| `--text-3xl` | 2rem (32px) | Hero text |
| `--text-4xl` | 2.5rem (40px) | Large display text |

## Component Patterns

### Glassmorphism

Used for cards and elevated surfaces:

```css
background: rgba(12, 45, 64, 0.65);
backdrop-filter: blur(16px);
border: 1px solid rgba(157, 190, 187, 0.18);
border-radius: 14px;
box-shadow: 0 4px 16px rgba(3, 25, 38, 0.5);
```

### Button Variants

- **Primary**: Gradient background (Metallic Seaweed to Green Sheen), inverse text, glow shadow
- **Secondary**: Elevated background, border, primary text
- **Ghost**: Transparent background, muted text, background on hover
- **Danger**: Red-tinted background, red text, red border
- **Icon**: Square aspect ratio, used for toolbar actions

### Spacing Scale

Based on 4px grid:
- `--space-1`: 4px | `--space-2`: 8px | `--space-3`: 12px | `--space-4`: 16px
- `--space-5`: 20px | `--space-6`: 24px | `--space-8`: 32px | `--space-10`: 40px

### Border Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Small elements, badges |
| `--radius-md` | 10px | Buttons, inputs |
| `--radius-lg` | 14px | Cards, panels |
| `--radius-xl` | 20px | Modals |
| `--radius-full` | 9999px | Pills, circles |

## Animations

### Transitions

- **Fast** (150ms): Hover states, toggles, color changes
- **Normal** (250ms): Panel reveals, card interactions
- **Slow** (400ms): Page transitions, complex animations
- **Spring** (500ms): Modal entries, scale-in effects

### Keyframe Animations

- `fadeIn` / `fadeOut`: Opacity transitions for mounting/unmounting
- `slideUp`: Entry from below (cards, project grid items)
- `slideInRight`: Panel entry from right (right panel, chat)
- `scaleIn`: Modal entry with subtle scale effect
- `pulse`: Loading indicators
- `shimmer`: Skeleton loading placeholders

## Table Node Design

The ER diagram table nodes follow a specific visual hierarchy:

1. **Header**: Gradient bar (Metallic Seaweed to Green Sheen) with table name and column count
2. **Column list**: Each row shows key icon, column name, and data type in monospace
3. **Key badges**: Color-coded by type:
   - PK (Primary Key): Warning/gold background
   - FK (Foreign Key): Green Sheen background
   - SK (Surrogate Key): Metallic Seaweed background
4. **Footer**: Truncated functional definition in muted text
5. **Selected state**: Accent border with glow shadow

## Relationship Edge Design

- Line color: #77ACA2 (Green Sheen)
- Line width: 2px
- Connector: Smooth curve
- Router: ER-specific routing for clean intersections
- Target marker: Classic arrow (8px)
- Label: Cardinality notation (1:1, 1:N, N:M) at midpoint
- Label background: Dark pill with subtle border
