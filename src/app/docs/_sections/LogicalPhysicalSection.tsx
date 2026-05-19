import React from 'react';
import { SectionTitle, P, DocTable, Callout, Code } from '../_components/primitives';

export function LogicalPhysicalSection() {
  return (
    <>
      <SectionTitle id="logical-physical">Nombres Lógico / Físico</SectionTitle>
      <P>La plataforma distingue dos capas de nomenclatura en tablas y columnas:</P>

      <DocTable
        headers={['Capa', 'Qué es', 'Ejemplo']}
        rows={[
          ['Físico', 'Nombre SQL real, el que va en el DDL y en la BD', 'HD_CLIENTE, CODCLI, VARCHAR(20)'],
          ['Lógico', 'Nombre de negocio / entidad, sin restricciones SQL', 'Cliente, Código de Cliente, Texto corto'],
        ]}
      />

      <P>
        En el canvas, los nodos de tabla muestran el nombre físico (<Code>schema.TABLA</Code>).
        Los <strong>nodos de Vista</strong> tienen una visión lógica de los datos (ver sección
        Vistas SQL).
      </P>

      <Callout type="info">
        El nombre lógico es opcional. Si se define, se usa en las vistas y como contexto para
        el agente IA.
      </Callout>
    </>
  );
}
