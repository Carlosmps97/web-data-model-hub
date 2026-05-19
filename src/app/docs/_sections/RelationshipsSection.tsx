import React from 'react';
import { SectionTitle, P, Sub, Ol, DocTable } from '../_components/primitives';

export function RelationshipsSection() {
  return (
    <>
      <SectionTitle id="relationships">Relaciones (FK)</SectionTitle>
      <P>
        Las relaciones conectan columnas entre tablas, representando las foreign keys del modelo.
      </P>

      <Sub>Crear relaciones desde el formulario de tabla</Sub>
      <Ol
        items={[
          <>Abrí el TableForm de la tabla que tendrá la FK</>,
          <>En la columna correspondiente, activá el chip <strong>FK</strong></>,
          <>Aparece el banner FK: seleccioná la tabla de referencia y la columna</>,
          <>Guardá la tabla — la relación aparece como arista en el canvas</>,
        ]}
      />

      <Sub>Crear relaciones directamente en el canvas</Sub>
      <P>Ver la sección <strong>Herramientas del Canvas</strong> para el flujo visual de drag-and-drop.</P>

      <Sub>Tipos de relación</Sub>
      <DocTable
        headers={['Tipo', 'Notación', 'Significado']}
        rows={[
          ['Uno a uno', '1 : 1', 'Cada registro tiene un único correspondiente en ambas tablas'],
          ['Uno a muchos', '1 : N', 'Un registro puede relacionarse con múltiples (el más común)'],
          ['Muchos a muchos', 'N : M', 'Múltiples registros en ambos lados (generalmente necesita tabla intermedia)'],
        ]}
      />
    </>
  );
}
