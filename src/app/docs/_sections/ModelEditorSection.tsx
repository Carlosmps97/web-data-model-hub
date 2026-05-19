import React from 'react';
import { SectionTitle, P, Sub, Ul, DocTable, Callout, Code } from '../_components/primitives';

export function ModelEditorSection() {
  return (
    <>
      <SectionTitle id="model-editor">Editor de Modelos</SectionTitle>
      <P>
        El editor tiene dos filas en el encabezado y un área de trabajo central que alterna
        entre Vista de Lista y Canvas.
      </P>

      <Sub>Fila Superior — Identidad</Sub>
      <Ul
        items={[
          <><strong>‹ Volver</strong> — regresa a la lista de modelos del proyecto</>,
          <><strong>Breadcrumb</strong> — <Code>Proyectos › Proyecto › Modelo</Code>, cada nivel es clickable</>,
          <><strong>Selector de motor</strong> — Databricks SQL / PostgreSQL / MySQL / SQL Server / CosmosDB</>,
        ]}
      />

      <Sub>Fila Inferior — Toolbar de Acciones</Sub>
      <DocTable
        headers={['Botón', 'Qué hace']}
        rows={[
          ['List / Canvas', 'Alterna entre la cuadrícula de tarjetas y el diagrama ER interactivo'],
          ['Dominios', 'Abre el gestor de dominios y subdominios del modelo (con badge contador)'],
          ['Nueva Vista', 'Crea una vista SQL derivada de una tabla física (habilitado cuando hay tablas)'],
          ['Import Excel', 'Sube un .xlsx; cada hoja se convierte en una tabla'],
          ['Guardar', 'Guarda el modelo manualmente. Se resalta en ámbar cuando hay cambios sin guardar'],
          ['Export DDL', 'Genera el DDL completo del modelo y abre el modal de descarga'],
          ['AI Agent', 'Abre/cierra el panel del agente IA (perrito) para modelado asistido'],
        ]}
      />

      <Callout type="info">
        El modelo <strong>no se guarda automáticamente</strong>. El botón <strong>Guardar</strong>
        {' '}se pone en ámbar cuando hay cambios pendientes. Guardá antes de cerrar el navegador.
      </Callout>
    </>
  );
}
