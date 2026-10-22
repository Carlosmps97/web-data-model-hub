import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { ApiError } from '@/services/http';
import { pinSession, trackRevalidation } from '@/features/modeler/lib/sessionGuard';
import { NothingDoneError, pushUndo, useUndoStore } from './useUndoStore';
import { useBusyStore } from './useBusyStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const open = (mode: 'editing' | 'readonly', changesetId: string) =>
  useSessionStore.getState().openModel({ projectId: 'p', mode, changesetId });

beforeEach(() => { useUndoStore.setState({ stack: [], busy: false }); });

describe('useUndoStore', () => {
  it('undoLast es LIFO: corre la inversa y devuelve su label', async () => {
    const ran: string[] = [];
    pushUndo('a', async () => { ran.push('a'); });
    pushUndo('b', async () => { ran.push('b'); });
    expect(await useUndoStore.getState().undoLast()).toBe('b');
    expect(ran).toEqual(['b']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['a']);
  });

  it('una inversa corriendo suprime la instrumentación (no apila su propia inversa)', async () => {
    pushUndo('add', async () => {
      // La inversa reusa una acción del store instrumentada: su pushUndo
      // interno no debe entrar a la pila.
      pushUndo('delete (nested)', async () => {});
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
    });
    const undo = useUndoStore.getState().undoLast();
    open('editing', 'cs2');
    await expect(undo).resolves.toBeNull();
    expect(wrote).toEqual(['bulk']);
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('si la sesión cambió mientras corría (aunque la inversa terminara), no dice «Undid»: null', async () => {
    pushUndo('Move block', async () => { await sleep(5); });
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
    pushUndo('Delete table T', async () => { during = useBusyStore.getState().active; });
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table T');
    expect(during).toBeNull();
    expect(useBusyStore.getState().active).toBeNull();
  });

  it('una acción que termina después de cambiar la sesión no deja su inversa en la pila de la nueva', () => {
    const pin = pinSession();          // la acción empieza editando cs1…
    open('editing', 'cs2');            // …y termina con cs2 abierta
    pushUndo('Create table T', async () => {}, pin);
    expect(useUndoStore.getState().stack).toEqual([]);
    pushUndo('Create table U', async () => {}, pinSession());
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
    const other = vi.fn(async () => {});
    pushUndo('Rename column X', other);
    pushUndo('Create table T', async () => { throw unread(); });
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(`${READ}: nothing was undone. Press Undo to try again.`);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Rename column X', 'Create table T']);
    expect(other).not.toHaveBeenCalled();
    expect(useUndoStore.getState().busy).toBe(false);
  });

  it('reintentar deshace esa acción', async () => {
    let fail = true;
    const ran = vi.fn(async () => { if (fail) throw unread(); });
    pushUndo('Rename column X', async () => {});
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
    pushUndo('Rename column A', async () => { ran.push('A'); });
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
      pushUndo('nested (de la inversa)', async () => {}, pinSession());
      await new Promise<void>((r) => { release = r; });
    });
    const undo = useUndoStore.getState().undoLast();
    await sleep(1);
    expect(useUndoStore.getState().stack).toEqual([]);          // la anidada no entró
    open('editing', 'cs2');                                      // se abre otra versión…
    pushUndo('Rename column B', async () => {}, pinSession());   // …y se edita en ella
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
    pushUndo('A', async () => {});
    const release = hold();
    expect(labels()).toEqual([]);
    pushUndo('B', async () => {});                 // una edición mientras se aplica
    expect(labels()).toEqual([]);
    await release();
    pushUndo('C', async () => {});
    expect(labels()).toEqual(['C']);
  });

  it('tampoco deshace mientras dura (el atajo con el popup cerrado)', async () => {
    const release = hold();
    const ran = vi.fn(async () => {});
    useUndoStore.setState({ stack: [{ label: 'X', run: ran }] });
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
    expect(ran).not.toHaveBeenCalled();
    await release();
    await expect(useUndoStore.getState().undoLast()).resolves.toBe('X');
  });

  it('en otra sesión no rige (la carga era de la anterior)', () => {
    hold();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    pushUndo('D', async () => {});
    expect(labels()).toEqual(['D']);
  });

  // El cierre sigue la versión, no la época de la sesión: ir a otra y volver a
  // la de la carga (que sigue aplicándose) no la abre, porque apilaría inversas
  // previas a lo cargado.
  it('de vuelta a la misma versión mientras dura: sigue cerrada', () => {
    hold();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
    pushUndo('E', async () => {});
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
    pushUndo('G', async () => {});
    expect(labels()).toEqual([]);                        // la de cs1 no terminó
    await second();                                      // termina la de cs2: cs1 sigue cerrada
    pushUndo('H', async () => {});
    expect(labels()).toEqual([]);
    await first();
    pushUndo('I', async () => {});
    expect(labels()).toEqual(['I']);
  });

  it('dos cargas en la misma versión: cerrada hasta que terminen las dos', async () => {
    const first = hold();
    const second = hold();
    await first();
    pushUndo('J', async () => {});
    expect(labels()).toEqual([]);
    await second();
    pushUndo('K', async () => {});
    expect(labels()).toEqual(['K']);
  });

  it('la misma versión en solo lectura no está cerrada (no se edita)', () => {
    hold();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' });
    pushUndo('F', async () => {});
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
    useUndoStore.setState({ stack: [{ label: 'Edit column C', run: () => new Promise<void>((_r, j) => { fail = j; }) }] });
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
});
