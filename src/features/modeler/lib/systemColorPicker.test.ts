// «More colors…»: el selector del navegador se ancla al input oculto. Si el
// input se agrega y se pulsa en el mismo instante, sin que el navegador le haya
// calculado posición, Chrome abre el selector en la esquina superior izquierda
// de la pantalla. Por eso el input va encima del botón que se pulsó, con su
// tamaño, y se fuerza el cálculo de su posición antes de abrirlo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { discardSystemPicker, openSystemPicker } from './systemColorPicker';

function fakeDom() {
  const calls: string[] = [];
  const listeners: Record<string, () => void> = {};
  const el = {
    type: '', value: '', tabIndex: 0, style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    addEventListener: (t: string, fn: () => void) => { listeners[t] = fn; },
    getBoundingClientRect: () => { calls.push('layout'); return { x: 0, y: 0, width: 0, height: 0 }; },
    click: () => { calls.push('click'); },
    blur: vi.fn(),
    remove: () => { calls.push('remove'); },
  };
  vi.stubGlobal('document', { createElement: () => el, body: { appendChild: () => { calls.push('append'); } } });
  return { el, calls, listeners };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('selector de color del sistema', () => {
  it('se abre anclado al botón pulsado: el input va encima de él y su posición se calcula antes de abrirlo', () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    useModelerStore.setState({ activeSaId: 'sa1' });
    const { el, calls } = fakeDom();
    const at = { left: 812, top: 640, width: 220, height: 30, right: 1032, bottom: 670 } as DOMRect;
    openSystemPicker('#92D050', at, vi.fn());
    expect(el.style).toMatchObject({ position: 'fixed', left: '812px', top: '640px', width: '220px', height: '30px' });
    expect(calls).toEqual(['append', 'layout', 'click']);
    discardSystemPicker(undefined);
  });

  it('discardSystemPicker suelta solo el selector que se abrió con ese `alive`', () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    useModelerStore.setState({ activeSaId: 'sa1' });
    const { calls } = fakeDom();
    const alive = () => true;
    openSystemPicker('#92D050', null, vi.fn(), alive);
    discardSystemPicker(() => true);
    expect(calls).not.toContain('remove');
    discardSystemPicker(alive);
    expect(calls).toContain('remove');
  });
});
