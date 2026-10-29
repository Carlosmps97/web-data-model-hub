// Atajos del historial en el canvas, iguales en Mac y en Windows (⌘ o Ctrl):
// Z deshace; Shift+Z o Y rehacen. Con Alt, o sin ⌘/Ctrl, no son del historial.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/changeset.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/changeset.service')>()),
  writeSeqOf: async () => ({ writeSeq: 0 }),   // el candado del Undo lee el contador (doc 133): nada ajeno
  effective: vi.fn(async () => []),
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
const { modal } = vi.hoisted(() => ({ modal: { open: false } }));
vi.mock('@/components/ui/focusTrap', async (orig) => ({ ...(await orig<object>()), modalOpen: () => modal.open }));
import { toast } from 'sonner';
import { effective } from '@/services/changeset.service';
import { useBusyStore } from '@/store/useBusyStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { StaleUndoError, useUndoStore } from '@/store/useUndoStore';
import { historyKey, historyShortcut, historyTip, runHistory } from './historyKeys';
import { notePointer } from './historyWait';

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }) as KeyboardEvent;

describe('historyShortcut', () => {
  it.each([
    ['⌘Z', key({ metaKey: true }), 'undo'],
    ['Ctrl+Z', key({ ctrlKey: true }), 'undo'],
    ['⇧⌘Z (Mac)', key({ metaKey: true, shiftKey: true, key: 'Z' }), 'redo'],
    ['Ctrl+Shift+Z', key({ ctrlKey: true, shiftKey: true, key: 'Z' }), 'redo'],
    ['Ctrl+Y (Windows)', key({ ctrlKey: true, key: 'y' }), 'redo'],
    ['⌘Y', key({ metaKey: true, key: 'y' }), 'redo'],
  ])('%s', (_l, e, want) => { expect(historyShortcut(e)).toBe(want); });

  it.each([
    ['Z sola', key({})],
    ['Alt+⌘Z', key({ metaKey: true, altKey: true })],
    ['Ctrl+Shift+Y', key({ ctrlKey: true, shiftKey: true, key: 'Y' })],
    ['⌘C', key({ metaKey: true, key: 'c' })],
  ])('%s no es del historial', (_l, e) => { expect(historyShortcut(e)).toBeNull(); });
});

// En edición el atajo es siempre del canvas: sin `preventDefault`, ⌘Y abre el
// Historial del navegador (Chrome/Safari en Mac) aunque no haya nada que rehacer
// o corra otro paso.
describe('historyKey', () => {
  beforeEach(() => {
    useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs1' });
    useUndoStore.getState().clear();
    useUndoStore.setState({ busy: false });
    vi.mocked(toast.info).mockClear();
  });
  const event = () => ({ preventDefault: vi.fn() });

  it('en edición se queda el atajo sin nada que rehacer, sin avisar nada', async () => {
    const e = event();
    const notify = vi.fn();
    historyKey(e, 'redo', true, notify);
    expect(e.preventDefault).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).not.toHaveBeenCalled();
  });

  it('en edición se queda el atajo con un paso en curso, sin correr otro', () => {
    let ran = false;
    useUndoStore.setState({ busy: true, stack: [{ label: 'A', run: async () => { ran = true; return null; } }] });
    const e = event();
    historyKey(e, 'undo', true, vi.fn());
    expect(e.preventDefault).toHaveBeenCalled();
    expect(ran).toBe(false);
  });

  it('deshace y avisa', async () => {
    useUndoStore.setState({ stack: [{ label: 'A', run: async () => null }] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Undid: A'));
  });

  it('fuera de edición no lo toma', () => {
    const e = event();
    historyKey(e, 'redo', false, vi.fn());
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  // Un arrastre en curso graba al soltar: caería en medio del paso (doc 133 §5).
  it('con un botón del mouse apretado se queda el atajo sin deshacer y lo dice en un solo aviso', async () => {
    let ran = false;
    useUndoStore.setState({ stack: [{ label: 'A', run: async () => { ran = true; return null; } }] });
    notePointer({ type: 'pointerdown', buttons: 1, pointerId: 1 });
    const e = event();
    const notify = vi.fn();
    historyKey(e, 'undo', true, notify);
    historyKey(event(), 'undo', true, notify);           // repetido (tecla sostenida): el mismo aviso
    notePointer({ type: 'pointerup', buttons: 0, pointerId: 1 });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(vi.mocked(toast.info).mock.calls).toEqual([
      ['Finish dragging first, then undo.', { id: 'dmh-history-drag' }],
      ['Finish dragging first, then undo.', { id: 'dmh-history-drag' }],
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect([ran, useUndoStore.getState().stack.length]).toEqual([false, 1]);
  });

  // Varios diálogos dejan la barra a la vista (backdrop «canvas»): su botón Undo
  // no deshace por detrás de uno abierto, como ya hace el atajo.
  it('con un diálogo abierto, el botón de la barra no deshace y pide cerrarlo', async () => {
    let ran = false;
    useUndoStore.setState({ stack: [{ label: 'A', run: async () => { ran = true; return null; } }] });
    modal.open = true;
    runHistory('undo', vi.fn());
    modal.open = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(toast.info).mock.calls).toEqual([['Close the dialog first, then undo.', { id: 'dmh-history-dialog' }]]);
    expect(ran).toBe(false);
  });

  it('el botón de la barra tampoco corre con otro puntero apretado (otro dedo arrastrando); sin nada que hacer, calla', async () => {
    let ran = false;
    useUndoStore.setState({ stack: [{ label: 'A', run: async () => { ran = true; return null; } }] });
    notePointer({ type: 'pointerdown', buttons: 1, pointerId: 7 });
    runHistory('redo', vi.fn());                         // nada que rehacer: sin aviso
    runHistory('undo', vi.fn());
    notePointer({ type: 'pointerup', buttons: 0, pointerId: 7 });
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(toast.info).mock.calls).toEqual([['Finish dragging first, then undo.', { id: 'dmh-history-drag' }]]);
    expect(ran).toBe(false);
  });
});

// Undo y Redo solo actúan sobre lo hecho en el canvas abierto (doc 133): con lo
// último hecho en otro, el aviso dice en cuál y ofrece abrirlo; si ese canvas ya
// no existe, el historial se vacía (no se podría deshacer nunca y tapa el resto).
describe('lo último se hizo en otro canvas', () => {
  const CANVASES = [{ id: 'sa1', name: 'Uno' }, { id: 'sa2', name: 'Ventas' }];
  const open = vi.fn(async () => {});
  beforeEach(() => {
    vi.mocked(toast.info).mockClear();
    vi.mocked(effective).mockClear();
    open.mockClear();
    modal.open = false;
    useBusyStore.getState().stop();
    useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs1' });
    useModelerStore.setState({ subjectAreas: CANVASES as never, activeSaId: 'sa1', selectSubjectArea: open });
    useUndoStore.getState().clear();
    useUndoStore.setState({ busy: false });
  });
  const event = () => ({ preventDefault: vi.fn() });
  const entry = (canvasId: string | null) => ({ label: 'Add column EMAIL', run: async () => null, canvasId });

  it('Undo: dice en qué canvas fue y ofrece abrirlo; no deshace nada', async () => {
    let ran = false;
    useUndoStore.setState({ stack: [{ ...entry('sa2'), run: async () => { ran = true; return null; } }] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [text, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { label: string; onClick: () => void } }];
    expect(text).toBe('Your last change was on canvas Ventas. Open it to undo it.');
    expect(opts.action.label).toBe('Open canvas');
    opts.action.onClick();
    expect(open).toHaveBeenCalledWith('sa2');
    expect([ran, notify.mock.calls.length, useUndoStore.getState().stack.length]).toEqual([false, 0, 1]);
  });

  it('Redo: igual, con lo último deshecho', async () => {
    useUndoStore.setState({ redoStack: [entry('sa2')] });
    historyKey(event(), 'redo', true, vi.fn());
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(vi.mocked(toast.info).mock.calls[0][0]).toBe('Your last undo was on canvas Ventas. Open it to redo it.');
  });

  it('si el servidor confirma que ese canvas ya no existe, vacía el historial y lo dice', async () => {
    vi.mocked(effective).mockResolvedValueOnce([]);
    useUndoStore.setState({ stack: [entry(null), entry('sa9')], redoStack: [entry('sa1')] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(
      'Your last change was on a canvas that no longer exists: the undo history was cleared.', 'err'));
    expect(vi.mocked(effective)).toHaveBeenCalledWith('cs1', 'subject_areas', { ids: ['sa9'] });
    expect([useUndoStore.getState().stack, useUndoStore.getState().redoStack]).toEqual([[], []]);
  });

  it('si no está en la lista de aquí pero existe (lo creó otra pestaña), no vacía: dice cuál y ofrece abrirlo', async () => {
    vi.mocked(effective).mockResolvedValueOnce([{ id: 'sa9', name: 'Nuevo' }] as never);
    useUndoStore.setState({ stack: [entry('sa9')] });
    historyKey(event(), 'undo', true, vi.fn());
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(vi.mocked(toast.info).mock.calls[0][0]).toBe('Your last change was on canvas Nuevo. Open it to undo it.');
    expect(useUndoStore.getState().stack).toHaveLength(1);
  });

  it('si no se puede confirmar, no vacía nada y pide intentar otra vez', async () => {
    vi.mocked(effective).mockRejectedValueOnce(new Error('offline'));
    useUndoStore.setState({ stack: [entry('sa9')] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("Couldn't check the canvas of your last change: nothing was undone. Try again.", 'err'));
    expect(useUndoStore.getState().stack).toHaveLength(1);
  });

  it('varias pulsaciones mientras confirma: una sola consulta', async () => {
    let answer!: (v: never[]) => void;
    vi.mocked(effective).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    useUndoStore.setState({ stack: [entry('sa9')] });
    for (let i = 0; i < 3; i += 1) historyKey(event(), 'undo', true, vi.fn());
    await vi.waitFor(() => expect(vi.mocked(effective)).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 5));
    expect(vi.mocked(effective)).toHaveBeenCalledTimes(1);
    answer([{ id: 'sa9' }] as never);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
  });

  it('si el servidor no le da nombre, lo nombra como otro canvas (y ofrece abrirlo)', async () => {
    vi.mocked(effective).mockResolvedValueOnce([{ id: 'sa9' }] as never);
    useUndoStore.setState({ stack: [entry('sa9')] });
    historyKey(event(), 'undo', true, vi.fn());
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(vi.mocked(toast.info).mock.calls[0][0]).toBe('Your last change was on another canvas. Open it to undo it.');
  });

  it('si mientras confirma cambió lo de arriba, no vacía lo nuevo', async () => {
    let answer!: (v: never[]) => void;
    vi.mocked(effective).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    useUndoStore.setState({ stack: [entry('sa9')] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(vi.mocked(effective)).toHaveBeenCalled());
    useUndoStore.setState({ stack: [entry('sa9'), entry('sa1')] });     // una acción nueva
    answer([]);
    await new Promise((r) => setTimeout(r, 5));
    expect(useUndoStore.getState().stack).toHaveLength(2);
  });

  // El aviso queda encima de todo (también de un borrado en curso o un diálogo):
  // su botón no cambia de canvas por detrás.
  it('«Open canvas» no hace nada con un diálogo, una acción bloqueante o un canvas abriéndose (el aviso queda), ni con ese canvas ya abierto', async () => {
    useUndoStore.setState({ stack: [entry('sa2')] });
    historyKey(event(), 'undo', true, vi.fn());
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { id: string; action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    expect(opts.id).toBe('dmh-history-elsewhere');
    const click = () => { const ev = { preventDefault: vi.fn() }; opts.action.onClick(ev); return ev.preventDefault; };
    modal.open = true;
    expect(click()).toHaveBeenCalled();
    modal.open = false;
    useBusyStore.getState().start('Deleting table…');
    expect(click()).toHaveBeenCalled();
    useBusyStore.getState().stop();
    useModelerStore.setState({ openingSaId: 'sa3' });
    expect(click()).toHaveBeenCalled();
    useModelerStore.setState({ openingSaId: null, activeSaId: 'sa2' });
    click();
    expect(open).not.toHaveBeenCalled();
    useModelerStore.setState({ activeSaId: 'sa1' });
  });

  it('el botón de un aviso de otra sesión (se abrió otra versión o proyecto) no abre nada', async () => {
    useUndoStore.setState({ stack: [entry('sa2')] });
    historyKey(event(), 'undo', true, vi.fn());
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    useSessionStore.getState().openModel({ projectId: 'p2', mode: 'editing', changesetId: 'cs2' });
    opts.action.onClick({ preventDefault: vi.fn() });
    expect(open).not.toHaveBeenCalled();
  });

  it('si al abrirlo resulta que ya no existe (lo borró otra pestaña), vacía el historial y lo dice', async () => {
    useUndoStore.setState({ stack: [entry(null), entry('sa2')] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    open.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    vi.mocked(effective).mockResolvedValueOnce([]);
    opts.action.onClick({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(
      'Your last change was on a canvas that no longer exists: the undo history was cleared.', 'err'));
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  // El aviso puede quedar en pantalla un rato: si mientras tanto lo de arriba
  // cambió, su botón no vacía un historial que ya no empieza por ese canvas.
  it('un aviso viejo: si lo de arriba cambió, al fallar la apertura no vacía nada (lo dice como falla)', async () => {
    useUndoStore.setState({ stack: [entry('sa2')] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    useUndoStore.setState({ stack: [entry('sa2'), entry('sa1')] });              // una acción nueva arriba
    open.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    vi.mocked(effective).mockResolvedValueOnce([]);
    opts.action.onClick({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't open the canvas/), 'err'));
    expect(useUndoStore.getState().stack).toHaveLength(2);
  });

  it('un aviso viejo de Redo: si lo pendiente de rehacer ya no está, no vacía lo de Undo', async () => {
    useUndoStore.setState({ stack: [entry('sa1')], redoStack: [entry('sa2')] });
    const notify = vi.fn();
    historyKey(event(), 'redo', true, notify);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    useUndoStore.setState({ redoStack: [] });                                       // otra escritura lo vació
    open.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    vi.mocked(effective).mockResolvedValueOnce([]);
    opts.action.onClick({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't open the canvas/), 'err'));
    expect(useUndoStore.getState().stack).toHaveLength(1);
  });

  it('un clic que abre el canvas (o con ese canvas ya abierto) deja cerrar el aviso', async () => {
    useUndoStore.setState({ stack: [entry('sa2')] });
    historyKey(event(), 'undo', true, vi.fn());
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    const ev = { preventDefault: vi.fn() };
    opts.action.onClick(ev);
    expect(open).toHaveBeenCalledWith('sa2');
    useModelerStore.setState({ activeSaId: 'sa2' });
    opts.action.onClick(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    useModelerStore.setState({ activeSaId: 'sa1' });
  });

  it('si no se puede abrir el canvas (y sigue existiendo), lo dice y no vacía', async () => {
    useUndoStore.setState({ stack: [entry('sa2')] });
    const notify = vi.fn();
    historyKey(event(), 'undo', true, notify);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
    const [, opts] = vi.mocked(toast.info).mock.calls[0] as unknown as [string, { action: { onClick: (ev: { preventDefault: () => void }) => void } }];
    open.mockRejectedValueOnce(new Error('boom'));
    vi.mocked(effective).mockResolvedValueOnce([{ id: 'sa2', name: 'Ventas' }] as never);
    opts.action.onClick({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't open the canvas/), 'err'));
    expect(useUndoStore.getState().stack).toHaveLength(1);
  });
});

describe('historyTip', () => {
  const CANVASES = [{ id: 'sa1', name: 'Uno' }, { id: 'sa2', name: 'Ventas' }];
  const e = (canvasId?: string | null) => ({ label: 'Add column EMAIL', run: async () => null, ...(canvasId !== undefined ? { canvasId } : {}) });

  it.each([
    ['nada que deshacer', 'undo', null, 'Undo (⌘Z) — nothing to undo'],
    ['nada que rehacer', 'redo', null, 'Redo (⇧⌘Z) — nothing to redo'],
    ['del canvas abierto', 'undo', e('sa1'), 'Undo — Add column EMAIL (⌘Z)'],
    ['sin dato de canvas', 'undo', e(), 'Undo — Add column EMAIL (⌘Z)'],
    ['hecho en el Object Inspector sin canvas', 'undo', e(null), 'Undo — Add column EMAIL in the Object Inspector (⌘Z)'],
    ['de otro canvas', 'undo', e('sa2'), 'Undo — Add column EMAIL (on canvas Ventas)'],
    ['de otro canvas, para rehacer', 'redo', e('sa2'), 'Redo — Add column EMAIL (on canvas Ventas)'],
    ['de un canvas que ya no está en la lista', 'undo', e('sa9'), 'Undo — Add column EMAIL (on another canvas)'],
  ] as const)('%s', (_l, cmd, entry, want) => {
    expect(historyTip(cmd, entry, cmd === 'undo' ? '⌘Z' : '⇧⌘Z', 'sa1', CANVASES)).toBe(want);
  });
});

// Si el candado del Undo no deja deshacer (otra pestaña escribió en la versión),
// el historial ya está vacío: el aviso lo dice y el diagrama se recarga completo
// (lo de la otra pestaña no está en pantalla).
describe('Undo rechazado por el candado', () => {
  const realUndo = useUndoStore.getState().undoLast;
  const realReload = useModelerStore.getState().reload;
  afterEach(() => {
    useUndoStore.setState({ undoLast: realUndo });
    useModelerStore.setState({ reload: realReload });
  });

  it('avisa y recarga el diagrama completo', async () => {
    const reload = vi.fn(async () => {});
    useModelerStore.setState({ reload });
    useUndoStore.setState({ busy: false, undoLast: async () => { throw new StaleUndoError('elsewhere'); } });
    const notify = vi.fn();
    historyKey({ preventDefault: vi.fn() }, 'undo', true, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(
      "This version changed in another tab or window: the undo history was cleared so it doesn't overwrite those changes.", 'err'));
    expect(reload).toHaveBeenCalledWith({ full: true });
  });
});
