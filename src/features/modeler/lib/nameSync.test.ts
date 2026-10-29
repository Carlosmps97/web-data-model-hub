import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftWorkSettled, flushPendingWrites, hasPendingWrites } from '@/services/draftWork';
import { createNameSync, type NameSync } from './nameSync';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// Lo tipeado sin grabar cuenta para Undo/Redo (registro de módulo): cada test
// descarta lo suyo al terminar (`reset`), así un physicalize sin responder de un
// test no queda agendado ni en vuelo en el siguiente.
const created: NameSync[] = [];
afterEach(() => { created.splice(0).forEach((s) => s.reset('', '')); });

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
  created.push(sync);
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

    h.calls[0].d.resolve({ physical: 'A' });         // la anterior llega tarde
    await flush();
    expect(h.state().physical).toBe('AB');           // no pisa con la respuesta stale
  });

  it('vaciar el lógico limpia el físico, commitea ambos y anula fetchs en vuelo', async () => {
    const h = harness();
    h.sync.setLogical('b');
    await vi.advanceTimersByTimeAsync(400);          // physicalize('b') en vuelo
    h.sync.setLogical('');
    expect(h.state()).toEqual({ logical: '', physical: '' });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({ logicalName: '', physicalName: '', physicalNameOverridden: false });

    h.calls[0].d.resolve({ physical: 'B' });         // resuelve tras el borrado
    await flush();
    expect(h.state().physical).toBe('');             // no reaparece el valor anterior
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

  it('emite un solo commit con ambos campos tras resolver el physicalize', async () => {
    const h = harness();
    h.sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).not.toHaveBeenCalled();       // sin commit intermedio con el físico desactualizado
    h.calls[0].d.resolve({ physical: 'A' });
    await flush();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'a', physicalName: 'A', physicalNameOverridden: false });
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
    expect(onCommit).toHaveBeenCalledWith({ logicalName: 'a', physicalName: '', physicalNameOverridden: false });
  });

  it('reset invalida fetchs en vuelo y timers pendientes', async () => {
    const h = harness();
    h.sync.setLogical('a');
    await vi.advanceTimersByTimeAsync(400);          // physicalize('a') en vuelo
    h.sync.reset('col2', 'COL2');                    // cambia la identidad de la fila
    h.calls[0].d.resolve({ physical: 'A' });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.onCommit).not.toHaveBeenCalled();       // nada del ciclo anterior persiste
  });
});

describe('override persistido', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reset con overridden=true: renombrar el lógico no re-deriva el físico', async () => {
    const h = harness();
    h.sync.reset('base eeff', 'HD_BASEEEFF', true);
    h.sync.setLogical('base eeff dos');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.physicalize).not.toHaveBeenCalled();            // auto apagado
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: 'base eeff dos', physicalName: 'HD_BASEEEFF',
      physicalNameOverridden: true,
    });
  });

  it('tipear el físico commitea overridden=true; vaciarlo lo apaga', async () => {
    const h = harness();
    h.sync.reset('monto', 'MTO', false);
    h.sync.setPhysical('MTO_X');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: 'monto', physicalName: 'MTO_X', physicalNameOverridden: true,
    });
    h.sync.setPhysical('');                                  // re-enciende el auto
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: 'monto', physicalName: '', physicalNameOverridden: false,
    });
  });
});

describe('normalizePhysical — regla de case del scope', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const upperHarness = () => {
    const onState = vi.fn();
    const onCommit = vi.fn();
    const sync = createNameSync({
      physicalize: async (l) => ({ physical: l.toUpperCase() }),
      normalizePhysical: (v) => v.toUpperCase(),
      onState, onCommit, debounceMs: 400,
    });
    return { sync, onState, onCommit, state: () => onState.mock.calls.at(-1)?.[0] as { logical: string; physical: string } };
  };

  it('tipear el físico en minúscula lo muestra y lo commitea normalizado', async () => {
    const h = upperHarness();
    h.sync.reset('monto', 'MTO', false);
    h.sync.setPhysical('monto_deuda');
    expect(h.state().physical).toBe('MONTO_DEUDA');      // la UI refleja la regla al instante
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: 'monto', physicalName: 'MONTO_DEUDA', physicalNameOverridden: true,
    });
  });

  it('vaciar el físico sigue re-encendiendo el auto (normalizar no inventa contenido)', async () => {
    const h = upperHarness();
    h.sync.reset('monto', 'MTO_X', true);
    h.sync.setPhysical('');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: 'monto', physicalName: '', physicalNameOverridden: false,
    });
  });

  it('reset no normaliza lo persistido: un físico guardado en minúscula se muestra tal cual hasta editarlo', async () => {
    const h = upperHarness();
    h.sync.reset('monto', 'mto_legacy', true);
    h.sync.setLogical('monto dos');                      // con override: commit sin re-derivar
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: 'monto dos', physicalName: 'mto_legacy', physicalNameOverridden: true,
    });
  });

  it('sin normalizePhysical el físico pasa tal cual (identidad)', async () => {
    const h = harness();
    h.sync.setPhysical('abc');
    expect(h.state().physical).toBe('abc');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenLastCalledWith({
      logicalName: '', physicalName: 'abc', physicalNameOverridden: true,
    });
  });
});

// ── tableNamePlan: decisión de guardado del panel de tabla ─────────────────
import { tableNamePlan } from './nameSync';

describe('tableNamePlan', () => {
  const prev = { logicalName: 'base eeff', physicalName: 'HD_BASEEEFF', physicalNameOverridden: true };

  it('con override persistido, renombrar el lógico no re-deriva y conserva el custom', () => {
    const plan = tableNamePlan({ logical: 'base eeff dos', physical: 'HD_BASEEEFF', prev, sessionOverride: null });
    expect(plan).toEqual({ physical: 'HD_BASEEEFF', overridden: true, derive: false });
  });

  it('sin override, renombrar el lógico con físico intacto sí re-deriva', () => {
    const plan = tableNamePlan({
      logical: 'maestro dos', physical: 'MAESTRO',
      prev: { logicalName: 'maestro', physicalName: 'MAESTRO' }, sessionOverride: null,
    });
    expect(plan).toEqual({ physical: 'MAESTRO', overridden: false, derive: true });
  });

  it('tipear un físico distinto en esta sesión marca override y no deriva', () => {
    const plan = tableNamePlan({
      logical: 'maestro', physical: 'MD_MAESTRO',
      prev: { logicalName: 'maestro', physicalName: 'MAESTRO' }, sessionOverride: true,
    });
    expect(plan).toEqual({ physical: 'MD_MAESTRO', overridden: true, derive: false });
  });

  it('vaciar el físico (o usar el botón derive) apaga el override y re-deriva', () => {
    const plan = tableNamePlan({ logical: 'base eeff', physical: '', prev, sessionOverride: false });
    expect(plan).toEqual({ physical: '', overridden: false, derive: true });
  });

  it('sin lógico no hay derivación posible', () => {
    const plan = tableNamePlan({ logical: '', physical: 'X', prev: { logicalName: '', physicalName: 'X' }, sessionOverride: null });
    expect(plan.derive).toBe(false);
  });
});

// Undo y Redo graban ya lo tipeado (doc 133 §5): el commit agendado sale en el
// acto y, si falta el físico derivado, se pide ya y el commit sale apenas llega
// (sin la segunda espera). Mientras falta, el Undo lo espera (trabajo en vuelo).
describe('createNameSync — lo agendado ante un Undo', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** ¿Terminó la espera del trabajo en vuelo? */
  const settledFlag = () => {
    const f = { done: false };
    void draftWorkSettled().then(() => { f.done = true; });
    return f;
  };

  it('con el commit agendado, lo manda en el acto y deja de contar', () => {
    const h = harness();
    h.sync.setPhysical('CLI');
    expect(hasPendingWrites()).toBe(true);
    flushPendingWrites();
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: '', physicalName: 'CLI', physicalNameOverridden: true });
    expect(hasPendingWrites()).toBe(false);
    vi.advanceTimersByTime(400);
    expect(h.onCommit).toHaveBeenCalledTimes(1);
  });

  it('sin el físico pedido todavía, lo pide ya y manda el commit apenas llega; el Undo lo espera', async () => {
    const h = harness();
    h.sync.setLogical('cliente');
    flushPendingWrites();
    expect(h.calls.map((c) => c.logical)).toEqual(['cliente']);
    const settled = settledFlag();
    await flush();
    expect(settled.done).toBe(false);
    h.calls[0].d.resolve({ physical: 'CLIENTE' });
    await draftWorkSettled();                        // termina recién con el commit mandado
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'CLIENTE', physicalNameOverridden: false });
    expect(hasPendingWrites()).toBe(false);
    vi.advanceTimersByTime(800);
    expect(h.physicalize).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledTimes(1);
  });

  it('con el físico en vuelo, manda el commit apenas llega', async () => {
    const h = harness();
    h.sync.setLogical('cliente');
    await vi.advanceTimersByTimeAsync(400);          // ya pidió el físico
    expect(hasPendingWrites()).toBe(true);
    flushPendingWrites();
    const settled = settledFlag();
    await flush();
    expect(settled.done).toBe(false);
    h.calls[0].d.resolve({ physical: 'CLIENTE' });
    await draftWorkSettled();
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'CLIENTE', physicalNameOverridden: false });
    expect(hasPendingWrites()).toBe(false);
  });

  it('si el físico no se puede derivar, manda el lógico apenas falla', async () => {
    const h = harness();
    h.physicalize.mockImplementationOnce(() => Promise.reject(new Error('sin naming')));
    h.sync.setLogical('cliente');
    flushPendingWrites();
    await flush(); await flush();
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: '', physicalNameOverridden: false });
    expect(hasPendingWrites()).toBe(false);
  });

  it('sin el físico en vuelo, el rayo (derive) también se manda apenas llega', async () => {
    const h = harness();
    h.sync.reset('cliente', 'X_CLI', true);
    h.sync.derive();
    expect(hasPendingWrites()).toBe(true);
    flushPendingWrites();
    h.calls[0].d.resolve({ physical: 'CLIENTE' });
    await flush(); await flush();
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'CLIENTE', physicalNameOverridden: false });
    expect(hasPendingWrites()).toBe(false);
  });

  it('al cerrar el panel con el físico en vuelo, sigue agendado: su commit sale 400 ms después de llegar, como antes', async () => {
    const h = harness();
    h.sync.setLogical('cliente');
    await vi.advanceTimersByTimeAsync(400);          // ya pidió el físico
    h.sync.dispose();
    expect(hasPendingWrites()).toBe(true);
    h.calls[0].d.resolve({ physical: 'CLIENTE' });
    await flush(); await flush();
    // Con la columna recién borrada, su recarga llega antes: el guardado no la revive.
    expect(h.onCommit).not.toHaveBeenCalled();
    expect(hasPendingWrites()).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'CLIENTE', physicalNameOverridden: false });
    expect(hasPendingWrites()).toBe(false);
  });

  it('… y un Undo en ese lapso lo manda ya y lo espera', async () => {
    const h = harness();
    h.sync.setLogical('cliente');
    await vi.advanceTimersByTimeAsync(400);
    h.sync.dispose();
    flushPendingWrites();
    const settled = settledFlag();
    await flush();
    expect(settled.done).toBe(false);
    h.calls[0].d.resolve({ physical: 'CLIENTE' });
    await draftWorkSettled();
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'CLIENTE', physicalNameOverridden: false });
    expect(hasPendingWrites()).toBe(false);
  });

  it('con un físico tipeado después del lógico, no pide el físico viejo: manda el commit en el acto', () => {
    const h = harness();
    h.sync.setLogical('cliente');
    h.sync.setPhysical('X_CLI');
    flushPendingWrites();
    expect(h.physicalize).not.toHaveBeenCalled();
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'X_CLI', physicalNameOverridden: true });
    expect(hasPendingWrites()).toBe(false);
  });

  it('si pintar el físico falla al llegar, igual sale el commit', async () => {
    const h = harness();
    h.sync.setLogical('cliente');
    await vi.advanceTimersByTimeAsync(400);
    h.onState.mockImplementationOnce(() => { throw new Error('render'); });
    h.calls[0].d.resolve({ physical: 'CLIENTE' });
    await flush(); await flush();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.onCommit).toHaveBeenCalledWith({ logicalName: 'cliente', physicalName: 'CLIENTE', physicalNameOverridden: false });
  });

  it('reset y dispose sueltan lo agendado sin mandarlo', () => {
    const h = harness();
    h.sync.setPhysical('CLI');
    h.sync.reset('otra', 'OTRA');
    expect(hasPendingWrites()).toBe(false);
    h.sync.setLogical('cli');
    h.sync.dispose();
    expect(hasPendingWrites()).toBe(false);
    flushPendingWrites();
    expect(h.onCommit).not.toHaveBeenCalled();
  });

  it('sin nada tipeado no cuenta como agendado', () => {
    const h = harness();
    h.sync.reset('cliente', 'CLIENTE');
    expect(hasPendingWrites()).toBe(false);
    flushPendingWrites();
    expect(h.physicalize).not.toHaveBeenCalled();
    expect(h.onCommit).not.toHaveBeenCalled();
  });
});
