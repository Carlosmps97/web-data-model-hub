// Lo que el panel de columna tiene pendiente al cerrarse —cambiar de columna o de
// canvas, cerrar el panel— sale ya (doc 133 §13, P2), sobre la columna vigente
// de la versión (`fromServer`: si ya no está, no se graba) y con el pin de
// cuando se editó (su canvas). Con el panel abierto, lo de siempre. Sin DOM
// (hooks de mentira: ver features/reporting/components/fakeReact.testutil).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, runEffects, unmount, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('@/store/useModelerStore', () => ({
  useModelerStore: (pick: (s: unknown) => unknown) => pick({ viewMode: 'physical', naming: null }),
}));
vi.mock('@/store/useSessionStore', async (orig) => ({ ...(await orig<object>()), sessionProjectId: () => 'p1' }));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('@/services/governance.service', async (orig) => ({ ...(await orig<object>()), physicalize: vi.fn() }));

import { setCanvasSource, type SessionPin } from '../lib/sessionGuard';
import { useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { ColumnPropsBody } from './ColumnPropertiesPanel';

const COL = { id: 'c1', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0 } as CanonicalColumn;
const TABLE = { id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' } as CanonicalTable;
let canvas = 'A';
type Patch = (id: string, fields: Partial<CanonicalColumn>, opts?: { fromServer: true; pin: SessionPin }) => Promise<void>;

/** Monta el cuerpo del panel (efectos corridos) y devuelve su árbol. */
function mount(onPatch: Patch) {
  resetFake();
  const tree = ColumnPropsBody({
    col: COL, table: TABLE, cols: [COL], tab: 'definition', domains: [], udpDefs: [], view: 'physical',
    canEdit: true, onPatch, onDelete: vi.fn(),
  });
  runEffects();
  return tree;
}
/** Tipea en el campo de `placeholder`. */
const type = (tree: unknown, placeholder: string, value: string) => {
  const el = [...walk(tree)].find((e: El) => e.props.placeholder === placeholder)!;
  (el.props.onChange as (e: unknown) => void)({ target: { value } });
};

beforeEach(() => {
  vi.useFakeTimers();
  canvas = 'A';
  setCanvasSource(() => canvas);
  useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
});
afterEach(() => { vi.useRealTimers(); setCanvasSource(() => null); });

describe('panel de columna: lo pendiente al cerrarse', () => {
  it('el nombre tipeado hace menos de 400 ms sale ya, sobre la vigente y con el pin de la edición (otro canvas abierto)', () => {
    const onPatch = vi.fn<Patch>(async () => {});
    const tree = mount(onPatch);
    type(tree, 'Physical name', 'NOMBRE_X');
    canvas = 'B';                                    // p. ej. se abrió otro canvas: el panel se cierra
    unmount();
    expect(onPatch).toHaveBeenCalledTimes(1);
    const [id, fields, opts] = onPatch.mock.calls[0];
    expect([id, fields]).toEqual(['c1', { logicalName: 'nombre', physicalName: 'NOMBRE_X', physicalNameOverridden: true }]);
    expect(opts?.fromServer).toBe(true);
    expect(opts?.pin.canvasId).toBe('A');
    vi.advanceTimersByTime(1000);
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('la definición tipeada también, con su pin', () => {
    const onPatch = vi.fn<Patch>(async () => {});
    const tree = mount(onPatch);
    type(tree, 'What this attribute represents…', 'Nombre del cliente');
    canvas = 'B';
    unmount();
    const [id, fields, opts] = onPatch.mock.calls[0];
    expect([id, fields]).toEqual(['c1', { description: 'Nombre del cliente' }]);
    expect(opts?.fromServer).toBe(true);
    expect(opts?.pin.canvasId).toBe('A');
  });

  it('con el panel abierto, lo tipeado sale pasados 400 ms como siempre (sin `fromServer`)', () => {
    const onPatch = vi.fn<Patch>(async () => {});
    const tree = mount(onPatch);
    type(tree, 'Physical name', 'NOMBRE_X');
    type(tree, 'What this attribute represents…', 'def');
    vi.advanceTimersByTime(400);
    const calls = onPatch.mock.calls.map(([, f, o]) => [f, o]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([
      [{ description: 'def' }, undefined],
      [{ logicalName: 'nombre', physicalName: 'NOMBRE_X', physicalNameOverridden: true }, undefined],
    ]));
  });

  it('el dominio elegido que termina de grabarse con el panel ya cerrado va sobre la vigente y con su pin', async () => {
    let arrive!: (v: { physical: string }) => void;
    vi.mocked(gov.physicalize).mockImplementationOnce(() => new Promise((r) => { arrive = r; }));
    const onPatch = vi.fn<Patch>(async () => {});
    resetFake();
    const tree = ColumnPropsBody({
      col: COL, table: TABLE, cols: [COL], tab: 'datatype', udpDefs: [], view: 'physical', canEdit: true, onPatch, onDelete: vi.fn(),
      domains: [{ id: 'd1', name: 'Apellido Paterno', inheritsName: true } as never],
    });
    runEffects();
    const pick = [...walk(tree)].find((e: El) => typeof e.props.onPick === 'function')!;
    void (pick.props.onPick as (id: string) => Promise<void>)('d1');   // hereda el nombre: pide el físico
    canvas = 'B';
    unmount();
    arrive({ physical: 'APELLIDO_PATERNO' });
    await vi.waitFor(() => expect(onPatch).toHaveBeenCalled());
    const [id, fields, opts] = onPatch.mock.calls.at(-1)!;
    expect(id).toBe('c1');
    expect(fields).toMatchObject({ parentDomainId: 'd1', logicalName: 'Apellido Paterno', physicalName: 'APELLIDO_PATERNO' });
    expect(opts?.fromServer).toBe(true);
    expect(opts?.pin.canvasId).toBe('A');
  });

  it('si los nombres cambian en la versión sin nada tipeado (llega lo grabado al cerrarse), los campos toman lo vigente', () => {
    const onPatch = vi.fn<Patch>(async () => {});
    mount(onPatch);
    const states = nextStates();
    resetFake((init, i) => (i < states.length ? states[i] : init), { keepRefs: true });
    const NUEVO = { ...COL, logicalName: 'nombre nuevo', physicalName: 'NOMBRE_NUEVO' };
    const props = { col: NUEVO, table: TABLE, cols: [NUEVO], tab: 'definition' as const, domains: [], udpDefs: [], view: 'physical' as const, canEdit: true, onPatch, onDelete: vi.fn() };
    ColumnPropsBody(props);
    runEffects();
    const next = nextStates();
    resetFake((init, i) => (i < next.length ? next[i] : init), { keepRefs: true });
    const tree = ColumnPropsBody(props);
    const shown = (ph: string) => [...walk(tree)].find((e: El) => e.props.placeholder === ph)!.props.value;
    expect([shown('Logical name'), shown('Physical name')]).toEqual(['nombre nuevo', 'NOMBRE_NUEVO']);
    // Un commit posterior (otro físico) no repone el lógico viejo.
    type(tree, 'Physical name', 'NOMBRE_Z');
    vi.advanceTimersByTime(400);
    expect(onPatch.mock.calls.at(-1)?.[1]).toEqual({ logicalName: 'nombre nuevo', physicalName: 'NOMBRE_Z', physicalNameOverridden: true });
  });

  it('la recarga de un guardado propio anterior no repone su nombre mientras sale el siguiente', async () => {
    const landing: (() => void)[] = [];
    const onPatch = vi.fn<Patch>(() => new Promise<void>((r) => { landing.push(r); }));
    const props = (col: CanonicalColumn) => ({ col, table: TABLE, cols: [col], tab: 'definition' as const, domains: [], udpDefs: [], view: 'physical' as const, canEdit: true, onPatch, onDelete: vi.fn() });
    const rerender = (col: CanonicalColumn) => {
      const st = nextStates();
      resetFake((init, i) => (i < st.length ? st[i] : init), { keepRefs: true });
      const t = ColumnPropsBody(props(col));
      runEffects();
      return t;
    };
    const shown = (t: unknown) => [...walk(t)].find((e: El) => e.props.placeholder === 'Physical name')!.props.value;
    type(mount(onPatch), 'Physical name', 'COD');
    vi.advanceTimersByTime(400);                     // C1 (COD) sale
    type(rerender(COL), 'Physical name', 'CODCLI');
    vi.advanceTimersByTime(400);                     // C2 (CODCLI) sale detrás
    const W1 = { ...COL, physicalName: 'COD', physicalNameOverridden: true };
    rerender(W1);                                    // llega la recarga de C1
    landing[0]();
    await Promise.resolve(); await Promise.resolve();
    expect(shown(rerender(W1))).toBe('CODCLI');
    landing[1]();
    await Promise.resolve(); await Promise.resolve();
    expect(shown(rerender({ ...COL, physicalName: 'CODCLI', physicalNameOverridden: true }))).toBe('CODCLI');
  });

  it('mientras su guardado de nombres sigue en camino, una recarga con otros nombres no los repone', () => {
    let land!: () => void;
    const onPatch = vi.fn<Patch>(() => new Promise<void>((r) => { land = r; }));
    const props = (col: CanonicalColumn) => ({ col, table: TABLE, cols: [col], tab: 'definition' as const, domains: [], udpDefs: [], view: 'physical' as const, canEdit: true, onPatch, onDelete: vi.fn() });
    const rerender = (col: CanonicalColumn) => {
      const st = nextStates();
      resetFake((init, i) => (i < st.length ? st[i] : init), { keepRefs: true });
      const t = ColumnPropsBody(props(col));
      runEffects();
      return t;
    };
    type(mount(onPatch), 'Physical name', 'COD');
    vi.advanceTimersByTime(400);                     // sale y queda en camino
    rerender({ ...COL, physicalName: 'OTRO' });      // llega otra recarga (no es su eco)
    const tree = rerender({ ...COL, physicalName: 'OTRO' });
    expect([...walk(tree)].find((e: El) => e.props.placeholder === 'Physical name')!.props.value).toBe('COD');
    land();
  });

  it('con un nombre tipeado sin grabar, un cambio en la versión no lo pisa', () => {
    const onPatch = vi.fn<Patch>(async () => {});
    const tree0 = mount(onPatch);
    type(tree0, 'Physical name', 'NOMBRE_TIPEADO');   // agendado (400 ms)
    const states = nextStates();
    resetFake((init, i) => (i < states.length ? states[i] : init), { keepRefs: true });
    const NUEVO = { ...COL, logicalName: 'otro', physicalName: 'OTRO' };
    ColumnPropsBody({ col: NUEVO, table: TABLE, cols: [NUEVO], tab: 'definition', domains: [], udpDefs: [], view: 'physical', canEdit: true, onPatch, onDelete: vi.fn() });
    runEffects();
    vi.advanceTimersByTime(400);
    expect(onPatch.mock.calls.at(-1)?.[1]).toMatchObject({ physicalName: 'NOMBRE_TIPEADO' });
  });

  it('el desmontaje de prueba de StrictMode no deja el panel como cerrado', () => {
    const onPatch = vi.fn<Patch>(async () => {});
    const tree = mount(onPatch);
    unmount();                                       // StrictMode: limpia y vuelve a correr los efectos
    runEffects();
    type(tree, 'Physical name', 'NOMBRE_X');
    vi.advanceTimersByTime(400);
    expect(onPatch.mock.calls.map(([, , o]) => o)).toEqual([undefined]);
  });
});

// El Object Inspector monta el mismo cuerpo (componente grande: se revisa el
// fuente): su guardado arma la columna con `columnBase` —la vigente si el cuerpo
// ya se desmontó— y apila con el pin de la edición.
describe('Object Inspector: el mismo cuerpo, el mismo cierre', () => {
  const code = readFileSync(join(__dirname, 'ObjectInspector.tsx'), 'utf-8');
  it('sus guardados de una misma columna van en fila (`inObjectOrder`) y la base se lee dentro de la fila', () => {
    const body = /const patchColumn = [^\n]*\n([\s\S]*?)\n {2}\}\);\n/.exec(code)?.[1] ?? '';
    const queued = body.indexOf('await inObjectOrder(id, async () => {');
    expect(queued).toBeGreaterThan(-1);
    expect(body.indexOf('await columnBase(')).toBeGreaterThan(queued);
  });

  it('el detalle de la columna pasa las opciones del cierre a su guardado', () => {
    expect(code).toMatch(/onPatch: \(id: string, fields: Partial<CanonicalColumn>, opts\?: ColumnPatchOpts\) => Promise<void>;/);
  });

  it('el panel de tabla repone la intención sobre el físico al cambiar la tabla ELEGIDA (no cuando la tabla sale y vuelve al canvas)', () => {
    const panel = readFileSync(join(__dirname, 'PropertiesPanel.tsx'), 'utf-8');
    expect(panel).toMatch(/setPhysTouched\(null\);\s*setColQuery\(''\);[^}]*\}, \[selectedTableId\]\);/);
  });

  it('su guardado de columna usa el pin de la edición y la vigente con `fromServer`', () => {
    expect(code).toMatch(/const patchColumn = \(id: string, fields: Partial<CanonicalColumn>, opts\?: ColumnPatchOpts\) => historyAction\(async \(\) => \{\s*const pin = opts\?\.pin \?\? pinSession\(\);/);
    expect(code).toMatch(/await columnBase\(id, dataRef\.current\?\.columns\.find\(\(x\) => x\.id === id\), opts\?\.fromServer\)/);
  });
});
