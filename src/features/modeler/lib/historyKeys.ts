/**
 * Deshacer y rehacer desde la barra o el teclado del canvas. Los atajos valen
 * igual en Mac y en Windows (⌘ o Ctrl): Z deshace; Shift+Z o Y rehacen. Solo
 * actúan sobre lo hecho en el canvas abierto (doc 133): con lo último hecho en
 * otro, el aviso dice en cuál y ofrece abrirlo.
 */
import { toast } from 'sonner';
import { modalOpen } from '@/components/ui/focusTrap';
import { effective } from '@/services/changeset.service';
import { useBusyStore } from '@/store/useBusyStore';
import { failureText, useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { OtherCanvasError, StaleUndoError, useUndoStore, type UndoEntry } from '@/store/useUndoStore';
import { pinSession, reportWriteError } from './sessionGuard';

export type HistoryCommand = 'undo' | 'redo';

/** El comando del historial de un evento de teclado; null si no es uno (sin
 *  ⌘/Ctrl, con Alt u otra tecla). */
export function historyShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): HistoryCommand | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  return k === 'y' && !e.shiftKey ? 'redo' : null;
}

type Notify = (message: string, kind?: 'err') => void;

/** Deshace o rehace y avisa: «Undid: …» / «Redid: …», o el motivo si no pudo.
 *  Sin nada que hacer o con un paso en curso no hace nada. */
export function runHistory(cmd: HistoryCommand, notify: Notify): void {
  const history = useUndoStore.getState();
  void (cmd === 'undo' ? history.undoLast() : history.redoLast())
    .then((label) => { if (label) notify(`${cmd === 'undo' ? 'Undid' : 'Redid'}: ${label}`); })
    .catch((e: unknown) => {
      if (e instanceof OtherCanvasError) { void elsewhere(e, notify); return; }
      // El candado no dejó deshacer: lo de la otra pestaña no está en pantalla.
      if (e instanceof StaleUndoError) void useModelerStore.getState().reload({ full: true });
      notify(e instanceof Error && e.message ? e.message : `Couldn't ${cmd}`, 'err');
    });
}

/** Lo de arriba de la pila del comando. */
const topOf = (cmd: HistoryCommand): UndoEntry | undefined => {
  const s = useUndoStore.getState();
  const pile = cmd === 'undo' ? s.stack : s.redoStack;
  return pile[pile.length - 1];
};

/** El canvas `id` en la versión abierta según el servidor: su documento, null
 *  si ya no existe, undefined si no se pudo saber. */
async function canvasOnServer(id: string): Promise<{ name?: string } | null | undefined> {
  const cs = useSessionStore.getState().activeChangesetId;
  if (!cs) return undefined;
  try {
    return (await effective<{ name?: string }>(cs, 'subject_areas', { ids: [id] }))[0] ?? null;
  } catch {
    return undefined;
  }
}

/** El canvas de lo último ya no existe: lo de él no se podría deshacer nunca y
 *  tapa el resto, así que el historial se vacía — solo si lo de arriba sigue
 *  siendo esa entrada de ese canvas. Dice si lo vació. */
function forgetGone(e: OtherCanvasError, asked: UndoEntry | undefined, notify: Notify): boolean {
  if (!asked || asked.canvasId !== e.canvasId || topOf(e.cmd) !== asked) return false;
  useUndoStore.getState().clear();
  notify(`${e.cmd === 'undo' ? 'Your last change' : 'Your last undo'} was on a canvas that no longer exists: the undo history was cleared.`, 'err');
  return true;
}

// La consulta en curso al servidor (las pulsaciones que llegan mientras tanto no repiten).
let confirming: Promise<void> | null = null;

/** Lo último del historial es de otro canvas: dice cuál y ofrece abrirlo. Si no
 *  está en la lista de aquí (pudo crearse o borrarse en otra pestaña), se lo
 *  pregunta al servidor. */
async function elsewhere(e: OtherCanvasError, notify: Notify): Promise<void> {
  const known = useModelerStore.getState().subjectAreas.find((c) => c.id === e.canvasId);
  if (known) { offerCanvas(e, known.name, notify); return; }
  if (confirming) return;
  const asked = topOf(e.cmd);
  const pin = pinSession();
  confirming = (async () => {
    const doc = await canvasOnServer(e.canvasId);
    // Lo de arriba (o la sesión) cambió mientras se preguntaba: no corresponde.
    if (!pin.holds() || topOf(e.cmd) !== asked) return;
    if (doc === null) forgetGone(e, asked, notify);
    else if (doc === undefined) {
      notify(e.cmd === 'undo' ? "Couldn't check the canvas of your last change: nothing was undone. Try again."
        : "Couldn't check the canvas of your last undo: nothing was redone. Try again.", 'err');
    } else offerCanvas(e, doc.name, notify);
  })().finally(() => { confirming = null; });
  await confirming;
}

/** El aviso con el botón para abrir el canvas de lo último. */
function offerCanvas(e: OtherCanvasError, name: string | undefined, notify: Notify): void {
  const what = e.cmd === 'undo' ? 'Your last change' : 'Your last undo';
  // La sesión y la entrada del aviso: el aviso puede quedar en pantalla un rato.
  const pin = pinSession();
  const asked = topOf(e.cmd);
  toast.info(`${what} was on ${name ? `canvas ${name}` : 'another canvas'}. Open it to ${e.cmd} it.`, {
    id: 'dmh-history-elsewhere',
    action: {
      label: 'Open canvas',
      onClick: (ev?: { preventDefault?: () => void }) => {
        // Un aviso de otra sesión (se abrió otra versión o proyecto) no abre nada.
        if (!pin.holds()) return;
        const st = useModelerStore.getState();
        if (st.activeSaId === e.canvasId) return;
        // El aviso queda encima de todo: con algo modal o bloqueante en pantalla
        // (un borrado en curso, un diálogo) o un canvas abriéndose, no se cambia de
        // canvas por detrás; el aviso sigue ahí para pulsarlo después.
        if (modalOpen() || useBusyStore.getState().active || st.openingSaId) { ev?.preventDefault?.(); return; }
        const report = reportWriteError((err) => notify(failureText("Couldn't open the canvas", err), 'err'));
        st.selectSubjectArea(e.canvasId).catch(async (err: unknown) => {
          // ¿Lo borró otra pestaña y la lista de aquí no lo sabía? Se vacía solo si
          // lo de arriba sigue siendo lo del aviso; si no, es una falla más.
          const gone = pin.holds() && (await canvasOnServer(e.canvasId)) === null;
          if (gone && pin.holds() && forgetGone(e, asked, notify)) return;
          await report(err);
        });
      },
    },
  });
}

/** El tooltip de Undo o Redo: qué hace y su atajo; si lo de arriba se hizo en
 *  otro canvas, en cuál (ahí no corre: el botón avisa); sin canvas (Object
 *  Inspector), de dónde es. */
export function historyTip(
  cmd: HistoryCommand, entry: UndoEntry | null, keyLabel: string, here: string | null,
  canvases: readonly { id: string; name: string }[],
): string {
  const verb = cmd === 'undo' ? 'Undo' : 'Redo';
  if (!entry) return `${verb} (${keyLabel}) — nothing to ${cmd}`;
  if (entry.canvasId === null) return `${verb} — ${entry.label} in the Object Inspector (${keyLabel})`;
  if (entry.canvasId === undefined || entry.canvasId === here) return `${verb} — ${entry.label} (${keyLabel})`;
  const name = canvases.find((c) => c.id === entry.canvasId)?.name;
  return `${verb} — ${entry.label} (${name ? `on canvas ${name}` : 'on another canvas'})`;
}

/** Un atajo del historial en el canvas: en edición es siempre suyo (sin
 *  `preventDefault`, ⌘Y abriría el Historial del navegador aunque no haya nada
 *  que rehacer) y corre `runHistory`; fuera de edición no lo toma. */
export function historyKey(e: Pick<KeyboardEvent, 'preventDefault'>, cmd: HistoryCommand, editing: boolean, notify: Notify): void {
  if (!editing) return;
  e.preventDefault();
  runHistory(cmd, notify);
}
