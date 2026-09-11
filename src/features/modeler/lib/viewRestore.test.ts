// Doc 89 §3.4: Undo del borrado de una vista desde el inspector — el backend
// (doc 88 §4) la quitó de `viewIds`/`layout` de sus canvases; la inversa re-graba
// la vista y vuelve a listarla en los canvases donde estaba (best-effort).
import { describe, expect, it } from 'vitest';
import { viewRestorePlan } from './viewRestore';

describe('viewRestorePlan', () => {
  it('agrega la vista a los canvases con membresía explícita que ya no la listan', () => {
    expect(viewRestorePlan('v1', [
      { id: 'sa1', viewIds: ['v9'] },
      { id: 'sa2', viewIds: [] },
    ])).toEqual([
      { canvasId: 'sa1', viewIds: ['v9', 'v1'] },
      { canvasId: 'sa2', viewIds: ['v1'] },
    ]);
  });

  it('no toca canvases que ya la listan ni legacy sin membresía explícita (viewIds null, doc 70)', () => {
    expect(viewRestorePlan('v1', [
      { id: 'sa1', viewIds: ['v1', 'v2'] },
      { id: 'sa2', viewIds: null },
      { id: 'sa3' },
    ])).toEqual([]);
  });

  it('un canvas repetido en la lista se planifica UNA vez', () => {
    expect(viewRestorePlan('v1', [{ id: 'sa1', viewIds: [] }, { id: 'sa1', viewIds: [] }]))
      .toEqual([{ canvasId: 'sa1', viewIds: ['v1'] }]);
  });
});
