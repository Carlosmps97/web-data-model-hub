// Doc 113 §4 — la tabla nueva nace en el centro de lo que el usuario VE del
// canvas (antes entraba sin posición y el canvas la ubicaba por número de orden:
// en un modelo de cientos de tablas, miles de píxeles más abajo). También al
// importar una existente, en CTAS y al pegar si el original no está a la vista;
// los dibujos usan el mismo centro.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    createTable: vi.fn(async () => ({})),
    physicalize: vi.fn(async (s: string) => ({ physical: s.toUpperCase() })),
    searchTables: vi.fn(async () => []),
    recordChangesBulk: vi.fn(async () => ({})),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(async () => []), listViewsForTables: vi.fn(async () => []) }));
vi.mock('@/features/modeler/services/structure.service', () => ({
  addToCanvas: vi.fn(async (_sa: string, add: { tableIds?: string[] }) => ({ tableIds: add.tableIds ?? [], viewIds: [] })),
  setSubjectAreaDrawings: vi.fn(async () => ({})),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('@/features/modeler/lib/canvasFocus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/modeler/lib/canvasFocus')>();
  return { ...actual, canvasView: vi.fn(() => null) };
});

import * as struct from '@/features/modeler/services/structure.service';
import * as mod from '@/features/modeler/services/modeler.service';
import { canvasView } from '@/features/modeler/lib/canvasFocus';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const st = () => useModelerStore.getState();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Lo que se ve: centro (1000, 2000), visible de (400, 1700) a (1600, 2300).
const VIEW = { center: { x: 1000, y: 2000 }, rect: { left: 400, top: 1700, right: 1600, bottom: 2300 } };
const T1 = { id: 't1', logicalName: 'cliente', physicalName: 'M_CLIENTE' };
const C1 = { id: 'c1', tableId: 't1', logicalName: 'cod', physicalName: 'COD', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
const DIA = { subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', tableIds: ['t1'], layout: { t1: { x: 500, y: 1800 } } }, tables: [T1], columns: [C1], relationships: [], views: [] };

/** Última escritura de miembros del canvas: { tableIds, layout? }. */
const lastAdd = () => vi.mocked(struct.addToCanvas).mock.calls.at(-1)![1] as { tableIds?: string[]; layout?: Record<string, { x: number; y: number }> };

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(canvasView).mockReturnValue(VIEW);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical', selectedTableId: null });
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await sleep(5); });

describe('New table: nace en el centro de lo que se ve (doc 113 §4)', () => {
  it('se graba CON posición: el bloque (240×60 sin columnas) centrado, y queda seleccionado', async () => {
    await st().createTable({ logicalName: 'cliente nuevo', physicalName: 'CLIENTE' });
    const add = lastAdd();
    const id = add.tableIds![0];
    expect(add.layout).toEqual({ [id]: { x: 880, y: 1970 } });
    // Al seleccionarse se abre el panel de Properties: el centro lo descuenta.
    expect(vi.mocked(canvasView).mock.calls.at(-1)![1]).toEqual({ panel: 'opens' });
    expect(st().selectedTableId).toBe(id);
  });

  it('sin el canvas montado (no hay qué medir), entra sin posición como antes', async () => {
    vi.mocked(canvasView).mockReturnValue(null);
    await st().createTable({ logicalName: 'x', physicalName: 'X' });
    expect(lastAdd().layout).toBeUndefined();
  });
});

describe('CTAS: la tabla nueva (con sus columnas) nace centrada', () => {
  it('el tamaño incluye las columnas; un bloque alto deja su cabecera a la vista', async () => {
    const cols = Array.from({ length: 40 }, (_, i) => ({ ...C1, id: `k${i}`, physicalName: `COL_${i}`, ordinal: i }));
    await st().createTableFromSources({ logicalName: 'tabla ctas', columns: cols as never });
    const add = lastAdd();
    const id = add.tableIds![0];
    // 40 filas → 32 + 40·28 = 1152 px: más alto que lo visible → el borde superior a 24 px del de la vista.
    expect(add.layout![id].y).toBe(1700 + 24);
    expect(add.layout![id].x).toBe(1000 - 120);
  });
});

describe('Import existing: la tabla importada nace centrada', () => {
  it('una tabla: centrada con el tamaño estimado por su nombre', async () => {
    await st().addExistingTables(['t9'], { tables: [{ id: 't9', physicalName: 'M_TABLA_IMPORTADA_CON_NOMBRE_LARGO', logicalName: 'x', schema: 'core' } as never] });
    const add = lastAdd();
    // «core.M_TABLA_IMPORTADA_CON_NOMBRE_LARGO» = 39 chars → 39·8+72 = 384 px de ancho.
    expect(add.layout).toEqual({ t9: { x: 1000 - 192, y: 1970 } });
  });

  it('varias a la vez: en cascada de 36 px para no taparse entera una a otra', async () => {
    await st().addExistingTables(['t8', 't9']);
    expect(lastAdd().layout).toEqual({ t8: { x: 880, y: 1970 }, t9: { x: 916, y: 2006 } });
  });
});

describe('Pegar una tabla', () => {
  const flow = (pos: { x: number; y: number }) => ({
    getNode: (id: string) => (id === 't1' ? { id, position: pos } : undefined),
    screenToFlowPosition: (p: { x: number; y: number }) => p,
  }) as never;

  it('con el original a la vista, la copia va a su lado (+36 px, como siempre)', async () => {
    useModelerStore.setState({ flow: flow({ x: 500, y: 1800 }), tblClipboard: { table: T1 as never, cols: [C1 as never] } });
    await st().pasteTable();
    const add = lastAdd();
    expect(Object.values(add.layout!)).toEqual([{ x: 536, y: 1836 }]);
  });

  it('con el original FUERA de la vista, la copia nace en el centro de lo que se ve', async () => {
    useModelerStore.setState({ flow: flow({ x: 9000, y: 40000 }), tblClipboard: { table: T1 as never, cols: [C1 as never] } });
    await st().pasteTable();
    const add = lastAdd();
    // «M_CLIENTE_copy_1» (16) vs columna «COD»+«STRING» (9+3): 16·8+72 = 200 → 240; 32 + 28 = 60.
    expect(Object.values(add.layout!)).toEqual([{ x: 880, y: 1970 }]);
  });
});

describe('Dibujos: nacen en el centro de lo que se ve (mismo cálculo)', () => {
  it('el rectángulo (200×120) queda centrado', () => {
    useModelerStore.setState({ flow: { screenToFlowPosition: (p: { x: number; y: number }) => p } as never, drawings: [] });
    st().addDrawing('rect');
    const d = st().drawings.at(-1)!;
    expect({ x: d.x, y: d.y }).toEqual({ x: 900, y: 1940 });
    expect(vi.mocked(canvasView).mock.calls.at(-1)![1]).toBeUndefined();
  });
});

// Ronda 3 de la revisión: lo reciente que todavía no se pinta cuenta por su
// posición guardada — pero sólo si se dibuja en esta faceta (las vistas, sólo
// en Physical).
describe('lo reciente que no se dibuja no desvía a la tabla nueva', () => {
  const withFreshView = (mode: 'logical' | 'physical') => {
    const base = structuredClone(DIA);
    const dia = {
      ...base,
      subjectArea: { ...base.subjectArea, layout: { ...base.subjectArea.layout, v9: { x: 880, y: 1970 } } },
      views: [{ id: 'v9', name: 'V9', schema: 'ddv_vu', tableId: 't1', sourceTableIds: ['t1'], sources: [] }],
    };
    useModelerStore.setState({ diagram: dia as never, viewMode: mode });
    st().markFresh({ sa1: ['v9'] });
  };

  it('en Logical (las vistas no se dibujan): nace en el centro', async () => {
    withFreshView('logical');
    await st().createTable({ logicalName: 'cliente nuevo', physicalName: 'CLIENTE' });
    expect(Object.values(lastAdd().layout!)).toEqual([{ x: 880, y: 1970 }]);
  });

  it('en Physical (la vista se dibuja ahí): baja en cascada', async () => {
    withFreshView('physical');
    await st().createTable({ logicalName: 'cliente nuevo', physicalName: 'CLIENTE' });
    expect(Object.values(lastAdd().layout!)).toEqual([{ x: 916, y: 2006 }]);
  });
});

// Doc 114 (piloto): crear, importar, CTAS o pegar una tabla ya no corre de
// casilla a las tablas existentes SIN posición guardada (el canvas las pinta
// por su número de orden, por nombre: una tabla que entra y ordena antes las
// corría). Se fijan donde se ven, en la MISMA escritura del alta.
describe('el alta fija a las existentes sin posición (doc 114)', () => {
  const T2 = { id: 't2', logicalName: 'zeta', physicalName: 'Z_SIN_POSICION' };
  const withLayoutless = () => {
    const base = structuredClone(DIA);
    useModelerStore.setState({ diagram: { ...base, subjectArea: { ...base.subjectArea, tableIds: ['t1', 't2'] }, tables: [T1, T2] } as never });
  };
  const pins = () => (vi.mocked(struct.addToCanvas).mock.calls.at(-1)![1] as { pins?: Record<string, { x: number; y: number }> }).pins;
  const SLOT_1 = { x: 60 + 260, y: 60 };   // gridSlot(1): la casilla de hoy de t2

  it('New table', async () => {
    withLayoutless();
    await st().createTable({ logicalName: 'alfa', physicalName: 'A_PRIMERA' });
    expect(pins()).toEqual({ t2: SLOT_1 });
  });

  it('CTAS', async () => {
    withLayoutless();
    await st().createTableFromSources({ logicalName: 'alfa ctas', columns: [C1] as never });
    expect(pins()).toEqual({ t2: SLOT_1 });
  });

  it('Import existing', async () => {
    withLayoutless();
    await st().addExistingTables(['t9']);
    expect(pins()).toEqual({ t2: SLOT_1 });
  });

  it('Pegar', async () => {
    withLayoutless();
    useModelerStore.setState({ flow: { getNode: () => undefined, screenToFlowPosition: (p: { x: number; y: number }) => p } as never, tblClipboard: { table: T1 as never, cols: [C1 as never] } });
    await st().pasteTable();
    expect(pins()).toEqual({ t2: SLOT_1 });
  });

  it('con todas las tablas posicionadas no se fija nada', async () => {
    await st().createTable({ logicalName: 'alfa', physicalName: 'A_PRIMERA' });
    expect(pins() ?? {}).toEqual({});
  });
});
