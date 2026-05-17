import React from 'react';
import { SectionTitle, P, Sub, DocTable, Callout, CodeBlock } from '../_components/primitives';

export function DbmlReferenceSection() {
  return (
    <>
      <SectionTitle id="dbml-reference">Referencia DBML</SectionTitle>
      <P>
        DBML (Database Markup Language) es el formato de texto del panel Code en el canvas.
        Permite escribir el modelo en código y sincronizarlo visualmente.
      </P>

      <Sub>Sintaxis básica</Sub>
      <CodeBlock lang="dbml">{`
Table HD_CLIENTE {
  CODCLI varchar(20) [pk, not null, note: 'Código único del cliente']
  NOMCLI varchar(256)
  FECRUTINA date
  FLGREGELIMINADO char(1) [default: '0']
  Note: 'Tabla maestra de clientes'
}

Table bcp_ddv_crm.HD_ORDEN {    // schema.nombre
  CODORDEN varchar(20) [pk]
  CODCLI varchar(20) [ref: > HD_CLIENTE.CODCLI]
  MTOORDEN decimal(21,4)
}
      `}</CodeBlock>

      <Sub>Configuraciones de columna</Sub>
      <DocTable
        headers={['Setting', 'Efecto']}
        rows={[
          ['pk', 'Primary Key'],
          ['not null', 'NOT NULL en DDL'],
          ['unique', 'Constraint UNIQUE'],
          ["default: 'x'", 'Valor por defecto'],
          ["note: 'texto'", 'Definición funcional (tooltip + DDL COMMENT)'],
          ['ref: > tabla.col', 'FK uno-a-muchos (el lado muchos está aquí)'],
          ['ref: - tabla.col', 'FK uno-a-uno'],
          ['ref: < tabla.col', 'FK muchos-a-muchos'],
        ]}
      />

      <Sub>FK entre schemas</Sub>
      <CodeBlock lang="dbml">{`
// FK calificada con schema
Table bcp_ddv_crm.HD_DETALLE {
  CODCLI varchar(20) [ref: > bcp_ddv_crm.HD_CLIENTE.CODCLI]
}
      `}</CodeBlock>

      <Callout type="warning">
        Aplicar DBML desde el editor Code <strong>reemplaza todas las tablas actuales</strong>
        {' '}del modelo. Exportá el DDL antes si querés conservar el estado.
      </Callout>
    </>
  );
}
