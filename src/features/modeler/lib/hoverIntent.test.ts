// Resaltado de relaciones al pasar el mouse: solo resalta si el mouse se
// detiene sobre el bloque o el wire, de modo que cruzar el canvas no repinta
// todos los wires en cada bloque que el mouse atraviesa; los dibujos no
// resaltan nada (no tienen relaciones).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelerStore } from '@/store/useModelerStore';
import { bindHoverDim, createHoverIntent, HOVER_INTENT_MS, hoverTargetOf } from './hoverIntent';

describe('hover con intención', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('pasar por encima de bloques sin detenerse no resalta nada', () => {
    const applied: (string | null)[] = [];
    const hover = createHoverIntent((id) => applied.push(id));
    for (const id of ['t1', 't2', 't3']) {
      hover.enter(id);
      vi.advanceTimersByTime(HOVER_INTENT_MS - 1);
      hover.leave();
    }
    vi.runAllTimers();
    expect(applied).toEqual([]);
  });

  it('detenerse sobre un bloque lo resalta y salir lo apaga en el acto', () => {
    const applied: (string | null)[] = [];
    const hover = createHoverIntent((id) => applied.push(id));
    hover.enter('t1');
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    expect(applied).toEqual(['t1']);
    hover.leave();
    expect(applied).toEqual(['t1', null]);
  });

  it('al desmontar el canvas no queda un resaltado pendiente', () => {
    const applied: (string | null)[] = [];
    const hover = createHoverIntent((id) => applied.push(id));
    hover.enter('t1');
    hover.dispose();
    vi.runAllTimers();
    expect(applied).toEqual([]);
  });
});

describe('qué resalta el mouse', () => {
  it('un dibujo no resalta nada (no tiene relaciones); tablas, vistas y símbolos sí', () => {
    expect(hoverTargetOf({ id: 'd1', type: 'shape' })).toBeNull();
    expect(hoverTargetOf({ id: 't1', type: 'table' })).toBe('t1');
    expect(hoverTargetOf({ id: 'v1', type: 'view' })).toBe('v1');
    expect(hoverTargetOf({ id: 's1', type: 'subcat' })).toBe('s1');
  });
});

describe('atenuado del resto por una clase del canvas', () => {
  it('se prende mientras hay un bloque o un wire resaltado y se apaga al salir', () => {
    useModelerStore.setState({ hoverNodeId: null, hoverEdgeId: null });
    const toggle = vi.fn();
    const off = bindHoverDim({ classList: { toggle } } as unknown as HTMLElement);
    expect(toggle).toHaveBeenLastCalledWith('wk-canvas--hover', false);
    useModelerStore.getState().setHoverNode('t1');
    expect(toggle).toHaveBeenLastCalledWith('wk-canvas--hover', true);
    useModelerStore.getState().setHoverNode(null);
    useModelerStore.getState().setHoverEdge('r1');
    expect(toggle).toHaveBeenLastCalledWith('wk-canvas--hover', true);
    useModelerStore.getState().setHoverEdge(null);
    expect(toggle).toHaveBeenLastCalledWith('wk-canvas--hover', false);
    off();
    toggle.mockClear();
    useModelerStore.getState().setHoverNode('t2');
    expect(toggle).not.toHaveBeenCalled();
    useModelerStore.setState({ hoverNodeId: null });
  });
});
