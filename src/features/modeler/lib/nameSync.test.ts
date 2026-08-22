import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNameSync } from './nameSync';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Harness: physicalize controlable por llamada + espías de estado/commit. */
function harness() {
  const calls: { logical: string; d: ReturnType<typeof deferred<{ physical: string }>> }[] = [];
  const physicalize = vi.fn((logical: string) => {
    const d = deferred<{ physical: string }>();
    calls.push({ logical, d });
    return d.promise;
  });
  const onState = vi.fn();
  const onCommit = vi.fn();
  const sync = createNameSync({ physicalize, onState, onCommit, debounceMs: 400 });
  const state = () => onState.mock.calls.at(-1)?.[0] as { logical: string; physical: string };
  return { sync, physicalize, onState, onCommit, calls, state };
}

// Deja correr los .then() encadenados de una promesa ya resuelta.
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('createNameSync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('descarta la respuesta stale de un physicalize fuera de orden', async () => {
    const h = harness();
    h.sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);          // dispara physicalize('a')
    h.sync.setLogical('ab');
    await vi.advanceTimersByTimeAsync(400);          // dispara physicalize('ab')
    expect(h.calls.map((c) => c.logical)).toEqual(['a', 'ab']);

    h.calls[1].d.resolve({ physical: 'AB' });        // la nueva llega primero
    await flush();
    expect(h.state().physical).toBe('AB');

    h.calls[0].d.resolve({ physical: 'A' });         // la vieja llega tarde
    await flush();
    expect(h.state().physical).toBe('AB');           // NO pisa con la stale
  });

  it('vaciar el lógico limpia el físico, commitea ambos y anula fetchs en vuelo', async () => {
    const h = harness();
    h.sync.setLogical('b');
    await vi.advanceTimersByTimeAsync(400);          // physicalize('b') en vuelo
    h.sync.setLogical('');
    expect(h.state()).toEqual({ logical: '', physical: '' });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({ logicalName: '', physicalName: '' });

    h.calls[0].d.resolve({ physical: 'B' });         // resuelve tras el borrado
    await flush();
    expect(h.state().physical).toBe('');             // no re-aparece el viejo
  });

  it('override manual del físico apaga el auto y sobrevive respuestas tardías', async () => {
    const h = harness();
    h.sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);          // physicalize('a') en vuelo
    h.sync.setPhysical('X');                         // override manual
    h.calls[0].d.resolve({ physical: 'A' });
    await flush();
    expect(h.state().physical).toBe('X');

    h.sync.setLogical('ab');                         // con override: sin auto
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.physicalize).toHaveBeenCalledTimes(1);
    expect(h.state().physical).toBe('X');

    h.sync.setPhysical('');                          // vaciarlo re-enciende el auto
    h.sync.setLogical('abc');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.physicalize).toHaveBeenCalledTimes(2);
    expect(h.calls[1].logical).toBe('abc');
  });

  it('emite UN solo commit con AMBOS campos tras resolver el physicalize', async () => {
    const h = harness();
    h.sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).not.toHaveBeenCalled();       // sin commit intermedio con físico viejo
    h.calls[0].d.resolve({ physical: 'A' });
    await flush();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'a', physicalName: 'A' });
  });

  it('physicalize que rechaza → commit igual (degradado, sin romper)', async () => {
    const onState = vi.fn();
    const onCommit = vi.fn();
    const sync = createNameSync({
      physicalize: () => Promise.reject(new Error('boom')),
      onState, onCommit, debounceMs: 400,
    });
    sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    await vi.advanceTimersByTimeAsync(400);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ logicalName: 'a', physicalName: '' });
  });

  it('reset invalida fetchs en vuelo y timers pendientes', async () => {
    const h = harness();
    h.sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);          // physicalize('a') en vuelo
    h.sync.reset('col2', 'COL2');                    // cambió la identidad de la fila
    h.calls[0].d.resolve({ physical: 'A' });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.onCommit).not.toHaveBeenCalled();       // nada del ciclo viejo persiste
  });
});
