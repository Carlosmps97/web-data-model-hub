import React from 'react';
import { SectionTitle, P, Sub, Ul, Ol, Callout } from '../_components/primitives';

export function GuidelinesSection() {
  return (
    <>
      <SectionTitle id="guidelines">Guidelines</SectionTitle>
      <P>
        Los <strong>lineamientos</strong> son archivos con las convenciones corporativas de
        modelado (nomenclatura, tipos de dato, columnas obligatorias, etc.). El agente los
        aplica automáticamente en cada turno de la conversación.
      </P>

      <Sub>Cargar guidelines</Sub>
      <Ol
        items={[
          <>En el panel del agente, click en <strong>Subir</strong> (sección Guidelines, sobre el área de mensajes)</>,
          <>Seleccioná el archivo (soporta: PDF, DOCX, MD, JSON, XLSX, TXT)</>,
          <>El agente procesará el archivo y lo cacheará para todos los turnos de la sesión</>,
        ]}
      />

      <Callout type="info">
        Las guidelines son por sesión — si iniciás una nueva sesión (↺), deberás volver a
        cargarlas. El contenido nunca se persiste en disco.
      </Callout>

      <Sub>Qué incluir en los lineamientos</Sub>
      <Ul
        items={[
          <>Prefijos de tablas por dominio (ej. HD_ para históricas, DM_ para dimensiones)</>,
          <>Abreviaturas estándar del glosario (COD = Código, CLI = Cliente, MTO = Monto…)</>,
          <>Dominios padres y sus tipos de dato (Monto → DECIMAL(21,4), Nombre → VARCHAR(256))</>,
          <>Columnas técnicas obligatorias (FecRutina, FlgEliminado, FecActualizacionRegistro…)</>,
          <>Convenciones de partición y clustering para el motor</>,
        ]}
      />
    </>
  );
}
