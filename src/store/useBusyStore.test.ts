import { describe, it, expect } from 'vitest';
import { runBlocking, useBusyStore } from './useBusyStore';

describe('useBusyStore · runBlocking', () => {
  it('activa el overlay durante la promesa y lo apaga al terminar (también con error)', async () => {
    let seen = false;
    const out = await runBlocking('Creating project…', async () => {
      seen = useBusyStore.getState().active?.title === 'Creating project…';
      return 42;
    });
    expect(out).toBe(42);
    expect(seen).toBe(true);
    expect(useBusyStore.getState().active).toBeNull();
    await expect(runBlocking('X', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(useBusyStore.getState().active).toBeNull();
  });

  it('guarda el detalle opcional y el instante de inicio', async () => {
    await runBlocking('Copying…', async () => {
      const a = useBusyStore.getState().active;
      expect(a?.detail).toBe('Copying standards from «Modelo DDV»');
      expect(typeof a?.startedAt).toBe('number');
    }, 'Copying standards from «Modelo DDV»');
  });
});
