// LOD del canvas (doc 33): histéresis del umbral y tamaños de la caja
// compacta (deben calzar con las métricas del nodo detallado — misma fórmula
// que scripts/arrange_all.py del backend).
import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';
import type { View } from '@/services/views.service';
import { LOD_ENTER, LOD_EXIT, nextLod, tableLodSize, viewLodSize } from './lodSize';

const table = (over: Partial<CanonicalTable> = {}): CanonicalTable =>
  ({ id: 't1', schema: 'bcp_x', physicalName: 'MD_TABLA', logicalName: 'Tabla', ...over }) as CanonicalTable;

const col = (over: Partial<CanonicalColumn> = {}): CanonicalColumn =>
  ({ id: 'c1', tableId: 't1', physicalName: 'CODCLI', logicalName: 'Codigo Cliente',
     dataType: 'VARCHAR(20)', isPrimaryKey: false, ...over }) as CanonicalColumn;

describe('nextLod (histéresis)', () => {
  it('entra compacto SOLO bajo ENTER y sale SOLO sobre EXIT (banda muerta)', () => {
    expect(nextLod(false, LOD_ENTER - 0.01)).toBe(true);   // cruza hacia abajo
    expect(nextLod(false, LOD_ENTER + 0.01)).toBe(false);  // sin cruce
    expect(nextLod(true, LOD_EXIT + 0.01)).toBe(false);    // cruza hacia arriba
    expect(nextLod(true, LOD_EXIT - 0.01)).toBe(true);     // sin cruce
    // dentro de la banda muerta conserva el estado (no parpadea)
    const mid = (LOD_ENTER + LOD_EXIT) / 2;
    expect(nextLod(true, mid)).toBe(true);
    expect(nextLod(false, mid)).toBe(false);
  });
});

describe('tableLodSize', () => {
  it('alto = 32 + filas·28 y franja PK con el conteo de PKs', () => {
    const cols = [col({ id: 'a', isPrimaryKey: true }), col({ id: 'b' }), col({ id: 'c' })];
    const s = tableLodSize(table(), cols, 'physical');
    expect(s.h).toBe(32 + 3 * 28);
    expect(s.pkRows).toBe(1);
  });

  it('sin columnas conserva la fila "No columns" (alto mínimo)', () => {
    expect(tableLodSize(table(), [], 'physical').h).toBe(32 + 28);
  });

  it('ancho acotado 240..880 y crece con la fila más larga', () => {
    const chico = tableLodSize(table({ schema: '', physicalName: 'T' }), [], 'physical');
    expect(chico.w).toBe(240);
    const larga = col({ physicalName: 'X'.repeat(150), dataType: 'VARCHAR(30)' });
    expect(tableLodSize(table(), [larga], 'physical').w).toBe(880);
  });

  it('usa el naming del modo activo (lógico vs físico)', () => {
    const c = col({ physicalName: 'COD', logicalName: 'Nombre Logico Bastante Mas Largo Que El Fisico' });
    const wFis = tableLodSize(table(), [c], 'physical').w;
    const wLog = tableLodSize(table(), [c], 'logical').w;
    expect(wLog).toBeGreaterThan(wFis);
  });
});

describe('viewLodSize', () => {
  it('alto por filas de source y ancho por header/fila más larga', () => {
    const view = {
      id: 'v1', schema: 'bcp_x_vu', name: 'MD_TABLA', tableId: 't1',
      sourceTableIds: ['t1'],
      sources: [
        { tableId: 't1', column: 'CODCLI', outputAlias: 'CODCLI' },
        { tableId: 't1', column: 'NOMBRE', outputAlias: 'NOMBRE' },
      ],
    } as unknown as View;
    const s = viewLodSize(view, { 't1::CODCLI': 'VARCHAR(20)', 't1::NOMBRE': 'STRING' });
    expect(s.h).toBe(32 + 2 * 28);
    expect(s.w).toBeGreaterThanOrEqual(240);
    expect(s.w).toBeLessThanOrEqual(880);
  });
});
