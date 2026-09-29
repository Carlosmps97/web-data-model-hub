// Doc 100 (P3): conflictos con producción en la revisión. Además de «producción
// la cambió después de que esta versión la editó» (aprobar la pisa), una
// entidad que producción BORRÓ después de abrirse esta versión vuelve al
// aprobar (`restores`): la revisión lo dice con otras palabras.
import { describe, expect, it } from 'vitest';
import { conflictCounts } from './conflicts';
import type { ChangesetDiff } from '@/types/versioning';

const diff = (collections: ChangesetDiff['collections']): ChangesetDiff =>
  ({ collections, impact: { tablesTouched: 0, columnsTouched: 0, affectedOtherTables: [] } }) as ChangesetDiff;

describe('conflictCounts', () => {
  it('separa lo que aprobar PISA de lo que aprobar RESTAURA', () => {
    expect(conflictCounts(diff({
      subject_areas: {
        added: [{ id: 'sa1', name: 'Ventas', conflict: true, restores: true }, { id: 'sa2', name: 'Nuevo' }],
        edited: [{ id: 'sa3', name: 'Otro', conflict: true }],
        deleted: [],
      },
      canonical_tables: {
        added: [], edited: [{ id: 't1', name: 'T', conflict: false }],
        deleted: [{ id: 't2', name: 'U', conflict: true }],
      },
    }))).toEqual({ overwrites: 2, restores: 1, total: 3 });
  });

  it('`restores` sin `conflict` no cuenta (mismo criterio que el detalle de la entidad)', () => {
    expect(conflictCounts(diff({
      subject_areas: { added: [{ id: 'sa1', name: 'X', restores: true }], edited: [], deleted: [] },
    }))).toEqual({ overwrites: 0, restores: 0, total: 0 });
  });

  it('sin conflictos: todo en cero', () => {
    expect(conflictCounts(diff({}))).toEqual({ overwrites: 0, restores: 0, total: 0 });
  });
});
