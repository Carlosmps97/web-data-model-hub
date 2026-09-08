// Doc 70 §2: helpers puros de membresía de vistas en el canvas.
import { describe, expect, it } from 'vitest';
import type { View } from '@/services/views.service';
import { mergeIds, orphanViewIds, splitByCanvas, viewsOfTable, withoutIds } from './canvasViews';

const v1: View = { id: 'v1', name: 'A_VU', sourceTableIds: ['t1'] };
const v2: View = { id: 'v2', name: 'B_VU', sourceTableIds: ['t1', 't2'] };
const v3: View = { id: 'v3', name: 'C_VU', tableId: 't2' };           // legacy: sólo tableId
const v4: View = { id: 'v4', name: 'D_VU', sourceTableIds: ['t9'] };

describe('canvasViews', () => {
  it('viewsOfTable: fuentes canónicas y legacy', () => {
    expect(viewsOfTable([v1, v2, v3, v4], 't1').map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(viewsOfTable([v1, v2, v3, v4], 't2').map((v) => v.id)).toEqual(['v2', 'v3']);
    expect(viewsOfTable([v1, v2, v3, v4], 't7')).toEqual([]);
  });

  it('splitByCanvas: conserva el orden y separa por membresía', () => {
    const { here, elsewhere } = splitByCanvas([v1, v2, v3], new Set(['v3', 'v1']));
    expect(here.map((v) => v.id)).toEqual(['v1', 'v3']);
    expect(elsewhere.map((v) => v.id)).toEqual(['v2']);
  });

  it('orphanViewIds: sólo las vistas sin ninguna fuente restante', () => {
    // quitar t1: v1 queda huérfana; v2 sobrevive por t2; v3 (legacy t2) sobrevive
    expect(orphanViewIds([v1, v2, v3], ['t2'])).toEqual(['v1']);
    // quitar todo: todas huérfanas
    expect(orphanViewIds([v1, v2, v3], [])).toEqual(['v1', 'v2', 'v3']);
    expect(orphanViewIds([], ['t1'])).toEqual([]);
  });

  it('mergeIds / withoutIds: sin duplicados y con orden estable', () => {
    expect(mergeIds(['a', 'b'], ['b', 'c', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeIds([], ['x', 'x'])).toEqual(['x']);
    expect(withoutIds(['a', 'b', 'c'], ['b', 'z'])).toEqual(['a', 'c']);
  });
});
