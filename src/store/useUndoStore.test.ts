import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) =>
  (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()));

import { ApiError } from '@/services/http';
import { writeSeqOf } from '@/services/changeset.service';
import { forgetDraftSeqs, noteSeen } from '@/services/draftSeqs';
import { pendingWrite, trackDraftWork } from '@/services/draftWork';
import { pinSession, setCanvasSource, trackRevalidation } from '@/features/modeler/lib/sessionGuard';
import { draftLedger } from './draftLedger.testutil';
import { NothingDoneError, OtherCanvasError, StaleUndoError, freshStep, historyAction, pushUndo, useUndoStore, verifiedLost, whenHistoryIdle, type HistoryStep } from './useUndoStore';
import { useBusyStore } from './useBusyStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const open = (mode: 'editing' | 'readonly', changesetId: string) =>
  useSessionStore.getState().openModel({ projectId: 'p', mode, changesetId });

beforeEach(() => { useUndoStore.getState().clear(); useUndoStore.setState({ busy: false }); forgetDraftSeqs(); });

describe('useUndoStore', () => {
  it('undoLast es LIFO: corre la inversa y devuelve su label', async () => {
    const ran: string[] = [];
    pushUndo('a', async () => { ran.push('a'); return null; });
    pushUndo('b', async () => { ran.push('b'); return null; });
    expect(await useUndoStore.getState().undoLast()).toBe('b');
    expect(ran).toEqual(['b']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['a']);
  });

  it('una inversa corriendo suprime la instrumentación (no apila su propia inversa)', async () => {
    pushUndo('add', async () => {
      // La inversa reusa una acción del store instrumentada: su pushUndo
      // interno no debe entrar a la pila.
      pushUndo('delete (nested)', async () => null);
      return null;
    });
    await useUndoStore.getState().undoLast();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('si la inversa falla, la entrada ya salió de la pila y el error se propaga', async () => {
    pushUndo('boom', async () => { throw new Error('409'); });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('409');
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('la pila se acota a 50 (se descarta lo más antiguo)', () => {
    for (let i = 0; i < 55; i += 1) pushUndo(`e${i}`, async () => null);
    const stack = useUndoStore.getState().stack;
    expect(stack).toHaveLength(50);
    expect(stack[0].label).toBe('e5');
  });

  it('undoLast con pila vacía o con una inversa en vuelo devuelve null', async () => {
    expect(await useUndoStore.getState().undoLast()).toBeNull();
    const slow = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return null; });
    pushUndo('other', async () => null);
    pushUndo('slow', slow);
    const first = useUndoStore.getState().undoLast();              // pop 'slow', queda busy
    expect(await useUndoStore.getState().undoLast()).toBeNull();   // busy → no-op
    await first;
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['other']);
  });
});

// La inversa es de la sesión en que se pidió el Undo. Los servicios toman la
// versión al llamarlos: si mientras corre se abre otra versión (u otro modo),
// lo que falta no se escribe — ni en la nueva ni en ninguna — y no se avisa
// nada engañoso («Undid…» o el error de una sesión que ya no está en pantalla).
describe('Undo atado a la sesión', () => {
  beforeEach(() => { open('editing', 'cs1'); });

  it('la inversa recibe el pin de su sesión: si se abre otra versión, corta y undoLast calla (null)', async () => {
    const wrote: string[] = [];
    pushUndo('Delete table T', async (pin) => {
      wrote.push('bulk');
      await sleep(5);
      pin.check();                     // antes de cada escritura
      wrote.push('canvas');
      return null;
    });
    const undo = useUndoStore.getState().undoLast();
    await sleep(1);                    // la inversa ya empezó
    open('editing', 'cs2');
    await expect(undo).resolves.toBeNull();
    expect(wrote).toEqual(['bulk']);
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('si la sesión cambia antes de que empiece la inversa, no corre nada', async () => {
    const wrote: string[] = [];
    pushUndo('Delete table T', async () => { wrote.push('bulk'); return null; });
    const undo = useUndoStore.getState().undoLast();
    open('editing', 'cs2');
    await expect(undo).resolves.toBeNull();
    expect(wrote).toEqual([]);
  });

  it('si la sesión cambió mientras corría (aunque la inversa terminara), no dice «Undid»: null', async () => {
    pushUndo('Move block', async () => { await sleep(5); return null; });
    const undo = useUndoStore.getState().undoLast();
    open('readonly', 'cs1');
    await expect(undo).resolves.toBeNull();
  });

  it('un 403/404/409 de su versión espera la revalidación: si cambió la sesión, calla (ya avisó ella)', async () => {
    pushUndo('Edit column', async () => {
      trackRevalidation(new Promise<void>((r) => setTimeout(() => { open('readonly', 'cs1'); r(); }, 10)));
      throw new ApiError('Only the owner can edit this version.', 403, null, '/api/changesets/cs1/changes');
    });
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
  });

  it('con la sesión igual el error se propaga, después de la revalidación', async () => {
    let revalidated = false;
    pushUndo('Edit column', async () => {
      trackRevalidation(new Promise<void>((r) => setTimeout(() => { revalidated = true; r(); }, 10)));
      throw new ApiError("You don't have permission for this action (model.edit).", 403, null, '/api/changesets/cs1/changes');
    });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(/permission/);
    expect(revalidated).toBe(true);
  });

  // Sin overlay: sería un flash con fondo difuminado en cada Ctrl+Z (el blur
  // cuesta compositor) y `busy` ya impide dos Undo a la vez. La protección
  // frente al cambio de sesión es el pin: la inversa corta antes de cada
  // escritura si la sesión cambió.
  it('no enciende el overlay bloqueante (sin flash en cada Ctrl+Z)', async () => {
    let during: unknown = 'sin medir';
    pushUndo('Delete table T', async () => { during = useBusyStore.getState().active; return null; });
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table T');
    expect(during).toBeNull();
    expect(useBusyStore.getState().active).toBeNull();
  });

  it('una acción que termina después de cambiar la sesión no deja su inversa en la pila de la nueva', () => {
    const pin = pinSession();          // la acción empieza editando cs1…
    open('editing', 'cs2');            // …y termina con cs2 abierta
    pushUndo('Create table T', async () => null, pin);
    expect(useUndoStore.getState().stack).toEqual([]);
    pushUndo('Create table U', async () => null, pinSession());
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Create table U']);
  });
});

// Una inversa que falla sin haber escrito nada (p. ej. la lectura previa de la
// cascada de «Create table» → borrar la tabla) no se pierde: la entrada vuelve
// a la pila y el aviso pide pulsar Undo otra vez. Si saliera de la pila, otro
// Ctrl+Z deshacería otra acción.
describe('una inversa que falla sin escribir', () => {
  const READ = "Couldn't check what depends on this table";
  const unread = () => new NothingDoneError(READ, `${READ}: nothing was deleted. Try again.`);

  it('la entrada vuelve a la pila y el aviso pide pulsar Undo otra vez', async () => {
    const other = vi.fn(async () => null);
    pushUndo('Rename column X', other);
    pushUndo('Create table T', async () => { throw unread(); });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(`${READ}: nothing was undone. Press Undo to try again.`);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Rename column X', 'Create table T']);
    expect(other).not.toHaveBeenCalled();
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('reintentar deshace esa acción', async () => {
    let fail = true;
    const ran = vi.fn(async () => { if (fail) throw unread(); return null; });
    pushUndo('Rename column X', async () => null);
    pushUndo('Create table T', ran);
    await useUndoStore.getState().undoLast().catch(() => {});
    fail = false;
    expect(await useUndoStore.getState().undoLast()).toBe('Create table T');
    expect(ran).toHaveBeenCalledTimes(2);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Rename column X']);
  });

  it('si en el medio cambió la sesión, no vuelve (la pila es de la sesión nueva) y no avisa', async () => {
    open('editing', 'cs1');
    pushUndo('Create table T', async () => { open('editing', 'cs2'); throw unread(); });
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('un error cualquiera (pudo haber escrito algo) sigue descartando la entrada', async () => {
    pushUndo('Delete table T', async () => { throw new Error('sin red'); });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('sin red');
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

// Una inversa que falla por transporte (timeout, red: status 0) no dice si
// escribió. Las inversas reponen pre-imágenes (upserts, borrados y membresía:
// idempotentes), así que re-correrla converge: la entrada vuelve a la pila. Si
// se descartara, «probar de nuevo» (Ctrl+Z) desharía otra acción.
describe('una inversa que falla por transporte', () => {
  const timeout = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/changesets/cs1/changes/bulk');

  it('vuelve a la pila; el aviso dice qué no se deshizo y que se pulse Undo otra vez', async () => {
    open('editing', 'cs1');
    const ran: string[] = [];
    pushUndo('Rename column A', async () => { ran.push('A'); return null; });
    pushUndo('Delete table T', async () => { ran.push('T'); throw timeout(); });
    await expect(useUndoStore.getState().undoLast())
      .rejects.toThrow("Couldn't undo Delete table T: The server didn't respond within 30s. Press Undo to try again.");
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Rename column A', 'Delete table T']);
    await useUndoStore.getState().undoLast().catch(() => {});
    expect(ran).toEqual(['T', 'T']);                   // reintenta esa, no «Rename column A»
  });

  it('un error del servidor con respuesta (409, 500) sigue descartándola', async () => {
    open('editing', 'cs1');
    pushUndo('Delete table T', async () => { throw new ApiError('Conflict', 409, null, '/api/projects/p/x'); });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Conflict');
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

// Mientras corre una inversa, `push` ignora lo que apila la propia inversa (una
// acción del store reusada). Pero si en el medio cambió la sesión, lo que se
// apila ya es de la nueva: no se descarta.
describe('apilar mientras corre una inversa', () => {
  it('lo apilado por la inversa se ignora; lo de una sesión nueva, no', async () => {
    open('editing', 'cs1');
    let release!: () => void;
    pushUndo('Delete table T', async () => {
      pushUndo('nested (de la inversa)', async () => null, pinSession());
      await new Promise<void>((r) => { release = r; });
      return null;
    });
    const undo = useUndoStore.getState().undoLast();
    await sleep(1);
    expect(useUndoStore.getState().stack).toEqual([]);          // la anidada no entró
    open('editing', 'cs2');                                      // se abre otra versión…
    pushUndo('Rename column B', async () => null, pinSession());   // …y se edita en ella
    release();
    await undo;
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Rename column B']);
  });
});

// Mientras se aplica una carga Excel la pila queda vacía y cerrada: la carga no
// está en ella, y una inversa previa (o una de lo editado con el popup ya
// cerrado) pisaría lo cargado. `clear({ until, pin })`: no apila ni deshace
// hasta que `until` termine, mientras siga esa sesión.
describe('clear con `until`: la pila queda cerrada mientras dura', () => {
  const labels = () => useUndoStore.getState().stack.map((e) => e.label);
  const open: (() => Promise<void>)[] = [];
  const hold = () => {
    let done!: () => void;
    const until = new Promise<void>((r) => { done = r; });
    useUndoStore.getState().clear({ until });
    const release = async () => { done(); await until; await new Promise((r) => setTimeout(r, 0)); };
    open.push(release);
    return release;
  };
  beforeEach(() => { useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' }); });
  // Cada carga termina (el cierre sigue la versión: uno sin terminar cerraría la pila del test siguiente).
  afterEach(async () => { for (const r of open.splice(0)) await r(); });

  it('vacía, no apila mientras dura y después vuelve a apilar', async () => {
    pushUndo('A', async () => null);
    const release = hold();
    expect(labels()).toEqual([]);
    pushUndo('B', async () => null);                 // una edición mientras se aplica
    expect(labels()).toEqual([]);
    await release();
    pushUndo('C', async () => null);
    expect(labels()).toEqual(['C']);
  });

  it('tampoco deshace mientras dura (el atajo con el popup cerrado)', async () => {
    const release = hold();
    const ran = vi.fn(async () => null);
    useUndoStore.setState({ stack: [{ label: 'X', run: ran }] });
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
    expect(ran).not.toHaveBeenCalled();
    await release();
    await expect(useUndoStore.getState().undoLast()).resolves.toBe('X');
  });

  it('en otra sesión no rige (la carga era de la anterior)', () => {
    hold();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    pushUndo('D', async () => null);
    expect(labels()).toEqual(['D']);
  });

  // El cierre sigue la versión, no la época de la sesión: ir a otra y volver a
  // la de la carga (que sigue aplicándose) no la abre, porque apilaría inversas
  // previas a lo cargado.
  it('de vuelta a la misma versión mientras dura: sigue cerrada', () => {
    hold();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
    pushUndo('E', async () => null);
    expect(labels()).toEqual([]);
  });

  // El cierre se lleva por versión, no en una sola ranura: una segunda carga en
  // otra versión no lo reemplaza y, de vuelta en la de la primera (que sigue
  // aplicándose), la pila sigue cerrada.
  it('dos cargas en versiones distintas: cada versión sigue cerrada mientras dure la suya', async () => {
    const first = hold();                                                                    // carga en cs1
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    const second = hold();                                                                   // otra en cs2
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
    pushUndo('G', async () => null);
    expect(labels()).toEqual([]);                        // la de cs1 no terminó
    await second();                                      // termina la de cs2: cs1 sigue cerrada
    pushUndo('H', async () => null);
    expect(labels()).toEqual([]);
    await first();
    pushUndo('I', async () => null);
    expect(labels()).toEqual(['I']);
  });

  it('dos cargas en la misma versión: cerrada hasta que terminen las dos', async () => {
    const first = hold();
    const second = hold();
    await first();
    pushUndo('J', async () => null);
    expect(labels()).toEqual([]);
    await second();
    pushUndo('K', async () => null);
    expect(labels()).toEqual(['K']);
  });

  it('la misma versión en solo lectura no está cerrada (no se edita)', () => {
    hold();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' });
    pushUndo('F', async () => null);
    expect(labels()).toEqual(['F']);
  });

  // Una inversa ya en vuelo al empezar la carga que falla sin escribir (o por
  // transporte) no vuelve a la pila cerrada: re-apilarla con `set` directo se
  // saltaría el cierre.
  it.each([
    ['por transporte (status 0)', () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/x')],
    ['sin escribir nada (NothingDoneError)', () => new NothingDoneError("Couldn't read X", "Couldn't read X: nothing was deleted.")],
  ])('una inversa en vuelo que falla %s no vuelve a la pila cerrada', async (_l, err) => {
    let fail!: (e: unknown) => void;
    useUndoStore.setState({ stack: [{ label: 'Edit column C', run: () => new Promise<HistoryStep | null>((_r, j) => { fail = j; }) }] });
    const undo = useUndoStore.getState().undoLast().catch((e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 0));
    const release = hold();
    fail(err());
    const msg = await undo;
    expect(labels()).toEqual([]);
    expect(msg).not.toMatch(/Press Undo to try again/);   // no se puede reintentar: la pila está cerrada
    await release();
    expect(labels()).toEqual([]);
  });

  it('cerrada también para rehacer, y la carga vacía lo pendiente de rehacer', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    await useUndoStore.getState().undoLast();
    expect(redoLabels()).toEqual(['A']);
    const release = hold();
    expect(redoLabels()).toEqual([]);
    useUndoStore.setState({ redoStack: [{ label: 'X', run: pair('X', log) }] });
    await expect(useUndoStore.getState().redoLast()).resolves.toBeNull();
    expect(log).toEqual(['undo A']);
    await release();
  });
});

// ── Redo ────────────────────────────────────────────────────────────────────
// Cada paso devuelve su contrario: deshacer deja el de rehacer, rehacer deja el
// de volver a deshacer. Solo se rehace sobre la versión tal como la dejó el
// Undo: sus escrituras (números consecutivos del contador `writeSeq`, avisados
// por `onDraftWrite`) fijan la base, y antes de escribir el Redo verifica que el
// contador de la versión siga ahí.

const CS = 'cs1';
/** Par deshacer ↔ rehacer: cada uno graba `writes` veces en la versión, anota
 *  qué corrió y devuelve al otro. */
function pair(label: string, log: string[], writes = 1): HistoryStep {
  const grab = () => { for (let i = 0; i < writes; i += 1) draftLedger.write(CS); };
  const undo: HistoryStep = async () => { grab(); log.push(`undo ${label}`); return redo; };
  const redo: HistoryStep = async () => { grab(); log.push(`redo ${label}`); return undo; };
  return undo;
}
const labels = () => useUndoStore.getState().stack.map((e) => e.label);
const redoLabels = () => useUndoStore.getState().redoStack.map((e) => e.label);

describe('Redo', () => {
  beforeEach(() => { open('editing', CS); vi.mocked(writeSeqOf).mockClear(); });

  it('deshacer deja la acción para rehacer; rehacer la devuelve a Undo con el mismo label', async () => {
    const log: string[] = [];
    pushUndo('Create table T', pair('T', log));
    expect(await useUndoStore.getState().undoLast()).toBe('Create table T');
    expect([labels(), redoLabels()]).toEqual([[], ['Create table T']]);
    expect(await useUndoStore.getState().redoLast()).toBe('Create table T');
    expect([labels(), redoLabels()]).toEqual([['Create table T'], []]);
    expect(await useUndoStore.getState().undoLast()).toBe('Create table T');
    expect(log).toEqual(['undo T', 'redo T', 'undo T']);
    expect(writeSeqOf).toHaveBeenCalledWith(CS);
  });

  it('rehace en orden inverso a lo deshecho, varias seguidas', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log, 2));
    pushUndo('B', pair('B', log, 3));
    await useUndoStore.getState().undoLast();
    await useUndoStore.getState().undoLast();
    expect(redoLabels()).toEqual(['B', 'A']);
    expect(await useUndoStore.getState().redoLast()).toBe('A');
    expect(await useUndoStore.getState().redoLast()).toBe('B');
    expect(log).toEqual(['undo B', 'undo A', 'redo A', 'redo B']);
    expect([labels(), redoLabels()]).toEqual([['A', 'B'], []]);
  });

  it('deshacer después de rehacer conserva lo que quedaba por rehacer', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    pushUndo('B', pair('B', log));
    await useUndoStore.getState().undoLast();          // B
    await useUndoStore.getState().undoLast();          // A
    await useUndoStore.getState().redoLast();          // A
    await useUndoStore.getState().undoLast();          // A otra vez
    expect(redoLabels()).toEqual(['B', 'A']);
    await useUndoStore.getState().redoLast();
    await useUndoStore.getState().redoLast();
    expect(log).toEqual(['undo B', 'undo A', 'redo A', 'undo A', 'redo A', 'redo B']);
  });

  it('una acción nueva vacía lo que había para rehacer', async () => {
    pushUndo('A', pair('A', []));
    await useUndoStore.getState().undoLast();
    pushUndo('B', async () => null, pinSession());
    expect(redoLabels()).toEqual([]);
  });

  it('una escritura de esta pestaña en la versión fuera de un Undo/Redo lo vacía; una en otra versión, no', async () => {
    pushUndo('A', pair('A', []));
    await useUndoStore.getState().undoLast();
    draftLedger.write('otra-version');
    expect(redoLabels()).toEqual(['A']);
    draftLedger.write(CS);
    expect(redoLabels()).toEqual([]);
  });

  it('si la versión cambió desde el Undo, no corre el paso: avisa y vacía lo pendiente', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    pushUndo('B', pair('B', log));
    await useUndoStore.getState().undoLast();
    await useUndoStore.getState().undoLast();
    draftLedger.foreign();                             // otra pestaña, un esquema, una carga
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    expect(log).toEqual(['undo B', 'undo A']);
    expect([labels(), redoLabels()]).toEqual([[], []]);
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('si no se puede leer el contador, no rehace y la entrada vuelve para reintentar', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    await useUndoStore.getState().undoLast();
    vi.mocked(writeSeqOf).mockRejectedValueOnce(new ApiError('Bad gateway', 502, null, '/api/changesets/cs1/seq'));
    await expect(useUndoStore.getState().redoLast())
      .rejects.toThrow("Couldn't check the version: nothing was redone. Press Redo to try again.");
    expect(redoLabels()).toEqual(['A']);
    expect(await useUndoStore.getState().redoLast()).toBe('A');
    expect(log).toEqual(['undo A', 'redo A']);
  });

  it('un Undo con un hueco en sus escrituras (algo ajeno escribió en el medio) no deja Redo', async () => {
    pushUndo('A', async () => { draftLedger.write(CS); draftLedger.foreign(); draftLedger.write(CS); return pair('A', []); });
    await useUndoStore.getState().undoLast();
    expect(redoLabels()).toEqual([]);
  });

  it('un Undo sin escrituras, o con una sin número (falló sin respuesta), no deja Redo', async () => {
    pushUndo('A', async () => pair('A', []));
    await useUndoStore.getState().undoLast();
    expect(redoLabels()).toEqual([]);
    pushUndo('B', async () => { draftLedger.write(CS); draftLedger.lost(CS); return pair('B', []); });
    await useUndoStore.getState().undoLast();
    expect(redoLabels()).toEqual([]);
  });

  // Con el candado del Undo (doc 133), lo único que puede quedar entre dos Undo
  // sin vaciar el historial es una escritura propia sin respuesta: la de un paso
  // que falló por red y se reintenta.
  it('un Undo cuya primera escritura no sigue a la base descarta lo que había para rehacer', async () => {
    let fail = true;
    pushUndo('A', async () => {
      if (fail) { draftLedger.lost(CS); draftLedger.foreign(); throw new ApiError('Network error', 0, null, '/api/x'); }
      draftLedger.write(CS);
      return pair('A', []);
    });
    pushUndo('B', pair('B', []));
    await useUndoStore.getState().undoLast();          // B: base = su última escritura
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');   // A se grabó sin respuesta
    fail = false;
    await useUndoStore.getState().undoLast();          // A otra vez: empieza después de esa escritura
    expect(redoLabels()).toEqual(['A']);
  });

  it('una acción que termina mientras corre un Undo cancela su Redo', async () => {
    let release!: () => void;
    pushUndo('A', async () => {
      draftLedger.write(CS);
      await new Promise<void>((r) => { release = r; });
      return pair('A', []);
    });
    const undo = useUndoStore.getState().undoLast();
    await sleep(1);
    pushUndo('X', async () => null, pinSession());
    release();
    await undo;
    expect([labels(), redoLabels()]).toEqual([[], []]);
  });

  it('un paso que devuelve null corta la cadena de rehacer', async () => {
    pushUndo('A', pair('A', []));
    pushUndo('B', async () => { draftLedger.write(CS); return null; });
    pushUndo('C', pair('C', []));
    await useUndoStore.getState().undoLast();          // C
    expect(redoLabels()).toEqual(['C']);
    await useUndoStore.getState().undoLast();          // B: sin contrario
    expect(redoLabels()).toEqual([]);
  });

  it('un Undo que falla habiendo podido escribir vacía lo que había para rehacer', async () => {
    pushUndo('A', async () => { throw new Error('500'); });
    pushUndo('B', pair('B', []));
    await useUndoStore.getState().undoLast();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('500');
    expect(redoLabels()).toEqual([]);
  });

  it('mientras corre un Undo, Redo devuelve null; mientras corre un Redo, Undo también', async () => {
    let release!: () => void;
    pushUndo('A', pair('A', []));
    pushUndo('B', async () => { draftLedger.write(CS); await new Promise<void>((r) => { release = r; }); return pair('B', []); });
    const running = useUndoStore.getState().undoLast();
    await sleep(1);
    await expect(useUndoStore.getState().redoLast()).resolves.toBeNull();
    release();
    await running;
    let go!: () => void;
    useUndoStore.setState({ redoStack: [{ label: 'R', run: async () => { await new Promise<void>((r) => { go = r; }); return null; } }] });
    const redo = useUndoStore.getState().redoLast();
    await sleep(1);
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
    go();
    await redo;
  });

  it('si la sesión cambia mientras corre un Redo, corta antes de la escritura siguiente y no avisa', async () => {
    const wrote: string[] = [];
    pushUndo('A', async () => {
      draftLedger.write(CS);
      return async (redo) => { wrote.push('uno'); await sleep(5); redo.check(); wrote.push('dos'); return null; };
    });
    await useUndoStore.getState().undoLast();
    const redo = useUndoStore.getState().redoLast();
    await sleep(1);
    open('editing', 'cs2');
    await expect(redo).resolves.toBeNull();
    expect(wrote).toEqual(['uno']);
    expect([labels(), redoLabels()]).toEqual([[], []]);
  });

  it('un Redo que falla sin escribir o por transporte vuelve a su pila; otro error lo descarta y vacía el resto', async () => {
    const back = (fail: () => unknown): HistoryStep => async () => { draftLedger.write(CS); return async () => { throw fail(); }; };
    pushUndo('Other', pair('Other', []));
    pushUndo('A', back(() => new NothingDoneError("Couldn't read A", "Couldn't read A: nothing was deleted.")));
    await useUndoStore.getState().undoLast();          // A
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("Couldn't read A: nothing was redone. Press Redo to try again.");
    expect(redoLabels()).toEqual(['A']);

    useUndoStore.getState().clear();
    pushUndo('Other', pair('Other', []));
    pushUndo('T', back(() => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/x')));
    await useUndoStore.getState().undoLast();
    await expect(useUndoStore.getState().redoLast())
      .rejects.toThrow("Couldn't redo T: The server didn't respond within 30s. Press Redo to try again.");
    expect(redoLabels()).toEqual(['T']);

    useUndoStore.getState().clear();
    pushUndo('Other', pair('Other', []));
    pushUndo('E', back(() => new Error('500')));
    await useUndoStore.getState().undoLast();          // E
    await useUndoStore.getState().undoLast();          // Other: queda debajo de E
    expect(redoLabels()).toEqual(['E', 'Other']);
    await useUndoStore.getState().redoLast();          // Other
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow('500');
    expect(redoLabels()).toEqual([]);
  });

  it('clear vacía las dos pilas', async () => {
    pushUndo('A', pair('A', []));
    pushUndo('B', pair('B', []));
    await useUndoStore.getState().undoLast();
    useUndoStore.getState().clear();
    expect([labels(), redoLabels()]).toEqual([[], []]);
  });

  it('dropRedo vacía solo lo pendiente de rehacer', async () => {
    pushUndo('A', pair('A', []));
    pushUndo('B', pair('B', []));
    await useUndoStore.getState().undoLast();
    useUndoStore.getState().dropRedo();
    expect([labels(), redoLabels()]).toEqual([['A'], []]);
  });

  // Un Redo que falló por transporte después de escribir parte: lo escrito es
  // suyo (números consecutivos desde la base), así que reintentar converge y el
  // candado lo deja pasar.
  it('falla por transporte tras escribir parte (números conocidos): la base avanza y el reintento rehace', async () => {
    const timeout = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/x');
    let fail = true;
    const log: string[] = [];
    pushUndo('A', async () => {
      draftLedger.write(CS);
      return async () => { draftLedger.write(CS); log.push('redo'); if (fail) throw timeout(); return null; };
    });
    await useUndoStore.getState().undoLast();
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow('Press Redo to try again.');
    fail = false;
    expect(await useUndoStore.getState().redoLast()).toBe('A');
    expect(log).toEqual(['redo', 'redo']);
  });

  it('falla por transporte con una escritura de resultado desconocido: no promete reintento y vacía lo pendiente', async () => {
    pushUndo('C', pair('C', []));
    pushUndo('A', async () => {
      draftLedger.write(CS);
      return async () => { draftLedger.lost(CS); throw new ApiError('Network error', 0, null, '/api/x'); };
    });
    pushUndo('B', pair('B', []));
    await useUndoStore.getState().undoLast();          // B: queda para rehacer después de A
    await useUndoStore.getState().undoLast();          // A
    await useUndoStore.getState().undoLast();          // C
    await useUndoStore.getState().redoLast();          // C
    const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
    expect(err).toMatch(/^Couldn't redo A: /);
    expect(err).not.toMatch(/try again/);
    expect(redoLabels()).toEqual([]);                  // B dependía de A
  });

  it('un Redo que falla sin escribir mientras otra acción cambió la versión no vuelve a la pila', async () => {
    pushUndo('A', async () => {
      draftLedger.write(CS);
      return async () => {
        pushUndo('X', async () => null, pinSession());   // otra acción termina mientras corre
        throw new NothingDoneError("Couldn't read A", "Couldn't read A: nothing was deleted.");
      };
    });
    await useUndoStore.getState().undoLast();
    const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
    expect(err).toBe("Couldn't read A: nothing was redone.");
    expect(redoLabels()).toEqual([]);
  });

  it('un Redo que falla por transporte después de que otra acción cambió la versión no promete reintento', async () => {
    pushUndo('A', async () => {
      draftLedger.write(CS);
      return async () => {
        draftLedger.write(CS);
        pushUndo('X', async () => null, pinSession());   // otra acción termina mientras corre
        throw new ApiError('Network error', 0, null, '/api/x');
      };
    });
    await useUndoStore.getState().undoLast();
    const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
    expect(err).toMatch(/^Couldn't redo A: /);
    expect(err).not.toMatch(/try again/);
    expect(redoLabels()).toEqual([]);
  });

  it('una acción que termina mientras el Redo lee el contador queda en Undo y el Redo no corre', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    await useUndoStore.getState().undoLast();
    vi.mocked(writeSeqOf).mockImplementationOnce(async () => {
      pushUndo('B', async () => null, pinSession());
      return { writeSeq: draftLedger.seq };
    });
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    expect(labels()).toEqual(['B']);
    expect(log).toEqual(['undo A']);
  });

  it('falla por transporte con una escritura ajena antes de las suyas: no promete reintento', async () => {
    pushUndo('A', async () => {
      draftLedger.write(CS);
      return async () => { draftLedger.foreign(); draftLedger.write(CS); throw new ApiError('Network error', 0, null, '/api/x'); };
    });
    await useUndoStore.getState().undoLast();
    const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
    expect(err).toMatch(/^Couldn't redo A: /);
    expect(err).not.toMatch(/try again/);
    expect(redoLabels()).toEqual([]);
  });

  // Lo que esta pestaña ya mandó a escribir antes de pulsar Undo o Redo (soltar
  // un bloque, un guardado de Properties) no es del paso: se espera a que
  // termine, su aviso llega fuera del paso y cancela lo pendiente de rehacer.
  it('una escritura propia en vuelo al pulsar Redo lo cancela: el paso no corre', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    await useUndoStore.getState().undoLast();
    const inFlight = trackDraftWork((async () => { await sleep(20); draftLedger.write(CS); })());
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    await inFlight;
    expect(log).toEqual(['undo A']);
    expect(redoLabels()).toEqual([]);
  });

  it('una escritura propia en vuelo al pulsar Undo no queda como parte de él (no deja Redo viejo)', async () => {
    pushUndo('B', async () => { await sleep(40); draftLedger.write(CS); return pair('B', []); });
    pushUndo('C', pair('C', []));
    await useUndoStore.getState().undoLast();          // C → Redo [C]
    expect(redoLabels()).toEqual(['C']);
    const inFlight = trackDraftWork((async () => { await sleep(20); draftLedger.write(CS); })());
    await useUndoStore.getState().undoLast();          // B escribe después de la escritura en vuelo
    await inFlight;
    expect(redoLabels()).toEqual(['B']);
  });

  it('Undo pulsado con una acción en vuelo espera a que termine y deshace esa acción', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log));
    const action = trackDraftWork((async () => { await sleep(20); draftLedger.write(CS); })())
      .then(() => pushUndo('B', pair('B', log), pinSession()));
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    await action;
    expect(log).toEqual(['undo B']);
    expect([labels(), redoLabels()]).toEqual([['A'], ['B']]);
  });

  it('si la lectura del contador falla después de que la versión cambió, no re-apila una entrada que ya no vale', async () => {
    pushUndo('A', pair('A', []));
    await useUndoStore.getState().undoLast();
    vi.mocked(writeSeqOf).mockImplementationOnce(async () => { draftLedger.write(CS); throw new ApiError('Bad gateway', 502, null, '/api/x'); });
    const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
    expect(err).not.toMatch(/try again/);
    expect(redoLabels()).toEqual([]);
  });

  // Pasos frescos (arman su contrario con lo que leen o escriben al correr): tras
  // escribir parte, re-correrlos parte de un estado a medias y su contrario sale
  // incompleto.
  describe('pasos frescos que fallan después de escribir', () => {
    const timeout = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/x');

    it('un Redo fresco no se reintenta: aviso sin «try again» y no queda qué rehacer', async () => {
      pushUndo('A', async () => {
        draftLedger.write(CS);
        return freshStep(async () => { draftLedger.write(CS); throw timeout(); });
      });
      await useUndoStore.getState().undoLast();
      const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
      expect(err).toMatch(/^Couldn't redo A: /);
      expect(err).not.toMatch(/try again/);
      expect(redoLabels()).toEqual([]);
    });

    it('un Redo fresco que falla sin haber escrito sí se reintenta', async () => {
      let fail = true;
      pushUndo('A', async () => {
        draftLedger.write(CS);
        return freshStep(async () => { if (fail) throw timeout(); draftLedger.write(CS); return null; });
      });
      await useUndoStore.getState().undoLast();
      await expect(useUndoStore.getState().redoLast()).rejects.toThrow('Press Redo to try again.');
      fail = false;
      expect(await useUndoStore.getState().redoLast()).toBe('A');
    });

    it('un Undo fresco reintentado después de escribir parte no deja Redo', async () => {
      let fail = true;
      pushUndo('A', freshStep(async () => { draftLedger.write(CS); if (fail) throw timeout(); return pair('A', []); }));
      await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
      fail = false;
      expect(await useUndoStore.getState().undoLast()).toBe('A');
      expect(redoLabels()).toEqual([]);
    });

    it('un Undo fresco que falla sin haber escrito, reintentado, sí deja Redo', async () => {
      let fail = true;
      pushUndo('A', freshStep(async () => { if (fail) throw timeout(); draftLedger.write(CS); return pair('A', []); }));
      await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
      fail = false;
      expect(await useUndoStore.getState().undoLast()).toBe('A');
      expect(redoLabels()).toEqual(['A']);
    });

    it('un Undo por valor reintentado después de escribir parte sí deja Redo', async () => {
      let fail = true;
      pushUndo('A', async () => { draftLedger.write(CS); if (fail) throw timeout(); return pair('A', []); });
      await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
      fail = false;
      expect(await useUndoStore.getState().undoLast()).toBe('A');
      expect(redoLabels()).toEqual(['A']);
    });
  });
});

// ── Candado del Undo (doc 133) ──────────────────────────────────────────────
// Solo el dueño escribe en su versión: un número del contador que no es de esta
// pestaña es de otra pestaña o equipo suyo. Una acción recuerda lo visto de su
// versión al empezar (su pin); si después alguien más escribió, deshacerla
// podría pisar eso: no se deshace y el historial se vacía.
describe('candado del Undo', () => {
  const FOREIGN = "This version changed in another tab or window: the undo history was cleared so it doesn't overwrite those changes.";
  const UNCONFIRMED = 'One of your saves got no response, so the undo history was cleared to avoid overwriting anything.';
  beforeEach(() => { open('editing', CS); vi.mocked(writeSeqOf).mockClear(); });

  /** Una acción con su pin: graba una vez y apila su inversa. */
  const act = (label: string, log: string[]) => {
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo(label, pair(label, log), pin);
  };

  it('deshace si todo lo escrito desde que empezó la acción es de esta pestaña', async () => {
    const log: string[] = [];
    act('A', log);
    draftLedger.write(CS);                       // mover un bloque: escritura propia
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(writeSeqOf).toHaveBeenCalledWith(CS);
    expect(log).toEqual(['undo A']);
  });

  it('si otra pestaña escribió después: no corre el paso, vacía Undo y Redo y lo dice', async () => {
    const log: string[] = [];
    act('A', log);
    act('B', log);
    act('C', log);
    await useUndoStore.getState().undoLast();    // C queda para rehacer
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    expect(log).toEqual(['undo C']);
    expect([labels(), redoLabels()]).toEqual([[], []]);
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('una escritura ajena que esta pestaña ya había visto al empezar la acción no la bloquea', async () => {
    draftLedger.foreign();
    noteSeen(CS, draftLedger.seq);               // la recarga del canvas la trajo
    act('A', []);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  it('una ajena que no había visto al empezar sí la bloquea (no se sabe si fue antes o después)', async () => {
    noteSeen(CS, draftLedger.seq);               // lo que trajo la última carga
    draftLedger.foreign();
    act('A', []);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
  });

  it('sin nada visto al empezar, cuenta desde lo primero que vio la sesión (la ajena anterior no bloquea)', async () => {
    draftLedger.foreign();
    act('A', []);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  it('si no se puede leer el contador, no deshace nada y la acción queda para reintentar', async () => {
    const log: string[] = [];
    act('A', log);
    vi.mocked(writeSeqOf).mockRejectedValueOnce(new ApiError('Bad gateway', 502, null, '/api/changesets/cs1/seq'));
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow("Couldn't check the version: nothing was undone. Press Undo to try again.");
    expect([labels(), log, useUndoStore.getState().busy]).toEqual([['A'], [], false]);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  it('si la sesión cambia mientras lee el contador, no corre nada y calla', async () => {
    const log: string[] = [];
    act('A', log);
    vi.mocked(writeSeqOf).mockImplementationOnce(async () => { open('editing', 'cs2'); return { writeSeq: draftLedger.seq }; });
    expect(await useUndoStore.getState().undoLast()).toBeNull();
    expect(log).toEqual([]);
  });

  it('lee el contador después de esperar lo que estaba en vuelo: una escritura ajena durante la espera también cuenta', async () => {
    noteSeen(CS, draftLedger.seq);
    act('A', []);
    trackDraftWork((async () => { await sleep(10); draftLedger.foreign(); draftLedger.write(CS); })());
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
  });

  it('si mientras lee el contador termina otra acción, lo vuelve a leer para ella', async () => {
    noteSeen(CS, draftLedger.seq);
    act('A', []);
    vi.mocked(writeSeqOf).mockImplementationOnce(async () => {
      const seq = draftLedger.seq;
      act('B', []);                              // empieza y termina mientras se lee
      draftLedger.foreign();                     // y otra pestaña escribe después
      return { writeSeq: seq };
    });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    expect(writeSeqOf).toHaveBeenCalledTimes(2);
  });

  it('lo que estaba en vuelo cuenta como propio', async () => {
    act('A', []);
    trackDraftWork((async () => { await sleep(10); draftLedger.write(CS); })());
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  it('el reintento de un Undo que falló sin respuesta no se bloquea por sus propias escrituras sin número', async () => {
    let fail = true;
    const log: string[] = [];
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo('A', async () => {
      draftLedger.write(CS);
      if (fail) {
        draftLedger.lost(CS);                    // se grabó, pero no llegó la respuesta
        draftLedger.foreign();
        throw new ApiError('Network error', 0, null, '/api/x');
      }
      log.push('undo A');
      return null;
    }, pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    fail = false;
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(log).toEqual(['undo A']);
  });

  it('pero si además escribió otra pestaña, el reintento no corre', async () => {
    let fail = true;
    const log: string[] = [];
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo('A', async () => {
      if (fail) { draftLedger.lost(CS); draftLedger.foreign(); throw new ApiError('Network error', 0, null, '/api/x'); }
      log.push('undo A');
      return null;
    }, pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    fail = false;
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    expect([labels(), log]).toEqual([[], []]);
  });

  it('un guardado propio sin respuesta que sí se grabó: el siguiente Undo vacía el historial y lo dice', async () => {
    act('A', []);
    draftLedger.lost(CS);
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(UNCONFIRMED);
    expect(labels()).toEqual([]);
  });

  it('una acción cuyo lote quedó sin respuesta y se verificó grabado: su Undo admite ese número sin dueño', async () => {
    const log: string[] = [];
    noteSeen(CS, draftLedger.seq);
    const pin = pinSession();
    draftLedger.lost(CS);                        // el lote se grabó, pero no llegó la respuesta
    draftLedger.foreign();
    pushUndo('A', verifiedLost(pair('A', log), 1), pin);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(log).toEqual(['undo A']);
  });

  it('el margen es exacto: un número sin dueño más (otra pestaña) sigue bloqueando', async () => {
    noteSeen(CS, draftLedger.seq);
    const pin = pinSession();
    draftLedger.lost(CS);
    draftLedger.foreign();
    pushUndo('A', verifiedLost(pair('A', []), 1), pin);
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    expect(labels()).toEqual([]);
  });

  it('lo que un Redo con su lote verificado devuelve a Undo admite ese número', async () => {
    const log: string[] = [];
    const redo: HistoryStep = async () => {
      draftLedger.lost(CS);                      // se grabó, sin respuesta; el paso lo verificó
      draftLedger.foreign();
      log.push('redo A');
      return verifiedLost(pair('A', log), 1);
    };
    noteSeen(CS, draftLedger.seq);
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo('A', async () => { draftLedger.write(CS); log.push('undo A'); return redo; }, pin);
    await useUndoStore.getState().undoLast();
    expect(await useUndoStore.getState().redoLast()).toBe('A');
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(log).toEqual(['undo A', 'redo A', 'undo A']);
  });

  it('el margen se consume al apilar: el mismo paso, devuelto otra vez por un Redo, ya no lo admite', async () => {
    noteSeen(CS, draftLedger.seq);
    const log: string[] = [];
    const undoStep: HistoryStep = async () => { draftLedger.write(CS); log.push('undo'); return redoStep; };
    const redoStep: HistoryStep = async () => { draftLedger.write(CS); log.push('redo'); return undoStep; };
    const pin = pinSession();
    draftLedger.lost(CS);                        // el lote de la acción, sin respuesta y verificado
    draftLedger.foreign();
    pushUndo('A', verifiedLost(undoStep, 1), pin);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    noteSeen(CS, draftLedger.seq);               // la recarga del paso
    expect(await useUndoStore.getState().redoLast()).toBe('A');   // vuelve a Undo el mismo paso
    draftLedger.foreign();                       // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    expect(log).toEqual(['undo', 'redo']);
  });

  it('un paso marcado que va a Redo no lleva el margen cuando vuelve a Undo', async () => {
    noteSeen(CS, draftLedger.seq);
    const same: HistoryStep = async () => { draftLedger.write(CS); return same; };   // su propio contrario
    pushUndo('A', async () => { draftLedger.write(CS); return verifiedLost(same, 1); }, pinSession());
    await useUndoStore.getState().undoLast();    // `same` queda para rehacer
    noteSeen(CS, draftLedger.seq);
    expect(await useUndoStore.getState().redoLast()).toBe('A');   // y vuelve a Undo
    draftLedger.foreign();                       // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
  });

  it('el margen de un paso que no llega a apilarse no queda para después', async () => {
    noteSeen(CS, draftLedger.seq);
    const step: HistoryStep = async () => null;
    pushUndo('A', verifiedLost(step, 1), { holds: () => false, check: () => undefined } as never);   // otra sesión: no apila
    const pin = pinSession();
    draftLedger.foreign();                       // otra pestaña, después de que empezó la acción nueva
    pushUndo('B', step, pin);                    // el mismo paso, en una acción sin escrituras perdidas
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
  });

  it('una acción que empezó sin nada visto ni conocido de la versión: su margen no vale (no se sabe dónde cayó lo suyo)', async () => {
    const log: string[] = [];
    const pin = pinSession();                    // nada cargado ni escrito con número en la sesión
    draftLedger.lost(CS);                        // su lote: sin respuesta…
    draftLedger.foreign();                       // …pero grabado
    pushUndo('A', verifiedLost(pair('A', log), 1), pin);
    draftLedger.foreign();                       // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(UNCONFIRMED);
    expect(log).toEqual([]);
  });

  it('… tampoco si después se abre un canvas (lo visto queda después de lo suyo)', async () => {
    const pin = pinSession();
    draftLedger.lost(CS);
    draftLedger.foreign();
    pushUndo('A', verifiedLost(pair('A', []), 1), pin);
    noteSeen(CS, draftLedger.seq);               // se abre un canvas
    draftLedger.foreign();                       // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
  });

  it('sin nada visto pero con una escritura propia con número antes: el margen vale desde ella', async () => {
    const log: string[] = [];
    draftLedger.write(CS);                       // lo primero que conoce la sesión
    const pin = pinSession();
    draftLedger.lost(CS);
    draftLedger.foreign();
    pushUndo('A', verifiedLost(pair('A', log), 1), pin);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(log).toEqual(['undo A']);
  });

  it('sin nada visto ni conocido, una entrada sin margen no se frena por guardados ajenos sin respuesta que no llegaron', async () => {
    const log: string[] = [];
    draftLedger.lost(CS);                        // un guardado anterior que venció y no llegó
    act('A', log);                               // su escritura tiene número
    draftLedger.lost(CS);                        // otro posterior, tampoco llegó
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(log).toEqual(['undo A']);
  });

  it('una acción sin nada visto y sin escrituras sin respuesta se deshace como antes', async () => {
    const log: string[] = [];
    act('A', log);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    act('B', log);
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
  });

  it('el margen de la acción no se suma al de un reintento: este parte del contador ya verificado', async () => {
    let fail = true;
    noteSeen(CS, draftLedger.seq);
    const pin = pinSession();
    draftLedger.lost(CS);
    draftLedger.foreign();
    pushUndo('A', verifiedLost(async () => {
      if (fail) { draftLedger.foreign(); throw new ApiError('Network error', 0, null, '/api/x'); }   // no escribió nada suyo
      return null;
    }, 1), pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    fail = false;
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
  });

  it('el paso que un Redo devuelve a Undo vale desde ese Redo', async () => {
    const log: string[] = [];
    act('A', log);
    await useUndoStore.getState().undoLast();
    await useUndoStore.getState().redoLast();
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    await useUndoStore.getState().redoLast();
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    expect(log).toEqual(['undo A', 'redo A', 'undo A', 'redo A']);
  });

  it('una escritura ajena durante la acción (antes de que apile) también la bloquea', async () => {
    noteSeen(CS, draftLedger.seq);               // lo que trajo la carga del canvas
    const pin = pinSession();
    draftLedger.foreign();                       // otra pestaña escribe mientras la acción corre
    draftLedger.write(CS);
    pushUndo('A', pair('A', []), pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
  });

  it('lo que un Redo devuelve a Undo vale desde ese Redo: una ajena anterior ya vista no lo bloquea', async () => {
    noteSeen(CS, draftLedger.seq);
    draftLedger.foreign();
    noteSeen(CS, draftLedger.seq);               // la recarga la trajo antes de la acción
    act('A', []);
    await useUndoStore.getState().undoLast();
    await useUndoStore.getState().redoLast();
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  // «Visto» es lo que trajo una carga del diagrama (sus datos están en pantalla):
  // leer el contador no recarga nada, así que no cuenta.
  it('leer el contador no da por vistos los datos de otra pestaña; una carga del diagrama sí', async () => {
    noteSeen(CS, draftLedger.seq);
    act('A', []);
    await useUndoStore.getState().undoLast();
    draftLedger.foreign();
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    act('B', []);                                // el diagrama sigue sin lo de la otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(FOREIGN);
    noteSeen(CS, draftLedger.seq);               // la recarga del canvas lo trae
    act('C', []);
    expect(await useUndoStore.getState().undoLast()).toBe('C');
  });

  it('el rechazo es un StaleUndoError (quien lo muestra recarga el diagrama)', async () => {
    noteSeen(CS, draftLedger.seq);
    act('A', []);
    draftLedger.foreign();
    const err = await useUndoStore.getState().undoLast().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleUndoError);
  });

  it('el margen de un reintento se usa una sola vez', async () => {
    let attempt = 0;
    const log: string[] = [];
    noteSeen(CS, draftLedger.seq);
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo('A', async () => {
      attempt += 1;
      if (attempt === 1) { draftLedger.lost(CS); throw new ApiError('Network error', 0, null, '/api/x'); }   // no llegó
      if (attempt === 2) throw new NothingDoneError("Couldn't read A", "Couldn't read A: nothing was deleted.");
      log.push('undo A');
      return null;
    }, pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    draftLedger.foreign();                       // otra pestaña
    // Un número sin dueño y una escritura propia sin respuesta: no se sabe de
    // quién es, y el margen ya se usó: no se deshace.
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(UNCONFIRMED);
    expect(log).toEqual([]);
  });

  it('lo que un reintento admitió sin dueño no vale para lo de más abajo', async () => {
    noteSeen(CS, draftLedger.seq);
    act('A', []);
    let fail = true;
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo('B', async () => {
      if (fail) { draftLedger.lost(CS); draftLedger.foreign(); throw new ApiError('Network error', 0, null, '/api/x'); }
      draftLedger.write(CS);
      return null;
    }, pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    fail = false;
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(UNCONFIRMED);
  });

  it('un Redo que termina después de un clear() durante su paso no vuelve a Undo', async () => {
    act('A', []);
    await useUndoStore.getState().undoLast();
    useUndoStore.setState({ redoStack: [{ label: 'A', run: async () => { draftLedger.write(CS); useUndoStore.getState().clear(); return async () => null; } }] });
    await useUndoStore.getState().redoLast();
    expect([labels(), redoLabels()]).toEqual([[], []]);
  });

  it('si el historial se vació mientras corría (p. ej. el Schema manager), la entrada que falla no vuelve', async () => {
    act('A', []);
    pushUndo('B', async () => { await sleep(5); useUndoStore.getState().clear(); throw new ApiError('Network error', 0, null, '/api/x'); }, pinSession());
    const err = await useUndoStore.getState().undoLast().catch((e: Error) => e.message);
    expect(err).not.toMatch(/try again/);
    expect(labels()).toEqual([]);
    pushUndo('C', async () => { await sleep(5); useUndoStore.getState().clear(); throw new NothingDoneError("Couldn't read C", "Couldn't read C: nothing."); }, pinSession());
    const err2 = await useUndoStore.getState().undoLast().catch((e: Error) => e.message);
    expect(err2).not.toMatch(/try again/);
    expect(labels()).toEqual([]);
  });

  it('un Undo rechazado no da por vistos los datos: lo que se haga sin recargar también queda protegido', async () => {
    noteSeen(CS, draftLedger.seq);
    act('A', []);
    draftLedger.foreign();
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
    act('B', []);                                // antes de que la recarga traiga lo de la otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
  });

  it('un guardado propio sin respuesta entre la carga y la acción da el aviso de guardado sin respuesta', async () => {
    noteSeen(CS, draftLedger.seq);
    draftLedger.lost(CS);                        // un guardado sin respuesta…
    draftLedger.foreign();                       // …que sí se grabó
    act('A', []);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(UNCONFIRMED);
  });

  it('el margen de un reintento no sobrevive a una acción nueva', async () => {
    noteSeen(CS, draftLedger.seq);
    let fail = true;
    const pin = pinSession();
    draftLedger.write(CS);
    pushUndo('B', async () => {
      if (fail) { draftLedger.lost(CS); throw new ApiError('Network error', 0, null, '/api/x'); }   // no llegó
      return null;
    }, pin);
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    act('C', []);
    await useUndoStore.getState().undoLast();    // C
    fail = false;
    draftLedger.foreign();                       // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
  });

  it('sin versión abierta no lee el contador', async () => {
    useSessionStore.getState().closeModel();
    pushUndo('A', async () => null);
    expect(await useUndoStore.getState().undoLast()).toBe('A');
    expect(writeSeqOf).not.toHaveBeenCalled();
  });
});

// ── Candado por canvas (doc 133) ────────────────────────────────────────────
// El historial es uno por versión, pero Undo y Redo solo actúan sobre lo hecho
// en el canvas que está abierto: lo de otro canvas no se toca sin verlo.
describe('candado por canvas', () => {
  let canvas: string | null = 'sa-A';
  beforeEach(() => {
    open('editing', CS);
    canvas = 'sa-A';
    setCanvasSource(() => canvas);
    vi.mocked(writeSeqOf).mockClear();
  });
  afterEach(() => setCanvasSource(() => null));

  it('lo hecho en otro canvas no se deshace desde este: no corre nada y dice en cuál fue', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    canvas = 'sa-B';
    const err = await useUndoStore.getState().undoLast().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OtherCanvasError);
    expect(err).toMatchObject({ cmd: 'undo', canvasId: 'sa-A' });
    expect([labels(), log, useUndoStore.getState().busy]).toEqual([['A'], [], false]);
    expect(writeSeqOf).not.toHaveBeenCalled();
    canvas = 'sa-A';
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  it('lo hecho sin canvas abierto (Object Inspector) se deshace desde cualquier canvas', async () => {
    canvas = null;
    const pin = pinSession();
    pushUndo('A', async () => null, pin);
    canvas = 'sa-B';
    expect(await useUndoStore.getState().undoLast()).toBe('A');
  });

  it('Redo: lo deshecho en otro canvas no se rehace desde este', async () => {
    pushUndo('A', pair('A', []), pinSession());
    await useUndoStore.getState().undoLast();
    canvas = 'sa-B';
    await expect(useUndoStore.getState().redoLast()).rejects.toMatchObject({ cmd: 'redo', canvasId: 'sa-A' });
    expect(redoLabels()).toEqual(['A']);
    canvas = 'sa-A';
    expect(await useUndoStore.getState().redoLast()).toBe('A');
  });

  it('el contrario que dejan Undo y Redo sigue siendo del canvas de la acción', async () => {
    pushUndo('A', pair('A', []), pinSession());
    await useUndoStore.getState().undoLast();
    await useUndoStore.getState().redoLast();
    canvas = 'sa-B';
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(OtherCanvasError);
  });

  it('con lo de otro canvas arriba avisa en el acto, aunque haya algo grabándose', async () => {
    pushUndo('A', pair('A', []), pinSession());
    let land!: () => void;
    const inFlight = trackDraftWork(new Promise<void>((r) => { land = r; }));
    canvas = 'sa-B';
    const quick = (p: Promise<unknown>) => Promise.race([p, sleep(30).then(() => 'esperó')]);
    await expect(quick(useUndoStore.getState().undoLast())).rejects.toBeInstanceOf(OtherCanvasError);
    expect(useUndoStore.getState().busy).toBe(false);
    land(); await inFlight;
    canvas = 'sa-A';
    await useUndoStore.getState().undoLast();
    let land2!: () => void;
    const inFlight2 = trackDraftWork(new Promise<void>((r) => { land2 = r; }));
    canvas = 'sa-B';
    await expect(quick(useUndoStore.getState().redoLast())).rejects.toBeInstanceOf(OtherCanvasError);
    expect(useUndoStore.getState().busy).toBe(false);
    land2(); await inFlight2;
  });

  it('si se abre otro canvas mientras espera lo que estaba en vuelo, no deshace', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    trackDraftWork((async () => { await sleep(10); canvas = 'sa-B'; draftLedger.write(CS); })());
    await expect(useUndoStore.getState().undoLast()).rejects.toMatchObject({ cmd: 'undo', canvasId: 'sa-A' });
    expect([labels(), log]).toEqual([['A'], []]);
  });

  it('una acción de otro canvas que termina mientras lee el contador queda arriba y no se deshace', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    vi.mocked(writeSeqOf).mockImplementationOnce(async () => {
      pushUndo('C', pair('C', log), { ...pinSession(), canvasId: 'sa-C' });
      return { writeSeq: draftLedger.seq };
    });
    await expect(useUndoStore.getState().undoLast()).rejects.toMatchObject({ canvasId: 'sa-C' });
    expect([labels(), log]).toEqual([['A', 'C'], []]);
  });

  it('Redo: si se abre otro canvas mientras espera lo que estaba en vuelo, no rehace', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    await useUndoStore.getState().undoLast();
    trackDraftWork((async () => { await sleep(10); canvas = 'sa-B'; })());
    await expect(useUndoStore.getState().redoLast()).rejects.toMatchObject({ cmd: 'redo', canvasId: 'sa-A' });
    expect([redoLabels(), log]).toEqual([['A'], ['undo A']]);
  });

  it('si mientras espera lo que estaba en vuelo queda arriba una acción de otro canvas, tampoco la deshace', async () => {
    pushUndo('A', pair('A', []), pinSession());
    const action = trackDraftWork((async () => { await sleep(10); draftLedger.write(CS); })())
      .then(() => pushUndo('C', pair('C', []), { ...pinSession(), canvasId: 'sa-C' }));
    await expect(useUndoStore.getState().undoLast()).rejects.toMatchObject({ canvasId: 'sa-C' });
    await action;
    expect(labels()).toEqual(['A', 'C']);
    expect(useUndoStore.getState().busy).toBe(false);
  });
});

// Doc 133 §5 (fase 2): lo que empezó antes del Ctrl+Z termina y es lo que se
// deshace. Una acción con Undo corre entera como trabajo en vuelo
// (`historyAction`): Undo y Redo esperan también su refresco y su entrada en la
// pila, no solo sus escrituras.
describe('acción en curso al pulsar Undo o Redo', () => {
  let canvas: string | null = 'sa-A';
  beforeEach(() => {
    open('editing', CS);
    canvas = 'sa-A';
    setCanvasSource(() => canvas);
    vi.mocked(writeSeqOf).mockClear();
  });
  afterEach(() => setCanvasSource(() => null));

  /** Una acción como las del store: escribe, refresca (sin escribir) y recién
   *  después apila su Undo. `refresh` decide cuándo termina el refresco. */
  const action = (label: string, log: string[], refresh: () => Promise<void> = () => sleep(10)) =>
    historyAction(async () => {
      const pin = pinSession();
      draftLedger.write(CS);
      await refresh();
      pushUndo(label, pair(label, log), pin);
    });

  it('Ctrl+Z durante el refresco de una acción deshace esa acción, no la anterior', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    let refreshed!: () => void;
    const b = action('B', log, () => new Promise<void>((r) => { refreshed = r; }));
    const undo = useUndoStore.getState().undoLast();
    await sleep(5);
    expect(log).toEqual([]);                       // espera a B: todavía no deshizo nada
    refreshed();
    expect(await undo).toBe('B');
    await b;
    expect(log).toEqual(['undo B']);
    expect([labels(), redoLabels()]).toEqual([['A'], ['B']]);
  });

  it('con la pila vacía, Ctrl+Z espera la primera acción en curso y la deshace', async () => {
    const log: string[] = [];
    const b = action('B', log);
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    await b;
    expect([labels(), log]).toEqual([[], ['undo B']]);
  });

  it('con lo de otro canvas arriba y una acción de este en curso, espera y deshace la de este', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    canvas = 'sa-B';
    const b = action('B', log);
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    await b;
    expect([labels(), log]).toEqual([['A'], ['undo B']]);
  });

  it('Redo con una acción en curso la espera: la acción nueva deja sin nada que rehacer', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    await useUndoStore.getState().undoLast();
    // Lee antes de escribir: al pulsar Redo todavía no escribió nada.
    const b = historyAction(async () => {
      const pin = pinSession();
      await sleep(5);
      draftLedger.write(CS);
      await sleep(10);
      pushUndo('B', pair('B', log), pin);
    });
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    await b;
    expect([labels(), redoLabels(), log]).toEqual([['B'], [], ['undo A']]);
  });

  it('Redo con lo de otro canvas arriba y una acción de este en curso: la espera y avisa que no hay qué rehacer', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    await useUndoStore.getState().undoLast();
    canvas = 'sa-B';
    const b = historyAction(async () => {
      const pin = pinSession();
      await sleep(5);
      draftLedger.write(CS);
      pushUndo('B', pair('B', log), pin);
    });
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    await b;
    expect([labels(), redoLabels()]).toEqual([['B'], []]);
  });

  it('con lo de otro canvas arriba y una acción en curso que no apila: avisa en cuál fue sin leer el contador', async () => {
    pushUndo('A', pair('A', []), pinSession());
    canvas = 'sa-B';
    const b = historyAction(async () => { await sleep(5); draftLedger.write(CS); });
    vi.mocked(writeSeqOf).mockClear();
    await expect(useUndoStore.getState().undoLast()).rejects.toMatchObject({ cmd: 'undo', canvasId: 'sa-A' });
    await b;
    expect(writeSeqOf).not.toHaveBeenCalled();
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('una acción en curso que falla sin apilar: Ctrl+Z termina sin hacer nada y no queda nada en curso', async () => {
    const failed = historyAction(async () => { await sleep(5); throw new Error('boom'); });
    failed.catch(() => undefined);
    expect(await useUndoStore.getState().undoLast()).toBeNull();
    await expect(failed).rejects.toThrow('boom');
    // Sin nada en curso, lo de otro canvas arriba se avisa en el acto, sin leer el contador.
    pushUndo('A', pair('A', []), pinSession());
    canvas = 'sa-B';
    vi.mocked(writeSeqOf).mockClear();
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(OtherCanvasError);
    expect(writeSeqOf).not.toHaveBeenCalled();
  });

  it('una acción en curso que llama a otra acción con Undo no deja colgado el Ctrl+Z', async () => {
    const log: string[] = [];
    const outer = historyAction(async () => {
      const pin = pinSession();
      await sleep(5);
      await historyAction(async () => { draftLedger.write(CS); });
      await sleep(5);
      pushUndo('B', pair('B', log), pin);
    });
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    await outer;
  });

  /** Algo agendado tras una espera de tecleo: al mandarlo corre la acción. */
  const scheduled = (label: string, log: string[]) => {
    const w = pendingWrite(() => { w.release(); void action(label, log); });
    w.hold();
  };

  it('Ctrl+Z manda ya lo agendado (espera de tecleo) y deshace eso', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    scheduled('B', log);
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    expect([labels(), log]).toEqual([['A'], ['undo B']]);
  });

  it('con la pila vacía y algo agendado, Ctrl+Z lo manda y lo deshace', async () => {
    const log: string[] = [];
    scheduled('B', log);
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    expect([labels(), log]).toEqual([[], ['undo B']]);
  });

  it('con lo de otro canvas arriba y algo agendado en este, lo manda y lo deshace', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    canvas = 'sa-B';
    scheduled('B', log);
    expect(await useUndoStore.getState().undoLast()).toBe('B');
    expect([labels(), log]).toEqual([['A'], ['undo B']]);
  });

  it('lo agendado se manda con la pantalla ya en espera', async () => {
    let busy: boolean | null = null;
    const w = pendingWrite(() => { busy = useUndoStore.getState().busy; w.release(); });
    w.hold();
    pushUndo('A', pair('A', []), pinSession());
    await useUndoStore.getState().undoLast();
    expect(busy).toBe(true);
  });

  it('Redo manda lo agendado antes: si escribe, no queda qué rehacer', async () => {
    const log: string[] = [];
    pushUndo('A', pair('A', log), pinSession());
    await useUndoStore.getState().undoLast();
    scheduled('B', log);
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    expect([labels(), log]).toEqual([['B'], ['undo A']]);
  });

  it('un paso que reusa una acción con Undo corre sin esperarse a sí mismo', async () => {
    pushUndo('A', async () => {
      await historyAction(async () => { draftLedger.write(CS); pushUndo('reusada', async () => null); });
      return null;
    }, pinSession());
    expect(await Promise.race([useUndoStore.getState().undoLast(), sleep(200).then(() => 'colgado')])).toBe('A');
  });
});

// Lo que llega por fuera del bloqueo de la pantalla (el selector de color del
// sistema) espera a que termine el paso, y corre fuera del aviso de fin: si
// fallara, no cortaría a los demás que esperan ese aviso.
describe('whenHistoryIdle', () => {
  afterEach(() => { useUndoStore.setState({ busy: false, running: null }); });

  it('sin paso en curso corre en el acto', () => {
    const ran: string[] = [];
    whenHistoryIdle(() => ran.push('ya'));
    expect(ran).toEqual(['ya']);
  });

  it('con un paso en curso corre al terminar, después del aviso de fin', async () => {
    useUndoStore.setState({ busy: true, running: 'undo' });
    const order: string[] = [];
    whenHistoryIdle(() => order.push('selector'));
    expect(order).toEqual([]);
    useUndoStore.setState({ busy: false, running: null });
    order.push('fin del paso');
    await Promise.resolve();
    expect(order).toEqual(['fin del paso', 'selector']);
  });
});

// Los paneles que copian el modelo para editarlo se vuelven a sembrar cuando
// termina un Undo o un Redo que corrió (`steps`).
describe('pasos terminados', () => {
  beforeEach(() => { open('editing', CS); vi.mocked(writeSeqOf).mockClear(); });
  const steps = () => useUndoStore.getState().steps;

  it('suben con cada Undo o Redo que corrió, también si falla', async () => {
    const s0 = steps();
    pushUndo('A', pair('A', []), pinSession());
    await useUndoStore.getState().undoLast();
    expect(steps()).toBe(s0 + 1);
    await useUndoStore.getState().redoLast();
    expect(steps()).toBe(s0 + 2);
    pushUndo('B', async () => { throw new Error('409'); }, pinSession());
    await useUndoStore.getState().undoLast().catch(() => undefined);
    expect(steps()).toBe(s0 + 3);
  });

  it('no suben con uno que no llegó a correr (nada que deshacer, el candado no dejó rehacer)', async () => {
    const s0 = steps();
    expect(await useUndoStore.getState().undoLast()).toBeNull();
    pushUndo('A', pair('A', []), pinSession());
    await useUndoStore.getState().undoLast();
    draftLedger.foreign();
    await useUndoStore.getState().redoLast().catch(() => undefined);
    expect(steps()).toBe(s0 + 1);
  });
});
