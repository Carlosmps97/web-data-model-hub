import React from 'react';
import { SectionTitle, P, DocTable } from '../_components/primitives';

export function AutoArrangeSection() {
  return (
    <>
      <SectionTitle id="auto-arrange">Distribución Automática</SectionTitle>
      <P>
        Click en el <strong>ícono de cuadrícula</strong> en la barra inferior del canvas para
        abrir el selector de algoritmo:
      </P>
      <DocTable
        headers={['Algoritmo', 'Cuándo usar']}
        rows={[
          ['Izquierda-Derecha', 'Pipelines ETL y lineajes — capas topológicas de izquierda a derecha'],
          ['Copo de Nieve', 'Esquemas estrella — tabla más conectada al centro, dimensiones alrededor'],
          ['Compacto', 'Diagramas con pocas relaciones — cuadrícula ordenada por densidad de conexiones'],
        ]}
      />
    </>
  );
}
