# Stack tecnológico

Este documento lista el runtime y las dependencias de la web con su versión exacta y el lugar donde se
usa cada una, y explica la política de versiones fijadas y el procedimiento para actualizar una
dependencia. Está dirigido a quien instala el proyecto, revisa dependencias o necesita subir una versión.
La fuente de verdad es `package.json`; este documento lo describe.

## Contenido

- [Runtime: Node.js y npm](#runtime-nodejs-y-npm)
- [Dependencias de ejecución](#dependencias-de-ejecución)
- [Dependencias de desarrollo](#dependencias-de-desarrollo)
- [Piezas sin dependencia npm](#piezas-sin-dependencia-npm)
- [Scripts npm](#scripts-npm)
- [Política de versiones fijadas](#política-de-versiones-fijadas)
- [Cómo actualizar una dependencia](#cómo-actualizar-una-dependencia)
- [Documentos relacionados](#documentos-relacionados)

## Runtime: Node.js y npm

- **Node.js 20 o superior.** `package.json` no declara `engines`; el mínimo sale de las dependencias:
  `react-router-dom` exige Node `>=20.0.0`, Vite 6 admite `^18 || ^20 || >=22` y ESLint 9 exige
  `^18.18 || ^20.9 || >=21.1`. Los tipos de Node están fijados en la línea 20 (`@types/node` `20.19.39`).
  La API `AbortSignal.any`, que usa el cliente HTTP y se ejercita en las pruebas con entorno `node`,
  requiere Node 20.3 o superior.
- **npm** con `package-lock.json` en formato `lockfileVersion: 3`. El proyecto es un módulo ES
  (`"type": "module"`).
- **En Databricks Apps** la versión de Node la provee el runtime de la plataforma: el repositorio no la
  fija y el workflow de despliegue no instala Node (el build no corre en GitHub Actions). Como paso previo al
  `command` de `app.yaml`, Databricks Apps ejecuta `npm install` y el script `build` de `package.json`.
  Por eso `app.yaml` no define `NODE_ENV=production`: el build necesita las `devDependencies`
  (TypeScript y Vite).

## Dependencias de ejecución

Son las que terminan en el bundle del navegador (`dependencies` de `package.json`).

| Paquete | Versión | Uso real |
|---|---|---|
| `react` | `19.2.4` | Componentes y hooks de toda la UI. |
| `react-dom` | `19.2.4` | `createRoot` en `src/main.tsx`; `createPortal` para menús, tooltips y diálogos (`components/ui/Dialog.tsx`, `Tooltip.tsx`, `features/modeler/components/FloatingPanel.tsx`, `SearchSelect.tsx`, `Toolbar.tsx`); `flushSync` en `useToolbarFit.ts`. Las pruebas usan `react-dom/server` para renderizar a HTML. |
| `react-router-dom` | `7.18.4` | `BrowserRouter`, rutas y guards (`src/App.tsx`, `features/auth/guards.tsx`), navegación (`useNavigate`) y parámetros de búsqueda en pantallas. |
| `zustand` | `5.0.12` | Stores globales de `src/store/` y la cola de diálogos de `components/ui/dialogs.tsx`. |
| `@xyflow/react` | `12.11.0` | React Flow: el canvas del Model (`ModelerCanvas`, nodos y aristas de `features/modeler/components`, utilidades de `features/modeler/lib`, `useModelerStore`). Su hoja de estilos se importa en `src/main.tsx`. |
| `elkjs` | `0.11.1` | Auto-layout con el algoritmo `layered`; único import en `features/modeler/lib/elkLayout.ts` (`elkjs/lib/elk.bundled.js`). |
| `@tanstack/react-virtual` | `3.14.5` | Lista virtualizada de elementos afectados en los popups de impacto; único uso en `components/ui/AffectedTable.tsx`. |
| `sonner` | `2.0.7` | Toasts: un `Toaster` en `src/App.tsx` y llamadas a `toast` en pantallas, componentes y `useModelerStore`. |
| `lucide-react` | `1.21.0` | Íconos SVG de toda la UI. |
| `@fontsource-variable/geist` | `5.2.9` | Tipografía Geist (UI), servida desde el propio build: se importa en `src/main.tsx` y se embebe en los exports del diagrama (`features/modeler/lib/exportFonts.ts`, con `?inline`). |
| `@fontsource-variable/geist-mono` | `5.2.8` | Tipografía Geist Mono (datos y SQL), con el mismo uso que Geist. |
| `xlsx` | `0.20.3` (`file:vendor/xlsx-0.20.3.tgz`) | SheetJS: export a Excel del Reporting (`screens/ReportingScreen.tsx`, `features/reporting/components/SheetTemplateCard.tsx`) y lectura del libro de la carga masiva (`features/upload/lib/parseWorkbook.ts`). |
| `yaml` | `2.9.0` | Lectura y escritura YAML del editor de DDL Export Rules; único import en `features/standards/ddlRules.service.ts`. |
| `fflate` | `0.8.3` | Empaquetado ZIP del export HTML del diagrama (`zipSync`) y compresión del reporte PDF (`zlibSync`); import dinámico en `features/modeler/exportPackage.ts`. |

Los identificadores del cliente se generan con `crypto.randomUUID()` del navegador, sin librería.

Sobre `xlsx`: SheetJS publica sus versiones corregidas solo en su CDN, no en el registro de npm. El
paquete `0.20.3` se guarda en el repositorio como `vendor/xlsx-0.20.3.tgz` y `package.json` lo declara
con `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`; así `npm install` (local, CI y Databricks Apps) lo instala
desde el propio repositorio, sin depender del CDN. `npm audit --omit=dev` no reporta avisos en las
dependencias de ejecución. Ver [Seguridad](08-seguridad.md).

## Dependencias de desarrollo

Se usan para compilar, probar y revisar el código; también se instalan en Databricks Apps porque el build
corre allí.

| Paquete | Versión | Uso real |
|---|---|---|
| `vite` | `6.4.3` | Servidor de desarrollo con HMR (`npm run dev`), que reenvía `/api` con el manejador de `server.mjs`; build de producción a `dist/` (`vite build`) y `vite preview`. Configurado en `vite.config.ts`. |
| `@vitejs/plugin-react` | `4.7.0` | Plugin de React para Vite (JSX y Fast Refresh), registrado en `vite.config.ts`. |
| `typescript` | `5.9.3` | Verificación de tipos con `tsc --noEmit`, primer paso de `npm run build`. Configurado en `tsconfig.json`. |
| `vitest` | `2.1.9` | Pruebas (`npm test`); su configuración vive en `vite.config.ts` (`defineConfig` de `vitest/config`). |
| `eslint` | `9.39.4` | Linter (`npm run lint`) con flat config en `eslint.config.mjs`. |
| `@eslint/js` | `9.39.4` | Reglas recomendadas de JavaScript en `eslint.config.mjs`. |
| `typescript-eslint` | `8.58.1` | Parser y reglas recomendadas de TypeScript; `tseslint.config(...)` arma la configuración. |
| `eslint-plugin-react-hooks` | `7.1.1` | Regla `react-hooks/exhaustive-deps` (advertencia). |
| `@types/react` | `19.2.14` | Tipos de React. |
| `@types/react-dom` | `19.2.3` | Tipos de React DOM. |
| `@types/node` | `20.19.39` | Tipos de los módulos `node:*` que usan la configuración y las pruebas (`vite.config.ts`, `src/architecture.test.ts`). |

## Piezas sin dependencia npm

- **`server.mjs`**: el servidor de producción usa solo módulos de Node (`node:fs`, `node:http`,
  `node:https`, `node:path`, `node:url`) y la API global `fetch`. No suma dependencias.
- **`src/lib/zip.ts`**: escritor ZIP propio (método STORE, sin compresión, con CRC-32) para el export DDL;
  el contenido es texto pequeño y no justifica una librería.
- **Exports del diagrama**: SVG, PDF y HTML se generan con código propio (`features/modeler/lib/sceneSvg.ts`,
  `scenePdf.ts`, `exportHtml.ts`) a partir de una escena calculada, sin librerías de captura de pantalla.

## Scripts npm

| Script | Comando | Uso |
|---|---|---|
| `dev` | `vite` | Servidor de desarrollo en `http://localhost:3000` con proxy de `/api` al backend local. |
| `build` | `tsc --noEmit && vite build` | Verifica tipos y genera `dist/`. Databricks Apps lo ejecuta en cada despliegue o arranque. |
| `preview` | `vite preview` | Sirve `dist/` con Vite para una revisión rápida (sin proxy M2M). |
| `start` | `node server.mjs` | Servidor de producción; es el `command` de `app.yaml`. |
| `test` | `vitest run` | Ejecuta todas las pruebas una vez. |
| `lint` | `eslint .` | Revisa el código con la configuración de `eslint.config.mjs`. |

## Política de versiones fijadas

Todas las dependencias, de ejecución y de desarrollo, se declaran con versión exacta en `package.json`,
sin `^` ni `~`. Con esto:

- un `npm install` en Databricks Apps instala exactamente las versiones validadas, aunque el registro
  publique otras compatibles;
- subir una versión es siempre un cambio explícito y revisable en `package.json` y `package-lock.json`,
  nunca un efecto lateral de una instalación;
- el entorno de desarrollo, el de pruebas y el desplegado resuelven el mismo árbol directo.

La única dependencia que no sale del registro de npm es `xlsx`, que se instala desde el tarball de
`vendor/`. Los avisos de `npm audit` que quedan afectan solo a herramientas de desarrollo (vitest 2, vite,
esbuild), que no llegan al bundle del navegador.

El backend aplica el mismo criterio con versiones fijadas con `==` en sus archivos de requisitos.

## Cómo actualizar una dependencia

1. Revisar qué hay disponible y qué avisos de seguridad existen:

   ```bash
   npm outdated
   npm audit
   ```

2. Instalar la versión elegida de forma exacta, para que `package.json` no reciba `^`:

   ```bash
   npm install --save-exact <paquete>@<versión>
   # dependencia de desarrollo
   npm install --save-exact --save-dev <paquete>@<versión>
   ```

3. Verificar que `package.json` tiene la versión exacta y que `package-lock.json` refleja el
   cambio.
4. Correr la verificación completa:

   ```bash
   npx tsc --noEmit
   npm run lint
   npm test
   npm run build
   ```

5. Probar en local lo que use la dependencia (por ejemplo, el canvas para `@xyflow/react` o `elkjs`, el
   export a Excel y la carga masiva para `xlsx`) con `npm run dev`, y la ruta de producción con
   `npm run build` y `BACKEND_API_URL=http://localhost:8000 node server.mjs`.
6. Hacer commit de `package.json` y `package-lock.json` juntos. El despliegue instala el lockfile
   resultante.

Para subir `xlsx` se descarga el tarball de la versión elegida desde el CDN de SheetJS, se guarda en
`vendor/` con el nombre `xlsx-<versión>.tgz`, se actualiza la ruta `file:` en `package.json`, se corre
`npm install` y se repiten los pasos 3 a 6; el tarball anterior se borra de `vendor/`.

Para quitar una dependencia sin uso se ejecuta `npm uninstall <paquete>` y se repite la verificación del
paso 4.

## Documentos relacionados

- [Arquitectura](02-arquitectura.md)
- [Estructura del proyecto](03-estructura-del-proyecto.md)
- [Seguridad](08-seguridad.md)
- [Despliegue](09-despliegue.md)
- [Pruebas](10-pruebas.md)
