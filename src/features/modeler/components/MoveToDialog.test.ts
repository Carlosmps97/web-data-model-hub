// «Move to…» sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil):
// la raíz y las carpetas del proyecto en orden de árbol, con sangría; los destinos
// que no se pueden elegir salen deshabilitados con su motivo; el buscador filtra
// por nombre sin tildes ni mayúsculas; Move manda el destino elegido.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
import MoveToDialog from './MoveToDialog';
import type { Folder, SubjectArea } from '../services/modeler.service';

const folder = (id: string, name: string, parentFolderId: string | null = null): Folder => ({ id, projectId: 'p1', parentFolderId, name, order: 0 });
const FOLDERS = [folder('F1', 'Riesgos'), folder('F2', 'Dominio', 'F1'), folder('F3', 'Modelo', 'F2'), folder('F4', 'Ventas')];
const CANVASES: SubjectArea[] = [];
let props: Parameters<typeof MoveToDialog>[0];

const options = (tree: unknown) => [...walk(tree)].filter((el) => el.props.role === 'option');
const option = (tree: unknown, label: string): El => {
  const hit = options(tree).find((o) => textOf(o).includes(label));
  if (!hit) throw new Error(`no option «${label}»`);
  return hit;
};
const button = (tree: unknown, label: string): El => {
  const hit = [...walk(tree)].find((el) => el.type === 'button' && textOf(el).trim() === label);
  if (!hit) throw new Error(`no button «${label}»`);
  return hit;
};
/** Re-render con el estado que dejaron los setters. */
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  return MoveToDialog(props);
}

beforeEach(() => {
  props = { item: { kind: 'folder', id: 'F2' }, name: 'Dominio', folders: FOLDERS, canvases: CANVASES, onMove: vi.fn(async () => {}), onClose: vi.fn() };
  resetFake();
});

describe('MoveToDialog', () => {
  it('la raíz y las carpetas en orden de árbol, con sangría', () => {
    const tree = MoveToDialog(props);
    expect(options(tree).map((o) => textOf(o).trim())).toEqual(['Models (project root)', 'Riesgos', 'Dominio', 'Modelo', 'Ventas']);
    const pad = (label: string) => (option(tree, label).props.style as { paddingLeft: number }).paddingLeft;
    expect(pad('Modelo')).toBeGreaterThan(pad('Dominio'));
    expect(pad('Dominio')).toBeGreaterThan(pad('Riesgos'));
  });

  it('lo que no se puede elegir sale deshabilitado con su motivo', () => {
    const tree = MoveToDialog(props);
    expect(option(tree, 'Dominio').props.disabled).toBe(true);
    expect(option(tree, 'Dominio').props.title).toBe("A folder can't be moved inside itself");
    expect(option(tree, 'Modelo').props.disabled).toBe(true);
    expect(option(tree, 'Riesgos').props.disabled).toBe(true);
    expect(option(tree, 'Riesgos').props.title).toBe('Already here');
    expect(option(tree, 'Ventas').props.disabled).toBe(false);
    expect(button(tree, 'Move').props.disabled).toBe(true);
  });

  it('el buscador filtra sin tildes ni mayúsculas y deja siempre la raíz', () => {
    let tree = MoveToDialog(props);
    const input = [...walk(tree)].find((el) => el.type === 'input')!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: 'VÉNT' } });
    tree = rerender();
    expect(options(tree).map((o) => textOf(o).trim())).toEqual(['Models (project root)', 'Ventas']);
  });

  it('elegir un destino y Move lo manda', async () => {
    let tree = MoveToDialog(props);
    (option(tree, 'Ventas').props.onClick as () => void)();
    tree = rerender();
    expect(button(tree, 'Move').props.disabled).toBe(false);
    (button(tree, 'Move').props.onClick as () => void)();
    expect(props.onMove).toHaveBeenCalledWith('F4');
  });

  it('mientras mueve, todo queda deshabilitado', () => {
    resetFake((init, i) => (i === 1 ? 'F4' : i === 2 ? true : init));   // [q, picked, busy]
    const tree = MoveToDialog(props);
    expect(button(tree, 'Move').props.disabled).toBe(true);
    expect(button(tree, 'Cancel').props.disabled).toBe(true);
    expect(option(tree, 'Ventas').props.disabled).toBe(true);
  });
});
