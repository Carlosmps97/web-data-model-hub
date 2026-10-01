# Documentación del frontend — Data Model Hub

Actualizado: 2026-07-31.

`web-data-model-hub` es la interfaz web del **Data Model Hub (DMH)**: una SPA en **React 19 + TypeScript**, construida con **Vite**, que cubre el modelado ER en canvas (React Flow + ELK), el reporting con motor de consulta, los Data Standards (incluidas las reglas del DDL Export), la revisión/aprobación de cambios y la administración RBAC. En producción la sirve un servidor Node propio (`server.mjs`, cero dependencias) que además proxya `/api` hacia el backend FastAPI con un token OAuth M2M — el navegador solo habla con un origen.

## Orden de lectura

| # | Documento | Qué responde |
|---|-----------|--------------|
| 1 | [architecture.md](architecture.md) | La visión completa: stack y librerías con versiones exactas y su uso real, scaffolding de `src/` (features, services, stores), routing, el canvas y el servidor de producción. **Punto de entrada.** |
| 2 | [consideraciones-tecnicas.md](consideraciones-tecnicas.md) | Las decisiones técnicas grandes: el auto-layout con ELK (algoritmo `layered`/Sugiyama y cada opción usada) y la renderización a escala (LOD/zoom semántico, virtualización, memoización). |
| 3 | [data-flow.md](data-flow.md) | Los flujos end-to-end: login/boot, apertura de canvas, edición → changeset → review → publish, auto-arrange, reporting y Export DDL con reglas. |
| 4 | [api-reference.md](api-reference.md) | La API tal como la consume el frontend: cliente HTTP, endpoints por pantalla/servicio y tabla maestra. |
| 5 | [design-system.md](design-system.md) | Identidad visual: tokens, tipografía Geist/Geist Mono, convenciones de estilos, componentes UI y el vocabulario visual del canvas. |
| 6 | [seguridad.md](seguridad.md) | Autenticación en producción (SSO de Databricks Apps + un solo origen), manejo del token de sesión, gating RBAC y ausencia de secretos en el bundle. |
| 7 | [deployment.md](deployment.md) | Cómo y dónde corre: `server.mjs`, el bundle de Databricks Apps, GitHub Variables, `BACKEND_API_URL` vs `VITE_API_URL` y el checklist de despliegue. |
| 8 | [testing.md](testing.md) | 1 974 tests con Vitest en 210 archivos al 2026-09-30, verdes también en orden aleatorio (incluidos los 15 del servidor de producción), gate de tipos con tsc sin errores, ESLint sin errores, y los límites/consideraciones conocidos. |

## Stack en una mirada

- **Lenguaje**: TypeScript `5.9.3` (`strict`), gate `tsc --noEmit` dentro del build.
- **UI**: React `19.2.4` + react-router-dom `7.18.0` + Zustand `5.0.12` (estado global).
- **Canvas ER**: @xyflow/react (React Flow) `12.11.0` + elkjs `0.11.1` (auto-layout `layered`).
- **Escala**: LOD/zoom semántico propio (`lib/lodSize.ts`) + @tanstack/react-virtual `3.14.5` (grilla del reporting).
- **Build/test**: Vite `6.4.3` + Vitest `2.1.9` + ESLint 9 (flat config con guard de límites entre features).
- **Runtime de producción**: `server.mjs` (Node puro — estáticos + proxy `/api` con token M2M).
- **Otros**: sonner (toasts), lucide-react (íconos), xlsx (export Excel), html-to-image (export SVG), yaml (editor de reglas DDL), Geist/Geist Mono self-hosted.
- Todas las dependencias están **pineadas exactas** (sin `^` ni `~`; política 2026-07-31).

## Convenciones de esta documentación

- Prosa en español (Perú); los términos técnicos, rutas, variables y comandos se citan en su forma original. La UI de la aplicación está 100% en inglés y sus pantallas/botones se citan tal como aparecen ("Data Standards", "Export DDL", "Find a Table").
- Fechas siempre absolutas (AAAA-MM-DD).
- Los documentos de diseño e historia de cada cambio viven en `plan-implementacion/` (repositorio de trabajo); esta carpeta `doc/` es la referencia estable y autosuficiente.
