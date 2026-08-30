// Arrange «headless» de los canvases tocados por la carga (doc 55 §3.5):
// uno por uno, mismo motor que el botón Autoarrange, tolerante a fallos
// puntuales (un canvas que no arregla no frena a los demás).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/features/modeler/services/structure.service', () => ({ setSubjectAreaLayout: vi.fn() }));
vi.mock('@/features/modeler/lib/arrangeGraph', () => ({ arrangeDiagram: vi.fn() }));

import { loadDiagram } from '@/features/modeler/services/modeler.service';
import { setSubjectAreaLayout } from '@/features/modeler/services/structure.service';
import { arrangeDiagram } from '@/features/modeler/lib/arrangeGraph';
import { arrangeCanvases } from './arrangeCanvases';

const dia = (n: number) => ({ tables: Array.from({ length: n }, (_, i) => ({ id: `t${i}` })) });

beforeEach(() => { vi.clearAllMocks(); });

describe('arrangeCanvases', () => {
  it('lays out every canvas with ELK and persists the positions, in order', async () => {
    vi.mocked(loadDiagram).mockResolvedValue(dia(2) as never);
    vi.mocked(arrangeDiagram).mockResolvedValue({ t0: { x: 1, y: 2 } });
    vi.mocked(setSubjectAreaLayout).mockResolvedValue({} as never);
    const progress: [number, number][] = [];
    const out = await arrangeCanvases(['sa1', 'sa2'], 'physical', (d, t) => progress.push([d, t]));
    expect(out).toEqual({ arranged: 2, failed: [] });
    expect(vi.mocked(loadDiagram).mock.calls.map((c) => c[0])).toEqual(['sa1', 'sa2']);
    expect(vi.mocked(setSubjectAreaLayout).mock.calls).toEqual([['sa1', { t0: { x: 1, y: 2 } }], ['sa2', { t0: { x: 1, y: 2 } }]]);
    expect(vi.mocked(arrangeDiagram).mock.calls[0][2]).toBe('physical');
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('skips empty canvases and keeps going when one canvas fails', async () => {
    vi.mocked(loadDiagram)
      .mockResolvedValueOnce(dia(0) as never)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(dia(1) as never);
    vi.mocked(arrangeDiagram).mockResolvedValue({});
    vi.mocked(setSubjectAreaLayout).mockResolvedValue({} as never);
    const out = await arrangeCanvases(['empty', 'bad', 'ok'], 'logical');
    expect(out).toEqual({ arranged: 2, failed: ['bad'] });
    expect(arrangeDiagram).toHaveBeenCalledTimes(1);
    expect(setSubjectAreaLayout).toHaveBeenCalledTimes(1);
  });
});
