// Tras la carga, en cada canvas que ganó tablas o vistas se ubica solo lo que
// entró (`newMembers` del backend) y se graba con `setSubjectAreaLayout`, que
// mezcla posiciones: lo existente no se mueve y los trazos manuales de wires se
// conservan (no se usa `arrangeSubjectArea`, que reinicia los trazos). Un
// canvas que falla no frena a los demás.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/features/modeler/services/structure.service', () => ({ arrangeSubjectArea: vi.fn(), setSubjectAreaLayout: vi.fn() }));
vi.mock('@/features/modeler/lib/placeNewMembers', () => ({ placeNewMembers: vi.fn() }));

import { loadDiagram } from '@/features/modeler/services/modeler.service';
import { arrangeSubjectArea, setSubjectAreaLayout } from '@/features/modeler/services/structure.service';
import { placeNewMembers } from '@/features/modeler/lib/placeNewMembers';
// eslint-disable-next-line no-restricted-imports -- a propósito: por el barrel de modeler sería un ciclo (Toolbar → UploadModal → modeler); ver docs/02-arquitectura.md
import { pinSession } from '@/features/modeler/lib/sessionGuard';
import { useSessionStore } from '@/store/useSessionStore';
import { placeUploadedObjects } from './placeUploaded';

const dia = (id: string) => ({ subjectArea: { id }, tables: [], columns: [], relationships: [], views: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDiagram).mockImplementation(async (id: string) => dia(id) as never);
  vi.mocked(placeNewMembers).mockImplementation(async (_d, entering) => Object.fromEntries(entering.map((e, i) => [e, { x: i, y: i }])));
  vi.mocked(setSubjectAreaLayout).mockResolvedValue({} as never);
});

describe('placeUploadedObjects', () => {
  it('ubica solo lo que entró a cada canvas y lo graba sin reiniciar trazos, en orden', async () => {
    const progress: [number, number][] = [];
    const out = await placeUploadedObjects(['sa1', 'sa2'], { sa1: ['t9'], sa2: ['t8', 'v8'] }, null, (d, t) => progress.push([d, t]));
    expect(out).toEqual({ placed: 2, failed: [], skipped: [] });
    expect(vi.mocked(placeNewMembers).mock.calls.map((c) => [c[0].subjectArea.id, c[1], c[2]]))
      .toEqual([['sa1', ['t9'], null], ['sa2', ['t8', 'v8'], null]]);
    expect(vi.mocked(setSubjectAreaLayout).mock.calls).toEqual([
      ['sa1', { t9: { x: 0, y: 0 } }],
      ['sa2', { t8: { x: 0, y: 0 }, v8: { x: 1, y: 1 } }],
    ]);
    expect(arrangeSubjectArea).not.toHaveBeenCalled();
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('el canvas abierto usa el centro de lo que el usuario ve; los demás, el de su contenido', async () => {
    await placeUploadedObjects(['sa1', 'sa2'], { sa1: ['a'], sa2: ['b'] }, { saId: 'sa2', point: { x: 5, y: 6 } });
    expect(vi.mocked(placeNewMembers).mock.calls.map((c) => c[2])).toEqual([null, { x: 5, y: 6 }]);
  });

  it('sin `newMembers` o sin nada nuevo en un canvas: no lo carga ni escribe', async () => {
    expect(await placeUploadedObjects(['sa1'], undefined, null)).toEqual({ placed: 0, failed: [], skipped: [] });
    expect(await placeUploadedObjects(['sa1', 'sa2'], { sa2: [] }, null)).toEqual({ placed: 0, failed: [], skipped: [] });
    expect(loadDiagram).not.toHaveBeenCalled();
    expect(setSubjectAreaLayout).not.toHaveBeenCalled();
  });

  it('un canvas que falla no frena a los demás; sin nada que ubicar en su diagrama, no escribe', async () => {
    vi.mocked(loadDiagram)
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async (id: string) => dia(id) as never);
    vi.mocked(placeNewMembers).mockResolvedValueOnce({});
    const out = await placeUploadedObjects(['bad', 'ok'], { bad: ['x'], ok: ['y'] }, null);
    expect(out).toEqual({ placed: 1, failed: ['bad'], skipped: [] });
    expect(setSubjectAreaLayout).not.toHaveBeenCalled();
  });
});

// Corre después de aplicar la carga, canvas por canvas, con el pin de la carga:
// si en el medio se abrió otra versión, no escribe en ella (ni carga el canvas
// siguiente) y devuelve en `skipped` los que no llegó a ubicar.
describe('placeUploadedObjects atado a la sesión de la carga', () => {
  const open = (cs: string) => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: cs });

  it('si a mitad se abre otra versión, no escribe en ella y lo dice', async () => {
    open('csA');
    const pin = pinSession();
    let n = 0;
    vi.mocked(loadDiagram).mockImplementation(async (id: string) => {
      n += 1;
      if (n === 2) open('csB');
      return dia(id) as never;
    });
    const where: string[] = [];
    vi.mocked(setSubjectAreaLayout).mockImplementation(async (id: string) => {
      where.push(`${useSessionStore.getState().activeChangesetId}:${id}`);
      return {} as never;
    });
    const out = await placeUploadedObjects(['sa1', 'sa2', 'sa3'], { sa1: ['a'], sa2: ['b'], sa3: ['c'] }, null, undefined, { pin });
    expect(where).toEqual(['csA:sa1']);
    expect(out).toEqual({ placed: 1, failed: [], skipped: ['sa2', 'sa3'] });
  });

  it('con la sesión ya cambiada, no carga ni calcula el canvas siguiente', async () => {
    open('csA');
    const pin = pinSession();
    vi.mocked(setSubjectAreaLayout).mockImplementation(async () => { open('csB'); return {} as never; });
    const out = await placeUploadedObjects(['sa1', 'sa2', 'sa3'], { sa1: ['a'], sa2: ['b'], sa3: ['c'] }, null, undefined, { pin });
    expect(vi.mocked(loadDiagram).mock.calls.map((c) => c[0])).toEqual(['sa1']);
    expect(placeNewMembers).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ placed: 1, failed: [], skipped: ['sa2', 'sa3'] });
  });
});
