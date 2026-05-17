import React from 'react';
import {
  SectionTitle,
  P,
  Sub,
  Ul,
  Ol,
  DocTable,
  Callout,
  Code,
  FlowDiagram,
} from '../_components/primitives';

export function AiAgentSection() {
  return (
    <>
      <SectionTitle id="ai-agent">Agente IA — Chat</SectionTitle>
      <P>
        El <strong>AI Modeler</strong> es un asistente que genera tablas, columnas, tipos de
        dato y DDL a partir de tu descripción. Conoce las convenciones y lineamientos
        corporativos si se los proveés.
      </P>

      <Sub>Abrir el panel</Sub>
      <P>
        Click en el botón <strong>AI Agent</strong> (con el perrito 🐕) en el toolbar. El panel
        se abre a la derecha del canvas o de la lista.
      </P>

      <Sub>Ciclo de una conversación</Sub>
      <FlowDiagram
        steps={[
          { icon: '📝', title: 'Describís', desc: 'Texto libre o Excel' },
          { icon: '🐕', title: 'Piensa', desc: 'Consulta lineamientos' },
          { icon: '🔍', title: 'Analiza', desc: 'Revisa catálogo' },
          { icon: '🎯', title: 'Responde', desc: 'Tablas + DDL + QA' },
          { icon: '✅', title: 'Aplicás', desc: 'Al canvas (2 pasos)' },
        ]}
      />

      <Sub>Enviar un mensaje</Sub>
      <Ul
        items={[
          <><strong>Texto libre</strong>: describí el modelo que necesitás ("Necesito modelar la tabla de campañas CRM con sus tipos de oferta y canales de distribución")</>,
          <><strong>Excel (.xlsx)</strong>: click en el clip 📎 para adjuntar un archivo con tus tablas ya definidas</>,
          <><strong>Combinación</strong>: texto + Excel en el mismo turno para contexto adicional</>,
          <>Presioná <Code>Enter</Code> para enviar · <Code>Shift+Enter</Code> para nueva línea</>,
        ]}
      />

      <Sub>Estados del agente (animaciones)</Sub>
      <DocTable
        headers={['Estado', 'Imagen', 'Qué significa']}
        rows={[
          ['Pensando', 'Perrito con lupa mirando hacia arriba', 'Procesando tu solicitud y elaborando el modelo'],
          ['Analizando', 'Perrito buscando con lupa', 'Revisando lineamientos y catálogo corporativo'],
          ['Listo', 'Perrito feliz con las manos arriba', 'Modelo generado correctamente'],
          ['Error', 'Perrito sudado y asustado', 'Algo salió mal (ver mensaje de error en el chat)'],
        ]}
      />

      <Sub>Resultado del agente</Sub>
      <P>Cada respuesta exitosa incluye un bloque colapsable con:</P>
      <Ul
        items={[
          <><strong>Tablas generadas</strong>: nombre, columnas con tipos y definiciones</>,
          <><strong>Relaciones</strong>: FK declaradas entre tablas</>,
          <><strong>QA Score</strong>: puntaje de calidad (0-100) y detalles de validaciones</>,
          <><strong>DDL</strong>: código SQL ejecutable, con botón de copiar</>,
          <><strong>Guidelines aplicadas</strong>: resumen de qué lineamientos respetó el agente</>,
        ]}
      />

      <Sub>Aplicar el modelo al canvas</Sub>
      <Ol
        items={[
          <>Click en <strong>Aplicar al canvas</strong> → aparece un aviso de confirmación</>,
          <>Click en <strong>Confirmar y aplicar</strong> para reemplazar las tablas/relaciones del canvas</>,
          <>Click en <strong>Cancelar</strong> si querés seguir conversando antes de aplicar</>,
        ]}
      />

      <Callout type="warning">
        Aplicar reemplaza <strong>todas</strong> las tablas y relaciones del canvas. Guardá el
        modelo antes si querés preservar el estado anterior.
      </Callout>

      <Sub>Conversación multi-turno</Sub>
      <P>
        El agente recuerda el historial y el último modelo generado en la sesión. Podés
        refinarlo progresivamente:
      </P>
      <Ul
        items={[
          <>"Agregá una tabla de auditoría con los campos estándar"</>,
          <>"Cambiá el tipo de dato de MTOOFERTA a DECIMAL(21,4)"</>,
          <>"Agregá las columnas técnicas obligatorias (FecRutina, FlgEliminado, etc.)"</>,
        ]}
      />

      <Sub>Nueva sesión</Sub>
      <P>Click en el ícono ↺ (rotación) en el header del panel. Esto:</P>
      <Ul
        items={[
          <>Limpia el historial visual del chat en pantalla</>,
          <>Libera la sesión en el backend (memoria liberada)</>,
          <>Genera un nuevo ID de sesión para el próximo mensaje</>,
          <>El canvas <strong>no se modifica</strong> — el modelo que construiste queda intacto</>,
        ]}
      />
    </>
  );
}
