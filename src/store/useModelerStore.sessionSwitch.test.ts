import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({}));
vi.mock('@/features/modeler/services/structure.service', () => ({
  setSubjectAreaLayout: vi.fn(async () => ({})),
  setSubjectAreaDrawings: vi.fn(async () => ({})),
  arrangeSubjectArea: vi.fn(async () => ({})),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import * as struct from '@/features/modeler/services/structure.service';
import { trackRevalidation } from '@/features/modeler/lib/sessionGuard';
import { ApiError } from '@/services/http';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { pushUndo, useUndoStore } from './useUndoStore';

/** Doc 104 (revisión): un guardado AGENDADO en una sesión de edición no se
 *  escribe si, cuando le toca, la sesión ya no edita esa versión (transferida,
 *  eliminada, enviada a revisión): los dibujos del debounce y el «Save and
 *  leave» de la navegación. */
describe('useModelerStore — guardados agendados tras un cambio de sesión (doc 104)', () => {
  const drawings = [{ id: 'd1', kind: 'rect', x: 1, y: 2 }] as never;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    useModelerStore.setState({ activeSaId: 'sa1', drawings, dirty: false, flow: { getNodes: () => [] } as never });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('los dibujos pendientes se graban si la sesión sigue editando la misma versión', async () => {
    useModelerStore.getState().persistDrawings();
    await vi.advanceTimersByTimeAsync(600);
    expect(struct.setSubjectAreaDrawings).toHaveBeenCalledWith('sa1', drawings);
  });

  it('los dibujos pendientes se descartan si la sesión pasó a solo lectura', async () => {
    useModelerStore.getState().persistDrawings();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' });
    await vi.advanceTimersByTimeAsync(600);
    expect(struct.setSubjectAreaDrawings).not.toHaveBeenCalled();
  });

  it('los dibujos pendientes se descartan si la sesión pasó a OTRA versión', async () => {
    useModelerStore.getState().persistDrawings();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    await vi.advanceTimersByTimeAsync(600);
    expect(struct.setSubjectAreaDrawings).not.toHaveBeenCalled();
  });

  it('«Save and leave» sin sesión de edición no escribe nada y deja de estar sucio', async () => {
    useModelerStore.setState({ dirty: true });
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' });
    await useModelerStore.getState().saveAll();
    expect(struct.setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(struct.setSubjectAreaDrawings).not.toHaveBeenCalled();
    expect(useModelerStore.getState().dirty).toBe(false);
  });
});

describe('fallo del guardado de dibujos de la versión abierta (doc 104, ronda 3)', () => {
  const drawings = [{ id: 'd1', kind: 'rect', x: 1, y: 2 }] as never;
  const refused = (status: number, message: string) =>
    new ApiError(message, status, message, '/api/changesets/cs1/changes');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    useModelerStore.setState({ activeSaId: 'sa1', drawings, dirty: false, flow: { getNodes: () => [] } as never });
  });
  afterEach(() => { vi.useRealTimers(); });

  async function drawThenFail(err: ApiError, revalidation: () => void) {
    vi.mocked(struct.setSubjectAreaDrawings).mockImplementationOnce(async () => {
      // el observador HTTP registra la revalidación ANTES de que el error llegue al llamador
      trackRevalidation(new Promise<void>((resolve) => setTimeout(() => { revalidation(); resolve(); }, 300)));
      throw err;
    });
    useModelerStore.getState().persistDrawings();
    await vi.advanceTimersByTimeAsync(1000);
  }

  it('si la revalidación cambió la sesión (transferida), no repite un aviso crudo', async () => {
    await drawThenFail(refused(403, 'Only published versions and your own drafts can be opened in the canvas.'),
      () => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('si la sesión sigue igual (p. ej. le quitaron el rol), el error real SÍ se muestra', async () => {
    await drawThenFail(refused(403, "You don't have permission for this action (model.edit)."), () => {});
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the drawings: You don't have permission for this action (model.edit).");
  });

  it('un 409 que no cambió la sesión (p. ej. nombre duplicado) también se muestra', async () => {
    await drawThenFail(refused(409, 'Canvas name already exists.'), () => {});
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the drawings: Canvas name already exists.");
  });
});

describe('refreshExplorer ante un 403/404 de la versión abierta (doc 104, ronda 3)', () => {
  const failing = (status: number) =>
    new ApiError('Invalid JSON response (HTTP 403)', status, null, '/api/changesets/cs1/effective/projects');
  const original = { loadProjects: useModelerStore.getState().loadProjects, loadSchemas: useModelerStore.getState().loadSchemas };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  });
  afterEach(() => { vi.useRealTimers(); useModelerStore.setState(original); });

  /** La carga de proyectos de la versión falla; el observador HTTP ya registró
   *  la revalidación, que en 300 ms hace `revalidation()`. */
  async function refreshFailing(err: ApiError, revalidation: () => void): Promise<unknown> {
    useModelerStore.setState({
      loadSchemas: vi.fn(async () => {}),
      loadProjects: vi.fn(async () => {
        trackRevalidation(new Promise<void>((resolve) => setTimeout(() => { revalidation(); resolve(); }, 300)));
        throw err;
      }),
    });
    const settled = useModelerStore.getState().refreshExplorer().then(() => 'resolved', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    return settled;
  }

  it('si la revalidación cambió la sesión, termina en silencio (el aviso ya lo dio ella)', async () => {
    const out = await refreshFailing(failing(403), () => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' }));
    expect(out).toBe('resolved');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('si la sesión sigue igual, el error no se traga: llega al llamador (p. ej. Refresh avisa)', async () => {
    const out = await refreshFailing(failing(403), () => {});
    expect(out).toBeInstanceOf(ApiError);
    expect((out as ApiError).status).toBe(403);
  });
});

/** Doc 105 F3: la pila de Undo es de la SESIÓN (proyecto + modo + versión):
 *  editar → solo lectura → editar la MISMA versión no deja inversas de antes
 *  (p. ej. de antes de una transferencia de ida y vuelta). El clipboard sigue
 *  su regla del doc 48 (muere sólo al cambiar de versión). */
describe('pila de Undo en los cambios de sesión (doc 105, F3)', () => {
  beforeEach(() => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    useUndoStore.setState({ stack: [], busy: false });
  });

  it('editar → solo lectura → editar la MISMA versión vacía la pila', () => {
    pushUndo('Delete table T', async () => {});
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' });
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('cambiar de modo sobre la misma versión ya la vacía (sin volver a editar)', () => {
    pushUndo('x', async () => {});
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' });
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('cambiar de versión sigue vaciándola (como antes)', () => {
    pushUndo('x', async () => {});
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('reabrir la MISMA sesión (mismo proyecto, modo y versión) NO la vacía', () => {
    pushUndo('x', async () => {});
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['x']);
  });

  it('el clipboard de tabla sobrevive a un cambio de MODO de la misma versión (doc 48, sin cambio)', () => {
    useModelerStore.setState({ tblClipboard: { table: { id: 't' }, cols: [] } as never });
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' });
    expect(useModelerStore.getState().tblClipboard).not.toBeNull();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    expect(useModelerStore.getState().tblClipboard).toBeNull();
  });
});
