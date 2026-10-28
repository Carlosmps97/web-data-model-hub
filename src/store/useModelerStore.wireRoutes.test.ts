// Trazos manuales de wires en el store: se siembran del diagrama, se
// guardan una vez por gesto (optimista, con Undo), sobreviven a un reload que
// llega antes que su guardado, y los flujos que cambian el canvas (auto-
// arrange, sacar o borrar una tabla) los reinician o podan. Servicios mockeados.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/features/modeler/services/structure.service', () => ({
  setWireRoute: vi.fn(async () => ({})),
  arrangeSubjectArea: vi.fn(async () => ({})),
  addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
  removeFromCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [], layout: {}, colors: {}, routes: {} })),
  setSubjectAreaLayout: vi.fn(async () => ({})),
}));
vi.mock('@/features/modeler/lib/arrangeGraph', () => ({
  arrangeDiagram: vi.fn(async () => ({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } })),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    tableUsage: vi.fn(async () => ({ usage: [], total: 0 })),
    recordChangesBulk: vi.fn(async () => ({})),
    deleteTable: vi.fn(async () => ({})),
    updateColumn: vi.fn(async () => ({})),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(async () => []) }));

import { toast } from 'sonner';
import * as struct from '@/features/modeler/services/structure.service';
import * as mod from '@/features/modeler/services/modeler.service';
import { arrangeDiagram } from '../features/modeler/lib/arrangeGraph';
import * as gov from '@/services/governance.service';
import { ApiError } from '@/services/http';
import { trackRevalidation } from '@/features/modeler/lib/sessionGuard';
import { gridSlot } from '@/features/modeler/lib/viewerLayout';
import { useModelerStore, manualRouteCount } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

// El `reload` real del store. El describe «auto-arrange» lo reemplaza por un
// mock con `setState`, y el reemplazo seguiría en el store para los tests que
// corren después: con orden aleatorio, «un reload que llega antes que el
// guardado» nunca recargaría (se vería el trazo local en vez del del backend).
// Por eso se repone en cada test.
const realReload = useModelerStore.getState().reload;

const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const R2 = [{ x: 260, y: -30 }];
const R3 = [{ x: 90, y: 90 }];

const rel = (id: string, parent: string, child: string, symbol?: string) => ({
  id, parentTableId: parent, childTableId: child, pairs: [],
  ...(symbol ? { subcategory: true, subtypeSymbolId: symbol } : {}),
});

const diagramWith = (routes: unknown, over: Record<string, unknown> = {}) => ({
  subjectArea: { id: 'sa1', projectId: 'p', name: 'Canvas', tableIds: ['t1', 't2', 't3'], viewIds: [], layout: {}, routes },
  tables: [
    { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente' },
    { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta' },
    { id: 't3', physicalName: 'M_TARJETA', logicalName: 'Tarjeta' },
  ],
  columns: [],
  relationships: [rel('r1', 't1', 't2'), rel('r2', 't1', 't3'), rel('s1', 't2', 't3', 'sym1')],
  views: [],
  ...over,
}) as never;

const routes = () => useModelerStore.getState().canvasRoutes;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Promesa que se resuelve a mano (para dejar un guardado «en vuelo»). */
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // `clearAllMocks` no vacía las colas de `…Once`: una que un test no consume
  // se filtra al siguiente (y cuál es depende del orden). Se vacían y se
  // reponen las implementaciones por defecto de las fábricas de arriba.
  vi.mocked(mod.loadDiagram).mockReset();
  vi.mocked(struct.setWireRoute).mockReset().mockImplementation(async () => ({}) as never);
  vi.mocked(struct.arrangeSubjectArea).mockReset().mockImplementation(async () => ({}) as never);
  vi.mocked(arrangeDiagram).mockReset().mockImplementation(async () => ({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } }) as never);
  await flush();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({
    activeSaId: 'sa1', diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {},
    selectedTableId: null, selectedEdgeId: null, flow: null, openingSaId: null, reload: realReload,
  });
  useModelerStore.setState({ diagram: diagramWith({ r1: R1 }) });
});

describe('siembra desde el diagrama', () => {
  it('toma los trazos del canvas cargado', () => {
    expect(routes()).toEqual({ r1: R1 });
  });

  it('sanea lo corrupto e ignora los trazos de wires que no existen en el canvas', () => {
    useModelerStore.setState({ diagram: diagramWith({
      r1: R1, 'subsym-sym1': R2, huerfano: R3, roto: [{ x: 'a', y: 1 }],
    }) });
    expect(routes()).toEqual({ r1: R1, 'subsym-sym1': R2 });
  });

  it.each([[undefined], [null], ['texto'], [[]]])('un canvas sin trazos válidos (%j) queda vacío', (raw) => {
    useModelerStore.setState({ diagram: diagramWith(raw) });
    expect(routes()).toEqual({});
  });

  it('sin canvas abierto no hay trazos', () => {
    useModelerStore.setState({ diagram: null });
    expect(routes()).toEqual({});
  });

  it('un cambio local del diagrama que no toca el canvas no re-siembra', () => {
    useModelerStore.setState({ canvasRoutes: { r1: R2 } });
    const dia = useModelerStore.getState().diagram!;
    useModelerStore.setState({ diagram: { ...dia, columns: [] } });   // mismo subjectArea
    expect(routes()).toEqual({ r1: R2 });
  });

  it('manualRouteCount cuenta los trazos del canvas', () => {
    expect(manualRouteCount(useModelerStore.getState())).toBe(1);
    useModelerStore.setState({ canvasRoutes: {} });
    expect(manualRouteCount(useModelerStore.getState())).toBe(0);
  });
});

describe('setWireRoute', () => {
  it('pinta de inmediato, graba una vez con los wires vigentes y marca el canvas sucio', async () => {
    const saved = useModelerStore.getState().setWireRoute('r2', R2);
    expect(routes()).toEqual({ r1: R1, r2: R2 });                       // optimista: antes de grabar
    await saved;
    expect(struct.setWireRoute).toHaveBeenCalledTimes(1);
    const [saId, wireId, points, valid] = vi.mocked(struct.setWireRoute).mock.calls[0];
    expect([saId, wireId, points]).toEqual(['sa1', 'r2', R2]);
    expect([...(valid as Iterable<string>)].sort()).toEqual(['r1', 'r2', 's1', 'subsym-sym1']);
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('null o lista vacía vuelve al camino automático', async () => {
    await useModelerStore.getState().setWireRoute('r1', null);
    expect(routes()).toEqual({});
    expect(vi.mocked(struct.setWireRoute).mock.calls[0].slice(0, 3)).toEqual(['sa1', 'r1', null]);
    useModelerStore.setState({ canvasRoutes: { r1: R1 } });
    await useModelerStore.getState().setWireRoute('r1', []);
    expect(routes()).toEqual({});
  });

  it('sin cambio real no graba ni apila Undo', async () => {
    await useModelerStore.getState().setWireRoute('r1', R1.map((p) => ({ ...p })));
    await useModelerStore.getState().setWireRoute('r2', null);              // ya era automático
    expect(struct.setWireRoute).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(useModelerStore.getState().dirty).toBe(false);
  });

  it('en visor o sin working copy no hace nada', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    useModelerStore.setState({ diagram: diagramWith({ r1: R1 }) });   // cambiar de sesión limpia el canvas: se carga dentro de ella
    await useModelerStore.getState().setWireRoute('r2', R2);
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: null });
    useModelerStore.setState({ diagram: diagramWith({ r1: R1 }) });
    await useModelerStore.getState().setWireRoute('r2', R2);
    expect(struct.setWireRoute).not.toHaveBeenCalled();
    expect(routes()).toEqual({ r1: R1 });
  });

  it('un trazo inválido no se pinta ni se graba', async () => {
    await useModelerStore.getState().setWireRoute('r2', [{ x: Number.NaN, y: 1 }]);
    expect(struct.setWireRoute).not.toHaveBeenCalled();
    expect(routes()).toEqual({ r1: R1 });
  });

  it('si el guardado falla, el trazo vuelve al anterior, avisa y no deja Undo', async () => {
    vi.mocked(struct.setWireRoute).mockRejectedValueOnce(new Error('sin red'));
    await useModelerStore.getState().setWireRoute('r1', R2);
    expect(routes()).toEqual({ r1: R1 });
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the wire route: sin red.");
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('con la versión recién transferida, calla: espera la revalidación, que ya avisó', async () => {
    vi.mocked(struct.setWireRoute).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((r) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p', mode: 'readonly', changesetId: 'cs1' }); r();
      }, 10)));
      throw new ApiError('Only the owner can edit this version.', 403, null, '/api/changesets/cs1/changes');
    });
    await useModelerStore.getState().setWireRoute('r1', R2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('un fallo anterior no pisa un trazo más reciente del mismo wire', async () => {
    const first = deferred();
    vi.mocked(struct.setWireRoute).mockImplementationOnce(() => first.promise as never);
    const a = useModelerStore.getState().setWireRoute('r1', R2);
    const b = useModelerStore.getState().setWireRoute('r1', R3);
    first.reject(new Error('sin red'));
    await Promise.all([a, b]);
    expect(routes()).toEqual({ r1: R3 });
  });

  it('Undo repone el trazo anterior', async () => {
    await useModelerStore.getState().setWireRoute('r1', R2);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Reroute wire']);
    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Reroute wire');
    expect(routes()).toEqual({ r1: R1 });
    expect(vi.mocked(struct.setWireRoute).mock.calls.at(-1)!.slice(0, 3)).toEqual(['sa1', 'r1', R1]);
    expect(useUndoStore.getState().stack).toEqual([]);                  // la inversa no apila otra
  });

  it('Undo de un wire que era automático lo devuelve a automático', async () => {
    await useModelerStore.getState().setWireRoute('r2', R2);
    await useUndoStore.getState().undoLast();
    expect(routes()).toEqual({ r1: R1 });
    expect(vi.mocked(struct.setWireRoute).mock.calls.at(-1)!.slice(0, 3)).toEqual(['sa1', 'r2', null]);
  });

  it('Undo con otro canvas abierto graba en el canvas original y no toca la pantalla', async () => {
    await useModelerStore.getState().setWireRoute('r1', R2);
    useModelerStore.setState({
      activeSaId: 'sa2',
      diagram: diagramWith({ r1: R3 }, { subjectArea: { id: 'sa2', projectId: 'p', name: 'Otro', tableIds: [], layout: {}, routes: { r1: R3 } } }),
    });
    await useUndoStore.getState().undoLast();
    expect(vi.mocked(struct.setWireRoute).mock.calls.at(-1)!.slice(0, 3)).toEqual(['sa1', 'r1', R1]);
    expect(routes()).toEqual({ r1: R3 });
  });
});

describe('un wire con nombre de propiedad heredada', () => {
  // `routes['constructor']` a secas devuelve la función heredada de Object.
  const odd = () => diagramWith({ r1: R1 }, { relationships: [rel('r1', 't1', 't2'), rel('constructor', 't1', 't3')] });

  it('se traza, se graba y se deshace como cualquier otro', async () => {
    useModelerStore.setState({ diagram: odd() });
    await useModelerStore.getState().setWireRoute('constructor', R2);
    expect(vi.mocked(struct.setWireRoute).mock.calls[0].slice(0, 3)).toEqual(['sa1', 'constructor', R2]);
    expect(Object.keys(routes()).sort()).toEqual(['constructor', 'r1']);
    expect(toast.error).not.toHaveBeenCalled();
    await useUndoStore.getState().undoLast();
    expect(vi.mocked(struct.setWireRoute).mock.calls[1].slice(0, 3)).toEqual(['sa1', 'constructor', null]);
    expect(routes()).toEqual({ r1: R1 });
  });

  it('sacar su tabla no inventa un trazo que no existe', async () => {
    useModelerStore.setState({ diagram: odd() });
    vi.mocked(mod.loadDiagram).mockResolvedValue(odd());
    await useModelerStore.getState().removeTableFromArea('t3');
    // nada que podar: sin lista de trazos (t1/t2, sin posición, quedan fijas donde se ven)
    const [saId, rm] = vi.mocked(struct.removeFromCanvas).mock.calls[0];
    expect(saId).toBe('sa1');
    expect(rm).toEqual({ tableIds: ['t3'], viewIds: [], pins: { t1: gridSlot(0), t2: gridSlot(1) } });
  });
});

describe('con la red fallando o lenta', () => {
  const R4 = [{ x: 7, y: 7 }, { x: 8, y: 8 }];
  /** Canvas B: mismas relaciones (los ids de relación son globales), otros trazos. */
  const diagramB = (routes: unknown) => diagramWith(routes, {
    subjectArea: { id: 'sa2', projectId: 'p', name: 'Otro', tableIds: ['t1', 't2', 't3'], viewIds: [], layout: {}, routes },
  });
  const open = (saId: string, diagram: unknown) => useModelerStore.setState({ activeSaId: saId, diagram: diagram as never });
  const diaRoutes = () => useModelerStore.getState().diagram?.subjectArea.routes;
  const writes = () => vi.mocked(struct.setWireRoute).mock.calls.map((c) => c.slice(0, 3));
  /** Deja en vuelo los próximos `n` guardados de trazo. */
  const holdWrites = (n: number) => {
    const ds = Array.from({ length: n }, () => deferred());
    for (const d of ds) vi.mocked(struct.setWireRoute).mockImplementationOnce(() => d.promise as never);
    return ds;
  };
  /** Con todo quieto, un diagrama recargado muestra exactamente lo que trae. */
  const expectNothingPending = (saId = 'sa1') => {
    const mk = saId === 'sa1' ? diagramWith : diagramB;
    open(saId, mk({ r1: R4 }));
    expect(routes(), 'quedó un guardado colgado').toEqual({ r1: R4 });
    open(saId, mk({}));
    expect(routes(), 'quedó un guardado colgado').toEqual({});
  };

  it('dos gestos sobre el mismo wire y los dos guardados fallan: vuelve a lo último grabado', async () => {
    const [first, second] = holdWrites(2);
    const a = useModelerStore.getState().setWireRoute('r1', R2);
    const b = useModelerStore.getState().setWireRoute('r1', R3);
    first.reject(new Error('offline')); await a;
    second.reject(new Error('offline')); await b;
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(useUndoStore.getState().stack).toEqual([]);
    // R2 nunca se grabó: no puede quedar en pantalla
    expect({ screen: routes(), diagram: diaRoutes() }).toEqual({ screen: { r1: R1 }, diagram: { r1: R1 } });
    expectNothingPending();
  });

  it('trazar y quitar enseguida, los dos fallan: el wire que era automático vuelve a automático', async () => {
    const [first, second] = holdWrites(2);
    const a = useModelerStore.getState().setWireRoute('r2', R2);
    const b = useModelerStore.getState().setWireRoute('r2', null);
    first.reject(new Error('offline')); await a;
    second.reject(new Error('offline')); await b;
    expect(routes()).toEqual({ r1: R1 });
  });

  it('tres gestos: el primero graba y los otros dos fallan ⇒ queda lo del primero', async () => {
    const [g1, g2, g3] = holdWrites(3);
    const a = useModelerStore.getState().setWireRoute('r1', R2);
    const b = useModelerStore.getState().setWireRoute('r1', R3);
    const c = useModelerStore.getState().setWireRoute('r1', R4);
    g1.resolve({}); await a;
    g2.reject(new Error('offline')); await b;
    g3.reject(new Error('offline')); await c;
    expect({ screen: routes(), diagram: diaRoutes() }).toEqual({ screen: { r1: R2 }, diagram: { r1: R2 } });
  });

  it('graba el primero y falla el segundo: queda lo del primero', async () => {
    const [g1, g2] = holdWrites(2);
    const a = useModelerStore.getState().setWireRoute('r1', R2);
    const b = useModelerStore.getState().setWireRoute('r1', R3);
    g1.resolve({}); await a;
    g2.reject(new Error('offline')); await b;
    expect(routes()).toEqual({ r1: R2 });
  });

  it('un Undo lanzado con otro canvas abierto y que falla ya de vuelta en el original no pinta el trazo del otro', async () => {
    await useModelerStore.getState().setWireRoute('r1', R2);               // A: R1 → R2, grabado
    open('sa2', diagramB({ r1: R3 }));                                     // B tiene su propio r1
    const [undoWrite] = holdWrites(1);
    const undone = useUndoStore.getState().undoLast().catch((e: Error) => e);
    await flush();                                                         // el Undo ya escribe (con B abierto)
    open('sa1', diagramWith({ r1: R2 }));                                  // vuelve a A (grabado: R2)
    expect(routes()).toEqual({ r1: R1 });                                  // el Undo en vuelo manda
    undoWrite.reject(new Error('offline'));
    await undone;
    expect(routes()).toEqual({ r1: R2 });                                  // lo grabado en A, no R3
  });

  it('un guardado que falla con su canvas cerrado no toca la pantalla del canvas abierto', async () => {
    const [write] = holdWrites(1);
    const saving = useModelerStore.getState().setWireRoute('r1', R2);
    open('sa2', diagramB({ r1: R3 }));
    write.reject(new Error('offline')); await saving;
    expect(routes()).toEqual({ r1: R3 });
    expectNothingPending('sa1');
  });

  it('con un guardado en vuelo llega un diagrama donde ese wire no existe: no se pinta un trazo huérfano', async () => {
    const [write] = holdWrites(1);
    const saving = useModelerStore.getState().setWireRoute('r2', R2);
    useModelerStore.setState({ diagram: diagramWith({ r1: R1 }, { relationships: [rel('r1', 't1', 't2')] }) });
    expect(routes()).toEqual({ r1: R1 });
    expect(manualRouteCount(useModelerStore.getState())).toBe(1);
    write.resolve({}); await saving;
  });

  it('con un guardado en vuelo llega un diagrama: el del store queda igual que la pantalla, y sigue igual al copiar el canvas', async () => {
    const [write] = holdWrites(1);
    const saving = useModelerStore.getState().setWireRoute('r2', R2);
    useModelerStore.setState({ diagram: diagramWith({ r1: R1 }) });        // el backend todavía no tiene r2
    expect({ screen: routes(), diagram: diaRoutes() }).toEqual({ screen: { r1: R1, r2: R2 }, diagram: { r1: R1, r2: R2 } });
    write.resolve({}); await saving;
    // lo que hace guardar Model properties: copia el canvas para cambiarle un campo
    const dia = useModelerStore.getState().diagram!;
    useModelerStore.setState({ diagram: { ...dia, subjectArea: { ...dia.subjectArea, udpValues: { u1: 'x' } } } });
    expect(routes()).toEqual({ r1: R1, r2: R2 });
  });

  it('si el guardado en vuelo falla después de llegar el diagrama, vuelve a lo que ese diagrama trajo', async () => {
    const [write] = holdWrites(1);
    const saving = useModelerStore.getState().setWireRoute('r1', R2);
    useModelerStore.setState({ diagram: diagramWith({ r1: R3 }) });        // otro valor grabado mientras tanto
    expect(routes()).toEqual({ r1: R2 });
    write.reject(new Error('offline')); await saving;
    expect({ screen: routes(), diagram: diaRoutes() }).toEqual({ screen: { r1: R3 }, diagram: { r1: R3 } });
  });

  it('si algo lanza durante el pintado optimista no queda un guardado colgado', async () => {
    let armed = true;
    const off = useModelerStore.subscribe((s, p) => {
      if (armed && s.canvasRoutes !== p.canvasRoutes) { armed = false; throw new Error('broken subscriber'); }
    });
    try {
      await useModelerStore.getState().setWireRoute('r2', R2);
    } finally { off(); }
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the wire route: broken subscriber.");
    expect(struct.setWireRoute).not.toHaveBeenCalled();
    expect(routes()).toEqual({ r1: R1 });
    expectNothingPending();
  });

  it.each([['undefined', undefined], ['an empty object', {}], ['a number', 5], ['a single point', { x: 1, y: 2 }], ['text', 'x']])(
    'una entrada que no es una lista de puntos (%s) no quita el trazo guardado', async (_label, points) => {
      await useModelerStore.getState().setWireRoute('r1', points as never);
      expect({ writes: writes(), screen: routes() }).toEqual({ writes: [], screen: { r1: R1 } });
    });

  it('con el diagrama de otro canvas en el store no graba nada', async () => {
    useModelerStore.setState({ activeSaId: 'sa2' });        // el diagrama sigue siendo el de sa1
    await useModelerStore.getState().setWireRoute('r2', R2);
    expect(writes()).toEqual([]);
  });
});

describe('cambiar de canvas', () => {
  it('el wire seleccionado deja de estarlo: en el canvas nuevo no aparece con tiradores', async () => {
    useModelerStore.setState({ selectedEdgeId: 'r1' });
    vi.mocked(mod.loadDiagram).mockResolvedValue(diagramWith({ r1: R3 }, {
      subjectArea: { id: 'sa2', projectId: 'p', name: 'Otro', tableIds: ['t1', 't2', 't3'], viewIds: [], layout: {}, routes: { r1: R3 } },
    }));
    await useModelerStore.getState().selectSubjectArea('sa2');
    expect(useModelerStore.getState().activeSaId).toBe('sa2');
    expect(useModelerStore.getState().selectedEdgeId).toBeNull();
    expect(routes()).toEqual({ r1: R3 });
  });
});

describe('el diagrama del store queda al día (sin re-armar el canvas)', () => {
  // El diagrama guarda el canvas de su última carga. Hay código que copia ese
  // canvas para cambiarle un campo (guardar Model properties) y el canvas se
  // re-arma con el layout del diagrama al cambiar de Logical a Physical: si el
  // diagrama no tuviera el trazo y la posición recientes, volverían los anteriores.
  const copyCanvas = () => {
    const dia = useModelerStore.getState().diagram!;
    useModelerStore.setState({ diagram: { ...dia, subjectArea: { ...dia.subjectArea, udpValues: { u1: 'x' } } } });
  };

  it('un trazo recién guardado sobrevive a una copia local del canvas', async () => {
    await useModelerStore.getState().setWireRoute('r2', R2);
    copyCanvas();
    expect(routes()).toEqual({ r1: R1, r2: R2 });
  });

  it('un trazo recién quitado no vuelve con una copia local del canvas', async () => {
    await useModelerStore.getState().setWireRoute('r1', null);
    copyCanvas();
    expect(routes()).toEqual({});
  });

  it('guardar un trazo no cambia la identidad del diagrama (el canvas no se re-arma)', async () => {
    const before = useModelerStore.getState().diagram;
    await useModelerStore.getState().setWireRoute('r2', R2);
    expect(useModelerStore.getState().diagram).toBe(before);
    expect(useModelerStore.getState().diagram!.subjectArea.routes).toEqual({ r1: R1, r2: R2 });
  });

  it('si el guardado falla, el diagrama también vuelve al trazo anterior', async () => {
    vi.mocked(struct.setWireRoute).mockRejectedValueOnce(new Error('sin red'));
    await useModelerStore.getState().setWireRoute('r1', R2);
    expect(useModelerStore.getState().diagram!.subjectArea.routes).toEqual({ r1: R1 });
    copyCanvas();
    expect(routes()).toEqual({ r1: R1 });
  });

  it('mover un bloque deja su posición en el diagrama, sin re-armar el canvas', async () => {
    const before = useModelerStore.getState().diagram;
    await useModelerStore.getState().saveLayout('t2', { x: 900, y: 300 });
    expect(struct.setSubjectAreaLayout).toHaveBeenCalledWith('sa1', { t2: { x: 900, y: 300 } });
    expect(useModelerStore.getState().diagram).toBe(before);
    expect(useModelerStore.getState().diagram!.subjectArea.layout.t2).toEqual({ x: 900, y: 300 });
  });

  it('mover un bloque no toca el diagrama de otro canvas', async () => {
    useModelerStore.setState({ activeSaId: 'sa-otro' });
    await useModelerStore.getState().saveLayout('t2', { x: 900, y: 300 });
    expect(useModelerStore.getState().diagram!.subjectArea.layout).toEqual({});
  });
});

describe('un reload que llega antes que el guardado', () => {
  it('conserva en pantalla el trazo que todavía se está grabando', async () => {
    const write = deferred();
    vi.mocked(struct.setWireRoute).mockImplementationOnce(() => write.promise as never);
    const saved = useModelerStore.getState().setWireRoute('r2', R2);
    // El backend todavía no tiene r2: el diagrama recargado trae solo r1.
    vi.mocked(mod.loadDiagram).mockResolvedValueOnce(diagramWith({ r1: R1 }));
    await useModelerStore.getState().reload();
    expect(routes()).toEqual({ r1: R1, r2: R2 });
    write.resolve({});
    await saved;
    // Ya grabado: el siguiente reload manda lo que diga el backend.
    vi.mocked(mod.loadDiagram).mockResolvedValueOnce(diagramWith({ r1: R1, r2: R3 }));
    await useModelerStore.getState().reload();
    expect(routes()).toEqual({ r1: R1, r2: R3 });
  });

  it('también conserva un trazo recién quitado', async () => {
    const write = deferred();
    vi.mocked(struct.setWireRoute).mockImplementationOnce(() => write.promise as never);
    const saved = useModelerStore.getState().setWireRoute('r1', null);
    vi.mocked(mod.loadDiagram).mockResolvedValueOnce(diagramWith({ r1: R1 }));
    await useModelerStore.getState().reload();
    expect(routes()).toEqual({});
    write.resolve({});
    await saved;
  });
});

describe('auto-arrange', () => {
  const flow = () => ({
    getNodes: () => [
      { id: 't1', type: 'table', position: { x: 1, y: 2 } },
      { id: 'sym1', type: 'subcat', position: { x: 5, y: 6 } },
      { id: 'd1', type: 'shape', position: { x: 9, y: 9 } },
    ],
    setNodes: vi.fn(),
  }) as never;

  beforeEach(() => {
    useModelerStore.setState({ flow: flow(), reload: vi.fn(async () => undefined) } as never);
  });

  it('en edición graba posiciones y reinicia los trazos en una sola escritura', async () => {
    await useModelerStore.getState().autoOrganize();
    expect(struct.arrangeSubjectArea).toHaveBeenCalledTimes(1);
    expect(struct.arrangeSubjectArea).toHaveBeenCalledWith('sa1', { t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } });
    expect(struct.setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(routes()).toEqual({});
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('Undo devuelve las posiciones y los trazos previos', async () => {
    await useModelerStore.getState().autoOrganize();
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Auto-arrange']);
    await useUndoStore.getState().undoLast();
    expect(struct.arrangeSubjectArea).toHaveBeenLastCalledWith(
      'sa1', { t1: { x: 1, y: 2 }, sym1: { x: 5, y: 6 } }, { r1: R1 });
    expect(routes()).toEqual({ r1: R1 });
  });

  it('si el guardado falla, los trazos siguen en pantalla y no queda Undo', async () => {
    vi.mocked(struct.arrangeSubjectArea).mockRejectedValueOnce(new Error('sin red'));
    await expect(useModelerStore.getState().autoOrganize()).rejects.toThrow('sin red');
    expect(routes()).toEqual({ r1: R1 });
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('la pre-imagen del Undo se toma antes de calcular: si mientras tanto cambian los nodos (otro canvas), vuelve a la de este', async () => {
    const { arrangeDiagram } = await import('@/features/modeler/lib/arrangeGraph');
    vi.mocked(arrangeDiagram).mockImplementationOnce(async () => {
      // mientras ELK calcula, el usuario abre otro canvas: los nodos vivos ya son de él
      useModelerStore.setState({ flow: { getNodes: () => [{ id: 'z9', type: 'table', position: { x: 99, y: 99 } }], setNodes: vi.fn() } as never });
      return { t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } };
    });
    await useModelerStore.getState().autoOrganize();
    await useUndoStore.getState().undoLast();
    expect(struct.arrangeSubjectArea).toHaveBeenLastCalledWith(
      'sa1', { t1: { x: 1, y: 2 }, sym1: { x: 5, y: 6 } }, { r1: R1 });   // no { z9: {99,99} }
  });

  it('en visor es efímero: oculta los trazos de ese canvas y no graba nada', async () => {
    useSessionStore.setState({ openMode: 'readonly' });
    useModelerStore.setState({ diagram: diagramWith({ r1: R1 }) });   // cambiar de sesión limpia el canvas: se carga dentro de ella
    await useModelerStore.getState().autoOrganize();
    const st = useModelerStore.getState();
    expect(st.viewerRoutesOff).toEqual({ sa1: true });
    expect(st.canvasRoutes).toEqual({ r1: R1 });          // lo publicado no se toca
    expect(struct.arrangeSubjectArea).not.toHaveBeenCalled();
    expect(st.dirty).toBe(false);
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

describe('sacar una tabla del canvas', () => {
  beforeEach(() => {
    useModelerStore.setState({ diagram: diagramWith({ r1: R1, r2: R2, 'subsym-sym1': R3, s1: R3 }) });
    vi.mocked(mod.loadDiagram).mockResolvedValue(diagramWith({ r2: R2 }));
  });

  it('poda los trazos de los wires de esa tabla en la misma escritura', async () => {
    // t2: hija en r1, supertipo del grupo sym1 (tronco + rama s1)
    await useModelerStore.getState().removeTableFromArea('t2');
    const [saId, rm] = vi.mocked(struct.removeFromCanvas).mock.calls[0];
    expect(saId).toBe('sa1');
    expect(rm.tableIds).toEqual(['t2']);
    expect([...rm.dropRouteIds!].sort()).toEqual(['r1', 's1', 'subsym-sym1']);
  });

  it('el Undo repone esos trazos (en la misma escritura que devuelve la tabla)', async () => {
    await useModelerStore.getState().removeTableFromArea('t2');
    await useUndoStore.getState().undoLast();
    const [saId, add] = vi.mocked(struct.addToCanvas).mock.calls[0];
    expect(saId).toBe('sa1');
    expect(add.tableIds).toEqual(['t2']);
    expect(add.routes).toEqual({ r1: R1, 'subsym-sym1': R3, s1: R3 });
  });

  it('una tabla sin wires trazados se saca sin lista de trazos y vuelve sin trazos', async () => {
    useModelerStore.setState({ diagram: diagramWith({ r2: R2 }) });
    await useModelerStore.getState().removeTableFromArea('t2');
    expect(vi.mocked(struct.removeFromCanvas).mock.calls[0][1]).not.toHaveProperty('dropRouteIds');
    await useUndoStore.getState().undoLast();
    expect(vi.mocked(struct.addToCanvas).mock.calls[0][1].routes).toEqual({});
  });
});

describe('borrar una tabla', () => {
  beforeEach(() => {
    useModelerStore.setState({ diagram: diagramWith({ r1: R1, r2: R2 }) });
    vi.mocked(mod.loadDiagram).mockResolvedValue(diagramWith({ r2: R2 }));
    vi.mocked(gov.listRelationships).mockResolvedValue([rel('r1', 't1', 't2'), rel('s1', 't2', 't3', 'sym1')] as never);
    vi.mocked(gov.tableUsage).mockResolvedValue({ usage: [{ canvasId: 'sa1' }, { canvasId: 'sa9' }], total: 2 } as never);
  });

  it('poda los trazos de sus wires en todos los canvases que la tenían', async () => {
    await useModelerStore.getState().deleteTable('t2');
    const calls = vi.mocked(struct.removeFromCanvas).mock.calls;
    expect(calls.map((c) => [c[0], c[1].tableIds])).toEqual([['sa1', ['t2']], ['sa9', ['t2']]]);
    for (const c of calls) expect([...c[1].dropRouteIds!].sort()).toEqual(['r1', 's1', 'subsym-sym1']);
  });

  it('el Undo repone en cada canvas los trazos que salieron de él (no los de la pantalla)', async () => {
    vi.mocked(struct.removeFromCanvas)
      .mockResolvedValueOnce({ tableIds: ['t2'], viewIds: [], layout: {}, colors: {}, routes: { r1: R1 } })
      .mockResolvedValueOnce({ tableIds: ['t2'], viewIds: [], layout: {}, colors: {}, routes: { s1: R3 } });
    await useModelerStore.getState().deleteTable('t2');
    await useUndoStore.getState().undoLast();
    const calls = vi.mocked(struct.addToCanvas).mock.calls;
    expect(calls.map((c) => [c[0], c[1].tableIds, c[1].routes])).toEqual([['sa1', ['t2'], { r1: R1 }], ['sa9', ['t2'], { s1: R3 }]]);
  });

  it('una tabla sin relaciones se borra sin lista de trazos', async () => {
    vi.mocked(gov.listRelationships).mockResolvedValue([]);
    await useModelerStore.getState().deleteTable('t2');
    // En el canvas abierto las que quedan sin posición se fijan; en otro canvas no hay diagrama.
    expect(vi.mocked(struct.removeFromCanvas).mock.calls).toEqual([
      ['sa1', { tableIds: ['t2'], pins: { t1: gridSlot(0), t3: gridSlot(2) } }], ['sa9', { tableIds: ['t2'] }],
    ]);
  });
});
