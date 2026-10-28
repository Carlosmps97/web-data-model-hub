/**
 * Deshacer y rehacer desde la barra o el teclado del canvas. Los atajos valen
 * igual en Mac y en Windows (⌘ o Ctrl): Z deshace; Shift+Z o Y rehacen.
 */
import { useUndoStore } from '@/store/useUndoStore';

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
    .catch((e: unknown) => notify(e instanceof Error && e.message ? e.message : `Couldn't ${cmd}`, 'err'));
}

/** Un atajo del historial en el canvas: en edición es siempre suyo (sin
 *  `preventDefault`, ⌘Y abriría el Historial del navegador aunque no haya nada
 *  que rehacer) y corre `runHistory`; fuera de edición no lo toma. */
export function historyKey(e: Pick<KeyboardEvent, 'preventDefault'>, cmd: HistoryCommand, editing: boolean, notify: Notify): void {
  if (!editing) return;
  e.preventDefault();
  runHistory(cmd, notify);
}
