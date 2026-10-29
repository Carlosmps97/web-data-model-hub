// Guardados del canvas que corren en segundo plano: el canvas los dispara con
// `void` (soltar un bloque, cambiar de canvas con dibujos pendientes). Si fallan,
// avisan con el criterio de los dibujos: un error de la versión espera la
// revalidación y calla si la sesión dejó de editar esa versión (la revalidación
// ya avisó); si no, muestra el motivo real. Nunca queda un rechazo sin manejar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('../features/modeler/services/structure.service', () => ({
  setSubjectAreaLayout: vi.fn(async () => ({})),
  setSubjectAreaDrawings: vi.fn(async () => ({})),
  arrangeSubjectArea: vi.fn(async () => ({})),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import { toast } from 'sonner';
import * as mod from '../features/modeler/services/modeler.service';
import * as struct from '../features/modeler/services/structure.service';
import { trackRevalidation } from '../features/modeler/lib/sessionGuard';
import { flushPendingWrites, hasPendingWrites } from '@/services/draftWork';
import { ApiError } from '@/services/http';
import { failureText, useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const refused = (message: string) => new ApiError(message, 403, message, '/api/changesets/cs1/changes');

// Los bloques que se mueven son del canvas (solo esos entran a su layout).
const diagram = (saId: string) => ({
  subjectArea: { id: saId, projectId: 'p1', name: saId, tableIds: ['t1', 't2'], viewIds: ['v1'], layout: {}, routes: {} },
  tables: [], columns: [], relationships: [], views: [],
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ activeSaId: 'sa1', activeProjectId: 'p1', diagram: diagram('sa1'), drawings: [], dirty: false, flow: null });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => diagram(saId));
});
afterEach(async () => {
  await sleep(20);
  process.off('unhandledRejection', onUnhandled);
});

describe('saveLayout que falla', () => {
  it('como lo llama el canvas (`void saveLayout(...)`): sin rechazo sin manejar y con el motivo', async () => {
    vi.mocked(struct.setSubjectAreaLayout).mockRejectedValueOnce(new Error('sin red'));
    void useModelerStore.getState().saveLayout('t1', { x: 10.4, y: 20.6 });
    await sleep(30);
    expect(unhandled, 'unhandledRejection').toEqual([]);
    // Qué falló + el motivo (el motivo solo no dice qué falló).
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the position: sin red.");
  });

  it('sin motivo legible: «Couldn\'t save the position»', async () => {
    vi.mocked(struct.setSubjectAreaLayout).mockRejectedValueOnce(new Error(''));
    await useModelerStore.getState().saveLayout('t1', { x: 1, y: 2 });
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the position");
  });

  it('403 de la versión y la revalidación cambia la sesión: calla (el aviso lo da la revalidación)', async () => {
    vi.mocked(struct.setSubjectAreaLayout).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((res) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' }); res();
      }, 20)));
      throw refused('Only the owner can edit this version.');
    });
    await useModelerStore.getState().saveLayout('t1', { x: 1, y: 2 });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('403 de la versión y la sesión sigue igual (rol perdido): avisa el motivo real, después de la revalidación', async () => {
    let revalidated = false;
    vi.mocked(struct.setSubjectAreaLayout).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((res) => setTimeout(() => { revalidated = true; res(); }, 20)));
      throw refused("You don't have permission for this action (model.edit).");
    });
    await useModelerStore.getState().saveLayout('t1', { x: 1, y: 2 });
    expect(revalidated).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the position: You don't have permission for this action (model.edit).");
  });
});

describe('flush de dibujos al cambiar de canvas', () => {
  it('si falla, avisa como el guardado con debounce', async () => {
    vi.mocked(struct.setSubjectAreaDrawings).mockRejectedValueOnce(new Error('sin red'));
    useModelerStore.getState().addDrawing('rect');                // agenda el guardado (debounce)
    await useModelerStore.getState().selectSubjectArea('sa2');    // flush inmediato del canvas anterior
    await sleep(30);
    expect(struct.setSubjectAreaDrawings).toHaveBeenCalledWith('sa1', expect.any(Array));
    expect(unhandled, 'unhandledRejection').toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the drawings: sin red.");
  });

  it('403 de la versión que cambia la sesión: calla', async () => {
    vi.mocked(struct.setSubjectAreaDrawings).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((res) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' }); res();
      }, 10)));
      throw refused('Only the owner can edit this version.');
    });
    useModelerStore.getState().addDrawing('rect');
    await useModelerStore.getState().selectSubjectArea('sa2');
    await sleep(40);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('updateDrawing sin cambio real', () => {
  it('no graba ni marca el canvas sucio; un cambio real, sí', async () => {
    // El guardado de dibujos es un temporizador de módulo (debounce de 500 ms):
    // el que otro test dejó agendado caería dentro de la ventana que se mide acá.
    await sleep(600);
    vi.mocked(struct.setSubjectAreaDrawings).mockClear();
    useModelerStore.setState({ drawings: [{ id: 'd1', type: 'text', x: 0, y: 0, w: 100, h: 40, align: 'center', font: { size: 11, bold: true } }], dirty: false });
    useModelerStore.getState().updateDrawing('d1', { align: 'center', font: { size: 11, bold: true } });
    useModelerStore.getState().updateDrawing('nope', { align: 'left' });
    await sleep(800);
    expect(struct.setSubjectAreaDrawings).not.toHaveBeenCalled();
    expect(useModelerStore.getState().dirty).toBe(false);
    useModelerStore.getState().updateDrawing('d1', { align: 'right' });
    expect(useModelerStore.getState().drawings[0].align).toBe('right');
    expect(useModelerStore.getState().dirty).toBe(true);
  });
});

describe('mover varios bloques a la vez', () => {
  it('una escritura del layout con todos los movidos, en píxeles enteros, y el diagrama al día en sitio', async () => {
    const before = useModelerStore.getState().diagram;
    await useModelerStore.getState().saveNodePositions({ t1: { x: 10.4, y: 20.6 }, v1: { x: 300, y: 40 } });
    expect(struct.setSubjectAreaLayout).toHaveBeenCalledTimes(1);
    expect(struct.setSubjectAreaLayout).toHaveBeenCalledWith('sa1', { t1: { x: 10, y: 21 }, v1: { x: 300, y: 40 } });
    expect(useModelerStore.getState().diagram).toBe(before);
    expect(useModelerStore.getState().diagram!.subjectArea.layout).toEqual({ t1: { x: 10, y: 21 }, v1: { x: 300, y: 40 } });
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('sin nodos no escribe nada', async () => {
    await useModelerStore.getState().saveNodePositions({});
    expect(struct.setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(useModelerStore.getState().dirty).toBe(false);
  });

  it('si falla, avisa una vez (mismo criterio que saveLayout)', async () => {
    vi.mocked(struct.setSubjectAreaLayout).mockRejectedValueOnce(new Error('sin red'));
    void useModelerStore.getState().saveNodePositions({ t1: { x: 1, y: 1 }, t2: { x: 2, y: 2 } });
    await sleep(30);
    expect(unhandled, 'unhandledRejection').toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the position: sin red.");
  });
});

// Un «Internal server error. Check the logs…» junto a «View created» no dice qué
// falló: el aviso lleva el contexto y el motivo, sin duplicar el contexto si el
// motivo ya lo trae.
describe('failureText', () => {
  it('contexto + motivo, con un solo punto final', () => {
    expect(failureText("Couldn't add the view to this canvas", new Error('Internal server error. Check the logs using the X-Request-ID.')))
      .toBe("Couldn't add the view to this canvas: Internal server error. Check the logs using the X-Request-ID.");
    expect(failureText("Couldn't save the position", new Error('sin red'))).toBe("Couldn't save the position: sin red.");
  });

  it('sin motivo legible: solo el contexto', () => {
    expect(failureText("Couldn't save the position", new Error(''))).toBe("Couldn't save the position");
    expect(failureText("Couldn't save the position", 'raro')).toBe("Couldn't save the position");
  });

  it('si el motivo ya dice lo mismo, va solo', () => {
    expect(failureText("Couldn't save the drawings", new Error("Couldn't save the drawings: the canvas is gone.")))
      .toBe("Couldn't save the drawings: the canvas is gone.");
  });
});

describe('dibujo nuevo', () => {
  it('queda marcado para nacer seleccionado (si no, se pintaría detrás de una tabla y parecería no haberse creado)', () => {
    useModelerStore.getState().addDrawing('rect');
    const st = useModelerStore.getState();
    const created = st.drawings[st.drawings.length - 1];
    expect(st.justAddedDrawingId).toBe(created.id);
  });
});

// Undo y Redo graban ya lo agendado antes de esperar lo en vuelo (doc 133 §5):
// los dibujos no están en el historial, pero su guardado no puede caer en medio
// del paso.
describe('dibujos agendados ante un Undo', () => {
  const box = { id: 'd1', type: 'rect' as const, x: 0, y: 0, w: 100, h: 40 };

  it('cuentan como agendados; flushPendingWrites los graba ya, una sola vez', async () => {
    await sleep(600);
    vi.mocked(struct.setSubjectAreaDrawings).mockClear();
    useModelerStore.setState({ drawings: [box] });
    useModelerStore.getState().updateDrawing('d1', { x: 30 });
    expect(hasPendingWrites()).toBe(true);
    flushPendingWrites();
    expect(struct.setSubjectAreaDrawings).toHaveBeenCalledWith('sa1', [{ ...box, x: 30 }]);
    expect(hasPendingWrites()).toBe(false);
    await sleep(600);
    expect(struct.setSubjectAreaDrawings).toHaveBeenCalledTimes(1);
  });

  it('dejan de contar al grabarse por su espera, al cambiar de canvas o con Save', async () => {
    await sleep(600);
    useModelerStore.setState({ drawings: [box] });
    useModelerStore.getState().updateDrawing('d1', { x: 31 });
    await sleep(550);
    expect(hasPendingWrites()).toBe(false);
    useModelerStore.getState().updateDrawing('d1', { x: 32 });
    await useModelerStore.getState().selectSubjectArea('sa2');
    expect(hasPendingWrites()).toBe(false);
    useModelerStore.setState({ activeSaId: 'sa1', diagram: diagram('sa1'), drawings: [box] });
    useModelerStore.getState().updateDrawing('d1', { x: 33 });
    await useModelerStore.getState().saveAll();
    expect(hasPendingWrites()).toBe(false);
  });

  it('si el canvas cambió desde que se agendaron, no los graba (su cambio de canvas ya lo hizo)', async () => {
    await sleep(600);
    useModelerStore.setState({ drawings: [box] });
    useModelerStore.getState().updateDrawing('d1', { x: 34 });
    useModelerStore.setState({ activeSaId: 'sa9' });
    vi.mocked(struct.setSubjectAreaDrawings).mockClear();
    flushPendingWrites();
    expect(struct.setSubjectAreaDrawings).not.toHaveBeenCalled();
    expect(hasPendingWrites()).toBe(false);
  });
});
