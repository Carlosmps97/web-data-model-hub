import React from 'react';
import { SectionTitle, P, Sub, DocTable, Code } from '../_components/primitives';

export function SchemasPartitioningSection() {
  return (
    <>
      <SectionTitle id="schemas-partitioning">Esquemas y Particionamiento</SectionTitle>

      <Sub>Schemas SQL</Sub>
      <P>
        Cada tabla pertenece a un schema (namespace). El default del motor se usa si no se
        especifica. La Vista de Lista agrupa por schema y el canvas muestra el prefijo
        {' '}<Code>schema.TABLA</Code>.
      </P>

      <Sub>Estrategias de Particionamiento</Sub>
      <DocTable
        headers={['Strategy', 'DDL emitido', 'Motores']}
        rows={[
          ['NONE', '(sin cláusula)', 'Todos'],
          ['RANGE', 'PARTITION BY RANGE (col)', 'PostgreSQL, Oracle, Databricks'],
          ['LIST', 'PARTITION BY LIST (col)', 'PostgreSQL, Oracle, Databricks'],
          ['HASH', 'PARTITION BY HASH (col)', 'PostgreSQL, Oracle, MySQL'],
          ['BUCKET', 'PARTITIONED BY (col)', 'Databricks'],
          ['DATE', 'PARTITION BY (col) -- con granularidad', 'Reservado para BigQuery (futuro)'],
        ]}
      />
    </>
  );
}
