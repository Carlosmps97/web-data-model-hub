/**
 * sessionKeeper: mantiene viva la sesión mientras el usuario usa la app y la
 * cierra cuando deja de usarla.
 *
 * El token de sesión vive `expiresIn` segundos (una hora por defecto). Con
 * actividad en la pestaña (puntero, tecla, rueda o toque) se renueva como
 * mucho una vez cada `renewEvery`: 5 minutos, o la sexta parte de la vida del
 * token si es menor. Sin actividad nadie lo renueva y, al vencer, la pestaña
 * cierra la sesión: una sesión sin uso dura entre `ttl - renewEvery` y `ttl`.
 *
 * Con la sesión en cookie, el navegador tiene una sola sesión para todas sus
 * pestañas. La marca `dmh.session` de localStorage (usuario y vencimiento, sin
 * el token) las coordina: una renovación en otra pestaña corre el vencimiento
 * de todas, y un logout o el ingreso con otra cuenta cierran la sesión en las
 * demás. Una renovación de esta pestaña que responde después de eso volvió a
 * dejar la cookie de esta sesión: `onStale` la borra, salvo que la sesión
 * vigente sea de la misma cuenta. Si la sesión es solo de esta pestaña (token
 * en memoria), la marca no se usa.
 */

export const SESSION_MARK_KEY = 'dmh.session';
const MAX_RENEW_EVERY_MS = 5 * 60_000;
const MAX_TICK_MS = 30_000;
// Vida del token cuando la respuesta no la informa.
const DEFAULT_TTL_S = 3600;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
const LISTEN = { capture: true, passive: true } as const;

/** Marca compartida entre pestañas: usuario y vencimiento (ms) de la sesión. */
export interface SessionMark { u: string; exp: number }

export function readMark(): SessionMark | null {
  try {
    const raw = localStorage.getItem(SESSION_MARK_KEY);
    const mark = raw ? (JSON.parse(raw) as Partial<SessionMark> | null) : null;
    return mark && typeof mark.u === 'string' && typeof mark.exp === 'number' ? { u: mark.u, exp: mark.exp } : null;
  } catch {
    return null;
  }
}

function writeMark(mark: SessionMark): void {
  try { localStorage.setItem(SESSION_MARK_KEY, JSON.stringify(mark)); } catch { /* sin localStorage: la pestaña sigue sola */ }
}

export function clearMark(): void {
  try { localStorage.removeItem(SESSION_MARK_KEY); } catch { /* ídem */ }
}

/** Por qué terminó la sesión: sin uso (`idle`); renovación fallida o logout en
 *  otra pestaña (`ended`); ingreso con otra cuenta en otra pestaña (`switched`). */
export type SessionEnd = 'idle' | 'ended' | 'switched';

export interface KeeperOptions {
  username: string;
  /** Segundos de vida del token. */
  expiresIn: number;
  /** La sesión es del navegador (cookie) y se coordina con las otras pestañas. */
  shared: boolean;
  /** Renueva el token y devuelve su vida en segundos; rechaza si la respuesta
   *  es de otra cuenta. `signal` cancela el pedido. */
  renew: (signal: AbortSignal) => Promise<number>;
  /** La sesión terminó; el keeper ya se detuvo. */
  onEnd: (reason: SessionEnd) => void;
  /** Borra la cookie que una renovación tardía volvió a dejar después de que
   *  otra pestaña saliera o entrara con otra cuenta. */
  onStale: () => Promise<unknown>;
}

/** Cadencia de la renovación y de la revisión del vencimiento. */
export function keeperTiming(ttlMs: number): { renewEveryMs: number; tickMs: number } {
  const renewEveryMs = Math.min(MAX_RENEW_EVERY_MS, ttlMs / 6);
  return { renewEveryMs, tickMs: Math.min(MAX_TICK_MS, renewEveryMs / 2) };
}

const ttlMsOf = (seconds: number): number =>
  (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TTL_S) * 1000;

let current: { stop: () => void } | null = null;
// Renovaciones en vuelo de esta pestaña (con su limpieza), también las de un
// keeper ya detenido: su respuesta vuelve a dejar la cookie puesta.
const pending = new Set<Promise<void>>();

/** Registra una tarea en vuelo; la promesa que devuelve nunca rechaza. */
function track(p: Promise<unknown>): Promise<void> {
  const settled = p.then(() => undefined, () => undefined);
  pending.add(settled);
  void settled.then(() => pending.delete(settled));
  return settled;
}

/** Arranca el keeper de la sesión que empieza (reemplaza al anterior). */
export function startSessionKeeper(opts: KeeperOptions): void {
  current?.stop();
  current = createKeeper(opts);
}

/** Detiene el keeper (cancela su renovación en vuelo) y espera lo pendiente de
 *  la pestaña, incluida la limpieza de un keeper que terminó por otra pestaña. */
export function stopSessionKeeper(): Promise<void> {
  current?.stop();
  current = null;
  return Promise.all([...pending]).then(() => undefined);
}

function createKeeper(opts: KeeperOptions): { stop: () => void } {
  let ttlMs = ttlMsOf(opts.expiresIn);
  const { renewEveryMs, tickMs } = keeperTiming(ttlMs);
  const started = Date.now();
  let expiresAt = started + ttlMs;
  let renewedAt = started;          // última renovación, de esta pestaña o de otra
  let nextRenewAt = started + renewEveryMs;
  let lastActivity = started;
  let inflight: Promise<void> | null = null;
  let cancel: (() => void) | null = null;
  let stopped = false;
  let endedElsewhere = false;       // otra pestaña salió o entró con otra cuenta
  const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
  const doc = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    // La pestaña misma sale o entra: la renovación en vuelo se cancela (si su
    // respuesta ya llegó, la cookie quedó antes del logout que sigue). Si la
    // sesión terminó por otra pestaña, se espera su respuesta para limpiarla.
    if (!endedElsewhere) cancel?.();
    clearInterval(timer);
    for (const type of ACTIVITY_EVENTS) win?.removeEventListener(type, onActivity, LISTEN);
    win?.removeEventListener('storage', onStorage);
    win?.removeEventListener('focus', check);
    doc?.removeEventListener('visibilitychange', onVisible);
  };

  const end = (reason: SessionEnd, elsewhere = false): void => {
    if (stopped) return;
    endedElsewhere = elsewhere;
    stop();
    opts.onEnd(reason);
  };

  const clean = (): Promise<void> => track(Promise.resolve().then(opts.onStale));

  function check(): void {
    if (stopped) return;
    if (opts.shared) {
      const mark = readMark();
      if (mark && mark.u !== opts.username) { end('switched', true); return; }
      if (mark && mark.exp > expiresAt) {
        // Otra pestaña renovó: la cookie ya trae el token nuevo.
        expiresAt = mark.exp;
        renewedAt = Math.max(renewedAt, mark.exp - ttlMs);
        nextRenewAt = Math.max(nextRenewAt, renewedAt + renewEveryMs);
      }
    }
    if (Date.now() < expiresAt || inflight) return;
    // Con actividad cuando ya tocaba renovar, la renovación falló: no es «sin uso».
    end(lastActivity < renewedAt + renewEveryMs ? 'idle' : 'ended');
  }

  function renew(): void {
    const controller = new AbortController();
    cancel = () => controller.abort();
    const p = track(opts.renew(controller.signal).then((expiresIn) => {
      if (stopped) {
        // Llegó después de que otra pestaña saliera o entrara con otra cuenta: la
        // respuesta volvió a dejar la cookie de esta sesión. Se borra salvo que
        // la sesión vigente sea de esta misma cuenta (otra pestaña volvió a entrar).
        const mark = endedElsewhere ? readMark() : null;
        return endedElsewhere && mark?.u !== opts.username ? clean() : undefined;
      }
      const now = Date.now();
      ttlMs = ttlMsOf(expiresIn);
      expiresAt = now + ttlMs;
      renewedAt = now;
      nextRenewAt = now + renewEveryMs;
      if (opts.shared) writeMark({ u: opts.username, exp: expiresAt });
      return undefined;
    }, () => {
      // Un 401 ya cerró la sesión (handler global). Sin respuesta o con un
      // error del servidor, se reintenta con la actividad, tras una pausa.
      if (!stopped) nextRenewAt = Date.now() + tickMs;
    }));
    inflight = p;
    void p.finally(() => {
      if (inflight === p) { inflight = null; cancel = null; }
    });
  }

  function onActivity(): void {
    const now = Date.now();
    // Lo que pasa después del vencimiento no es uso de la sesión vencida.
    if (now >= expiresAt) check();
    if (stopped) return;
    lastActivity = now;
    if (now >= nextRenewAt && !inflight) renew();
  }

  function onStorage(e: StorageEvent): void {
    if (e.key !== SESSION_MARK_KEY || stopped) return;
    if (e.newValue !== null) { check(); return; }
    // Otra pestaña salió. Si la marca vigente es la de este vencimiento, una
    // renovación respondió después del logout y volvió a dejar la cookie.
    const mark = readMark();
    const revived = mark !== null && mark.u === opts.username && mark.exp === expiresAt;
    end('ended', true);
    if (revived) {
      clearMark();
      void clean();
    }
  }

  function onVisible(): void {
    if (doc?.visibilityState === 'visible') check();
  }

  if (opts.shared) writeMark({ u: opts.username, exp: expiresAt });
  const timer = setInterval(check, tickMs);
  for (const type of ACTIVITY_EVENTS) win?.addEventListener(type, onActivity, LISTEN);
  if (opts.shared) win?.addEventListener('storage', onStorage);
  win?.addEventListener('focus', check);
  doc?.addEventListener('visibilitychange', onVisible);
  return { stop };
}
