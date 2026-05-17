import React from 'react';
import { SectionTitle, Sub, DocTable, Callout, Code } from '../_components/primitives';

export function EngineCapabilitiesSection() {
  return (
    <>
      <SectionTitle id="engine-capabilities">Capacidades por Motor</SectionTitle>

      <Sub>Mapeo de Tipos Canónicos</Sub>
      <DocTable
        headers={['Canónico', 'PostgreSQL', 'SQL Server', 'Databricks SQL', 'MySQL']}
        rows={[
          ['integer',   'INTEGER',         'INT',           'INT',             'INT'],
          ['bigint',    'BIGINT',          'BIGINT',        'BIGINT',          'BIGINT'],
          ['decimal',   'NUMERIC',         'DECIMAL',       'DECIMAL',         'DECIMAL'],
          ['varchar',   'VARCHAR',         'NVARCHAR',      'STRING',          'VARCHAR'],
          ['text',      'TEXT',            'NVARCHAR(MAX)', 'STRING',          'TEXT'],
          ['boolean',   'BOOLEAN',         'BIT',           'BOOLEAN',         'TINYINT(1)'],
          ['date',      'DATE',            'DATE',          'DATE',            'DATE'],
          ['timestamp', 'TIMESTAMP',       'DATETIME2',     'TIMESTAMP',       'DATETIME'],
          ['json',      'JSONB',           'NVARCHAR(MAX)', 'STRING',          'JSON'],
          ['array',     'JSONB',           'NVARCHAR(MAX)', 'ARRAY<STRING>',   'JSON'],
          ['struct',    'JSONB',           'NVARCHAR(MAX)', 'STRUCT',          'JSON'],
        ]}
      />

      <Callout type="tip">
        Si escribís un tipo con paréntesis ya dialect-specific (ej. <Code>VARCHAR2(50)</Code>,
        {' '}<Code>DECIMAL(21,4)</Code>), el generador DDL lo respeta sin remapear.
      </Callout>
    </>
  );
}
