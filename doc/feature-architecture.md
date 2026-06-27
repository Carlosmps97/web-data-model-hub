# Arquitectura de features y guía de colaboración

> Cómo está organizado `web-data-model-hub` para que varias personas construyan
> distintas features en paralelo sin pisarse. Léelo antes de agregar código.
> Complementa a `doc/architecture.md` (la vista de runtime / flujo de datos).

## La forma

La app se divide en **features autocontenidas** dentro de `src/features/`. Cada
una es dueña de su UI, su lógica y sus estilos, y expone una única **API
pública** (su barrel `index.ts`). Los archivos de ruta de Next.js en `src/app/`
son **shells finos**: leen los params y renderizan el *screen* de una feature —
no contienen lógica de negocio.

```
src/
  app/                     # rutas Next = shells de ~10 líneas que renderizan un screen
  components/
    layout/                # shell de la app: AppLayout · Header · Sidebar
    ui/                    # primitivas compartidas del design system (Icon · Modal · …)
  features/<name>/
    components/            # *.tsx — screens, modales, paneles
    hooks/                 # use*.ts (opcional)
    lib/                   # helpers puros + tipos (opcional)
    services/              # clientes HTTP (opcional)
    store/                 # slices de zustand (opcional)
    <name>.css             # estilos de esta feature (globales, clases planas)
    index.ts               # API PÚBLICA — lo único que otros pueden importar
    README.md              # qué administra + responsable
  store/                   # stores de zustand transversales (project · ui · metadata)
  services/                # capa de API transversal (http · projects · canvas · metadata)
  lib/                     # helpers puros transversales (hierarchy · tags · columnRef)
  types/                   # tipos de dominio compartidos (model · api)
  styles/                  # tokens · base · ui · shell (CSS global de toda la app)
```

## La única regla que lo mantiene limpio

**Importa una feature solo a través de su barrel.**

```ts
// ✅ desde cualquier lugar fuera de la feature
import { ERCanvas, Inspector } from '@/features/diagram';

// ❌ nunca alcances los internals
import ERCanvas from '@/features/diagram/components/ERCanvas';

// ✅ dentro de la misma feature, usa rutas relativas
import { nodeHeight } from '../layout/layouts';
```

Por qué: el barrel es el contrato de la feature. Mientras se mantenga estable, su
dueño puede renombrar, mover o dividir todo lo interno sin romper a otros
equipos. Un guard de ESLint (`no-restricted-imports` en `eslint.config.mjs`)
avisa cuando algún código importa internals `@/features/*/...`.

`features/diagram/index.ts` es un buen ejemplo de un barrel bien formado.

## Cómo agregar una feature

1. Copia `src/features/_template/` a `src/features/<name>/`.
2. Construye tus components/hooks/etc. dentro; conecta un shell de ruta en
   `src/app/` que renderice tu screen desde el barrel.
3. Reexporta la superficie pública desde `index.ts` — solo lo que otros necesiten.
4. Pon los estilos en `<name>.css` (usa un prefijo de clase único) y agrega un
   `@import` ordenado en `src/app/globals.css`.
5. Agrega un `README.md` de una línea (qué administra + quién lo mantiene).

> Las features grandes que vienen (la **matriz de permisos** robusta; la
> reconexión del **agente IA**; colaboración sin autoguardado) entran como nuevas
> `features/<name>/` sin tocar las demás.

## Qué queda compartido (no es una feature)

- `components/ui/*` — primitivas del design system reutilizadas en todas partes.
- `components/layout/*` — el shell de la app.
- `store/*`, `services/*`, `lib/*`, `types/*` — temas transversales.
- `styles/{tokens,base,ui,shell}.css` — CSS de toda la app (el design system
  `rd-*`/`dmh-*` + los tokens).

Si algo lo usan dos o más features no relacionadas, va en una carpeta
compartida, no dentro de una feature.
