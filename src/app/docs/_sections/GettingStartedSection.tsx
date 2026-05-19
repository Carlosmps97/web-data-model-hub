import React from 'react';
import { SectionTitle, P, Sub, Ol, Callout, FlowDiagram } from '../_components/primitives';

export function GettingStartedSection() {
  return (
    <>
      <SectionTitle id="getting-started">Primeros Pasos</SectionTitle>
      <P>
        Data Model Hub es una plataforma web para diseñar modelos de datos ER (Entidad-Relación)
        de forma visual e interactiva, con asistencia de un agente IA que genera tablas y DDL
        a partir de descripción en lenguaje natural o archivos Excel.
      </P>

      <FlowDiagram
        steps={[
          { icon: '📁', title: 'Crear Proyecto', desc: 'Agrupa modelos' },
          { icon: '📐', title: 'Crear Modelo', desc: 'Seleccioná el motor DB' },
          { icon: '🗂️', title: 'Agregar Tablas', desc: 'Manual o con IA' },
          { icon: '🔗', title: 'Definir Relaciones', desc: 'FK entre columnas' },
          { icon: '💾', title: 'Exportar DDL', desc: 'SQL ejecutable' },
        ]}
      />

      <Sub>Crear un Proyecto</Sub>
      <Ol
        items={[
          <>En la pantalla principal, hacé click en <strong>New Project</strong></>,
          <>Ingresá nombre (obligatorio) y descripción (opcional)</>,
          <>Click en <strong>Create Project</strong> — te redirige al detalle del proyecto</>,
        ]}
      />

      <Sub>Crear un Modelo de Datos</Sub>
      <Ol
        items={[
          <>Dentro del proyecto, click en <strong>Create First Model</strong> (o <strong>New Model</strong>)</>,
          <>Ingresá un nombre → <strong>Create Model</strong></>,
          <>El editor se abre en Vista de Lista por defecto</>,
        ]}
      />

      <Callout type="tip">
        Cada proyecto puede tener múltiples modelos. Usá un modelo por dominio, sistema o
        solución de datos para mantener el diseño organizado.
      </Callout>
    </>
  );
}
