// sessionKeeper: la sesión se renueva con actividad (como mucho una vez cada
// `renewEvery`) y se cierra sin uso; con la sesión en cookie, las pestañas se
// coordinan con la marca de localStorage (usuario y vencimiento, sin token).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keeperTiming, readMark, SESSION_MARK_KEY, startSessionKeeper, stopSessionKeeper } from './sessionKeeper';

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const HOUR = 3600;
const T0 = Date.parse('2026-10-21T10:00:00Z');
let win: EventTarget;
let doc: EventTarget & { visibilityState: string };
let renew: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<number>>>;
let onEnd: ReturnType<typeof vi.fn<(reason: string) => void>>;
let onStale: ReturnType<typeof vi.fn<() => Promise<unknown>>>;

const minutes = (m: number) => vi.advanceTimersByTimeAsync(m * 60_000);
const act = (type = 'pointerdown') => { win.dispatchEvent(new Event(type)); };
const storage = (newValue: string | null) =>
  win.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_MARK_KEY, newValue }));
const start = (over: { shared?: boolean; expiresIn?: number; username?: string } = {}) =>
  startSessionKeeper({ username: 'ana', expiresIn: HOUR, shared: true, renew, onEnd, onStale, ...over });
/** Renovación que responde cuando la prueba lo decide. */
function slowRenew() {
  let release: (n: number) => void = () => {};
  renew.mockImplementation(() => new Promise<number>((r) => { release = r; }));
  return (n = HOUR) => release(n);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  store.clear();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', fakeStorage);
  renew = vi.fn<(signal: AbortSignal) => Promise<number>>(async () => HOUR);
  onEnd = vi.fn();
  onStale = vi.fn(async () => undefined);
});
afterEach(async () => { await stopSessionKeeper(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('keeperTiming', () => {
  it('una hora: renueva como mucho cada 5 minutos y revisa cada 30 s; vidas cortas, en proporción', () => {
    expect(keeperTiming(3600_000)).toEqual({ renewEveryMs: 300_000, tickMs: 30_000 });
    expect(keeperTiming(60_000)).toEqual({ renewEveryMs: 10_000, tickMs: 5_000 });
  });
});

describe('renovación con actividad', () => {
  it('sin actividad no renueva; con actividad, como mucho una vez cada 5 minutos', async () => {
    start();
    await minutes(4);
    act();
    expect(renew).not.toHaveBeenCalled();
    await minutes(1);
    act(); act('keydown'); act('wheel'); act('pointermove');
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    await minutes(4);
    act();
    expect(renew).toHaveBeenCalledTimes(1);
    await minutes(1);
    act('touchstart');
    expect(renew).toHaveBeenCalledTimes(2);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('con uso la sesión no vence', async () => {
    start();
    for (let m = 0; m < 180; m += 2) { await minutes(2); act(); }
    expect(onEnd).not.toHaveBeenCalled();
    expect(renew).toHaveBeenCalledTimes(30);                     // a los 6, 12, … 180 minutos
  });

  it('una renovación fallida (sin respuesta) se reintenta tras una pausa; si nunca funciona, vence como «ended»', async () => {
    renew.mockRejectedValue(new Error('network'));
    start();
    await minutes(5);
    act();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    act();
    expect(renew).toHaveBeenCalledTimes(1);                      // pausa de 30 s
    await vi.advanceTimersByTimeAsync(30_000);
    act();
    expect(renew).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 120; i += 1) { await vi.advanceTimersByTimeAsync(30_000); act(); }
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('ended');                 // hubo uso: no es «sin uso»
  });
});

describe('cierre sin uso', () => {
  it('sin uso, se cierra al vencer el token («idle») sin renovar', async () => {
    start();
    await minutes(59.5);
    expect(onEnd).not.toHaveBeenCalled();
    await minutes(0.5);
    expect(onEnd).toHaveBeenCalledWith('idle');
    expect(renew).not.toHaveBeenCalled();
  });

  it('el uso en los primeros 5 minutos no alarga la sesión: vence a la hora', async () => {
    start();
    for (let m = 0; m < 4; m += 1) { await minutes(1); act(); }
    await minutes(56);
    expect(renew).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('idle');
  });

  it('actividad después de vencer (equipo suspendido): cierra en vez de renovar', async () => {
    start();
    vi.setSystemTime(T0 + 2 * HOUR * 1000);                      // el tiempo pasó sin ticks
    act();
    expect(onEnd).toHaveBeenCalledWith('idle');
    expect(renew).not.toHaveBeenCalled();
  });

  it('al volver a la pestaña revisa enseguida', async () => {
    start();
    vi.setSystemTime(T0 + 2 * HOUR * 1000);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(onEnd).toHaveBeenCalledWith('idle');
  });

  it('una vida inválida en la respuesta cuenta como una hora (sin revisiones en bucle)', async () => {
    start({ expiresIn: Number.NaN });
    await minutes(59);
    expect(onEnd).not.toHaveBeenCalled();
    await minutes(1);
    expect(onEnd).toHaveBeenCalledWith('idle');
  });
});

describe('detener', () => {
  it('stop espera la renovación en vuelo, y su respuesta tardía ya no toca la marca', async () => {
    let release: (n: number) => void = () => {};
    renew.mockImplementation(() => new Promise<number>((r) => { release = r; }));
    start();
    await minutes(5);
    act();
    let done = false;
    const stopping = stopSessionKeeper().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    release(HOUR);
    await stopping;
    expect(done).toBe(true);
    expect(readMark()).toEqual({ u: 'ana', exp: T0 + HOUR * 1000 });
    act();
    await minutes(120);
    expect(onEnd).not.toHaveBeenCalled();                        // sin listeners ni timer
  });

  it('un keeper nuevo reemplaza al anterior', async () => {
    const first = vi.fn();
    startSessionKeeper({ username: 'ana', expiresIn: HOUR, shared: true, renew, onEnd: first, onStale });
    start();
    await minutes(60);
    expect(first).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('pestañas con la sesión en cookie', () => {
  it('la marca guarda usuario y vencimiento, y se corre al renovar', async () => {
    start();
    expect(JSON.parse(store.get(SESSION_MARK_KEY) ?? 'null')).toEqual({ u: 'ana', exp: T0 + HOUR * 1000 });
    await minutes(5);
    act();
    await vi.advanceTimersByTimeAsync(0);
    expect(readMark()).toEqual({ u: 'ana', exp: T0 + 5 * 60_000 + HOUR * 1000 });
  });

  it('adopta la renovación de otra pestaña: no se cierra mientras otra siga en uso', async () => {
    start();
    await minutes(50);
    const renewedElsewhere = JSON.stringify({ u: 'ana', exp: Date.now() + HOUR * 1000 });
    store.set(SESSION_MARK_KEY, renewedElsewhere);
    storage(renewedElsewhere);
    await minutes(15);
    expect(onEnd).not.toHaveBeenCalled();
    await minutes(45);
    expect(onEnd).toHaveBeenCalledWith('idle');                  // 50 + 60 minutos
  });

  it('también sin el evento: la revisión periódica lee la marca', async () => {
    start();
    await minutes(50);
    store.set(SESSION_MARK_KEY, JSON.stringify({ u: 'ana', exp: Date.now() + HOUR * 1000 }));
    await minutes(15);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('otra pestaña salió (marca borrada): esta también', async () => {
    start();
    store.delete(SESSION_MARK_KEY);
    storage(null);
    expect(onEnd).toHaveBeenCalledWith('ended');
  });

  it('otra pestaña entró con otra cuenta: esta se cierra', async () => {
    start();
    const other = JSON.stringify({ u: 'otro', exp: Date.now() + HOUR * 1000 });
    store.set(SESSION_MARK_KEY, other);
    storage(other);
    expect(onEnd).toHaveBeenCalledWith('switched');
  });

  it('sesión solo de esta pestaña (token en memoria): no escribe ni lee la marca', async () => {
    start({ shared: false });
    expect(store.has(SESSION_MARK_KEY)).toBe(false);
    const other = JSON.stringify({ u: 'otro', exp: Date.now() + 10 * HOUR * 1000 });
    store.set(SESSION_MARK_KEY, other);
    storage(other);
    await minutes(59);
    expect(onEnd).not.toHaveBeenCalled();
    await minutes(1);
    expect(onEnd).toHaveBeenCalledWith('idle');                  // no adoptó un vencimiento ajeno
  });
});

// Una renovación en vuelo cuando otra pestaña sale o entra con otra cuenta:
// su respuesta vuelve a dejar la cookie de esta sesión, y se borra (`onStale`).
describe('renovación tardía frente a otra pestaña', () => {
  it('otra pestaña salió mientras la renovación estaba en vuelo: al responder, se borra la cookie', async () => {
    const release = slowRenew();
    start();
    await minutes(5);
    act();
    store.delete(SESSION_MARK_KEY);
    storage(null);
    expect(onEnd).toHaveBeenCalledWith('ended');
    expect(onStale).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(store.has(SESSION_MARK_KEY)).toBe(false);
  });

  it('la renovación respondió después del logout pero antes de su aviso: se borran la marca y la cookie', async () => {
    const release = slowRenew();
    start();
    await minutes(5);
    act();
    store.delete(SESSION_MARK_KEY);                              // la otra pestaña salió; su aviso aún no llega
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.has(SESSION_MARK_KEY)).toBe(true);              // la renovación reescribió la marca
    storage(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(onEnd).toHaveBeenCalledWith('ended');
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(store.has(SESSION_MARK_KEY)).toBe(false);
  });

  it('otra cuenta entró mientras la renovación estaba en vuelo: al responder, se borra la cookie', async () => {
    const release = slowRenew();
    start();
    await minutes(5);
    act();
    const other = JSON.stringify({ u: 'otro', exp: Date.now() + HOUR * 1000 });
    store.set(SESSION_MARK_KEY, other);
    storage(other);
    expect(onEnd).toHaveBeenCalledWith('switched');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(store.get(SESSION_MARK_KEY)).toBe(other);             // la marca de la otra cuenta no se toca
  });

  it('el logout propio cancela la renovación en vuelo (no espera su respuesta) y no limpia', async () => {
    let aborted = false;
    renew.mockImplementation((signal) => new Promise<number>((_, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    }));
    start();
    await minutes(5);
    act();
    await stopSessionKeeper();
    expect(aborted).toBe(true);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('si la respuesta tardía es de la otra cuenta (el pedido salió con su cookie), no se limpia', async () => {
    let fail: (e: Error) => void = () => {};
    renew.mockImplementation(() => new Promise<number>((_, reject) => { fail = reject; }));
    start();
    await minutes(5);
    act();
    const other = JSON.stringify({ u: 'otro', exp: Date.now() + HOUR * 1000 });
    store.set(SESSION_MARK_KEY, other);
    storage(other);
    fail(new Error('session belongs to another account'));      // lo que hace el store
    await vi.advanceTimersByTimeAsync(0);
    expect(onEnd).toHaveBeenCalledWith('switched');
    expect(onStale).not.toHaveBeenCalled();
  });

  it('otra pestaña salió y volvió a entrar con la misma cuenta: la renovación tardía no se limpia', async () => {
    const release = slowRenew();
    start();
    await minutes(5);
    act();
    store.delete(SESSION_MARK_KEY);
    storage(null);
    store.set(SESSION_MARK_KEY, JSON.stringify({ u: 'ana', exp: Date.now() + HOUR * 1000 }));   // entró de nuevo
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(onEnd).toHaveBeenCalledWith('ended');
    expect(onStale).not.toHaveBeenCalled();
  });

  it('detener espera también la limpieza de un keeper que ya terminó', async () => {
    const release = slowRenew();
    let cleaned: () => void = () => {};
    onStale.mockImplementation(() => new Promise<void>((r) => { cleaned = r; }));
    start();
    await minutes(5);
    act();
    store.delete(SESSION_MARK_KEY);
    storage(null);
    release();
    await vi.advanceTimersByTimeAsync(0);
    let done = false;
    const stopping = stopSessionKeeper().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);                                    // el login siguiente espera el logout de limpieza
    cleaned();
    await stopping;
    expect(done).toBe(true);
  });

  it('eventos de otras claves o un clear() no cierran la sesión', async () => {
    start();
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'dmh:lastProject', newValue: 'p1' }));
    win.dispatchEvent(Object.assign(new Event('storage'), { key: null, newValue: null }));
    await minutes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('sin localStorage (lanza): la pestaña sigue sola y vence por su cuenta', async () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    start();
    await minutes(5);
    act();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    await minutes(60);
    expect(onEnd).toHaveBeenCalledWith('idle');
  });
});
