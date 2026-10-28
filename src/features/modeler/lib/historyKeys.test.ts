// Atajos del historial en el canvas, iguales en Mac y en Windows (⌘ o Ctrl):
// Z deshace; Shift+Z o Y rehacen. Con Alt, o sin ⌘/Ctrl, no son del historial.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/store/useSessionStore';
import { useUndoStore } from '@/store/useUndoStore';
import { historyKey, historyShortcut } from './historyKeys';

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }) as KeyboardEvent;

describe('historyShortcut', () => {
  it.each([
    ['⌘Z', key({ metaKey: true }), 'undo'],
    ['Ctrl+Z', key({ ctrlKey: true }), 'undo'],
    ['⇧⌘Z (Mac)', key({ metaKey: true, shiftKey: true, key: 'Z' }), 'redo'],
    ['Ctrl+Shift+Z', key({ ctrlKey: true, shiftKey: true, key: 'Z' }), 'redo'],
    ['Ctrl+Y (Windows)', key({ ctrlKey: true, key: 'y' }), 'redo'],
    ['⌘Y', key({ metaKey: true, key: 'y' }), 'redo'],
  ])('%s', (_l, e, want) => { expect(historyShortcut(e)).toBe(want); });

  it.each([
    ['Z sola', key({})],
    ['Alt+⌘Z', key({ metaKey: true, altKey: true })],
    ['Ctrl+Shift+Y', key({ ctrlKey: true, shiftKey: true, key: 'Y' })],
    ['⌘C', key({ metaKey: true, key: 'c' })],
  ])('%s no es del historial', (_l, e) => { expect(historyShortcut(e)).toBeNull(); });
});

// En edición el atajo es siempre del canvas: sin `preventDefault`, ⌘Y abre el
// Historial del navegador (Chrome/Safari en Mac) aunque no haya nada que rehacer
// o corra otro paso.
describe('historyKey', () => {
  beforeEach(() => {
    useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs1' });
    useUndoStore.getState().clear();
    useUndoStore.setState({ busy: false });
  });
  const event = () => ({ preventDefault: vi.fn() });

  it('en edición se queda el atajo sin nada que rehacer, sin avisar nada', async () => {
    const e = event();
    const notify = vi.fn();
    historyKey(e, 'redo', true, notify);
    expect(e.preventDefault).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).not.toHaveBeenCalled();
  });

  it('en edición se queda el atajo con un paso en curso, sin correr otro', () => {
    let ran = false;
    useUndoStore.setState({ busy: true, stack: [{ label: 'A', run: async () => { ran = true; return null; } }] });
    const e = event();
    historyKey(e, 'undo', true, vi.fn());
    expect(e.preventDefault).toHaveBeenCalled();
    expect(ran).toBe(false);
  });

  it('deshace y avisa', async () => {
    useUndoStore.setState({ stack: [{ label: 'A', run: async () => null }] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Undid: A'));
  });

  it('fuera de edición no lo toma', () => {
    const e = event();
    historyKey(e, 'redo', false, vi.fn());
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
