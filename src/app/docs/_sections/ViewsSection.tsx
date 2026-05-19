import React from 'react';
import { SectionTitle, P, Sub, Ul, Ol, DocTable, Code, CodeBlock } from '../_components/primitives';

export function ViewsSection() {
  return (
    <>
      <SectionTitle id="views">Vistas SQL (Capa Lógica)</SectionTitle>
      <P>
        Las <strong>vistas SQL</strong> son la capa lógica del modelo: entidades derivadas de
        tablas físicas con transformaciones, renombrado de columnas y filtros.
      </P>

      <Sub>Tipos de Vista</Sub>
      <DocTable
        headers={['Tipo', 'Uso típico', 'Ejemplo']}
        rows={[
          ['Técnica (TECH)', 'ETL interno, auditoría, staging', 'VW_CLIENTE_STAGING'],
          ['De usuario (USER)', 'Nombres limpios para usuarios finales, sin columnas técnicas', 'VW_CLIENTE'],
          ['De negocio (BIZ)', 'KPIs, métricas, transformaciones para analistas', 'VW_CLIENTES_ACTIVOS_MES'],
        ]}
      />

      <Sub>Crear una Vista</Sub>
      <Ol
        items={[
          <>Click en <strong>Nueva Vista</strong> en el toolbar (requiere que existan tablas)</>,
          <>En pestaña <strong>General</strong>: elegí la tabla física origen, el tipo de vista, schema y nombre</>,
          <>En pestaña <strong>Columnas</strong>: seleccioná qué columnas incluir, definí aliases y expresiones SQL</>,
          <>En pestaña <strong>Filtros</strong>: agregá una cláusula WHERE, o activá "Query personalizado" para escribir SQL completo</>,
          <>Click en <strong>Crear vista</strong></>,
        ]}
      />

      <Sub>Configuración de Columnas</Sub>
      <DocTable
        headers={['Campo', 'Descripción', 'Ejemplo']}
        rows={[
          ['Incluir (checkbox)', 'Si la columna aparece en la vista o se omite', '☑ CODCLI'],
          ['Alias', 'Nombre que expondrá la vista (renombrado)', 'CODCLI → codigo_cliente'],
          ['Expresión SQL (fx)', 'Transformación aplicada sobre la columna', 'CAST(MTOSALDO AS DECIMAL(21,4))'],
        ]}
      />

      <P>Ejemplos de expresiones SQL válidas:</P>
      <CodeBlock lang="sql">{`
-- Cast de tipo
CAST(col_monto AS DECIMAL(21,4))

-- Máscara condicional
CASE WHEN clasificacion = 'DAC' THEN 'CONFIDENCIAL' ELSE valor END

-- Concatenación
CONCAT(cod_pais, '-', cod_region)

-- Coalesce con default
COALESCE(nombre_comercial, nombre_legal, 'SIN NOMBRE')

-- Formato de fecha
DATE_FORMAT(fec_registro, 'yyyy-MM')
      `}</CodeBlock>

      <Sub>Filtro WHERE</Sub>
      <P>En la pestaña Filtros, escribí solo la condición (sin el keyword WHERE):</P>
      <CodeBlock lang="sql">{`
flg_eliminado = 0 AND estado = 'ACTIVO' AND fec_rutina >= CURRENT_DATE - 30
      `}</CodeBlock>

      <Sub>Query Personalizado</Sub>
      <P>
        Para vistas con lógica compleja (JOINs, subqueries), activá el toggle
        {' '}<strong>Query personalizado</strong> y escribí el SQL completo:
      </P>
      <CodeBlock lang="sql">{`
CREATE OR REPLACE VIEW bcp_ddv_crm.VW_CLIENTES_OFERTA AS
SELECT
  c.CODCLI,
  c.NOMCLI,
  o.CODOFERTA,
  CAST(o.MTOOFERTA AS DECIMAL(21,4)) AS monto_oferta
FROM bcp_ddv_crm.HD_CLIENTE c
INNER JOIN bcp_ddv_crm.HD_OFERTA o ON c.CODCLI = o.CODCLI
WHERE c.flg_eliminado = 0 AND o.estado = 'VIGENTE'
      `}</CodeBlock>

      <Sub>Vistas en el Canvas</Sub>
      <P>
        Las vistas aparecen en el canvas como nodos con <strong>borde punteado</strong>, badge
        de tipo coloreado, y una arista punteada que las conecta con su tabla origen.
      </P>
      <Ul
        items={[
          <>Las columnas con alias muestran <Code>col_origen → alias</Code></>,
          <>Las columnas con expresión muestran el badge <Code>fx</Code></>,
          <>Un badge <Code>WHERE</Code> en el footer indica que tiene filtro activo</>,
          <>Click en el ícono de lápiz del nodo para editar la vista</>,
        ]}
      />
    </>
  );
}
