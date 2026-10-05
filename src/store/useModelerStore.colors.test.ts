// Doc 109 — colores de las cajas en el store: se siembran del canvas, se pintan
// al instante y se graban UNA vez por gesto (con Undo), un guardado fallido
// vuelve a lo anterior, y el color propio de una tabla o vista es un cambio del
// modelo (changeset) con su Undo. Servicios mockeados.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/features/modeler/services/structure.service', () => ({
  setCanvasColors: vi.fn(async () => ({})),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, createTable: vi.fn(), currentTable: vi.fn() };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(async () => []), updateView: vi.fn(), currentView: vi.fn(),
}));

import { toast } from 'sonner';
import * as struct from '@/features/modeler/services/structure.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { inObjectOrder, useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const realReload = useModelerStore.getState().reload;

const diagramWith = (colors: unknown) => ({
  subjectArea: { id: 'sa1', projectId: 'p', name: 'Canvas', tableIds: ['t1', 't2'], viewIds: ['v1'], layout: {}, routes: {}, colors },
  tables: [
    { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', color: 'theme:th1' },
    { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta' },
  ],
  columns: [],
  relationships: [],
  views: [{ id: 'v1', name: 'VW_CLIENTE', sql: '', color: null }],
}) as never;

const st = () => useModelerStore.getState();
const colors = () => st().canvasColors;

/** La working copy (lo que leen `currentTable`/`currentView` y graban las escrituras). */
let working: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(struct.setCanvasColors).mockReset().mockImplementation(async () => ({}) as never);
  working = {
    t1: { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', color: 'theme:th1' },
    t2: { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta' },
    v1: { id: 'v1', name: 'VW_CLIENTE', sql: '', color: null },
  };
  const isView = (id: string) => 'name' in (working[id] ?? {});
  vi.mocked(gov.currentTable).mockReset().mockImplementation(async (id) =>
    (working[id] && !isView(id) ? { ...working[id] } : null) as never);
  vi.mocked(viewsSvc.currentView).mockReset().mockImplementation(async (id) =>
    (working[id] && isView(id) ? { ...working[id] } : null) as never);
  vi.mocked(gov.createTable).mockReset().mockImplementation(async (t) => { working[t.id] = { ...t }; return {} as never; });
  vi.mocked(viewsSvc.updateView).mockReset().mockImplementation(async (id, v) => { working[id] = { ...v, id }; return {} as never; });
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: 'sa1', diagram: null, dirty: false, reload: realReload });
  useModelerStore.setState({ diagram: diagramWith({ t2: '#16A37B' }) });
});

describe('siembra desde el canvas', () => {
  it('toma los colores del canvas, sin los inválidos', () => {
    useModelerStore.setState({ diagram: diagramWith({ t1: 'none', t2: '#16a37b', v1: 'rojo', t9: 7 }) });
    expect(colors()).toEqual({ t1: 'none', t2: '#16A37B' });
  });

  it('sin canvas abierto no hay colores', () => {
    useModelerStore.setState({ diagram: null });
    expect(colors()).toEqual({});
  });
});

describe('setBoxColors', () => {
  it('pinta de inmediato, graba UNA vez el lote y marca el canvas sucio', async () => {
    const saved = st().setBoxColors(['t1', 'v1', 't1'], 'theme:th2');
    expect(colors()).toEqual({ t1: 'theme:th2', t2: '#16A37B', v1: 'theme:th2' });   // optimista
    await saved;
    expect(struct.setCanvasColors).toHaveBeenCalledTimes(1);
    expect(vi.mocked(struct.setCanvasColors).mock.calls[0]).toEqual(['sa1', { t1: 'theme:th2', v1: 'theme:th2' }]);
    expect(st().dirty).toBe(true);
    expect(st().diagram!.subjectArea.colors).toEqual(colors());                     // el canvas del diagrama, al día
  });

  it('null quita la excepción: la caja vuelve al color de su tabla', async () => {
    await st().setBoxColors(['t2'], null);
    expect(colors()).toEqual({});
    expect(vi.mocked(struct.setCanvasColors).mock.calls[0]).toEqual(['sa1', { t2: null }]);
  });

  it('sin cambio real, o con un color inválido, no graba ni apila Undo', async () => {
    await st().setBoxColors(['t2'], '#16a37b');
    await st().setBoxColors(['t1'], 'rojo');
    await st().setBoxColors([], '#000000');
    expect(struct.setCanvasColors).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(st().dirty).toBe(false);
  });

  it('en visor o sin working copy no hace nada', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    useModelerStore.setState({ diagram: diagramWith({ t2: '#16A37B' }) });
    await st().setBoxColors(['t1'], '#000000');
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: null });
    useModelerStore.setState({ diagram: diagramWith({ t2: '#16A37B' }) });
    await st().setBoxColors(['t1'], '#000000');
    expect(struct.setCanvasColors).not.toHaveBeenCalled();
    expect(colors()).toEqual({ t2: '#16A37B' });
  });

  it('si el guardado falla, vuelve a lo anterior, avisa y no deja Undo', async () => {
    vi.mocked(struct.setCanvasColors).mockRejectedValueOnce(new Error('sin red'));
    await st().setBoxColors(['t1', 't2'], 'none');
    expect(colors()).toEqual({ t2: '#16A37B' });
    expect(toast.error).toHaveBeenCalledWith("Couldn't change the color: sin red.");
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('un fallo no pisa un color más nuevo de la misma caja', async () => {
    let fail!: (e: unknown) => void;
    vi.mocked(struct.setCanvasColors).mockImplementationOnce(() => new Promise((_r, rej) => { fail = rej; }));
    const first = st().setBoxColors(['t1'], '#111111');
    await st().setBoxColors(['t1'], '#222222');     // el segundo gesto graba bien
    fail(new Error('sin red'));
    await first;
    expect(colors().t1).toBe('#222222');
  });

  it('un diagrama que llega con el guardado en vuelo (pedido antes) no borra el color pedido', async () => {
    let done!: () => void;
    vi.mocked(struct.setCanvasColors).mockImplementationOnce(() => new Promise((r) => { done = () => r({} as never); }));
    const saved = st().setBoxColors(['t1'], '#FF0000');
    useModelerStore.setState({ diagram: diagramWith({ t2: '#16A37B' }) });   // la foto de antes del guardado
    expect(colors()).toEqual({ t1: '#FF0000', t2: '#16A37B' });
    done();
    await saved;
    expect(colors()).toEqual({ t1: '#FF0000', t2: '#16A37B' });
    // y volver al color de la tabla se graba (antes se salteaba: «sin cambio»)
    await st().setBoxColors(['t1'], null);
    expect(vi.mocked(struct.setCanvasColors).mock.calls[1]).toEqual(['sa1', { t1: null }]);
  });

  it('un color en vuelo de una versión no se le pega a otra que abre el mismo canvas', async () => {
    let done!: () => void;
    vi.mocked(struct.setCanvasColors).mockImplementationOnce(() => new Promise((r) => { done = () => r({} as never); }));
    const saved = st().setBoxColors(['t1'], '#FF0000');
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs2' });
    useModelerStore.setState({ activeSaId: 'sa1', diagram: diagramWith({ t2: '#16A37B' }) });   // cs2 abre el mismo canvas
    expect(colors()).toEqual({ t2: '#16A37B' });
    done();
    await saved;
    expect(colors()).toEqual({ t2: '#16A37B' });
  });

  it('ignora ids que no son tablas ni vistas de este canvas', async () => {
    await st().setBoxColors(['zz', 't1'], '#000000');
    expect(vi.mocked(struct.setCanvasColors).mock.calls[0]).toEqual(['sa1', { t1: '#000000' }]);
    vi.mocked(struct.setCanvasColors).mockClear();
    await st().setBoxColors(['zz'], '#000000');
    expect(struct.setCanvasColors).not.toHaveBeenCalled();
  });

  it('Undo repone lo que tenía cada caja', async () => {
    await st().setBoxColors(['t1', 't2'], '#000000');
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Change color of 2 boxes']);
    await useUndoStore.getState().undoLast();
    expect(colors()).toEqual({ t2: '#16A37B' });
    expect(vi.mocked(struct.setCanvasColors).mock.calls[1]).toEqual(['sa1', { t1: null, t2: '#16A37B' }]);
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

describe('setObjectColor', () => {
  beforeEach(() => { useModelerStore.setState({ reload: vi.fn(async () => {}) }); });

  it('tabla: graba el color en la tabla (changeset), recarga y deja Undo con el anterior', async () => {
    await st().setObjectColor('t1', '#ff0000');
    expect(gov.createTable).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', color: '#FF0000' }));
    expect(st().reload).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Change color of M_CLIENTE']);
    await useUndoStore.getState().undoLast();
    expect(vi.mocked(gov.createTable).mock.calls[1][0]).toEqual(expect.objectContaining({ id: 't1', color: 'theme:th1' }));
  });

  it('deshacer el color no revierte lo que otra escritura grabó después', async () => {
    await st().setObjectColor('t1', '#ff0000');
    working.t1 = { ...working.t1, description: 'nueva' };          // otra escritura posterior (la definición)
    await useUndoStore.getState().undoLast();
    expect(working.t1).toMatchObject({ color: 'theme:th1', description: 'nueva' });
  });

  it('vista: por la edición de la vista; null = sin color', async () => {
    working.v1 = { ...working.v1, color: '#00B050' };
    await st().setObjectColor('v1', null);
    expect(viewsSvc.updateView).toHaveBeenCalledWith('v1', expect.objectContaining({ color: null }));
  });

  it('en fila con otra escritura de la tabla: parte del documento VIGENTE (no lo revierte)', async () => {
    let release!: () => void;
    const first = inObjectOrder('t1', () => new Promise<void>((r) => { release = r; }).then(() => {
      working.t1 = { ...working.t1, description: 'nueva' };     // la escritura anterior (la definición)
    }));
    const color = st().setObjectColor('t1', '#ff0000');
    await Promise.resolve();
    expect(gov.createTable).not.toHaveBeenCalled();          // espera su turno
    release();
    await first; await color;
    expect(gov.createTable).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', description: 'nueva', color: '#FF0000' }));
  });

  it('aunque el diagrama en pantalla esté viejo (su recarga falló), parte de la working copy', async () => {
    working.t1 = { ...working.t1, udpValues: { u1: 'A' } };      // el diagrama no lo tiene
    await st().setObjectColor('t1', '#ff0000');
    expect(gov.createTable).toHaveBeenCalledWith(expect.objectContaining({ udpValues: { u1: 'A' }, color: '#FF0000' }));
  });

  it('una tabla que ya no está en la working copy avisa y no se recrea', async () => {
    delete working.t1;
    await expect(st().setObjectColor('t1', '#ff0000')).rejects.toThrow(/no longer in the working copy/);
    expect(gov.createTable).not.toHaveBeenCalled();
  });

  it('sin cambio o con un color inválido, nada', async () => {
    await st().setObjectColor('t1', 'theme:th1');
    await st().setObjectColor('t2', 'none');           // 'none' sólo vale como excepción de un canvas
    expect(gov.createTable).not.toHaveBeenCalled();
    expect(viewsSvc.updateView).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});
