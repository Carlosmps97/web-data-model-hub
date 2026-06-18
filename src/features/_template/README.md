# `_template` — punto de partida para una feature nueva

Copia esta carpeta a `src/features/<tu-feature>/`, renómbrala y complétala.

```
features/<tu-feature>/
  components/        # *.tsx — la UI de la feature (screens, modales, paneles)
  hooks/             # use*.ts — lógica con estado (opcional)
  lib/               # helpers puros + tipos, sin React (opcional)
  services/          # clientes HTTP de esta feature (opcional)
  store/             # slices de zustand de esta feature (opcional)
  <tu-feature>.css   # estilos de la feature (globales, clases planas)
  index.ts           # API PÚBLICA — lo único que otros pueden importar
  README.md          # una línea: qué administra esta feature + responsable
```

## Reglas

1. **Una sola puerta pública.** El código externo importa solo desde
   `@/features/<name>` (el barrel `index.ts`). Nunca debe importar una ruta
   interna como `@/features/<name>/components/Algo`. El guard de ESLint avisa
   ante violaciones.
2. **Relativo por dentro.** Dentro de la feature, importa hermanos con rutas
   `./`.
3. **Dueño de tu CSS.** Pon los estilos de la feature en `<tu-feature>.css` con
   el prefijo de clase de la feature, y agrega una línea `@import` en
   `src/app/globals.css` (respeta el orden de imports). No agregues reglas al
   CSS de otras features.
4. **Compón vía barrels.** Si necesitas otra feature, importa su barrel
   (p. ej. `import { ERCanvas } from '@/features/diagram'`). Mantén pocas
   dependencias entre features y en una sola dirección.

`features/chat-agent` es la implementación de referencia de esta convención.
