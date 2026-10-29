// Botón Redo de la barra del canvas: al lado de Undo, con el label de lo que
// rehace y el atajo; se apaga sin nada que rehacer, con un Undo/Redo en curso o
// en solo lectura.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// En un render del lado del servidor zustand lee el estado inicial de cada
// store: la sesión y el historial salen de estos objetos (el resto, real).
const session: Record<string, unknown> = {};
const history: Record<string, unknown> = {};
const modeler: Record<string, unknown> = { activeSaId: 'sa1', diagram: { subjectArea: { id: 'sa1' } } };
vi.mock('@/store/useSessionStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useSessionStore')>();
  const real = actual.useSessionStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...session });
  return { ...actual, useSessionStore: Object.assign(hook, real) };
});
vi.mock('@/store/useUndoStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useUndoStore')>();
  const real = actual.useUndoStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...history });
  return { ...actual, useUndoStore: Object.assign(hook, real) };
});
vi.mock('@/store/useModelerStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useModelerStore')>();
  const real = actual.useModelerStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...modeler });
  return { ...actual, useModelerStore: Object.assign(hook, real) };
});
vi.mock('./ColumnContextMenu', async (orig) => ({ ...(await orig<object>()), UNDO_KEY_LABEL: 'Mod+Z', REDO_KEY_LABEL: 'Mod+Shift+Z' }));
import Toolbar from './Toolbar';

const entry = (label: string) => ({ label, run: async () => null });
/** Los botones de la barra, en orden: nombre accesible y si están deshabilitados. */
function buttons(): { name: string; disabled: boolean }[] {
  const html = renderToStaticMarkup(<Toolbar pushToast={() => {}} onOpenModel={() => {}} />);
  return [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
    name: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? '', disabled: /\sdisabled(=""|\s|$)/.test(attrs),
  }));
}
const undoRedo = () => {
  const all = buttons();
  const i = all.findIndex((b) => b.name.startsWith('Undo'));
  return [all[i], all[i + 1]];
};

describe('Toolbar: botón Redo', () => {
  it('va justo después de Undo, con lo que rehace y el atajo', () => {
    Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    Object.assign(history, { stack: [entry('Edit column A')], redoStack: [entry('Create table T')], busy: false });
    const [undo, redo] = undoRedo();
    expect(undo).toEqual({ name: 'Undo — Edit column A (Mod+Z)', disabled: false });
    expect(redo).toEqual({ name: 'Redo — Create table T (Mod+Shift+Z)', disabled: false });
  });

  it('sin nada que rehacer, o con un Undo/Redo en curso, queda deshabilitado', () => {
    Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    Object.assign(history, { stack: [], redoStack: [], busy: false });
    expect(undoRedo()[1]).toEqual({ name: 'Redo (Mod+Shift+Z) — nothing to redo', disabled: true });
    Object.assign(history, { redoStack: [entry('Create table T')], busy: true });
    expect(undoRedo()[1].disabled).toBe(true);
  });

  it('en solo lectura queda deshabilitado', () => {
    Object.assign(session, { openMode: 'readonly', activeChangesetId: null, activeProjectId: 'p1' });
    Object.assign(history, { stack: [], redoStack: [entry('Create table T')], busy: false });
    const redo = buttons().find((b) => b.name.startsWith('Redo'));
    expect(redo?.disabled).toBe(true);
  });
});

// Undo y Redo solo actúan sobre lo hecho en el canvas abierto (doc 133): si lo
// de arriba se hizo en otro, el tooltip dice en cuál y el botón sigue activo
// (al pulsarlo avisa y ofrece abrirlo).
describe('Toolbar: lo último se hizo en otro canvas', () => {
  const at = (label: string, canvasId: string | null) => ({ label, run: async () => null, canvasId });
  const CANVASES = [{ id: 'sa1', name: 'Uno' }, { id: 'sa2', name: 'Ventas' }];

  it('el tooltip dice en qué canvas y el botón sigue activo', () => {
    Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    Object.assign(modeler, { subjectAreas: CANVASES });
    Object.assign(history, { stack: [at('Edit column A', 'sa2')], redoStack: [at('Create table T', 'sa2')], busy: false });
    const [undo, redo] = undoRedo();
    expect(undo).toEqual({ name: 'Undo — Edit column A (on canvas Ventas)', disabled: false });
    expect(redo).toEqual({ name: 'Redo — Create table T (on canvas Ventas)', disabled: false });
  });

  it('lo del canvas abierto, como siempre; lo hecho sin canvas, desde el Object Inspector', () => {
    Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    Object.assign(modeler, { subjectAreas: CANVASES });
    Object.assign(history, { stack: [at('Edit column A', 'sa1')], redoStack: [at('Create table T', null)], busy: false });
    const [undo, redo] = undoRedo();
    expect(undo.name).toBe('Undo — Edit column A (Mod+Z)');
    expect(redo.name).toBe('Redo — Create table T in the Object Inspector (Mod+Shift+Z)');
  });
});
