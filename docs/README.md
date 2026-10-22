# Documentación del frontend

Esta carpeta contiene la documentación técnica de la web de Data Model Hub: qué pantallas tiene, cómo está
construida, cómo circulan los datos, cómo se comunica con el backend, cómo se protege, cómo se despliega y
prueba, y qué sistema visual y decisiones de rendimiento la sostienen. La puesta en marcha rápida está en
el [README del repositorio](../README.md).

## Documentos

| Documento | Qué responde |
|---|---|
| [01 · Visión general](01-vision-general.md) | Qué hace la web, qué pantallas tiene y para qué sirve cada una, qué significa cada concepto en la UI, qué ve cada rol y cómo es el recorrido típico de un modelador. |
| [02 · Arquitectura](02-arquitectura.md) | Dónde corre la web, cómo llega cada request al backend, en qué capas se organiza `src/`, qué hace `server.mjs`, cómo se protegen las rutas, qué guarda cada store y cómo se manejan los errores. |
| [03 · Estructura del proyecto](03-estructura-del-proyecto.md) | Qué hay en la raíz y en `src/`, cómo se arma una feature, qué reglas de importación aplica ESLint, qué convenciones siguen código, pruebas y estilos, y cómo se agrega una pantalla o una feature. |
| [04 · Stack tecnológico](04-stack-tecnologico.md) | Qué runtime y dependencias usa, con qué versión exacta y dónde, y cómo se actualiza una dependencia. |
| [05 · Funcionalidades](05-funcionalidades.md) | Qué permite cada pantalla y feature, con qué componentes, stores, servicios y permisos, y qué validaciones, confirmaciones y atajos tiene. |
| [06 · Flujo de datos](06-flujo-de-datos.md) | Cómo viajan los datos del arranque y el login a la publicación de una versión: canvas, escrituras en segundo plano, Undo, revalidación, Reporting, Export DDL y carga Excel. |
| [07 · Integración con la API](07-integracion-con-la-api.md) | Cómo funciona el cliente HTTP, qué cabeceras viajan, cómo se leen el envelope y los errores, qué errores son del proxy y qué endpoint usa cada función de servicio. |
| [08 · Seguridad](08-seguridad.md) | Cómo participa la web en la autenticación, cómo guarda la sesión, qué controla la UI y qué no, cómo se endurecen `server.mjs` y los exports, y qué revisar antes de desplegar. |
| [09 · Despliegue](09-despliegue.md) | Cómo se compila y despliega en Databricks Apps con GitHub Actions, qué variables existen, cómo se ejecuta en local y qué cambiar para otra plataforma. |
| [10 · Pruebas](10-pruebas.md) | Cómo está configurado Vitest, qué tipos de prueba hay, qué compuertas estáticas corren y con qué comandos. |
| [11 · Sistema de diseño](11-sistema-de-diseno.md) | Qué tokens, tipografía, estilos y componentes UI existen, qué patrones de interacción y accesibilidad se siguen y qué vocabulario visual usa el canvas. |
| [12 · Consideraciones técnicas](12-consideraciones-tecnicas.md) | Cómo funciona el auto-layout con ELK, cómo se pintan canvases grandes sin trabar el navegador, cómo se generan los exports y qué límites conocidos tiene el cliente. |

Complementa esta carpeta el mapa del módulo de Export DDL en
[src/features/ddl/README.md](../src/features/ddl/README.md).

## Rutas de lectura por perfil

| Perfil | Orden sugerido |
|---|---|
| Incorporación de un desarrollador | [01](01-vision-general.md) → [02](02-arquitectura.md) → [03](03-estructura-del-proyecto.md) → [04](04-stack-tecnologico.md) → [10](10-pruebas.md) |
| Desarrollo de una funcionalidad | [05](05-funcionalidades.md) → [06](06-flujo-de-datos.md) → [07](07-integracion-con-la-api.md) → [11](11-sistema-de-diseno.md) → [03](03-estructura-del-proyecto.md) (cómo agregar una feature) → [12](12-consideraciones-tecnicas.md) |
| Despliegue y operación | [09](09-despliegue.md) → [08](08-seguridad.md) (checklist) → [07](07-integracion-con-la-api.md) (errores del proxy) |
| Revisión de seguridad | [08](08-seguridad.md) → [02](02-arquitectura.md) (`server.mjs` y guardas) → [07](07-integracion-con-la-api.md) (cabeceras) → [09](09-despliegue.md) (variables y permisos de las apps) |

## Convenciones de la documentación

- **Idioma**: español. La interfaz está en inglés; sus textos se citan tal como aparecen, en negrita
  (**Create new version from production**, **Export DDL**). Los mensajes del backend y de `server.mjs`
  también se citan en inglés, porque son código.
- **Rutas**: las rutas de código van entre comillas invertidas y son relativas a la raíz del repositorio
  (`src/services/http.ts`). Los enlaces entre documentos son relativos.
- **Diagramas**: se escriben en Mermaid; GitHub los dibuja con zoom y desplazamiento. Cada diagrama va
  precedido de una frase que explica qué muestra.
- **Contenido extenso opcional**: ejemplos completos y tablas largas van en bloques plegables
  (`<details>`), que se abren con un clic.
- **Fuente de verdad**: el código. Los conteos que cambian con el tiempo no se escriben; cada documento
  indica cómo obtenerlos (por ejemplo, `npx vitest list`).

## Otro repositorio del sistema

La API, el modelo de datos en Lakebase, el RBAC, el despliegue de la base y la carga desde Erwin se
documentan en la carpeta `docs/` del repositorio `backend-data-model-hub`.
