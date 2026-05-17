import React from 'react';
import { SectionTitle, P, Sub, Ul, DocTable, Code } from '../_components/primitives';

export function CanvasViewSection() {
  return (
    <>
      <SectionTitle id="canvas-view">Diagrama ER (Canvas)</SectionTitle>
      <P>
        El canvas es el diagrama interactivo que muestra todas las tablas y vistas del modelo
        con sus relaciones.
      </P>

      <Sub>Navegación</Sub>
      <DocTable
        headers={['Acción', 'Cómo']}
        rows={[
          ['Desplazar', 'Arrastrar en espacio vacío del canvas'],
          ['Zoom', 'Rueda del mouse · botones ± en barra inferior'],
          ['Ajustar todo', 'Botón de ajuste de vista en la barra inferior'],
          ['Minimapa', 'Panel inferior derecho — arrastrable y zoomeable'],
        ]}
      />

      <Sub>Nodos de Tabla (borde sólido)</Sub>
      <Ul
        items={[
          <><strong>Header coloreado</strong>: nombre físico (<Code>schema.TABLA</Code>), badge de conteo de columnas, engranaje ⚙</>,
          <><strong>Columnas</strong>: ícono PK/FK/SK/PT + nombre + tipo de dato</>,
          <><strong>Footer</strong>: definición funcional (primeros 45 caracteres)</>,
          <><strong>Hover</strong>: resalta las aristas de relaciones conectadas y las columnas involucradas en ambos nodos</>,
          <><strong>Tooltip de columna</strong>: nombre lógico/físico, tipo, FK referenciada</>,
        ]}
      />

      <Sub>Nodos de Vista (borde punteado)</Sub>
      <Ul
        items={[
          <><strong>Badge de tipo</strong>: TECH (azul) · USER (teal) · BIZ (violeta)</>,
          <><strong>Nombre lógico</strong> como etiqueta principal, nombre físico en gris pequeño</>,
          <><strong>Flecha punteada</strong>: conecta la vista con su tabla física origen</>,
          <><strong>Indicadores</strong>: badge <Code>fx</Code> por columna con expresión, badge <Code>WHERE</Code> en footer</>,
        ]}
      />

      <Sub>Editar desde el canvas</Sub>
      <Ul
        items={[
          <><strong>Tablas</strong>: hover → ícono ⚙ → Edit → formulario completo</>,
          <><strong>Vistas</strong>: ícono de lápiz en el header del nodo → ViewForm</>,
          <><strong>Mover nodos</strong>: arrastrar libremente (posiciones en memoria de sesión)</>,
        ]}
      />
    </>
  );
}
