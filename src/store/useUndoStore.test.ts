import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pushUndo, useUndoStore } from './useUndoStore';

beforeEach(() => { useUndoStore.setState({ stack: [], busy: false }); });

describe('useUndoStore (doc 50)', () => {
  it('undoLast es LIFO: corre la inversa y devuelve su label', async () => {
    const ran: string[] = [];
    pushUndo('a', async () => { ran.push('a'); });
    pushUndo('b', async () => { ran.push('b'); });
    expect(await useUndoStore.getState().undoLast()).toBe('b');
    expect(ran).toEqual(['b']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['a']);
  });

  it('una inversa corriendo SUPRIME la instrumentación (no apila su propia inversa)', async () => {
    pushUndo('add', async () => {
      // La inversa reusa una acción del store instrumentada: su pushUndo
      // interno no debe entrar a la pila.
      pushUndo('delete (nested)', async () => {});
    });
    await useUndoStore.getState().undoLast();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('si la inversa FALLA, la entrada ya salió de la pila y el error se propaga', async () => {
    pushUndo('boom', async () => { throw new Error('409'); });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('409');
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('la pila se acota a 50 (se descarta lo más viejo)', () => {
    for (let i = 0; i < 55; i += 1) pushUndo(`e${i}`, async () => {});
    const stack = useUndoStore.getState().stack;
    expect(stack).toHaveLength(50);
    expect(stack[0].label).toBe('e5');
  });

  it('undoLast con pila vacía o con una inversa en vuelo devuelve null', async () => {
    expect(await useUndoStore.getState().undoLast()).toBeNull();
    const slow = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); });
    pushUndo('other', async () => {});
    pushUndo('slow', slow);
    const first = useUndoStore.getState().undoLast();              // pop 'slow', queda busy
    expect(await useUndoStore.getState().undoLast()).toBeNull();   // busy → no-op
    await first;
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['other']);
  });
});
