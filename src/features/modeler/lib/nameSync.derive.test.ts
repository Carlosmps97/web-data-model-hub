// Doc 88 §3: `derive()` — el «rayo» del panel de atributo re-deriva el físico
// desde el lógico y apaga el override; una edición posterior gana.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNameSync } from './nameSync';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

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

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('createNameSync.derive (doc 88 §3)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('re-deriva del lógico y apaga el override manual', async () => {
    const h = harness();
    h.sync.reset('Codigo Cliente', 'MI_CUSTOM', true);
    h.sync.derive();
    expect(h.calls.map((c) => c.logical)).toEqual(['Codigo Cliente']);
    h.calls[0].d.resolve({ physical: 'CODCLI' });
    await flush();
    expect(h.state().physical).toBe('CODCLI');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({ logicalName: 'Codigo Cliente', physicalName: 'CODCLI', physicalNameOverridden: false });
  });

  it('una edición manual posterior gana sobre la derivación en vuelo', async () => {
    const h = harness();
    h.sync.reset('Codigo', 'X', true);
    h.sync.derive();
    h.sync.setPhysical('MANUAL');
    h.calls[0].d.resolve({ physical: 'COD' });
    await flush();
    expect(h.state().physical).toBe('MANUAL');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({ logicalName: 'Codigo', physicalName: 'MANUAL', physicalNameOverridden: true });
  });

  it('con lógico vacío no hace nada', () => {
    const h = harness();
    h.sync.reset('', 'X', true);
    h.sync.derive();
    expect(h.physicalize).not.toHaveBeenCalled();
  });
});
