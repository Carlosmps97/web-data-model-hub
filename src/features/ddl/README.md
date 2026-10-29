# ddl

Módulo del **Export DDL**: genera el DDL de Databricks u Oracle a partir del diagrama del canvas
abierto, aplica las DDL Export Rules del proyecto (motor en el backend) y entrega el resultado como un
`.zip` con un `.sql` por objeto o como un único SQL copiado al portapapeles.

## API pública

Se importa desde `@/features/ddl` (el barrel `index.ts`); la regla de ESLint de barrels marca como advertencia
todo import a los archivos internos. Expone:

- `ExportDdlModal`: el diálogo que abre la acción **Export DDL** de la barra del canvas.
- `viewDDL`, `DEFAULT_DATABRICKS_OPTS`, `DdlView`: el generador de vistas, que también usa la vista
  previa del editor de vistas del modeler para emitir el mismo SQL que el export.
- `DdlOutputForm`, `DEFAULT_OUTPUT_SETTINGS`, `mergeOutputSettings`, `DdlOutputSettings`: el formulario
  de **Output settings**, compartido con Data Standards.
- `DdlDialect`: el dialecto (Databricks u Oracle).

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `generators.ts` | Generador puro de DDL Databricks sobre la forma canónica del diagrama (tablas, columnas, relaciones, vistas): `CREATE`, particiones, propiedades, tags y vistas con `col AS alias`. |
| `oracle.ts` | Generador puro de DDL Oracle con la misma entrada: PK dentro del `CREATE TABLE` y FK como `ALTER TABLE … DISABLE NOVALIDATE` al final o en su propio archivo; comentarios dentro del `CREATE TABLE` como Erwin; tipos tal cual. |
| `outputSettings.ts` | Output settings (cómo se escribe el DDL y cómo se nombran los archivos), valores por defecto y fusión con lo guardado en el proyecto; espejo de `app/features/ddl_rules/output.py` del backend. |
| `rulesBridge.ts` | Puente con las DDL Export Rules: lee las reglas, la configuración y las definiciones UDP del proyecto (`/api/projects/{id}/ddl-rules`, `/ddl-rules/config`, `/udp`), arma el payload con el estado efectivo del canvas (drafts incluidos) y ensambla el `.sql` con la respuesta de `POST /ddl-rules/render` y el sello de la versión de reglas. Sin reglas seleccionadas no interviene. |
| `ddlExportBundle.ts` | Arma la lista de archivos del `.zip` (`{Tabla}/TABLE-…sql`, `VIEW_NEG-…`, `VIEW_TEC-…`) según las Output settings, resolviendo choques de nombre sin distinguir mayúsculas. |
| `exportGate.ts` | Compuerta del diálogo: no exporta ni deja editar hasta tener Output settings, definiciones UDP y lista de reglas del proyecto. |
| `canvasDdlViews.ts` | Vistas a exportar: las miembro del canvas (`diagram.views`), no todas las de sus tablas. |
| `tableSelection.ts` | Tablas elegidas en **Tables to export**: sin elección explícita no hay ninguna. |
| `components/ExportDdlModal.tsx` | Diálogo Export DDL (`Dialog` con fondo de canvas): selección de tablas y dialecto, vista previa, pestañas **Output** y **Export rules**, **Download .zip** y **Copy**. |
| `components/DdlOutputForm.tsx` | Formulario controlado de Output settings por dialecto (Oracle muestra solo lo que existe en Oracle). |
| `components/ExportRulesPanel.tsx` | Selector de reglas agrupado en «Generators» y «Transformations», en el orden de ejecución del motor; solo con Databricks. |

Cada archivo `.ts` tiene su prueba `*.test.ts` al lado.

## Documentación

- [Funcionalidades](../../../docs/05-funcionalidades.md): qué ofrece el Export DDL a la persona usuaria.
- [Flujo de datos](../../../docs/06-flujo-de-datos.md): secuencia del export con y sin reglas.
- [Sistema de diseño](../../../docs/11-sistema-de-diseno.md): `Dialog`, botones y clases `exd-`.
