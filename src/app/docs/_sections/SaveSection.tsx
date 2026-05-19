import React from 'react';
import { SectionTitle, P, Sub, Ul, DocTable, Callout } from '../_components/primitives';

export function SaveSection() {
  return (
    <>
      <SectionTitle id="save">Guardar</SectionTitle>
      <P>
        El modelo se guarda <strong>solo cuando hacés click en el botón Guardar</strong>. No hay
        auto-guardado.
      </P>

      <Sub>Estados del botón Guardar</Sub>
      <DocTable
        headers={['Estado', 'Apariencia', 'Qué significa']}
        rows={[
          ['Sin cambios', 'Gris claro · ícono ✓ verde · "Guardado"', 'El modelo está sincronizado con lo persistido en Cosmos DB'],
          ['Cambios pendientes', 'Fondo ámbar · negrita · "Guardar"', 'Hay tablas, relaciones o vistas modificadas sin guardar'],
          ['Guardando', 'Spinner girando · "Guardando…"', 'El request de guardado está en vuelo'],
        ]}
      />

      <Callout type="warning">
        Cerrar el navegador o navegar fuera del editor sin guardar
        {' '}<strong>perderá todos los cambios</strong>. El botón ámbar es la señal de que hay
        trabajo sin persistir.
      </Callout>

      <P>El botón Guardar se habilita (ámbar) al:</P>
      <Ul
        items={[
          <>Agregar, editar o eliminar una tabla</>,
          <>Crear, modificar o eliminar una relación (desde formulario o desde el canvas)</>,
          <>Agregar o editar una vista SQL</>,
          <>Crear o modificar dominios del catálogo</>,
          <>Aplicar un modelo generado por el agente al canvas</>,
          <>Cambiar el motor de BD del modelo</>,
        ]}
      />
    </>
  );
}
