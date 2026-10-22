// Al seleccionar una tabla (clic en la tabla o en una columna de otra tabla, que
// abre el panel de Properties, o «Locate» desde el Explorer o el buscador) el
// canvas se acerca y centra la tabla con sus vistas en el área que queda libre
// (el canvas ya descuenta el panel). Seguir trabajando dentro de la misma tabla
// no vuelve a mover el canvas.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/modeler/lib/canvasFocus', async (orig) => {
  const actual = await orig<typeof import('@/features/modeler/lib/canvasFocus')>();
  return { ...actual, paneSize: vi.fn(() => ({ width: 704, height: 730 })) };
});

import { focusViewport } from '@/features/modeler/lib/canvasFocus';
import { dblClickShield } from '@/features/modeler/lib/dblClickShield';
import { stopFraming, useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tras un clic el encuadre arranca enseguida (cuando el panel ya achicó el canvas) y anima.
 *  No espera la ventana del doble clic (lo ataja `dblClickShield`). */
const CLICK_WAIT = 120;
const T = { id: 't1', type: 'table', position: { x: 1000, y: 2000 }, measured: { width: 240, height: 312 }, data: {} };
const V = { id: 'v1', type: 'view', position: { x: 1280, y: 2000 }, measured: { width: 240, height: 312 }, data: { view: { id: 'v1', sourceTableIds: ['t1'] } } };
const OTHER = { id: 'v9', type: 'view', position: { x: 9000, y: 0 }, measured: { width: 240, height: 100 }, data: { view: { id: 'v9', sourceTableIds: ['t9'] } } };
const T2 = { id: 't2', type: 'table', position: { x: 0, y: 0 }, measured: { width: 240, height: 120 }, data: {} };
const NODES = [T, V, OTHER, T2];
const flow = () => {
  let last: unknown = { x: 0, y: 0, zoom: 0.3 };
  return {
    setViewport: vi.fn<(vp: unknown, opts?: unknown) => Promise<boolean>>(async (vp) => { last = vp; return true; }),
    setCenter: vi.fn(async () => true), getViewport: () => last,
    getNodes: () => NODES, getNode: (id: string) => NODES.find((n) => n.id === id), getZoom: () => 0.3,
  };
};
const box = (n: typeof T) => ({ x: n.position.x, y: n.position.y, w: n.measured.width, h: n.measured.height });
const EXPECTED = focusViewport(box(T), [box(V)], { width: 704, height: 730 }, 0.3);

beforeEach(() => {
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
  useModelerStore.setState({ selectedTableId: null, selectedColumnId: null, selectedViewId: null, selectedEdgeId: null, flow: null,
    relPreset: null, subcatArmed: false, colMenu: null } as never);
  useModelerStore.getState().selectTable(null);   // también olvida la tabla pendiente de encuadre
});

describe('enfocar la tabla seleccionada con sus vistas', () => {
  it('clic en la tabla: la centra con su vista (no la de otra tabla), acercando hasta 100 %, con animación', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().selectTable('t1');
    expect(useModelerStore.getState().selectedTableId).toBe('t1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    const [vp, opts] = f.setViewport.mock.calls[0] as unknown as [typeof EXPECTED, { duration: number }];
    expect(vp).toEqual(EXPECTED);
    expect(vp.zoom).toBe(1);
    expect(opts.duration).toBeGreaterThan(0);
    // Trayecto directo: cortado a mitad de camino (deseleccionar, un
    // menú, un arrastre, la rueda) nunca queda más lejos que al principio (la
    // interpolación «suave» de d3 se aleja en el medio de un trayecto largo).
    expect(opts).toMatchObject({ interpolate: 'linear' });
  });

  it('otro clic en la misma tabla (o en una de sus columnas): no vuelve a mover el canvas', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never, selectedTableId: 't1' });
    useModelerStore.getState().selectTable('t1');
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).not.toHaveBeenCalled();
    expect(useModelerStore.getState().selectedColumnId).toBe('c1');
  });

  it('clic en una columna de otra tabla: la selecciona, abre la columna y centra esa tabla', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never, selectedTableId: 't2' });
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    await sleep(CLICK_WAIT);
    expect(useModelerStore.getState()).toMatchObject({ selectedTableId: 't1', selectedColumnId: 'c1' });
    expect(f.setViewport.mock.calls[0][0]).toEqual(EXPECTED);
  });

  it('Locate (Explorer / buscador): selecciona y centra la tabla con su vista, aunque ya estuviera seleccionada', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never, selectedTableId: 't1' });
    useModelerStore.getState().focusTable('t1');
    await sleep(60);
    expect(f.setViewport.mock.calls[0][0]).toEqual(EXPECTED);
    expect(f.setCenter).not.toHaveBeenCalled();
  });

  it('Locate de una vista: la centra sin seleccionarla', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().focusTable('v1');
    await sleep(60);
    expect(useModelerStore.getState().selectedTableId).toBeNull();
    expect(f.setCenter).toHaveBeenCalledTimes(1);
    expect(f.setViewport).not.toHaveBeenCalled();
  });

  it('deseleccionar (null) no mueve el canvas', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never, selectedTableId: 't1' });
    useModelerStore.getState().selectTable(null);
    await sleep(CLICK_WAIT);
    expect(useModelerStore.getState().selectedTableId).toBeNull();
    expect(f.setViewport).not.toHaveBeenCalled();
  });
});

// Lejos, el canvas dibuja cajas compactas (LOD) de otro tamaño que el detalle; al
// acercarse cambian y el grupo quedaría corrido unos píxeles. Al terminar la
// animación se corrige con lo medido, salvo que el usuario ya haya movido el
// canvas o seleccionado otra cosa.
describe('enfoque: corrección al cambiar el tamaño de las cajas', () => {
  const sized = (w: number) => [
    { ...T, measured: { width: w, height: 312 } },
    { ...V, measured: { width: w, height: 312 } },
  ];
  const flowWith = (sizes: () => typeof NODES, viewport: () => { x: number; y: number; zoom: number }) => {
    const f = {
      setViewport: vi.fn<(vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => Promise<boolean>>(async () => true),
      getNodes: () => sizes(), getNode: (id: string) => sizes().find((n) => n.id === id), getZoom: () => 0.3,
      getViewport: () => viewport(),
    };
    return f;
  };

  it('las cajas cambian de tamaño al acercarse: segundo encuadre corto con lo medido', async () => {
    let w = 240;
    let last = { x: 0, y: 0, zoom: 0.3 };
    const f = flowWith(() => sized(w), () => last);
    f.setViewport.mockImplementation(async (vp) => { last = vp; w = 220; return true; });
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT + 150);
    expect(f.setViewport).toHaveBeenCalledTimes(2);
    const second = f.setViewport.mock.calls[1];
    expect(second[0]).toEqual(focusViewport({ x: 1000, y: 2000, w: 220, h: 312 }, [{ x: 1280, y: 2000, w: 220, h: 312 }],
      { width: 704, height: 730 }, 0.3));
    expect(second[1]?.duration).toBeLessThan(400);
  });

  it('sin cambio de tamaño no hay segundo encuadre', async () => {
    let last = { x: 0, y: 0, zoom: 0.3 };
    const f = flowWith(() => sized(240), () => last);
    f.setViewport.mockImplementation(async (vp) => { last = vp; return true; });
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT + 150);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
  });

  it('si el usuario movió el canvas (o eligió otra tabla) entretanto, no se corrige', async () => {
    let w = 240;
    const f = flowWith(() => sized(w), () => ({ x: 5, y: 5, zoom: 0.8 }));   // difiere del encuadre pedido
    f.setViewport.mockImplementation(async () => { w = 220; return true; });
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT + 150);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
  });
});

// Encuadre tras un clic:
//  · en un doble clic, el segundo clic caería donde la tabla estaba antes de
//    moverse: lo ataja el escudo del canvas (`dblClickShield`, armado por el clic
//    que encuadra), también en el doble clic lento, y el encuadre arranca enseguida;
//  · con la herramienta de relación o subcategoría armada, un clic en una
//    cabecera selecciona sin mover el canvas (moverlo rompería el trazo clic → clic);
//  · la corrección final no mueve el canvas si se cierra el panel o cambia la
//    selección durante la animación.
describe('encuadre tras un clic', () => {
  it('tras un clic arranca enseguida y arma el escudo del doble clic', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never });
    const arm = vi.spyOn(dblClickShield, 'arm');
    useModelerStore.getState().selectTable('t1');
    expect(arm).toHaveBeenCalledTimes(1);
    await sleep(60);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    arm.mockRestore();
  });

  it('Locate (Explorer / buscador) no espera ni arma el escudo: no hay doble clic en el canvas', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never });
    const arm = vi.spyOn(dblClickShield, 'arm');
    useModelerStore.getState().focusTable('t1');
    await sleep(60);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    expect(arm).not.toHaveBeenCalled();
    arm.mockRestore();
  });

  it('con la herramienta de relación (o subcategoría) armada, selecciona sin mover el canvas', async () => {
    for (const armed of [{ relPreset: { parent: 'one', child: 'zero-many', identifying: true } }, { subcatArmed: true }]) {
      const f = flow();
      useModelerStore.setState({ flow: f as never, selectedTableId: null, relPreset: null, subcatArmed: false, ...armed } as never);
      useModelerStore.getState().selectTable('t1');
      await sleep(CLICK_WAIT);
      expect(useModelerStore.getState().selectedTableId).toBe('t1');
      expect(f.setViewport).not.toHaveBeenCalled();
    }
    useModelerStore.setState({ relPreset: null, subcatArmed: false } as never);
  });

  it('desarmada la herramienta, otro clic en esa misma tabla ya la encuadra', async () => {
    const f = flow();
    useModelerStore.setState({ flow: f as never, selectedTableId: null, subcatArmed: true } as never);
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).not.toHaveBeenCalled();
    useModelerStore.setState({ subcatArmed: false } as never);
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    useModelerStore.getState().selectTable('t1');   // y un clic más no la vuelve a mover
    await sleep(CLICK_WAIT);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
  });

  it('si se cierra el panel (el área cambia) o cambia la selección durante la animación, no se corrige', async () => {
    const { paneSize } = await import('@/features/modeler/lib/canvasFocus');
    for (const change of ['area', 'selection'] as const) {
      let w = 240;
      let last = { x: 0, y: 0, zoom: 0.3 };
      const f = {
        setViewport: vi.fn<(vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => Promise<boolean>>(async (vp) => {
          last = vp; w = 220;   // las cajas cambian de tamaño al acercarse…
          if (change === 'area') vi.mocked(paneSize).mockReturnValue({ width: 1176, height: 730 });   // …y el panel se cerró
          else useModelerStore.setState({ selectedTableId: 't2' });                                   // …o se eligió otra cosa
          return true;
        }),
        getNodes: () => [{ ...T, measured: { width: w, height: 312 } }, { ...V, measured: { width: w, height: 312 } }],
        getNode: (id: string) => [{ ...T, measured: { width: w, height: 312 } }, { ...V, measured: { width: w, height: 312 } }].find((n) => n.id === id),
        getZoom: () => 0.3, getViewport: () => last,
      };
      useModelerStore.setState({ flow: f as never, selectedTableId: null });
      useModelerStore.getState().selectTable('t1');
      await sleep(CLICK_WAIT + 200);
      // Sin corrección (ninguna llamada de 150 ms); al deseleccionar, además, se corta la animación (duración 0).
      expect(f.setViewport.mock.calls.map((c) => c[1]), change).toEqual(change === 'area' ? [{ duration: 400, interpolate: 'linear' }] : [{ duration: 400, interpolate: 'linear' }, { duration: 0 }]);
      vi.mocked(paneSize).mockReturnValue({ width: 704, height: 730 });
    }
  });
});

/** Un flow cuya animación no termina sola: como d3, la promesa de `setViewport`
 *  con duración solo se resuelve al final de la transición; si se interrumpe
 *  (rueda, paneo, un clic en el fondo, otro setViewport), nunca. */
const stuckFlow = (viewport?: () => { x: number; y: number; zoom: number }) => {
  const f = flow();
  if (viewport) Object.assign(f, { getViewport: viewport });
  f.setViewport.mockImplementation(async (_vp, opts) => ((opts as { duration?: number } | undefined)?.duration
    ? new Promise<boolean>(() => {}) : true));
  return f;
};
const durations = (f: ReturnType<typeof flow>) => f.setViewport.mock.calls.map((c) => c[1]);

// Cerrar el panel (deseleccionar) justo cuando el encuadre arranca detiene la
// animación; el corte no depende de que la promesa de la animación se resuelva.
describe('deseleccionar durante el encuadre lo detiene', () => {
  it('antes de arrancar: no se mueve; ya arrancado: se corta donde está, y no queda nada colgado', async () => {
    // 1) Deseleccionada antes de que arranque: no se mueve.
    let f = flow();
    useModelerStore.setState({ flow: f as never, selectedTableId: null });
    useModelerStore.getState().selectTable('t1');
    useModelerStore.getState().setSelectedTable(null);
    await sleep(CLICK_WAIT);
    expect(f.setViewport).not.toHaveBeenCalled();
    // 2) Deseleccionada con la animación en curso: un setViewport inmediato (duración 0) en la posición actual la corta.
    f = stuckFlow();
    useModelerStore.setState({ flow: f as never, selectedTableId: null });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    useModelerStore.getState().setSelectedTable(null);
    await sleep(20);
    expect(durations(f)).toEqual([{ duration: 400, interpolate: 'linear' }, { duration: 0 }]);
    // La suscripción del corte se libera al terminar: volver a seleccionarla (sin
    // encuadre) y deseleccionarla minutos después no corta nada.
    useModelerStore.getState().setSelectedTable('t1');
    useModelerStore.getState().setSelectedTable(null);
    await sleep(900);
    expect(f.setViewport).toHaveBeenCalledTimes(2);
  });
});

describe('el encuadre no queda colgado ni pisa lo que hace el usuario', () => {
  it('si la animación se interrumpe (su promesa no se resuelve), el encuadre se suelta igual', async () => {
    const f = stuckFlow();
    useModelerStore.setState({ flow: f as never, selectedTableId: null });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    await sleep(900);   // la rueda del usuario la cortó: pasó la animación y su margen
    useModelerStore.getState().setSelectedTable(null);
    await sleep(20);
    expect(f.setViewport).toHaveBeenCalledTimes(1);   // sin corte extemporáneo
  });

  it('abrir un menú contextual durante la animación la corta (el menú queda junto a su tabla)', async () => {
    const f = stuckFlow();
    useModelerStore.setState({ flow: f as never, selectedTableId: null, colMenu: null } as never);
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    useModelerStore.setState({ colMenu: { x: 5, y: 5, tableId: 't1', colId: null, kind: 'table' } } as never);
    await sleep(20);
    expect(durations(f)).toEqual([{ duration: 400, interpolate: 'linear' }, { duration: 0 }]);
    useModelerStore.setState({ colMenu: null } as never);
  });

  it('armar una herramienta durante la animación no la corta a medio camino, pero se omite la corrección final', async () => {
    for (const armed of [{ relPreset: { parent: 'one', child: 'zero-many', identifying: true } }, { subcatArmed: true }]) {
      let w = 240;
      let last = { x: 0, y: 0, zoom: 0.3 };
      const f = {
        setViewport: vi.fn<(vp: { x: number; y: number; zoom: number }, opts?: { duration?: number }) => Promise<boolean>>(async (vp) => {
          last = vp; w = 220;   // las cajas cambian al acercarse (habría corrección)…
          useModelerStore.setState(armed as never);   // …pero el usuario arma la herramienta a mitad de la animación
          return true;
        }),
        getNodes: () => [{ ...T, measured: { width: w, height: 312 } }, { ...V, measured: { width: w, height: 312 } }],
        getNode: (id: string) => [{ ...T, measured: { width: w, height: 312 } }, { ...V, measured: { width: w, height: 312 } }].find((n) => n.id === id),
        getZoom: () => 0.3, getViewport: () => last,
      };
      useModelerStore.setState({ flow: f as never, selectedTableId: null, relPreset: null, subcatArmed: false } as never);
      useModelerStore.getState().selectTable('t1');
      await sleep(CLICK_WAIT + 200);
      expect(f.setViewport.mock.calls.map((c) => c[1]), Object.keys(armed)[0]).toEqual([{ duration: 400, interpolate: 'linear' }]);
      useModelerStore.setState({ relPreset: null, subcatArmed: false } as never);
    }
  });

  it('con un bloque arrastrándose cuando le toca arrancar, no arranca', async () => {
    const f = flow();
    const dragging = NODES.map((n) => (n.id === 't2' ? { ...n, dragging: true } : n));
    Object.assign(f, { getNodes: () => dragging });
    useModelerStore.setState({ flow: f as never, selectedTableId: null });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).not.toHaveBeenCalled();
  });

  it('arrastrar una tabla durante la animación la corta (stopFraming, desde onNodeDragStart)', async () => {
    const f = stuckFlow();
    useModelerStore.setState({ flow: f as never, selectedTableId: null });
    useModelerStore.getState().selectTable('t1');
    await sleep(CLICK_WAIT);
    stopFraming();
    await sleep(20);
    expect(durations(f)).toEqual([{ duration: 400, interpolate: 'linear' }, { duration: 0 }]);
    stopFraming();   // sin encuadre en curso, nada
    expect(f.setViewport).toHaveBeenCalledTimes(2);
  });

  it('un clic en otra tabla mientras el canvas sigue en movimiento (corrección, Locate) la encuadra igual', async () => {
    let t = 0;
    const f = stuckFlow(() => ({ x: (t += 3), y: 0, zoom: 0.3 }));   // el canvas sigue moviéndose
    useModelerStore.setState({ flow: f as never, selectedTableId: null });
    useModelerStore.getState().focusTable('t2');   // Locate en curso…
    await sleep(40);
    useModelerStore.getState().selectTable('t1');   // …y el usuario elige otra tabla
    await sleep(CLICK_WAIT);
    const last = f.setViewport.mock.calls.at(-1) as unknown as [typeof EXPECTED, { duration: number }];
    expect(last[0].zoom).toBe(EXPECTED.zoom);
    expect(last[1]).toEqual({ duration: 400, interpolate: 'linear' });
  });

  it('Locate de una columna en el visor encuadra una vez y sin el escudo del clic', async () => {
    useSessionStore.setState({ openMode: 'readonly' });
    const f = flow();
    useModelerStore.setState({
      flow: f as never, selectedTableId: null,
      diagram: { subjectArea: { id: 'sa' }, tables: [], columns: [{ id: 'c1', tableId: 't1' }], relationships: [], views: [] },
    } as never);
    const arm = vi.spyOn(dblClickShield, 'arm');
    useModelerStore.getState().focusColumn('t1', 'c1');
    await sleep(CLICK_WAIT);
    expect(f.setViewport).toHaveBeenCalledTimes(1);
    expect(f.setViewport.mock.calls[0][0]).toEqual(EXPECTED);
    expect(arm).not.toHaveBeenCalled();
    expect(useModelerStore.getState()).toMatchObject({ selectedTableId: 't1', selectedColumnId: 'c1' });
    arm.mockRestore();
    useModelerStore.setState({ diagram: null } as never);
  });
});
