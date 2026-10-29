// La espera de un Undo o un Redo (doc 133 §5): una capa que no se ve ni toma el
// puntero al empezar (el bloqueo lo hacen los listeners: así no apaga el hover
// del canvas en cada Ctrl+Z) y, si el paso tarda más de 300 ms, el aviso
// «Undoing…»/«Redoing…»; si tarda mucho, dice que espera al servidor.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// En un render del lado del servidor zustand lee el estado inicial: el
// historial sale de este objeto.
const history: Record<string, unknown> = {};
vi.mock('@/store/useUndoStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useUndoStore')>();
  const real = actual.useUndoStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...history });
  return { ...actual, useUndoStore: Object.assign(hook, real) };
});
import HistoryOverlay, { waitingView } from './HistoryOverlay';

describe('HistoryOverlay', () => {
  it('sin Undo ni Redo en curso no pinta nada', () => {
    history.running = null;
    expect(renderToStaticMarkup(<HistoryOverlay />)).toBe('');
  });

  it('con un paso en curso está desde el primer momento, todavía sin aviso', () => {
    history.running = 'undo';
    const html = renderToStaticMarkup(<HistoryOverlay />);
    expect(html).toMatch(/class="dmh-history-wait"/);
    expect(html).toMatch(/role="status"/);
    // La región viva no se marca ocupada: el aviso se anunciaría recién al terminar.
    expect(html).not.toMatch(/aria-busy/);
    expect(html).not.toMatch(/Undoing/);
  });
});

describe('qué muestra la capa', () => {
  const base = { what: 'undo' as const, shown: false, slow: false, blocking: false };
  it('al empezar, nada (ni velo ni cursor)', () => {
    expect(waitingView(base)).toEqual({ className: 'dmh-history-wait', title: null, detail: null });
  });
  it('pasados 300 ms, el aviso del paso que corre', () => {
    expect(waitingView({ ...base, shown: true })).toEqual({ className: 'dmh-history-wait is-shown', title: 'Undoing…', detail: null });
    expect(waitingView({ ...base, what: 'redo', shown: true }).title).toBe('Redoing…');
  });
  it('si tarda mucho, dice que espera al servidor', () => {
    expect(waitingView({ ...base, shown: true, slow: true }).detail).toBe('Still waiting for the server…');
  });
  it('con otra espera bloqueante encima (borrar una tabla deshaciendo su alta), no pinta la suya', () => {
    expect(waitingView({ ...base, shown: true, slow: true, blocking: true })).toEqual({ className: 'dmh-history-wait', title: null, detail: null });
  });
});
