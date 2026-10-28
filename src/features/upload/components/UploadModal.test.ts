// UploadModal sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil).
// La carga ya pedida:
//  · si el POST del apply falla con una respuesta de error, el job sigue
//    validado: cerrar el popup lo descarta;
//  · la pila de Undo se vacía y queda cerrada desde que empieza el apply (una
//    inversa previa, o de lo editado con el popup cerrado, pisaría lo cargado);
//    si el polling se rinde ante fallos transitorios, la carga no se da por
//    fallida: «no se pudo confirmar el resultado» y se refresca;
//  · con la sesión cambiada, una carga que falla se avisa nombrando la versión,
//    salvo que el motivo sea esa versión misma (ya avisó la revalidación).
// «Otra versión abierta» se mira por la versión (csId, en edición), no por la
// época de la sesión; tras un logout (401, u otro usuario) no se avisa nada;
// 401/403 del polling = «no se pudo confirmar»; un POST sin respuesta lo decide
// el polling; se refresca también tras un apply fallido (y se avisa si el
// refresco falla); con el Undo en vuelo la carga no empieza.
// Con otra versión abierta, la carga que termina bien también se avisa
// (nombrando la versión); un POST sin respuesta se relee un par de veces antes de
// darlo por no llegado; el arrange sigue la versión (A → B → A).
// No hay arrange completo: se ubica solo lo que entró a cada canvas
// (`newMembers`), en el centro de lo que se ve si es el canvas abierto, y se
// marca para pintarlo encima (`markFresh`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import { fake, nextStates, resetFake, runEffects, textOf, unmount, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const session = { openMode: 'editing' as string | null, activeChangesetId: 'cs1' as string | null, activeProjectId: 'p1', activeVersionLabel: 'v3' as string | null };
const auth = { user: { username: 'ana' } as { username: string } | null };
vi.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => auth } }));
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: Object.assign((sel: (s: unknown) => unknown) => sel(session), { getState: () => session, subscribe: () => () => {} }),
}));
const clearUndo = vi.fn();
const undoState = { busy: false };
vi.mock('@/store/useUndoStore', () => ({
  useUndoStore: { getState: () => ({ clear: clearUndo, busy: undoState.busy }) },
  historyRunning: (then: string) => (undoState.busy ? `Undo or redo is still running — ${then} when it finishes.` : null),
}));
const refreshExplorer = vi.fn(async () => {});
const markFresh = vi.fn();
const mstate = {
  viewMode: 'logical', trees: {}, subjectAreas: [], refreshExplorer, markFresh,
  activeSaId: null as string | null, diagram: null as { subjectArea: { id: string } } | null, flow: null,
};
vi.mock('@/store/useModelerStore', () => ({
  useModelerStore: Object.assign((sel: (s: unknown) => unknown) => sel(mstate), { getState: () => mstate }),
}));
const pinState = { holds: true };
const revalidation = { run: async () => {} };
vi.mock('@/features/modeler/lib/sessionGuard', () => ({
  SessionChangedError: class SessionChangedError extends Error { constructor() { super('SessionChanged'); this.name = 'SessionChangedError'; } },
  pinSession: () => ({ holds: () => pinState.holds, check: () => { if (!pinState.holds) throw new Error('SessionChanged'); } }),
  touchesVersion: (e: unknown, cs: string) => e instanceof ApiError && [403, 404, 409].includes(e.status) && (e.url ?? '').includes(`/${cs}/`),
  afterRevalidation: () => revalidation.run(),
}));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('../placeUploaded', () => ({ placeUploadedObjects: vi.fn(async () => ({ placed: 1, failed: [], skipped: [] })) }));
vi.mock('@/features/modeler/lib/canvasFocus', () => ({ canvasView: vi.fn(() => null) }));
vi.mock('../upload.service', () => ({
  applyUpload: vi.fn(), createDefaultProfile: vi.fn(), discardUpload: vi.fn(async () => ({ deleted: true })),
  getProfileCatalog: vi.fn(async () => ({})), getUploadTargets: vi.fn(async () => ({ mode: 'none', candidates: [] })),
  listProfiles: vi.fn(async () => [{ id: 'pr1', name: 'P', isDefault: true, sheets: {} }]), pollUploadJob: vi.fn(), startUpload: vi.fn(),
}));

import { applyUpload, discardUpload, pollUploadJob } from '../upload.service';
import { placeUploadedObjects } from '../placeUploaded';
import { canvasView } from '@/features/modeler/lib/canvasFocus';
import UploadModal from './UploadModal';

const JOB = { id: 'j1', status: 'validated', report: { errorCount: 0, warningCount: 0 }, progress: { phase: '', done: 0, total: 0 } };
const APPLIED = { ...JOB, status: 'applied', result: { affectedCanvasIds: [], counts: {} } };
const TIMEOUT = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/changesets/cs1/uploads/j1');
const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
let props: Parameters<typeof UploadModal>[0];

function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = UploadModal(props);
  runEffects();
  return tree;
}
/** El popup con un job ya validado: phase (useState #0) y job (#3); jobRef (useRef #1). */
function mountValidated() {
  props = { onClose: vi.fn(), pushToast: vi.fn() };
  resetFake((init, i) => (i === 0 ? 'validated' : i === 3 ? JOB : init));
  const tree = UploadModal(props);
  runEffects();
  fake.refs[1].current = JOB;
  return tree;
}
const button = (tree: unknown, text: string) => {
  const b = [...walk(tree)].find((el) => typeof el.props.onClick === 'function' && textOf(el) === text);
  if (!b) throw new Error(`no button «${text}»`);
  return b;
};
const upload = (tree: unknown) => (button(tree, 'Upload').props.onClick as () => void)();
const phase = () => nextStates()[0];
const error = () => nextStates()[4] as string | null;
const errToasts = () => vi.mocked(props.pushToast).mock.calls.filter(([, k]) => k === 'err').map(([m]) => m);
const okToasts = () => vi.mocked(props.pushToast).mock.calls.filter(([, k]) => k !== 'err').map(([m]) => m);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mstate, { activeSaId: null, diagram: null, flow: null });
  // Lo encolado con `…Once` que un test no consumió no pasa al siguiente.
  vi.mocked(applyUpload).mockReset();
  vi.mocked(pollUploadJob).mockReset();
  pinState.holds = true;
  Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeVersionLabel: 'v3' });
  auth.user = { username: 'ana' };
  undoState.busy = false;
  revalidation.run = async () => {};
});
afterEach(() => { vi.useRealTimers(); });   // las relecturas del POST sin respuesta se prueban con reloj falso

describe('si el POST del apply falla, el job sigue validado', () => {
  it('cerrar el popup lo descarta', async () => {
    let tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(new ApiError('Another upload is being applied to this version; wait for it to finish.', 409, null, '/api/changesets/cs1/uploads/j1/apply'));
    upload(tree);
    await ticks();
    tree = rerender();
    expect(phase()).toBe('failed');
    (button(tree, 'Close').props.onClick as () => void)();
    unmount();
    expect(discardUpload).toHaveBeenCalledWith('cs1', 'j1');
  });
});

describe('la carga ya pedida y el Undo', () => {
  it('la pila se vacía y queda cerrada antes de enviar el POST y hasta que la carga termina', async () => {
    const tree = mountValidated();
    const order: string[] = [];
    clearUndo.mockImplementation((h?: object) => { order.push(h ? 'hold' : 'clear'); });
    vi.mocked(applyUpload).mockImplementationOnce(async () => { order.push('apply'); return { ...JOB, status: 'applying' } as never; });
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    upload(tree);
    await ticks();
    expect(order.slice(0, 2)).toEqual(['hold', 'apply']);
    const held = clearUndo.mock.calls[0][0] as { until: Promise<unknown> };
    await expect(held.until).resolves.toBeUndefined();       // terminó: se abre
    expect(phase()).toBe('done');
  });

  it('el polling se rindió (fallos transitorios): no es «failed» — no se pudo confirmar; se refresca el Explorer', async () => {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
    vi.mocked(pollUploadJob).mockRejectedValueOnce(TIMEOUT());
    upload(tree);
    await ticks();
    expect(phase()).toBe('unconfirmed');
    expect(error()).toBe("Couldn't confirm the result of the upload: The server didn't respond within 30s. It may still be applied — check the model before continuing.");
    expect(refreshExplorer).toHaveBeenCalled();
    expect(placeUploadedObjects).not.toHaveBeenCalled();
    expect(clearUndo).toHaveBeenCalled();
  });

  it('una falla real (el job falló) sigue siendo «failed»', async () => {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
    vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB, status: 'failed', error: 'Upload stopped. 2 of 5 batches had already been saved.' } as never);
    upload(tree);
    await ticks();
    expect(phase()).toBe('failed');
    expect(error()).toBe('Upload stopped. 2 of 5 batches had already been saved.');
  });
});

describe('la carga falla con la sesión cambiada', () => {
  /** Upload; el polling queda en vuelo; el TopNav desmonta el popup y se abre otra versión (cs2). */
  async function switchDuringApply() {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
    let finish!: (j: unknown) => void; let fail!: (e: unknown) => void;
    vi.mocked(pollUploadJob).mockImplementationOnce(() => new Promise((r, j) => { finish = r; fail = j; }) as never);
    upload(tree);
    await tick();
    unmount();
    pinState.holds = false;
    session.activeChangesetId = 'cs2';
    return { finish, fail };
  }

  it('avisa la falla nombrando la versión', async () => {
    const p = await switchDuringApply();
    p.finish({ ...JOB, status: 'failed', error: 'Upload stopped. 2 of 5 batches had already been saved.' });
    await ticks();
    expect(errToasts()).toEqual(['The upload to “v3” failed: Upload stopped. 2 of 5 batches had already been saved.']);
  });

  it('sin nombre de la versión, lo dice igual', async () => {
    session.activeVersionLabel = null;
    const p = await switchDuringApply();
    p.finish({ ...JOB, status: 'failed', error: 'Nothing was written.' });
    await ticks();
    expect(errToasts()).toEqual(['The upload to the version where it started failed: Nothing was written.']);
  });

  it('con otra versión abierta, un error de la versión de la carga se avisa: la revalidación no la mira', async () => {
    const p = await switchDuringApply();
    p.fail(new ApiError('You no longer have access to this version.', 403, null, '/api/changesets/cs1/uploads/j1'));
    await ticks();
    // (un 403 del polling no dice cómo terminó)
    expect(errToasts()).toEqual(["Couldn't confirm the result of the upload to “v3”: You no longer have access to this version. It may still be applied — check that version before continuing."]);
  });

  it('un error que no es de la versión (ni transitorio) se avisa, con su motivo', async () => {
    const p = await switchDuringApply();
    p.fail(new ApiError('The workbook changed since it was validated; validate again.', 422, null, '/api/changesets/cs1/uploads/j1'));
    await ticks();
    expect(errToasts()).toEqual(['The upload to “v3” failed: The workbook changed since it was validated; validate again.']);
  });

  it('si no se pudo confirmar el resultado, también lo dice nombrando la versión', async () => {
    const p = await switchDuringApply();
    p.fail(TIMEOUT());
    await ticks();
    expect(errToasts()).toEqual(["Couldn't confirm the result of the upload to “v3”: The server didn't respond within 30s. It may still be applied — check that version before continuing."]);
    expect(refreshExplorer).not.toHaveBeenCalled();
  });
});

describe('el resultado de la carga, dónde y a quién se avisa', () => {
  const applying = () => vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
  /** El polling en vuelo, para decidir su final en el test. */
  function pollInFlight() {
    let finish!: (j: unknown) => void; let fail!: (e: unknown) => void;
    vi.mocked(pollUploadJob).mockImplementationOnce(() => new Promise((r, j) => { finish = r; fail = j; }) as never);
    return { finish: (j: unknown) => finish(j), fail: (e: unknown) => fail(e) };
  }

  it('un 401 del polling (sesión vencida o logout; el popup se desmonta): nada que avisar', async () => {
    const tree = mountValidated();
    applying(); const p = pollInFlight();
    upload(tree); await tick();
    unmount();
    p.fail(new ApiError('Authentication required. Sign in.', 401, null, '/api/changesets/cs1/uploads/j1'));
    await ticks();
    expect(errToasts()).toEqual([]);
  });

  it('si ya entró otro usuario, nada de esta carga se avisa', async () => {
    const tree = mountValidated();
    applying(); const p = pollInFlight();
    upload(tree); await tick();
    unmount();
    auth.user = { username: 'bob' };
    p.finish({ ...JOB, status: 'failed', error: 'Nothing was written.' });
    await ticks();
    expect(errToasts()).toEqual([]);
  });

  it('con otro usuario en el tab y la misma versión abierta, la falla a mitad no refresca su Explorer', async () => {
    const tree = mountValidated();
    applying(); const p = pollInFlight();
    upload(tree); await tick();
    unmount();
    auth.user = { username: 'bob' };
    p.finish({ ...JOB, status: 'failed', error: 'The upload stopped. 3 of 5 batches had already been saved.' });
    await ticks();
    expect(errToasts()).toEqual([]);
    expect(refreshExplorer).not.toHaveBeenCalled();
  });

  it('…ni «unconfirmed» (el polling se rindió)', async () => {
    const tree = mountValidated();
    applying(); const p = pollInFlight();
    upload(tree); await tick();
    unmount();
    auth.user = { username: 'bob' };
    p.fail(TIMEOUT());
    await ticks();
    expect(errToasts()).toEqual([]);
    expect(refreshExplorer).not.toHaveBeenCalled();
  });

  it('un 403 del polling (sin permiso): no se sabe cómo terminó; «unconfirmed», no «failed»', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockRejectedValueOnce(new ApiError("You don't have permission for this action (model.edit).", 403, null, '/api/changesets/cs1/uploads/j1'));
    upload(tree);
    await ticks();
    expect(phase()).toBe('unconfirmed');
    expect(error()).toMatch(/^Couldn't confirm the result of the upload: You don't have permission/);
  });

  it('en la misma sesión, un error de la versión que la revalidación resolvió cambiándola: calla (avisó ella)', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockRejectedValueOnce(new ApiError('This version was deleted.', 404, null, '/api/changesets/cs1/uploads/j1'));
    revalidation.run = async () => { pinState.holds = false; session.activeChangesetId = null; };
    upload(tree);
    await ticks();
    expect(errToasts()).toEqual([]);
    expect(phase()).not.toBe('failed');
  });

  it('de vuelta en la misma versión (A → B → A), un error de la versión se avisa (ya la revalidó al reabrirla)', async () => {
    const tree = mountValidated();
    applying(); const p = pollInFlight();
    upload(tree); await tick();
    unmount();
    pinState.holds = false;                       // otra época de sesión…
    session.activeChangesetId = 'cs1';           // …en la misma versión
    p.fail(new ApiError("You don't have permission for this action (model.edit).", 403, null, '/api/changesets/cs1/uploads/j1'));
    await ticks();
    expect(errToasts()).toHaveLength(1);
  });

  it('el POST sin respuesta: el polling dice si llegó; aplicada, sigue normal', async () => {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    upload(tree);
    await ticks();
    expect(phase()).toBe('done');
    expect(pollUploadJob).toHaveBeenCalled();
  });

  it('el POST sin respuesta y el job sigue «validated» (también al releerlo): se descarta esperando la respuesta; nada se aplicó, y lo dice', async () => {
    vi.useFakeTimers();
    let tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    for (let i = 0; i < 3; i++) vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB } as never);
    upload(tree);
    await vi.advanceTimersByTimeAsync(0);
    expect(pollUploadJob).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('applying');                  // sin concluir: pudo llegar tarde
    expect(discardUpload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollUploadJob).toHaveBeenCalledTimes(3);    // la primera lectura y dos relecturas espaciadas
    // «No llegó» se vuelve cierto: un POST que llegue después no encuentra el job;
    // y solo si sigue validado (si en ese instante la carga ya empezó o terminó, 409: se sigue).
    expect(discardUpload).toHaveBeenCalledTimes(1);
    expect(discardUpload).toHaveBeenCalledWith('cs1', 'j1', { onlyIfValidated: true });
    tree = rerender();
    expect(phase()).toBe('failed');
    expect(error()).toBe("Nothing was applied — the upload didn't start (The server didn't respond within 30s). Validate the workbook and upload it again.");
    (button(tree, 'Close').props.onClick as () => void)();
    unmount();
    expect(discardUpload).toHaveBeenCalledTimes(1);    // no queda nada que descartar
  });

  it('…y el DELETE da 409 (el servidor ya lo está aplicando): el POST sí llegó; se sigue el polling y la carga termina', async () => {
    vi.useFakeTimers();
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    for (let i = 0; i < 3; i++) vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB } as never);
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    vi.mocked(discardUpload).mockRejectedValueOnce(new ApiError("The upload is being applied; it can't be discarded until it finishes.", 409, null, '/api/changesets/cs1/uploads/j1'));
    upload(tree);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollUploadJob).toHaveBeenCalledTimes(4);
    expect(phase()).toBe('done');
    expect(okToasts()).toEqual([expect.stringMatching(/^Uploaded /)]);
    expect(errToasts()).toEqual([]);
  });

  it('…y el DELETE da 404 (el job no existe): tampoco se aplicará; «failed», nada se aplicó', async () => {
    vi.useFakeTimers();
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    for (let i = 0; i < 3; i++) vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB } as never);
    vi.mocked(discardUpload).mockRejectedValueOnce(new ApiError('Upload not found.', 404, null, '/api/changesets/cs1/uploads/j1'));
    upload(tree);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(phase()).toBe('failed');
    expect(error()).toMatch(/^Nothing was applied/);
  });

  it('…y el DELETE no responde: no se sabe si llegó; «unconfirmed»', async () => {
    vi.useFakeTimers();
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    for (let i = 0; i < 3; i++) vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB } as never);
    vi.mocked(discardUpload).mockRejectedValueOnce(TIMEOUT());
    upload(tree);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(phase()).toBe('unconfirmed');
  });

  it('el POST sin respuesta llegó tarde: una relectura lo ve y sigue normal', async () => {
    vi.useFakeTimers();
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB } as never).mockResolvedValueOnce(APPLIED as never);
    upload(tree);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollUploadJob).toHaveBeenCalledTimes(2);
    expect(phase()).toBe('done');
    expect(errToasts()).toEqual([]);
  });

  it('con el POST respondido, «validated» no se relee (solo el que no tuvo respuesta pudo llegar tarde)', async () => {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
    vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB } as never);
    upload(tree);
    await ticks();
    expect(pollUploadJob).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('failed');
    // El servidor lo devolvió a «validated»: no «Upload failed.» a secas.
    expect(error()).toBe("Nothing was applied — the upload didn't start. Validate the workbook and upload it again.");
  });

  it('con respuesta de error del POST no se relee (sigue validado de verdad)', async () => {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(new ApiError('Another upload is being applied to this version; wait for it to finish.', 409, null, '/api/changesets/cs1/uploads/j1/apply'));
    upload(tree);
    await ticks();
    expect(pollUploadJob).not.toHaveBeenCalled();
    expect(phase()).toBe('failed');
  });

  it('el POST sin respuesta y la 1.ª lectura «validated»: desmontar el popup en la pausa no descarta el job (el POST pudo llegar tarde)', async () => {
    vi.useFakeTimers();
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    // Como el servicio real: cada foto pasa por `onTick` antes de volver.
    const read = (job: unknown) => (async (_cs: string, _id: string, opts?: { onTick?: (j: unknown) => void }) => {
      opts?.onTick?.(job);
      return job;
    }) as never;
    vi.mocked(pollUploadJob).mockImplementationOnce(read({ ...JOB })).mockImplementationOnce(read(APPLIED));
    upload(tree);
    await vi.advanceTimersByTimeAsync(0);
    expect(pollUploadJob).toHaveBeenCalledTimes(1);   // en la pausa antes de releer
    unmount();                                        // p. ej. Logical/Physical cierra los popups
    expect(discardUpload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollUploadJob).toHaveBeenCalledTimes(2);   // el POST llegó tarde: la relectura la ve aplicada
  });

  it('el apply terminó «failed»: cerrar el popup descarta ese job', async () => {
    let tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB, status: 'failed', error: 'Nothing was written.' } as never);
    upload(tree);
    await ticks();
    tree = rerender();
    expect(phase()).toBe('failed');
    (button(tree, 'Close').props.onClick as () => void)();
    unmount();
    expect(discardUpload).toHaveBeenCalledWith('cs1', 'j1');
  });

  it('el popup sigue ocupado mientras se refresca el Explorer (el canvas muestra el diagrama previo a la carga) y avisa al terminar', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    let refreshed!: () => void;
    refreshExplorer.mockImplementationOnce(() => new Promise<void>((r) => { refreshed = r; }));
    upload(tree);
    await ticks();
    expect(refreshExplorer).toHaveBeenCalled();
    expect(phase()).toBe('arranging');                // ocupado: Done/ESC no lo cierran
    expect(okToasts()).toEqual([]);
    const shown = [...walk(rerender())].map(textOf).join('\n');
    expect(shown).toContain('Updating the explorer');   // no «Placing the new objects 1 of 0»
    expect(shown).not.toMatch(/Placing the new objects/);
    refreshed();
    await ticks();
    expect(phase()).toBe('done');
    expect(okToasts()).toEqual([expect.stringMatching(/^Uploaded /)]);
  });

  it('un logout durante el refresco del Explorer: el aviso de la carga no pasa a la sesión siguiente', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    let refreshed!: () => void;
    refreshExplorer.mockImplementationOnce(() => new Promise<void>((r) => { refreshed = r; }));
    const shownTo: (string | null)[] = [];
    vi.mocked(props.pushToast).mockImplementation(() => { shownTo.push(auth.user?.username ?? null); });
    upload(tree);
    await ticks();
    expect(refreshExplorer).toHaveBeenCalled();
    auth.user = { username: 'bob' };                  // logout y login durante el refresco
    refreshed();
    await ticks();
    expect(shownTo).toEqual([]);
  });

  it('otra versión abierta durante el refresco: el aviso de la carga la nombra', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    let refreshed!: () => void;
    refreshExplorer.mockImplementationOnce(() => new Promise<void>((r) => { refreshed = r; }));
    upload(tree);
    await ticks();
    session.activeChangesetId = 'cs2';
    refreshed();
    await ticks();
    expect(okToasts()).toEqual([expect.stringMatching(/^Uploaded .* to “v3”$/)]);
  });

  it('POST sin respuesta, popup cerrado en la pausa y las relecturas siguen «validated»: al concluir que no llegó, se descarta el job', async () => {
    vi.useFakeTimers();
    const tree = mountValidated();
    vi.mocked(applyUpload).mockRejectedValueOnce(TIMEOUT());
    const read = (job: unknown) => (async (_cs: string, _id: string, opts?: { onTick?: (j: unknown) => void }) => {
      opts?.onTick?.(job);
      return job;
    }) as never;
    for (let i = 0; i < 3; i++) vi.mocked(pollUploadJob).mockImplementationOnce(read({ ...JOB }));
    upload(tree);
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    expect(discardUpload).not.toHaveBeenCalled();     // en la pausa: el POST pudo llegar tarde
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollUploadJob).toHaveBeenCalledTimes(3);
    expect(discardUpload).toHaveBeenCalledWith('cs1', 'j1', { onlyIfValidated: true });   // no llegó: nada lo aplica después del aviso de falla
    // Con el popup cerrado, el aviso dice que fue la carga (no solo «el servidor no respondió»).
    expect(errToasts()).toEqual([expect.stringMatching(/^The upload to “v3” failed: Nothing was applied — the upload didn't start \(/)]);
  });

  it('«unconfirmed» con la red caída: si el refresco del Explorer falla, se avisa', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockRejectedValueOnce(TIMEOUT());
    refreshExplorer.mockRejectedValueOnce(TIMEOUT());
    upload(tree);
    await ticks();
    expect(phase()).toBe('unconfirmed');
    expect(errToasts()).toEqual(["Couldn't reload the explorer: The server didn't respond within 30s. Use Refresh to try again."]);
  });

  it('también al terminar bien', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockResolvedValueOnce(APPLIED as never);
    refreshExplorer.mockRejectedValueOnce(TIMEOUT());
    upload(tree);
    await ticks();
    expect(phase()).toBe('done');
    expect(errToasts()).toEqual(["Couldn't reload the explorer: The server didn't respond within 30s. Use Refresh to try again."]);
  });

  it('el apply falló a mitad (tandas grabadas): «failed» y se refresca', async () => {
    const tree = mountValidated();
    applying();
    vi.mocked(pollUploadJob).mockResolvedValueOnce({ ...JOB, status: 'failed', error: 'The upload stopped. 3 of 5 batches had already been saved.' } as never);
    upload(tree);
    await ticks();
    expect(phase()).toBe('failed');
    expect(refreshExplorer).toHaveBeenCalled();
  });

  it('con una inversa del Undo en vuelo, la carga no empieza', async () => {
    const tree = mountValidated();
    undoState.busy = true;
    upload(tree);
    await ticks();
    expect(applyUpload).not.toHaveBeenCalled();
    expect(clearUndo).not.toHaveBeenCalled();
    expect(errToasts()).toEqual(['Undo or redo is still running — upload when it finishes.']);
  });

  it('otra versión y de vuelta a la misma (A → B → A): al terminar, se refresca y se vacía su Undo', async () => {
    const tree = mountValidated();
    applying(); const p = pollInFlight();
    upload(tree); await tick();
    unmount();
    pinState.holds = false;
    session.activeChangesetId = 'cs1';
    clearUndo.mockClear();
    p.finish(APPLIED);
    await ticks();
    expect(refreshExplorer).toHaveBeenCalled();
    expect(clearUndo).toHaveBeenCalledWith();   // el clear() final, sin cierre
  });
});

describe('la carga que termina con otra versión abierta, y el arrange por versión', () => {
  const applying = () => vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
  /** Upload; el polling queda en vuelo (se decide en el test). */
  async function inFlight() {
    const tree = mountValidated();
    applying();
    let finish!: (j: unknown) => void;
    vi.mocked(pollUploadJob).mockImplementationOnce(() => new Promise((r) => { finish = r; }) as never);
    upload(tree);
    await tick();
    return (j: unknown) => finish(j);
  }
  const COUNTS = { columns: { create: 12, update: 0, unchanged: 0 } };

  it('termina bien con otra versión abierta: se avisa que terminó, nombrando la versión', async () => {
    const finish = await inFlight();
    unmount();                                         // el TopNav desmonta el popup…
    pinState.holds = false;
    session.activeChangesetId = 'cs2';                // …y se abre otra versión
    finish({ ...APPLIED, result: { affectedCanvasIds: [], counts: COUNTS } });
    await ticks();
    expect(okToasts()).toEqual(['Uploaded 12 columns to “v3”']);
    expect(errToasts()).toEqual([]);
    expect(refreshExplorer).not.toHaveBeenCalled();   // la abierta no se toca
    expect(clearUndo).not.toHaveBeenCalledWith();      // ni su pila de Undo
  });

  it('la versión de la carga abierta en solo lectura: al terminar se refresca su Explorer (sin tocar su Undo) y el aviso la nombra', async () => {
    const finish = await inFlight();
    unmount();
    session.openMode = 'readonly';                    // la misma versión, abierta como visor
    finish({ ...APPLIED, result: { affectedCanvasIds: [], counts: COUNTS } });
    await ticks();
    expect(refreshExplorer).toHaveBeenCalled();
    expect(clearUndo).not.toHaveBeenCalledWith();
    expect(okToasts()).toEqual(['Uploaded 12 columns to “v3”']);
  });

  it('con canvases sin ubicar: un solo aviso (aplicada + lo que no se pudo ubicar)', async () => {
    vi.mocked(placeUploadedObjects).mockResolvedValueOnce({ placed: 0, failed: ['sa9'], skipped: [] });
    const finish = await inFlight();
    unmount();
    pinState.holds = false;
    session.activeChangesetId = 'cs2';
    finish({ ...APPLIED, result: { affectedCanvasIds: ['sa9'], counts: COUNTS } });
    await ticks();
    expect(okToasts()).toEqual([]);
    expect(errToasts()).toHaveLength(1);
    expect(errToasts()[0]).toMatch(/^The upload to “v3” was applied, but the new objects couldn't be placed on 1 canvas/);
  });

  it('tras un logout (otro usuario): nada', async () => {
    const finish = await inFlight();
    unmount();
    pinState.holds = false;
    session.activeChangesetId = 'cs2';
    auth.user = { username: 'beto' };
    finish({ ...APPLIED, result: { affectedCanvasIds: [], counts: COUNTS } });
    await ticks();
    expect(vi.mocked(props.pushToast)).not.toHaveBeenCalled();
  });

  it('termina bien en la misma versión pero con otro usuario (logout y login en el tab): nada', async () => {
    const finish = await inFlight();
    unmount();
    session.activeChangesetId = 'cs1';                // la misma versión, en edición…
    auth.user = { username: 'beto' };                 // …pero de otro usuario
    finish({ ...APPLIED, result: { affectedCanvasIds: [], counts: COUNTS } });
    await ticks();
    expect(vi.mocked(props.pushToast)).not.toHaveBeenCalled();
    expect(refreshExplorer).not.toHaveBeenCalled();
    expect(clearUndo).not.toHaveBeenCalledWith();         // ni su pila de Undo
  });

  it('A → B → A: el arrange sigue la versión; de vuelta en la misma no se salta canvases; con otra abierta, corta', async () => {
    let guard: { pin?: { holds: () => boolean; check: () => void } } = {};
    vi.mocked(placeUploadedObjects).mockImplementationOnce(async (_ids, _m, _f, _p, g) => { guard = g ?? {}; return { placed: 1, failed: [], skipped: [] }; });
    const finish = await inFlight();
    unmount();
    pinState.holds = false;                            // otra época de la sesión…
    session.activeChangesetId = 'cs1';                // …en la misma versión (A → B → A)
    finish({ ...APPLIED, result: { affectedCanvasIds: ['sa1'], counts: COUNTS } });
    await ticks();
    expect(guard.pin?.holds()).toBe(true);
    expect(() => guard.pin?.check()).not.toThrow();
    session.activeChangesetId = 'cs2';                // otra versión: corta antes de escribir en ella
    expect(guard.pin?.holds()).toBe(false);
    expect(() => guard.pin?.check()).toThrow(expect.objectContaining({ name: 'SessionChangedError' }));
    session.activeChangesetId = 'cs1'; session.openMode = 'readonly';   // la misma, en solo lectura: tampoco
    expect(guard.pin?.holds()).toBe(false);
    session.openMode = 'editing'; auth.user = { username: 'beto' };      // otro usuario: tampoco
    expect(guard.pin?.holds()).toBe(false);
  });
});

// Tras la carga no se reacomoda el canvas: se ubica solo lo que entró a cada
// canvas (`newMembers` del backend), centrado en lo que el usuario ve si es el
// canvas abierto, y queda marcado para pintarse encima.
describe('solo lo nuevo, al centro de lo que se ve y encima', () => {
  const MEMBERS = { sa1: ['t1', 'v1'], sa2: ['t2'] };
  const DONE = { ...APPLIED, result: { affectedCanvasIds: ['sa1', 'sa2'], newMembers: MEMBERS, counts: {} } };
  const VIEW = { center: { x: 5, y: 6 }, rect: { left: 0, top: 0, right: 10, bottom: 12 } };

  async function uploadDone(result = DONE) {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
    vi.mocked(pollUploadJob).mockResolvedValueOnce(result as never);
    upload(tree);
    await ticks(6);
  }

  it('pasa `newMembers` y el centro de lo que se ve del canvas abierto (si la carga lo tocó)', async () => {
    Object.assign(mstate, { activeSaId: 'sa1', diagram: { subjectArea: { id: 'sa1' } } });
    vi.mocked(canvasView).mockReturnValueOnce(VIEW);
    await uploadDone();
    const call = vi.mocked(placeUploadedObjects).mock.calls[0];
    expect(call[0]).toEqual(['sa1', 'sa2']);
    expect(call[1]).toEqual(MEMBERS);
    expect(call[2]).toEqual({ saId: 'sa1', point: { x: 5, y: 6 } });
    expect(call[4]).toEqual({ pin: expect.objectContaining({ holds: expect.any(Function), check: expect.any(Function) }) });
    // El refresco reabre el canvas sin selección (el panel de Properties se
    // cierra): el centro se mide como quedará, con el panel cerrado.
    expect(vi.mocked(canvasView).mock.calls[0][1]).toEqual({ panel: 'closes' });
  });

  it('si el canvas abierto no está entre los tocados, no hay foco (cada canvas va al centro de su contenido)', async () => {
    Object.assign(mstate, { activeSaId: 'sa7', diagram: { subjectArea: { id: 'sa7' } } });
    vi.mocked(canvasView).mockReturnValue(VIEW);
    await uploadDone();
    expect(vi.mocked(placeUploadedObjects).mock.calls[0][2]).toBeNull();
    vi.mocked(canvasView).mockReset();
    vi.mocked(canvasView).mockReturnValue(null);
  });

  it('marca lo ubicado para pintarlo encima (menos los canvases que fallaron), antes de refrescar', async () => {
    vi.mocked(placeUploadedObjects).mockResolvedValueOnce({ placed: 1, failed: ['sa2'], skipped: [] });
    const order: string[] = [];
    markFresh.mockImplementationOnce(() => { order.push('fresh'); });
    refreshExplorer.mockImplementationOnce(async () => { order.push('refresh'); });
    await uploadDone();
    expect(markFresh).toHaveBeenCalledWith({ sa1: ['t1', 'v1'] });
    expect(order).toEqual(['fresh', 'refresh']);
  });

  it('el resumen final dice que lo existente no se movió; en los que fallaron, que lo nuevo está debajo', async () => {
    vi.mocked(placeUploadedObjects).mockResolvedValueOnce({ placed: 1, failed: ['sa2'], skipped: [] });
    await uploadDone();
    const shown = [...walk(rerender())].map(textOf).join('\n');
    expect(shown).toContain('New objects placed on 1 canvas — existing blocks were not moved.');
    expect(shown).toContain("Couldn't place the new objects on 1 canvas — they were left below the existing blocks.");
    expect(shown).not.toMatch(/auto-arranged|Autoarrange/);
  });

  it('con otra versión abierta al terminar, no se marca nada en la sesión vigente', async () => {
    const tree = mountValidated();
    vi.mocked(applyUpload).mockResolvedValueOnce({ ...JOB, status: 'applying' } as never);
    let finish!: (j: unknown) => void;
    vi.mocked(pollUploadJob).mockImplementationOnce(() => new Promise((r) => { finish = r; }) as never);
    upload(tree);
    await tick();
    pinState.holds = false;
    session.activeChangesetId = 'cs2';
    finish(DONE);
    await ticks(6);
    expect(markFresh).not.toHaveBeenCalled();
  });
});
