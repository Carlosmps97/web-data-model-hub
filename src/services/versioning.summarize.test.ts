/** summarizeDiff: agrega el /diff a la card "Changes summary". */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  ApiError: class extends Error { status = 0; },
}));
import { summarizeDiff } from './versioning.service';
import type { ChangesetDiff, DiffEntity } from '@/types/versioning';

const e = (id: string): DiffEntity => ({ id, name: id });

const DIFF: ChangesetDiff = {
  collections: {
    canonical_tables: { added: [e('t1'), e('t2')], edited: [e('t3')], deleted: [] },
    canonical_columns: { added: [e('c1')], edited: [e('c2'), e('c3')], deleted: [e('c4')] },
    views: { added: [], edited: [e('v1')], deleted: [] },
    relationships: { added: [], edited: [], deleted: [e('r1')] },
    schemas: { added: [], edited: [], deleted: [] },          // 0 → fila omitida
    otra_coleccion_futura: { added: [e('x1')], edited: [], deleted: [] },
  },
  impact: { tablesTouched: 3, columnsTouched: 4, affectedOtherTables: [] },
  tree: [
    {
      type: 'project', id: 'p1', name: 'Modelo Ventas',
      children: [
        {
          type: 'folder', id: 'f1', name: 'Despriorizado',
          children: [{ type: 'canvas', id: 'sa1', name: 'Pricing', children: [] }],
        },
        {
          type: 'folder', id: '__root__', name: '— (project root)',
          children: [{ type: 'canvas', id: 'sa2', name: 'Riesgos', children: [] }],
        },
      ],
    },
  ],
};

describe('summarizeDiff', () => {
  it('cuenta por colección en orden fijo y omite filas en cero', () => {
    const s = summarizeDiff(DIFF);
    expect(s.rows.map((r) => r.label)).toEqual([
      'Tables', 'Columns', 'Views', 'Relationships', 'otra_coleccion_futura',
    ]);
    const tables = s.rows[0];
    expect([tables.added, tables.edited, tables.deleted]).toEqual([2, 1, 0]);
  });

  it('totales globales = suma de buckets (incluida una colección desconocida)', () => {
    const s = summarizeDiff(DIFF);
    expect(s.added).toBe(4);      // t1 t2 c1 x1
    expect(s.edited).toBe(4);     // t3 c2 c3 v1
    expect(s.deleted).toBe(2);    // c4 r1
    expect(s.total).toBe(10);
  });

  it('proyectos y modelos con nombre real; el folder raíz no prefija', () => {
    const s = summarizeDiff(DIFF);
    expect(s.projects).toEqual(['Modelo Ventas']);
    expect(s.models).toEqual(['Despriorizado › Pricing', 'Riesgos']);
  });

  it('diff sin árbol no rompe: solo conteos', () => {
    const s = summarizeDiff({ ...DIFF, tree: undefined });
    expect(s.projects).toEqual([]);
    expect(s.models).toEqual([]);
    expect(s.total).toBe(10);
  });
});
