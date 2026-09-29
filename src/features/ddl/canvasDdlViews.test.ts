// Doc 102: el Export DDL lleva SOLO las vistas miembro del canvas
// (`diagram.views`), no todas las vistas de sus tablas.
import { describe, expect, it } from 'vitest';
import type { View } from '@/services/views.service';
import { canvasDdlViews } from './canvasDdlViews';

const view = (id: string, over: Partial<View> = {}): View => ({ id, name: id.toUpperCase(), sourceTableIds: ['t1'], ...over });

describe('canvasDdlViews', () => {
  it('mapea las vistas del canvas con lo que usa el generador', () => {
    const out = canvasDdlViews({ views: [view('v1', { schema: 's_vu', sql: 'x', description: 'd', showOnCanvas: true,
      sources: [{ column: 'A', tableId: 't1' }], tableId: 't1', customSql: 'NO' })] });
    expect(out).toEqual([{ id: 'v1', tableId: 't1', sourceTableIds: ['t1'], name: 'V1', schema: 's_vu', sql: 'x',
      description: 'd', sources: [{ column: 'A', tableId: 't1' }], showOnCanvas: true }]);
  });
  it('dos de diez: solo las del canvas; sin diagrama, nada', () => {
    expect(canvasDdlViews({ views: [view('v1'), view('v7')] }).map((v) => v.id)).toEqual(['v1', 'v7']);
    expect(canvasDdlViews(null)).toEqual([]);
  });
});
