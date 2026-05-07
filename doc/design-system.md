# Design System

> Sistema visual del frontend `web-data-model-hub`. Las decisiones de
> tema (colores, tipografía, espaciado, animaciones) viven como CSS
> variables HSL en `src/styles/globals.css` y se exponen al resto del
> stack vía Tailwind CSS y `class-variance-authority`.

## 1. Stack visual

| Capa | Stack |
|------|-------|
| **Estilo** | Tailwind CSS 4 (con `@theme inline`) |
| **Variantes de componente** | `class-variance-authority` + `tailwind-merge` |
| **Iconos** | `lucide-react` |
| **Componentes base** | `@radix-ui/*` headless (Dialog, Popover, Dropdown, Tooltip, Tabs, Select, Toast) |
| **Animaciones** | `tailwindcss-animate` + keyframes propios en `globals.css` |
| **Tipografía** | system stack (`-apple-system, "Segoe UI", Roboto, …`) — sin webfont para mantener LCP rápido |

---

## 2. Tokens de color (HSL)

Los tokens se declaran en `:root` (light) y `.dark`. Cualquier color
referenciado en código debe ser uno de estos tokens — nunca hex hardcoded.

### 2.1 Light theme

| Token | Valor | Uso |
|-------|-------|-----|
| `--background` | `0 0% 100%` | fondo de la app |
| `--foreground` | `222.2 84% 4.9%` | texto principal |
| `--card` | `0 0% 100%` | superficie elevada |
| `--card-foreground` | `222.2 84% 4.9%` | texto sobre `card` |
| `--primary` | `221.2 83.2% 53.3%` | acción principal (botones CTA) |
| `--primary-foreground` | `210 40% 98%` | texto sobre `primary` |
| `--secondary` | `210 40% 96.1%` | acción secundaria / chips |
| `--muted` | `210 40% 96.1%` | bg de inputs, panels desactivados |
| `--muted-foreground` | `215.4 16.3% 46.9%` | texto secundario |
| `--accent` | `210 40% 96.1%` | hover de items selectionables |
| `--destructive` | `0 84.2% 60.2%` | acción peligrosa / error |
| `--border` | `214.3 31.8% 91.4%` | bordes y separadores |
| `--input` | `214.3 31.8% 91.4%` | borde de inputs |
| `--ring` | `221.2 83.2% 53.3%` | focus ring (a11y) |

### 2.2 Dark theme

Replica los mismos slots con valores invertidos. Activación: clase
`dark` en `<html>` (manejada por `next-themes`). Todo componente que
use `bg-background`, `text-foreground`, `bg-card`, etc. funciona en
ambos modos sin código extra.

### 2.3 Tokens semánticos del modelador

Específicos del dominio de modelamiento, viven aparte:

| Token | Valor (light) | Uso |
|-------|---------------|-----|
| `--er-pk` | `220 75% 55%` | badge PK |
| `--er-fk` | `220 60% 50%` | badge FK |
| `--er-sk` | `30 90% 55%` | badge SK |
| `--er-pt` | `190 60% 45%` | badge partition column |
| `--er-edge` | `220 50% 60%` | edge color del canvas |
| `--er-edge-active` | `220 80% 50%` | edge resaltada |

> Las variantes "engine-color" (PostgreSQL azul, Databricks rojo, etc.)
> se declaran junto a estas y las consume `EngineBadge` para colorear
> chips por motor de BD.

---

## 3. Tipografía y espaciado

### 3.1 Escala tipográfica (Tailwind)

| Clase | px |
|-------|------|
| `text-xs` | 12 |
| `text-sm` | 14 |
| `text-base` | 16 |
| `text-lg` | 18 |
| `text-xl` | 20 |
| `text-2xl` | 24 |

**Convenciones**:

- Encabezados de página: `text-2xl font-semibold`.
- Encabezados de sección dentro de modales: `text-lg font-semibold`.
- Texto de cuerpo: `text-sm`.
- Texto secundario / metadata: `text-xs text-muted-foreground`.
- Código y nombres físicos en SQL: `font-mono text-xs`.

### 3.2 Espaciado

Solo se usa la escala Tailwind (4 px base): `gap-1, gap-2, gap-3, gap-4, gap-6`.
Containers principales: `p-4` o `p-6`. Modales: `p-6`.

### 3.3 Radios

| Token | Valor |
|-------|-------|
| `--radius` | `0.5rem` |
| `rounded-sm` | `calc(var(--radius) - 4px)` |
| `rounded-md` | `calc(var(--radius) - 2px)` |
| `rounded-lg` | `var(--radius)` |
| `rounded-xl` | `calc(var(--radius) + 4px)` |

---

## 4. Componentes primitivos (`src/components/ui/`)

Los componentes shadcn-style se generan a partir de Radix headless +
`cva`. Reglas:

- **Stateless**: estado visual viene por props/clase, no por hooks
  internos.
- **Forward refs**: todos exportan `forwardRef` para que el caller
  conecte refs (autofocus, scroll, etc.).
- **Variantes con `cva`**: `Button` tiene `variant=(default|secondary|ghost|destructive|outline|link)` y `size=(default|sm|lg|icon)`. Misma idea en `Badge`, `Alert`, `Card`.

### Inventario actual

| Primitive | Notas |
|-----------|-------|
| `Button` | Single source of truth para CTAs. Soporta `asChild` (Radix Slot) para wraps tipo `<Link>`. |
| `Input` / `Textarea` | Borde `--input`, focus ring `--ring`. |
| `Select` | Wrapper de `@radix-ui/react-select` con estilos consistentes. |
| `Dialog` / `AlertDialog` | Modales y confirmaciones. `ConfirmDialog` (composite) está en `components/ConfirmDialog.tsx` y soporta "no preguntar más en esta sesión" para acciones destructivas frecuentes. |
| `Popover` | Usado por `AutoArrangePopover`, `EngineSelect` y submenús del canvas. |
| `Tabs` | Radix tabs con underline animado. |
| `Tooltip` | Activación 200 ms hover delay. |
| `Toast` | Singleton via `useToast()`. Variantes `default`, `destructive`. |
| `DropdownMenu` | Para menús contextuales (gear de tabla, more actions). |
| `Card` | Container con `border + shadow-sm + p-6`. |
| `Badge` | Pequeñas etiquetas (engine, dominio, count). |
| `ScrollArea` | Wrapper de Radix ScrollArea para contenido largo en panels. |

---

## 5. Componentes específicos del dominio

### 5.1 `EngineBadge` (`features/engines/`)

Badge coloreado por motor de BD. El color sale de `engineColor[engine]`
en `engines/engineColors.ts`. Se usa en cards de modelo, headers de
canvas y en cada toolbar de DDL.

### 5.2 `TableNode` (`features/diagram/components/TableNode.tsx`)

- Header: `bg-card`, borde `--border`, sombra `shadow-md`. Activado:
  `ring-2 ring-primary`.
- Filas: alternancia con `even:bg-muted/40`. Activa: `bg-primary/10`.
- Iconos PK/FK/SK/PT con `text-er-*` correspondiente.
- Tipo de dato en `font-mono text-xs text-muted-foreground`.

### 5.3 `AnimatedEREdge`

- Color base: `var(--er-edge)`.
- Color activo: `var(--er-edge-active)`, `stroke-width: 2.5`.
- Animación: `animation: dash 1.2s linear infinite` con
  `stroke-dasharray: 6 4` cuando highlighted.

### 5.4 `ChatPanel` (`features/chat-agent/`)

- Slide-in derecho ancho 480 px.
- Mensajes del usuario: `bg-primary/10 text-primary-foreground` align right.
- Mensajes del agente: `bg-muted` align left.
- Bloque de resultado del modelo (`ModelResultBlock`): card expandible
  con preview de tablas y botón "Aplicar al canvas".
- **Loading "dog state"**: imagen animada cuando el agente está
  procesando, con timer en segundos y línea de log discreta.

### 5.5 `LoginPage` (`app/login/page.tsx`)

- Layout split: hero a la izquierda con gradiente
  (`bg-gradient-to-br from-primary/20 via-primary/5 to-background`),
  formulario a la derecha en `Card` centrado.
- Form errors usan `Alert variant="destructive"` con copy en
  castellano.

### 5.6 `AdminUsersPage` (`app/admin/users/page.tsx`)

- Tabla densa (`text-sm`) con columnas: Username, Role, Active,
  Permissions count, Last Login, Actions.
- Edición de permisos en `<Dialog>` con árbol jerárquico
  Project → Models, checkboxes view/edit por nivel.

### 5.7 `DashboardPage` (`app/dashboard/page.tsx`)

- Grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` de `Card`s con
  KPIs (proyectos, modelos, tablas, columnas).
- Gráfico de barras (Recharts) con la distribución por engine.

---

## 6. Animaciones

Definidas en `globals.css` y consumidas vía `tailwindcss-animate`:

| Keyframe | Uso |
|----------|-----|
| `accordion-down` / `accordion-up` | acordeones de sidebars |
| `slide-in-right` | `ChatPanel` y modales drawer |
| `fade-in` | mensajes nuevos del chat |
| `pulse-active-edge` | edge resaltada al hacer hover de tabla |
| `dog-bounce` | loading del agente |

> Toda animación respeta `prefers-reduced-motion`: `tailwindcss-animate`
> desactiva keyframes automáticamente y nuestras animaciones custom
> usan media query `@media (prefers-reduced-motion: reduce)`.

---

## 7. Reglas de uso

1. **No hardcodear hex/rgb**: usar `bg-primary`, `text-foreground`,
   `border-border`, etc. Si no existe el token, agregar el slot al
   theme antes que un color suelto.
2. **No mezclar estilos inline con Tailwind** (excepto coordenadas
   computadas de React Flow).
3. **`cn()` para combinar clases condicionales**:
   ```tsx
   <Button
     variant={isActive ? 'default' : 'ghost'}
     className={cn('gap-2', isFullWidth && 'w-full')}
   />
   ```
4. **Iconos con `lucide-react` siempre**, tamaño por defecto
   `w-4 h-4`, en chips `w-3 h-3`. Color heredado del texto.
5. **Modales con `Dialog`** (Radix) — nunca custom positioned divs.
   Confirmaciones destructivas: `ConfirmDialog` para que la opción
   "no preguntar más en esta sesión" funcione consistentemente.
6. **Toasts para feedback async** (auto-save, login error, copy DDL,
   etc.). Errores 401 disparan logout en lugar de toast.
7. **Estados disabled vs hidden**: si el usuario no tiene permiso para
   una acción, deshabilitarla con tooltip explicativo en vez de
   esconderla. La excepción: rutas completas (admin) que el usuario
   no debe siquiera saber que existen.

---

## 8. Accesibilidad

- **Focus visible**: `ring-2 ring-ring ring-offset-2` aplicado por
  Radix automáticamente. No removerlo con `outline-none` sin
  reemplazo.
- **Contraste**: tokens elegidos para AA en ambos temas. Si
  introduces un nuevo token, validá con un checker.
- **Etiquetas semánticas**: `<button>` para acciones, `<a>` para
  navegación. Iconos solos siempre con `aria-label`.
- **Atajos de teclado**: `Esc` cierra modales y popovers (lo da Radix
  gratis). El canvas soporta arrastrar con click+drag y zoom con
  scroll/pinch — sin atajos custom para no chocar con extensiones.

---

## 9. Convenciones por archivo

```
src/
├── components/ui/*          # primitives shadcn (Button, Dialog, ...)
├── components/*             # composites compartidos (ConfirmDialog, AppLayout, ...)
├── features/<feature>/
│   ├── components/          # componentes específicos
│   ├── utils/               # helpers puros (parsers, generators)
│   └── index.ts             # barrel
└── styles/globals.css       # tokens + keyframes
```

Reglas:

- **Cada feature** tiene su propia carpeta con `components/` y
  `utils/`. No imports cross-feature directos: importar desde el
  barrel (`@/features/ddl`) o promover el código a `lib/`.
- **`components/ui/`** solo contiene primitives generados por shadcn.
  Nada de lógica de dominio.
- **`features/<x>/utils/`** funciones puras testables sin React.
