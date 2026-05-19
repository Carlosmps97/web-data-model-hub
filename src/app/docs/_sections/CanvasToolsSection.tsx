import React from 'react';
import { SectionTitle, P, Sub, Ul, Ol, Callout, Code } from '../_components/primitives';

export function CanvasToolsSection() {
  return (
    <>
      <SectionTitle id="canvas-tools">Herramientas del Canvas</SectionTitle>
      <P>
        El canvas tiene una <strong>barra de herramientas flotante</strong> en el lado izquierdo
        con dos modos:
      </P>

      <Sub>Herramienta Seleccionar (↖)</Sub>
      <Ul
        items={[
          <>Modo por defecto al entrar al canvas</>,
          <>Click en nodos para seleccionarlos visualmente</>,
          <>Drag en espacio vacío para desplazar la vista</>,
          <>Drag en un nodo de tabla para moverlo</>,
        ]}
      />

      <Sub>Herramienta Conectar (🔗)</Sub>
      <P>Para crear una relación visual entre dos columnas de tablas distintas:</P>
      <Ol
        items={[
          <>Click en el ícono de enlace en la barra lateral para activar modo Conectar</>,
          <>Los handles de columnas se vuelven visibles como círculos índigo en cada columna</>,
          <>Arrastrá desde el handle de una columna hacia el handle de otra columna en otra tabla</>,
          <>Al soltar, aparece un selector centrado: elegí el tipo de relación (1:1 / 1:N / N:M)</>,
          <>Click en <strong>Cancelar</strong> si querés descartar la conexión</>,
          <>La relación se crea y aparece como arista animada en el canvas</>,
        ]}
      />

      <Callout type="tip">
        Solo podés conectar columnas de <strong>tablas físicas</strong> entre sí. No es posible
        hacer FK desde/hacia vistas (las vistas no tienen FK propias en SQL).
      </Callout>

      <Sub>Borrar una Relación desde el Canvas</Sub>
      <Ol
        items={[
          <>Hacé click sobre cualquier arista (línea de relación) para seleccionarla</>,
          <>Presioná la tecla <Code>Delete</Code></>,
          <>La relación se elimina del canvas y del modelo</>,
        ]}
      />

      <Callout type="warning">
        Borrar una relación desde el canvas elimina la FK del modelo. Si también tenías el chip
        FK marcado en la columna, deberás desmarcarlo manualmente en el formulario de tabla
        para mantener consistencia.
      </Callout>
    </>
  );
}
