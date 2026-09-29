// Escrituras del canvas en sesión de edición (doc 99): cada guardado es
// «leer el canvas efectivo + grabar el documento COMPLETO». Dos cosas que
// estas pruebas fijan: los trazos manuales de wires viajan con el documento
// en TODAS las escrituras, y dos escrituras del mismo canvas van en fila.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', () => ({ effective: vi.fn(), recordChange: vi.fn() }));
vi.mock('./modeler.service', () => ({ setSubjectAreaLayout: vi.fn(), setSubjectAreaDrawings: vi.fn() }));

import * as csvc from '@/services/changeset.service';
import * as mod from './modeler.service';
import { useSessionStore } from '@/store/useSessionStore';
import * as struct from './structure.service';
import type { SubjectArea } from './modeler.service';

const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const R2 = [{ x: 260, y: -30 }];

const canvas = (over: Partial<SubjectArea> = {}): SubjectArea => ({
  id: 'sa1', projectId: 'p1', name: 'Canvas', folderId: null,
  tableIds: ['t1', 't2'], viewIds: [],
  layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 } },
  drawings: [], udpValues: {}, routes: {}, ...over,
});

/** Draft en memoria: `effective` devuelve lo último grabado de cada canvas. */
let draft: Record<string, SubjectArea>;
const calls: string[] = [];
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const recorded = () => vi.mocked(csvc.recordChange).mock.calls.map((c) => c[4] as unknown as SubjectArea);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  draft = { sa1: canvas(), sa2: canvas({ id: 'sa2' }) };
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    calls.push(`get:${id}`);
    await tick();
    return (draft[id] ? [structuredClone(draft[id])] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    calls.push(`put:${id}`);
    await tick();
    if (op === 'delete') delete draft[id]; else draft[id] = structuredClone(payload) as unknown as SubjectArea;
    return {} as never;
  });
});

describe('setWireRoute — entradas (revisión 2026-09-28)', () => {
  it.each([['undefined', undefined], ['an empty object', {}], ['zero', 0], ['true', true], ['text', 'x'], ['a single point', { x: 1, y: 2 }]])(
    'algo que no es una lista ni null (%s) se rechaza sin tocar el canvas', async (_label, points) => {
      draft.sa1 = canvas({ routes: { r1: R1 } });
      await expect(struct.setWireRoute('sa1', 'r1', points as never)).rejects.toThrow(/Invalid wire route/);
      expect(calls).toEqual([]);
      expect(draft.sa1.routes).toEqual({ r1: R1 });
    });

  it('más de 32 puntos: el mensaje dice el tope', async () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ x: i, y: i }));
    await expect(struct.setWireRoute('sa1', 'r1', many)).rejects.toThrow(/at most 32 points/);
    expect(calls).toEqual([]);
  });

  it('un punto inválido: el mensaje habla de los puntos', async () => {
    await expect(struct.setWireRoute('sa1', 'r1', [{ x: 1, y: Number.NaN }])).rejects.toThrow(/finite x and y/);
  });

  it('el trazo de un wire que ya no existe en el canvas no se graba', async () => {
    draft.sa1 = canvas({ routes: { r1: R1 } });
    await struct.setWireRoute('sa1', 'gone', R2, ['r1']);
    expect(recorded()[0].routes).toEqual({ r1: R1 });
  });

  it('un canvas que ya no está en la working copy: error en inglés (llega a un aviso en pantalla)', async () => {
    await expect(struct.setWireRoute('nope', 'r1', R1)).rejects.toThrow('This canvas is no longer in the working copy.');
    await expect(struct.arrangeSubjectArea('nope', { t1: { x: 1, y: 1 } })).rejects.toThrow('This canvas is no longer in the working copy.');
    await expect(struct.addToCanvas('nope', { routes: { r1: R1 } })).rejects.toThrow('This canvas is no longer in the working copy.');
  });
});

describe('setWireRoute', () => {
  it('graba el trazo del wire sobre el canvas efectivo, con el documento completo', async () => {
    draft.sa1 = canvas({ routes: { r2: R2 } });
    await struct.setWireRoute('sa1', 'r1', R1);
    expect(csvc.recordChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(csvc.recordChange).mock.calls[0].slice(0, 4)).toEqual(['cs1', 'subject_areas', 'sa1', 'upsert']);
    expect(recorded()[0]).toEqual(canvas({ routes: { r2: R2, r1: R1 } }));
  });

  it('null quita el trazo del wire (vuelve al camino automático) y deja los demás', async () => {
    draft.sa1 = canvas({ routes: { r1: R1, r2: R2 } });
    await struct.setWireRoute('sa1', 'r1', null);
    expect(recorded()[0].routes).toEqual({ r2: R2 });
  });

  it('una lista vacía también quita el trazo', async () => {
    draft.sa1 = canvas({ routes: { r1: R1 } });
    await struct.setWireRoute('sa1', 'r1', []);
    expect(recorded()[0].routes).toEqual({});
  });

  it('poda los trazos de wires que ya no existen cuando recibe los ids vigentes', async () => {
    draft.sa1 = canvas({ routes: { r2: R2, borrada: R1 } });
    await struct.setWireRoute('sa1', 'r1', R1, ['r1', 'r2']);
    expect(recorded()[0].routes).toEqual({ r2: R2, r1: R1 });
  });

  it('sanea lo que lee: un trazo corrupto del canvas no vuelve como payload', async () => {
    draft.sa1 = canvas({ routes: { r2: R2, roto: [{ x: 'a', y: 1 }] } as never });
    await struct.setWireRoute('sa1', 'r1', R1);
    expect(recorded()[0].routes).toEqual({ r2: R2, r1: R1 });
  });

  it('un canvas anterior al doc 99 (sin la llave) recibe su primer trazo', async () => {
    const legacy = canvas();
    delete legacy.routes;
    draft.sa1 = legacy;
    await struct.setWireRoute('sa1', 'r1', R1);
    expect(recorded()[0].routes).toEqual({ r1: R1 });
  });

  it('rechaza un trazo inválido ANTES de tocar el backend', async () => {
    await expect(struct.setWireRoute('sa1', 'r1', [{ x: Number.NaN, y: 1 }])).rejects.toThrow(/route/i);
    expect(csvc.effective).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });

  it.each([[''], ['   '], ['__proto__'], ['a\u0000b'], ['x'.repeat(201)]])('rechaza un id de wire inválido (%j) sin tocar el backend', async (wireId) => {
    await expect(struct.setWireRoute('sa1', wireId, R1)).rejects.toThrow(/wire id/i);
    expect(csvc.effective).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });

  it('exige sesión de edición: en visor no escribe', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    await expect(struct.setWireRoute('sa1', 'r1', R1)).rejects.toThrow(/working copy/i);
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: null });
    await expect(struct.setWireRoute('sa1', 'r1', R1)).rejects.toThrow(/working copy/i);
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });

  it('si el canvas no está en el estado efectivo, falla sin grabar', async () => {
    await expect(struct.setWireRoute('no-existe', 'r1', R1)).rejects.toThrow();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });
});

describe('miembros del canvas: la lista se arma DENTRO de la cola (doc 100, P5)', () => {
  it('addToCanvas suma sólo lo que falta, con posiciones y trazos, en UNA escritura, y devuelve lo que entró', async () => {
    draft.sa1 = canvas({ viewIds: ['v1'], routes: { r9: R2 } });
    const added = await struct.addToCanvas('sa1', {
      tableIds: ['t2', 't3', 't3'], viewIds: ['v1', 'v2'], layout: { t3: { x: 5, y: 6 } }, routes: { r1: R1, r2: R2 },
    });
    expect(added).toEqual({ tableIds: ['t3'], viewIds: ['v2'] });
    expect(calls).toEqual(['get:sa1', 'put:sa1']);
    expect(recorded()[0]).toEqual(canvas({
      tableIds: ['t1', 't2', 't3'], viewIds: ['v1', 'v2'],
      layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, t3: { x: 5, y: 6 } },
      routes: { r9: R2, r1: R1, r2: R2 },
    }));
  });

  it('dos altas casi a la vez no se pisan (antes cada una grababa la lista que leyó afuera)', async () => {
    await Promise.all([struct.addToCanvas('sa1', { tableIds: ['t3'] }), struct.addToCanvas('sa1', { tableIds: ['t4'] })]);
    expect(draft.sa1.tableIds).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('un alta y una baja casi a la vez tampoco', async () => {
    draft.sa1 = canvas({ viewIds: ['v1', 'v2'] });
    await Promise.all([struct.removeFromCanvas('sa1', { viewIds: ['v1'] }), struct.addToCanvas('sa1', { tableIds: ['t3'], viewIds: ['v3'] })]);
    expect(draft.sa1.tableIds).toEqual(['t1', 't2', 't3']);
    expect(draft.sa1.viewIds).toEqual(['v2', 'v3']);
  });

  it('sin nada que cambiar no graba', async () => {
    expect(await struct.addToCanvas('sa1', { tableIds: ['t1'], routes: {} })).toEqual({ tableIds: [], viewIds: [] });
    await struct.removeFromCanvas('sa1', { tableIds: ['t9'] });
    expect(calls).toEqual(['get:sa1', 'get:sa1']);
  });

  it('canvas sin lista explícita de vistas (doc 70): parte de la que se MUESTRA; sin ella, no toca las vistas', async () => {
    draft.sa1 = canvas({ viewIds: undefined });
    expect(await struct.addToCanvas('sa1', { viewIds: ['v2'] }, ['v1'])).toEqual({ tableIds: [], viewIds: ['v2'] });
    expect(draft.sa1.viewIds).toEqual(['v1', 'v2']);
    draft.sa2 = canvas({ id: 'sa2', viewIds: undefined });
    expect(await struct.addToCanvas('sa2', { viewIds: ['v2'] })).toEqual({ tableIds: [], viewIds: [] });
    await struct.removeFromCanvas('sa2', { viewIds: ['v1'] });
    expect(draft.sa2.viewIds).toBeUndefined();
    expect(calls.filter((c) => c === 'put:sa2')).toEqual([]);
    draft.sa2 = canvas({ id: 'sa2', viewIds: undefined, layout: { t1: { x: 0, y: 0 }, v1: { x: 9, y: 9 } } });
    await struct.removeFromCanvas('sa2', { viewIds: ['v1'] }, ['v1', 'v2']);
    expect(draft.sa2.viewIds).toEqual(['v2']);
    expect(draft.sa2.layout).toEqual({ t1: { x: 0, y: 0 } });
  });

  it('una tabla que entra a un canvas sin lista NO arrastra sus vistas: la lista que se muestra queda fija', async () => {
    draft.sa1 = canvas({ viewIds: undefined });
    await struct.addToCanvas('sa1', { tableIds: ['t3'] }, ['v1']);
    expect(draft.sa1.viewIds).toEqual(['v1']);
    draft.sa2 = canvas({ id: 'sa2', viewIds: undefined });
    await struct.addToCanvas('sa2', { tableIds: ['t3'] });          // sin la lista que se muestra: no la inventa
    expect(draft.sa2.viewIds).toBeUndefined();
  });

  it('Undo de borrar una vista (doc 89): vuelve a una lista explícita, aunque esté vacía; no a una que ya la tiene ni a un canvas sin lista', async () => {
    draft.sa1 = canvas({ viewIds: ['v1'] });
    expect(await struct.addToCanvas('sa1', { viewIds: ['v1'] })).toEqual({ tableIds: [], viewIds: [] });
    expect(calls).toEqual(['get:sa1']);
    draft.sa2 = canvas({ id: 'sa2', viewIds: [] });
    expect(await struct.addToCanvas('sa2', { viewIds: ['v1'] })).toEqual({ tableIds: [], viewIds: ['v1'] });
    expect(draft.sa2.viewIds).toEqual(['v1']);
    draft.sa2 = canvas({ id: 'sa2', viewIds: null as never });
    expect(await struct.addToCanvas('sa2', { viewIds: ['v1'] })).toEqual({ tableIds: [], viewIds: [] });
    expect(draft.sa2.viewIds).toBeNull();
  });

  it('removeFromCanvas saca tablas y vistas con su posición, y poda los trazos pedidos', async () => {
    draft.sa1 = canvas({ viewIds: ['v1', 'v2'], layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 1, y: 1 } },
      routes: { r1: R1, r2: R2, 'subsym-s1': R2 } });
    await struct.removeFromCanvas('sa1', { tableIds: ['t2'], viewIds: ['v1'], dropRouteIds: ['r1', 'subsym-s1'] });
    expect(csvc.recordChange).toHaveBeenCalledTimes(1);
    const out = recorded()[0];
    expect(out.tableIds).toEqual(['t1']);
    expect(out.viewIds).toEqual(['v2']);
    expect(out.layout).toEqual({ t1: { x: 0, y: 0 } });
    expect(out.routes).toEqual({ r2: R2 });
  });

  it('removeFromCanvas sin wires que podar deja los trazos como están', async () => {
    draft.sa1 = canvas({ routes: { r1: R1 } });
    await struct.removeFromCanvas('sa1', { tableIds: ['t2'] });
    expect(recorded()[0].routes).toEqual({ r1: R1 });
  });

  it('un canvas sin la llave de trazos no la inventa', async () => {
    const legacy = canvas();
    delete legacy.routes;
    draft.sa1 = legacy;
    await struct.removeFromCanvas('sa1', { tableIds: ['t2'], dropRouteIds: ['r1'] });
    expect(recorded()[0]).not.toHaveProperty('routes');
  });

  it('removeFromCanvas sobre un canvas que ya no está en la working copy no hace nada', async () => {
    await struct.removeFromCanvas('nope', { tableIds: ['t1'] });
    expect(calls).toEqual(['get:nope']);
  });

  it('exigen sesión de edición', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    await expect(struct.addToCanvas('sa1', { tableIds: ['t3'] })).rejects.toThrow(/working copy/i);
    await expect(struct.removeFromCanvas('sa1', { tableIds: ['t1'] })).rejects.toThrow(/working copy/i);
    expect(calls).toEqual([]);
  });
});

describe('posiciones enteras (doc 100, P6)', () => {
  it('toda escritura del canvas graba las posiciones redondeadas, también las que ya traía', async () => {
    draft.sa1 = canvas({ layout: { t1: { x: 0.4, y: 10.5 }, t2: { x: 400, y: 0 } } });
    await struct.setSubjectAreaLayout('sa1', { t2: { x: 72.3315, y: -3.7 } });
    expect(recorded()[0].layout).toEqual({ t1: { x: 0, y: 11 }, t2: { x: 72, y: -4 } });
    await struct.setWireRoute('sa1', 'r1', R1);
    expect(recorded()[1].layout).toEqual({ t1: { x: 0, y: 11 }, t2: { x: 72, y: -4 } });
  });

  it('sin -0 (se grabaría como 0 igual, pero no confunde las comparaciones)', async () => {
    await struct.setSubjectAreaLayout('sa1', { t1: { x: -0.4, y: -0.2 } });
    expect(Object.is(recorded()[0].layout.t1.x, 0) && Object.is(recorded()[0].layout.t1.y, 0)).toBe(true);
  });

  it('sin working copy también redondea', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null });
    vi.mocked(mod.setSubjectAreaLayout).mockResolvedValue(canvas() as never);
    await struct.setSubjectAreaLayout('sa1', { t1: { x: 1.6, y: 2.2 } });
    expect(mod.setSubjectAreaLayout).toHaveBeenCalledWith('sa1', { t1: { x: 2, y: 2 } });
  });
});

describe('mensajes en inglés (doc 100, P4)', () => {
  it('un canvas o una carpeta que ya no están en la working copy', async () => {
    await expect(struct.getSubjectArea('nope')).rejects.toThrow('This canvas is no longer in the working copy.');
    await expect(struct.updateSubjectArea('nope', { projectId: 'p1', name: 'x' })).rejects.toThrow('This canvas is no longer in the working copy.');
    await expect(struct.setSubjectAreaLayout('nope', { t1: { x: 1, y: 1 } })).rejects.toThrow('This canvas is no longer in the working copy.');
    await expect(struct.renameFolder('nope', 'x')).rejects.toThrow('This folder is no longer in the working copy.');
  });
});

describe('arrangeSubjectArea', () => {
  it('graba las posiciones nuevas y reinicia los trazos en UNA sola escritura', async () => {
    draft.sa1 = canvas({ routes: { r1: R1, r2: R2 }, layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, sym: { x: 9, y: 9 } } });
    await struct.arrangeSubjectArea('sa1', { t1: { x: 50, y: 60 }, t2: { x: 700, y: 80 } });
    expect(csvc.recordChange).toHaveBeenCalledTimes(1);
    expect(recorded()[0].layout).toEqual({ t1: { x: 50, y: 60 }, t2: { x: 700, y: 80 }, sym: { x: 9, y: 9 } });   // mergea
    expect(recorded()[0].routes).toEqual({});
  });

  it('puede reponer posiciones Y trazos (Undo del auto-arrange)', async () => {
    draft.sa1 = canvas({ routes: {}, layout: { t1: { x: 50, y: 60 } } });
    await struct.arrangeSubjectArea('sa1', { t1: { x: 0, y: 0 } }, { r1: R1 });
    expect(recorded()[0].layout).toEqual({ t1: { x: 0, y: 0 } });
    expect(recorded()[0].routes).toEqual({ r1: R1 });
  });

  it('sin working copy usa el endpoint directo de posiciones (no hay trazos que reiniciar)', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null });
    vi.mocked(mod.setSubjectAreaLayout).mockResolvedValue(canvas() as never);
    await struct.arrangeSubjectArea('sa1', { t1: { x: 1, y: 2 } });
    expect(mod.setSubjectAreaLayout).toHaveBeenCalledWith('sa1', { t1: { x: 1, y: 2 } });
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });
});

describe('las demás escrituras del canvas conservan los trazos', () => {
  beforeEach(() => { draft.sa1 = canvas({ routes: { r1: R1, r2: R2 } }); });

  it('mover una tabla', async () => {
    await struct.setSubjectAreaLayout('sa1', { t2: { x: 900, y: 300 } });
    expect(recorded()[0].routes).toEqual({ r1: R1, r2: R2 });
    expect(recorded()[0].layout.t2).toEqual({ x: 900, y: 300 });
  });

  it('cambiar miembros, dibujos o el nombre', async () => {
    await struct.addToCanvas('sa1', { tableIds: ['t3'] });
    await struct.setSubjectAreaDrawings('sa1', []);
    await struct.updateSubjectArea('sa1', { projectId: 'p1', name: 'Otro nombre' });
    expect(recorded().map((p) => p.routes)).toEqual([{ r1: R1, r2: R2 }, { r1: R1, r2: R2 }, { r1: R1, r2: R2 }]);
  });

  it('sacar una vista', async () => {
    draft.sa1 = canvas({ viewIds: ['v1'], routes: { r1: R1, r2: R2 } });
    await struct.removeFromCanvas('sa1', { viewIds: ['v1'] });
    expect(recorded()[0].routes).toEqual({ r1: R1, r2: R2 });
  });
});

describe('cola por canvas — dos guardados del mismo canvas van en fila', () => {
  it('mover una tabla y trazar un wire casi a la vez NO se pisan', async () => {
    // Sin la cola: los dos leen el canvas viejo y el segundo PUT borra el
    // cambio del primero (el trazo desaparecía al recargar).
    await Promise.all([
      struct.setWireRoute('sa1', 'r1', R1),
      struct.setSubjectAreaLayout('sa1', { t2: { x: 900, y: 300 } }),
    ]);
    expect(calls).toEqual(['get:sa1', 'put:sa1', 'get:sa1', 'put:sa1']);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    expect(draft.sa1.layout.t2).toEqual({ x: 900, y: 300 });
  });

  it('respeta el orden en que se pidieron', async () => {
    await Promise.all([
      struct.setWireRoute('sa1', 'r1', R1),
      struct.setWireRoute('sa1', 'r1', R2),
      struct.setWireRoute('sa1', 'r2', R1),
    ]);
    expect(draft.sa1.routes).toEqual({ r1: R2, r2: R1 });
  });

  it('canvases distintos no se esperan entre sí', async () => {
    await Promise.all([
      struct.setWireRoute('sa1', 'r1', R1),
      struct.setWireRoute('sa2', 'r1', R2),
    ]);
    expect(calls.slice(0, 2).sort()).toEqual(['get:sa1', 'get:sa2']);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    expect(draft.sa2.routes).toEqual({ r1: R2 });
  });

  it('un guardado que falla avisa a quien lo pidió y NO frena al siguiente', async () => {
    vi.mocked(csvc.recordChange).mockImplementationOnce(async () => { throw new Error('boom'); });
    const first = struct.setWireRoute('sa1', 'r1', R1);
    const second = struct.setSubjectAreaLayout('sa1', { t2: { x: 900, y: 300 } });
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBeDefined();
    expect(draft.sa1.layout.t2).toEqual({ x: 900, y: 300 });
    expect(draft.sa1.routes).toEqual({});
  });

  it('borrar el canvas espera a los guardados pendientes (no lo resucitan)', async () => {
    await Promise.all([
      struct.setSubjectAreaLayout('sa1', { t2: { x: 900, y: 300 } }),
      struct.deleteSubjectArea('sa1'),
    ]);
    expect(calls).toEqual(['get:sa1', 'put:sa1', 'put:sa1']);
    expect(draft).not.toHaveProperty('sa1');
  });
});
