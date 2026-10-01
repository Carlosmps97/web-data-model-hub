// Arrange «headless» de los canvases tocados por la carga (doc 55 §3.5):
// uno por uno, mismo motor que el botón Autoarrange, tolerante a fallos
// puntuales (un canvas que no arregla no frena a los demás). Doc 99: el
// arrange mueve TODOS los bloques del canvas, así que graba con
// `arrangeSubjectArea` — posiciones nuevas y trazos manuales reiniciados en la
// misma escritura (un canvas existente que ganó tablas no queda con trazos
// que ya no calzan).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/features/modeler/services/structure.service', () => ({ arrangeSubjectArea: vi.fn(), setSubjectAreaLayout: vi.fn() }));
vi.mock('@/features/modeler/lib/arrangeGraph', () => ({ arrangeDiagram: vi.fn() }));

import { loadDiagram } from '@/features/modeler/services/modeler.service';
import { arrangeSubjectArea, setSubjectAreaLayout } from '@/features/modeler/services/structure.service';
import { arrangeDiagram } from '@/features/modeler/lib/arrangeGraph';
// eslint-disable-next-line no-restricted-imports -- a propósito: por el barrel de modeler sería un ciclo (Toolbar → UploadModal → modeler); ver doc/architecture.md
import { pinSession } from '@/features/modeler/lib/sessionGuard';
import { useSessionStore } from '@/store/useSessionStore';
import { arrangeCanvases } from './arrangeCanvases';

const dia = (n: number) => ({ tables: Array.from({ length: n }, (_, i) => ({ id: `t${i}` })) });

beforeEach(() => { vi.clearAllMocks(); });

describe('arrangeCanvases', () => {
  it('lays out every canvas with ELK and persists the positions, in order', async () => {
    vi.mocked(loadDiagram).mockResolvedValue(dia(2) as never);
    vi.mocked(arrangeDiagram).mockResolvedValue({ t0: { x: 1, y: 2 } });
    vi.mocked(arrangeSubjectArea).mockResolvedValue({} as never);
    const progress: [number, number][] = [];
    const out = await arrangeCanvases(['sa1', 'sa2'], 'physical', (d, t) => progress.push([d, t]));
    expect(out).toEqual({ arranged: 2, failed: [], skipped: [] });
    expect(vi.mocked(loadDiagram).mock.calls.map((c) => c[0])).toEqual(['sa1', 'sa2']);
    expect(vi.mocked(arrangeSubjectArea).mock.calls).toEqual([['sa1', { t0: { x: 1, y: 2 } }], ['sa2', { t0: { x: 1, y: 2 } }]]);
    expect(setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(vi.mocked(arrangeDiagram).mock.calls[0][2]).toBe('physical');
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('skips empty canvases and keeps going when one canvas fails', async () => {
    vi.mocked(loadDiagram)
      .mockResolvedValueOnce(dia(0) as never)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(dia(1) as never);
    vi.mocked(arrangeDiagram).mockResolvedValue({});
    vi.mocked(arrangeSubjectArea).mockResolvedValue({} as never);
    const out = await arrangeCanvases(['empty', 'bad', 'ok'], 'logical');
    expect(out).toEqual({ arranged: 2, failed: ['bad'], skipped: [] });
    expect(arrangeDiagram).toHaveBeenCalledTimes(1);
    expect(arrangeSubjectArea).toHaveBeenCalledTimes(1);
  });
});

// Doc 105 (ronda 3, R7-B): el arrange corre DESPUÉS de aplicar la carga, canvas
// por canvas, y el servicio toma la versión al llamarlo: si en el medio se
// abría otra versión (Back → Home → otra), los canvases que faltaban se
// escribían en ELLA. Va con el pin de la carga y corta si la sesión cambió.
// Ronda 4: el corte no se tira como error — se devuelve qué canvases quedaron
// sin arreglar (`skipped`) para avisarlo; y cerrar el popup ya no lo corta (la
// carga ya está aplicada en su versión: el arrange sigue).
describe('arrangeCanvases atado a la sesión de la carga (doc 105, R7-B)', () => {
  const open = (cs: string) => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: cs });

  it('si a mitad del arrange se abre otra versión, NO escribe en ella y lo dice', async () => {
    open('csA');
    const pin = pinSession();
    let n = 0;
    vi.mocked(loadDiagram).mockImplementation(async () => {
      n += 1;
      if (n === 2) open('csB');                       // el usuario abre otra versión mientras corre
      return dia(1) as never;
    });
    vi.mocked(arrangeDiagram).mockResolvedValue({ t0: { x: 1, y: 2 } });
    const where: string[] = [];
    vi.mocked(arrangeSubjectArea).mockImplementation(async (id: string) => {
      where.push(`${useSessionStore.getState().activeChangesetId}:${id}`);
      return {} as never;
    });
    const out = await arrangeCanvases(['sa1', 'sa2', 'sa3'], 'physical', undefined, { pin });
    expect(where).toEqual(['csA:sa1']);                  // antes: ['csA:sa1', 'csB:sa2', 'csB:sa3']
    expect(out).toEqual({ arranged: 1, failed: [], skipped: ['sa2', 'sa3'] });
  });
});

// Doc 105 (ronda 5, R15-H8): con la sesión ya cambiada no se sigue trabajando
// en la nueva — antes cargaba el diagrama del canvas siguiente y corría ELK
// (en otra versión: un 404 disparaba revalidaciones y contaba como «failed»)
// antes de cortar en el `pin.check()` de la escritura.
describe('arrangeCanvases no trabaja en la sesión nueva (doc 105, ronda 5)', () => {
  const open = (cs: string) => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: cs });

  it('si la sesión cambió, no carga ni calcula el canvas siguiente', async () => {
    open('csA');
    const pin = pinSession();
    vi.mocked(loadDiagram).mockResolvedValue(dia(1) as never);
    vi.mocked(arrangeDiagram).mockResolvedValue({ t0: { x: 1, y: 2 } });
    vi.mocked(arrangeSubjectArea).mockImplementation(async () => { open('csB'); return {} as never; });   // cambia mientras graba sa1
    const out = await arrangeCanvases(['sa1', 'sa2', 'sa3'], 'physical', undefined, { pin });
    expect(vi.mocked(loadDiagram).mock.calls.map((c) => c[0])).toEqual(['sa1']);
    expect(arrangeDiagram).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ arranged: 1, failed: [], skipped: ['sa2', 'sa3'] });
  });
});
