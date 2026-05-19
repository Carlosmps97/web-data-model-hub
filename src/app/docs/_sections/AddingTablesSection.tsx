import React from 'react';
import { SectionTitle, P, Sub, Ul, DocTable, Callout } from '../_components/primitives';

export function AddingTablesSection() {
  return (
    <>
      <SectionTitle id="adding-tables">Tablas y Columnas</SectionTitle>
      <P>
        Las tablas son la unidad base del modelo. Cada tabla tiene propiedades físicas (SQL) y
        opcionales lógicas (negocio).
      </P>

      <Sub>Abrir el formulario de tabla</Sub>
      <Ul
        items={[
          <>En Vista Lista: botón <strong>+ Nueva Tabla</strong> o ícono de edición en cada tarjeta</>,
          <>En Vista Canvas: engranaje ⚙ en el encabezado de cualquier nodo → <strong>Edit</strong></>,
        ]}
      />

      <Sub>Pestaña General</Sub>
      <DocTable
        headers={['Campo', 'Req.', 'Descripción']}
        rows={[
          ['Nombre de Entidad (lógico)', 'No', 'Nombre de negocio (ej. "Cliente"). Visible en vista lógica del canvas.'],
          ['Schema', 'Sí', 'Namespace SQL (ej. bcp_ddv_crm). Se auto-completa con el default del motor.'],
          ['Nombre de Tabla (físico)', 'Sí', 'Identificador SQL (ej. HD_CLIENTE). Preview en vivo: schema.tabla.'],
          ['Definición Funcional', 'No', 'Descripción de negocio. Aparece en tooltips y se emite como COMMENT en el DDL.'],
          ['Dominio / Subdominio', 'No', 'Selector del catálogo de dominios. Al elegir, hereda schema y tags definidos en el dominio.'],
        ]}
      />

      <Sub>Pestaña Columns</Sub>
      <P>Cada columna es una tarjeta con:</P>
      <Ul
        items={[
          <><strong>Nombre físico</strong> — identificador SQL</>,
          <><strong>Nombre lógico</strong> — atributo de negocio (ej. "Código de Cliente"). Se muestra en vista lógica.</>,
          <><strong>Tipo de dato</strong> — selector con todos los tipos canónicos</>,
          <><strong>Chips de constraint</strong>: PK · FK · SK · UNIQUE · NOT NULL (toggleables, con colores semánticos)</>,
          <><strong>Campos inline</strong>: Length · Scale · Default · Definición funcional</>,
          <><strong>Banner FK</strong>: cuando FK está activo, aparece un selector de tabla.columna referenciada</>,
        ]}
      />

      <Callout type="tip">
        Activar PK implica NOT NULL automáticamente. Length aparece para varchar/char/nvarchar;
        Scale para decimal/numeric.
      </Callout>

      <Sub>Pestaña Partitioning</Sub>
      <DocTable
        headers={['Campo', 'Descripción']}
        rows={[
          ['Strategy', 'NONE · RANGE · LIST · HASH · DATE · BUCKET (filtrado según motor)'],
          ['Partition Columns', 'Columnas que dirigen la partición (chips seleccionables)'],
          ['Buckets', 'Para estrategia HASH/BUCKET'],
          ['Granularity', 'Para DATE: DAY / MONTH / YEAR / HOUR'],
          ['Clustering Columns', 'Solo Databricks — Z-ORDER (clustering adicional sobre la partición)'],
        ]}
      />

      <Sub>Pestaña Metadata</Sub>
      <DocTable
        headers={['Campo', 'Uso']}
        rows={[
          ['Application Code', 'Sistema dueño de la tabla (CRM, ERP, MDM…)'],
          ['Domain / Subdomain', 'Clasificación de negocio (se sincroniza con el catálogo de dominios)'],
          ['Tags', 'Etiquetas libres para filtrado. Enter o coma para agregar.'],
        ]}
      />
    </>
  );
}
