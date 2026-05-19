import React from 'react';
import { SectionTitle, P, Sub, Ul, DocTable, Code } from '../_components/primitives';

export function DdlExportSection() {
  return (
    <>
      <SectionTitle id="ddl-export">Exportar DDL</SectionTitle>
      <P>El DDL generado es SQL ejecutable adaptado al motor del modelo. Tres niveles de granularidad:</P>
      <DocTable
        headers={['Scope', 'Cómo', 'Resultado']}
        rows={[
          ['Modelo completo', 'Botón Export DDL en el toolbar', 'CREATE SCHEMA + todas las tablas + ALTER TABLE FKs al final'],
          ['Por dominio', 'Ícono ↓ junto al header de grupo en Vista Lista', 'Solo tablas del dominio/schema seleccionado'],
          ['Una tabla', 'Ícono ↓ en la tarjeta de cada tabla', 'CREATE TABLE de esa tabla con sus FKs'],
        ]}
      />

      <Sub>Opciones del modal DDL</Sub>
      <Ul
        items={[
          <><strong>Emit schemas</strong>: incluye <Code>CREATE SCHEMA IF NOT EXISTS</Code> al inicio</>,
          <><strong>Emit foreign keys</strong>: agrega <Code>ALTER TABLE ADD CONSTRAINT FOREIGN KEY</Code> al final</>,
          <><strong>Emit comments</strong>: emite <Code>COMMENT ON TABLE/COLUMN</Code> con las definiciones funcionales</>,
          <><strong>Copy</strong>: copia al portapapeles · <strong>Download</strong>: descarga como <Code>.sql</Code></>,
        ]}
      />
    </>
  );
}
