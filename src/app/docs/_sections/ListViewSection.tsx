import React from 'react';
import { SectionTitle, P, Sub, Ul, DocTable } from '../_components/primitives';

export function ListViewSection() {
  return (
    <>
      <SectionTitle id="list-view">Vista de Lista</SectionTitle>
      <P>
        La Vista de Lista muestra todas las tablas del modelo como tarjetas con metadatos de
        clasificación.
      </P>

      <Sub>Búsqueda y Filtros</Sub>
      <Ul
        items={[
          <><strong>Búsqueda</strong>: filtra por nombre de tabla, schema, dominio, subdominio, código de app, definición o etiquetas</>,
          <><strong>Tags</strong>: click en cualquier chip de etiqueta para filtrar por esa tag</>,
          <><strong>Group by</strong>: By schema · By domain · Flat (sin agrupación)</>,
        ]}
      />

      <Sub>Acciones por tabla</Sub>
      <DocTable
        headers={['Ícono', 'Acción']}
        rows={[
          ['↓', 'Descargar DDL de esa tabla específica'],
          ['✏', 'Editar tabla (abre el TableForm)'],
          ['🗑', 'Eliminar tabla (con confirmación)'],
        ]}
      />
    </>
  );
}
