# Set de iconos del ribbon (M4 · Fase A-7)

El ribbon del modeler (`features/modeler/components/Toolbar.tsx`) es **solo-iconos**, estilo
MS Office / Erwin ER360: botones cuadrados (`.wk-ic`) sin texto, agrupados por secciones
con divisores (`.wk-sep`) y **tooltip flotante** al hover (`components/ui/Tooltip.tsx`,
renderizado por portal para no sufrir clipping del overflow de la toolbar).

- **Iconos genéricos:** [`lucide-react`](https://lucide.dev/icons) — referenciados por nombre de export.
- **Iconos ER (crow's-foot):** custom en `features/modeler/components/RelIcon.tsx` (`<RelIcon kind="…" />`),
  SVG mini con la cardinalidad dibujada en cada extremo (barra = uno, pata = muchos, círculo = cero;
  línea sólida = identificadora, punteada = no identificadora).

## Objetos

| Acción | Icono | Fuente | Tooltip |
| --- | --- | --- | --- |
| Nueva tabla | `Table2` | lucide-react | Nueva tabla |
| Agregar tabla existente | `Rows3` | lucide-react | Agregar tabla existente |
| CTAS (crear desde existentes) | `Combine` | lucide-react | CTAS — crear desde existentes |

## Relaciones (presets crow's-foot)

| Acción | Icono | Fuente | Tooltip |
| --- | --- | --- | --- |
| Uno a muchos | `RelIcon kind="1:N"` | RelIcon (custom) | Relación uno a muchos |
| Uno a uno | `RelIcon kind="1:1"` | RelIcon (custom) | Relación uno a uno |
| Cero a muchos | `RelIcon kind="0:N"` | RelIcon (custom) | Relación cero a muchos |
| Muchos a muchos | `RelIcon kind="N:M"` | RelIcon (custom) | Relación muchos a muchos |
| Identificadora (FK→PK) | `RelIcon kind="ID"` | RelIcon (custom) | Relación identificadora (FK→PK) |

> El preset activo se marca con `.wk-ic.active`. Con un preset activo, se dibuja la relación
> arrastrando de una columna a otra en el canvas.

## Edición

| Acción | Icono | Fuente | Tooltip |
| --- | --- | --- | --- |
| Eliminar selección | `Trash2` | lucide-react | Eliminar selección |
| Auto-organizar (ELK) | `Network` | lucide-react | Auto-organizar |

> **Eliminar** borra lo seleccionado (relación o tabla del diagrama). La selección se hace
> con **clic** sobre el wire en el canvas (se resalta); **doble clic** abre el editor de
> cardinalidad. El borrado usa `ConfirmDialog` (diálogo con estilo) — **sin `confirm()` nativo**.
> Borrar una tabla la **quita del diagrama** (no la elimina del catálogo canónico).

## Gobierno

| Acción | Icono | Fuente | Tooltip |
| --- | --- | --- | --- |
| UDP (glossary) | `BookA` | lucide-react | UDP (glossary) |
| Parent Domains | `Shapes` | lucide-react | Parent Domains |
| Catálogo canónico | `Library` | lucide-react | Catálogo canónico |
| Aprobaciones | `ClipboardCheck` | lucide-react | Aprobaciones |

## Changeset (derecha)

| Acción | Icono | Fuente | Tooltip |
| --- | --- | --- | --- |
| Usuario (dev) | `User` | lucide-react | Usuario (dev) |
| Nuevo changeset | `GitBranchPlus` | lucide-react | Nuevo changeset |
| Publicar para revisión | `Send` | lucide-react | Publicar para revisión |

> Entre el icono de usuario y los botones hay dos `<select>` (`.wk-cs`): usuario dev y
> changeset activo (Publicado read-only / drafts propios).

## Versión

`lucide-react@1.21.0`. Los 12 nombres de export usados se verificaron contra el paquete
instalado (todos existen; sin sustituciones).
