// «Locate» de una vista (buscador del Model, Explorer, inspector): se encuadra como
// una tabla. Si entra legible, entera; si es más alta que el canvas (una vista de
// cientos de columnas), desde su cabecera: centrar su medio dejaba el nombre fuera.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/modeler/lib/canvasFocus', async (orig) => {
  const actual = await orig<typeof import('@/features/modeler/lib/canvasFocus')>();
  return { ...actual, paneSize: vi.fn(() => ({ width: 704, height: 730 })) };
});

import { focusViewport } from '@/features/modeler/lib/canvasFocus';
import { useModelerStore } from './useModelerStore';

const view = (id: string, height: number) =>
  ({ id, type: 'view', position: { x: 500, y: 300 }, measured: { width: 260, height }, data: { view: { id, sourceTableIds: ['t1'] } } });
const flow = (nodes: ReturnType<typeof view>[]) => ({
  setViewport: vi.fn(async () => true), setCenter: vi.fn(async () => true),
  getNodes: () => nodes, getNode: (id: string) => nodes.find((n) => n.id === id), getZoom: () => 0.3,
});
const AREA = { width: 704, height: 730 };

beforeEach(() => {
  useModelerStore.setState({ flow: null, selectedTableId: null, selectedViewId: null } as never);
});

describe('Locate de una vista', () => {
  it('una vista más alta que el canvas queda con su cabecera a la vista', async () => {
    const tall = view('v2', 1900);
    const f = flow([tall]);
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().focusTable('v2');
    await vi.waitFor(() => expect(f.setViewport).toHaveBeenCalled());
    expect(f.setCenter).not.toHaveBeenCalled();
    const [[vp]] = f.setViewport.mock.calls as unknown as [[{ x: number; y: number; zoom: number }]];
    expect(vp).toEqual(focusViewport({ x: 500, y: 300, w: 260, h: 1900 }, [], AREA, 0.3));
    const top = tall.position.y * vp.zoom + vp.y;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(80);
  });

  it('una vista que entra se ve entera, centrada', async () => {
    const f = flow([view('v1', 200)]);
    useModelerStore.setState({ flow: f as never });
    useModelerStore.getState().focusTable('v1');
    await vi.waitFor(() => expect(f.setViewport).toHaveBeenCalled());
    const [[vp]] = f.setViewport.mock.calls as unknown as [[{ x: number; y: number; zoom: number }]];
    expect(vp).toEqual(focusViewport({ x: 500, y: 300, w: 260, h: 200 }, [], AREA, 0.3));
    expect(useModelerStore.getState().selectedTableId).toBeNull();   // una vista nunca abre el panel
  });
});
