import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) =>
  (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()));

import { ApiError } from '@/services/http';
import { writeSeqOf } from '@/services/changeset.service';
import { trackDraftWork } from '@/services/draftWork';
import { pinSession, trackRevalidation } from '@/features/modeler/lib/sessionGuard';
import { draftLedger } from './draftLedger.testutil';
import { NothingDoneError, freshStep, pushUndo, useUndoStore, type HistoryStep } from './useUndoStore';
import { useBusyStore } from './useBusyStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const open = (mode: 'editing' | 'readonly', changesetId: string) =>
  useSessionStore.getState().openModel({ projectId: 'p', mode, changesetId });

beforeEach(() => { useUndoStore.getState().clear(); useUndoStore.setState({ busy: false }); });

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

  it('un Undo cuya primera escritura no sigue a la base descarta lo que había para rehacer', async () => {
    pushUndo('A', pair('A', []));
    pushUndo('B', pair('B', []));
    await useUndoStore.getState().undoLast();          // B: base = su última escritura
    draftLedger.foreign();
    await useUndoStore.getState().undoLast();          // A empieza después de una ajena
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
