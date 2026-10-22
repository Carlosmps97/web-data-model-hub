// Conflictos con producción en la revisión. Además de «producción la modificó
// después de que esta versión la editó» (aprobar la pisa), una entidad que
// producción borró después de abrirse esta versión vuelve al aprobar
// (`restores`): la revisión lo dice con otras palabras.
import { describe, expect, it } from 'vitest';
import { conflictCounts } from './conflicts';
import type { ChangesetDiff } from '@/types/versioning';

const diff = (collections: ChangesetDiff['collections']): ChangesetDiff =>
  ({ collections, impact: { tablesTouched: 0, columnsTouched: 0, affectedOtherTables: [] } }) as ChangesetDiff;

describe('conflictCounts', () => {
  it('separa lo que aprobar pisa de lo que aprobar restaura', () => {
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
    }))).toEqual({ overwrites: 2, restores: 1, blocked: 0, total: 3 });
  });

  it('`restores` sin `conflict` no cuenta (mismo criterio que el detalle de la entidad)', () => {
    expect(conflictCounts(diff({
      subject_areas: { added: [{ id: 'sa1', name: 'X', restores: true }], edited: [], deleted: [] },
    }))).toEqual({ overwrites: 0, restores: 0, blocked: 0, total: 0 });
  });

  it('sin conflictos: todo en cero', () => {
    expect(conflictCounts(diff({}))).toEqual({ overwrites: 0, restores: 0, blocked: 0, total: 0 });
  });

  it('lo que otra versión borró y esta cambia bloquea el publish: no cuenta como restauración', () => {
    expect(conflictCounts(diff({
      views: {
        added: [{ id: 'v1', name: 'V', conflict: true, deletedInProduction: true },
                { id: 'v2', name: 'W', conflict: true, restores: true }],
        edited: [{ id: 'v3', name: 'X', conflict: true }],
        deleted: [],
      },
    }))).toEqual({ overwrites: 1, restores: 1, blocked: 1, total: 3 });
  });
});
