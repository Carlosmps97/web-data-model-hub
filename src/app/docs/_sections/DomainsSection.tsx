import React from 'react';
import { SectionTitle, P, Sub, Ul, Ol, Callout } from '../_components/primitives';

export function DomainsSection() {
  return (
    <>
      <SectionTitle id="domains">Dominios y Subdominios</SectionTitle>
      <P>
        El catálogo de dominios permite definir áreas de negocio reutilizables con
        {' '}<strong>defaults heredables</strong> por las tablas asignadas.
      </P>

      <Sub>¿Para qué sirven?</Sub>
      <Ul
        items={[
          <>Organizar tablas por área de negocio (Campañas CRM, Ofertas, Clientes…)</>,
          <>Heredar automáticamente el <strong>schema</strong> y los <strong>tags</strong> al asignar un dominio/subdominio a una tabla</>,
          <>Filtrar y agrupar en la Vista de Lista (By domain)</>,
          <>Dar contexto al agente IA para que use los schemas correctos al generar tablas</>,
        ]}
      />

      <Sub>Gestionar Dominios</Sub>
      <Ol
        items={[
          <>Click en el botón <strong>Dominios</strong> del toolbar (con badge contador)</>,
          <>En el panel izquierdo del modal, click en <strong>Nuevo</strong></>,
          <>Completá: nombre, código de abreviatura, descripción, color identificador</>,
          <>En <em>Defaults heredables</em>: schema por defecto, tags por defecto</>,
          <>Click en <strong>Crear dominio</strong></>,
          <>Para agregar subdominios, expandí el dominio creado y usá la fila inferior</>,
        ]}
      />

      <Sub>Herencia de Defaults</Sub>
      <P>Cuando asignás un dominio o subdominio a una tabla en el <strong>TableForm</strong>:</P>
      <Ul
        items={[
          <>El schema del dominio se aplica automáticamente (si el schema actual es el default del motor)</>,
          <>Los tags del dominio se agregan a la tabla</>,
          <>Si el subdominio tiene su propio schema, éste sobreescribe el del dominio</>,
        ]}
      />

      <Callout type="tip">
        Los subdominios son más específicos que los dominios. Usá dominios para el área general
        (ej. "Campañas") y subdominios para la solución específica (ej. "Campañas Digital",
        "Campañas Físico").
      </Callout>
    </>
  );
}
