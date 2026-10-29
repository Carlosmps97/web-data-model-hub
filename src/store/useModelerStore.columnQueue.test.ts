// Dos guardados de la misma columna a la vez (un nombre y una descripción que
// Undo o Redo mandan juntos, o el cierre del panel) van en fila: cada uno arma
// su documento con la columna del diagrama más lo que grabaron los anteriores de
// la fila, así ninguno repone el valor viejo del campo del otro aunque la
// recarga no haya llegado (doc 133 §5). Cada uno es de la sesión en que se
// pidió: si cambió mientras esperaba su turno, no graba.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) =>
  (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, updateColumn: vi.fn(), recordChangesBulk: vi.fn() };
});

import * as gov from '@/services/governance.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const COL = { id: 'c1', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0 } as gov.CanonicalColumn;
/** La working copy: lo grabado por los guardados. */
let saved: Map<string, gov.CanonicalColumn>;

function showSaved() {
  useModelerStore.setState({
    activeSaId: 'sa1',
    diagram: {
      subjectArea: { id: 'sa1', projectId: 'p', name: 'Canvas', tableIds: ['t1'], viewIds: [], layout: {}, routes: {} },
      tables: [{ id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' }], columns: [...saved.values()], relationships: [], views: [],
    } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs1' });
  useUndoStore.getState().clear();
  saved = new Map([['c1', { ...COL }]]);
  showSaved();
  // La recarga trae lo grabado.
  useModelerStore.setState({ reload: vi.fn(async () => { await sleep(5); showSaved(); }) });
  vi.mocked(gov.updateColumn).mockImplementation(async (c) => { await sleep(10); saved.set(c.id, { ...c }); return {} as never; });
});

describe('guardados de la misma columna', () => {
  it('a la vez no se pisan: quedan los dos campos', async () => {
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { description: 'desc nueva' }),
      useModelerStore.getState().updateColumn('c1', { logicalName: 'nombre nuevo' }),
    ]);
    expect(saved.get('c1')).toMatchObject({ description: 'desc nueva', logicalName: 'nombre nuevo' });
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Edit column NOMBRE', 'Edit column NOMBRE']);
  });

  it('una recarga que no llegó a tiempo no le hace reponer al siguiente el campo del anterior; deshacer el último deja el otro', async () => {
    useModelerStore.setState({ reload: vi.fn(async () => { await sleep(5); }) });   // reemplazada: no trae lo grabado
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { description: 'desc nueva' }),
      useModelerStore.getState().updateColumn('c1', { logicalName: 'nombre nuevo' }),
    ]);
    expect(saved.get('c1')).toMatchObject({ description: 'desc nueva', logicalName: 'nombre nuevo' });
    await useUndoStore.getState().undoLast();
    expect(saved.get('c1')).toMatchObject({ description: 'desc nueva', logicalName: 'nombre' });
  });

  it('tras un cambio de llave en la fila, el siguiente guardado no lo repone', async () => {
    useModelerStore.setState({ reload: vi.fn(async () => { await sleep(5); }) });   // no trae lo grabado
    vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
      await sleep(10);
      for (const ch of changes) if (ch.collection === 'canonical_columns') saved.set(ch.entityId, { ...(ch.payload as unknown as gov.CanonicalColumn) });
      return undefined as never;
    });
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { isPrimaryKey: true }),
      useModelerStore.getState().updateColumn('c1', { description: 'desc' }),
    ]);
    expect(saved.get('c1')).toMatchObject({ isPrimaryKey: true, description: 'desc' });
  });

  it('un cambio de llave en la fila deja la columna en su nuevo lugar aunque la recarga no llegue', async () => {
    saved = new Map([
      ['k', { ...COL, id: 'k', physicalName: 'K', logicalName: 'k', isPrimaryKey: true, ordinal: 0 }],
      ['a', { ...COL, id: 'a', physicalName: 'A', logicalName: 'a', ordinal: 1 }],
      ['c1', { ...COL, ordinal: 2 }],
    ]);
    showSaved();
    useModelerStore.setState({ reload: vi.fn(async () => { await sleep(5); }) });   // no trae lo grabado
    vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
      await sleep(10);
      for (const ch of changes) if (ch.collection === 'canonical_columns') saved.set(ch.entityId, { ...(ch.payload as unknown as gov.CanonicalColumn) });
      return undefined as never;
    });
    await useModelerStore.getState().updateColumn('c1', { isPrimaryKey: true }).then(() => undefined);
    const moved = saved.get('c1')!.ordinal;
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { isPrimaryKey: false }).then(() => undefined),
    ]);
    // Encimados: la llave y otro campo; el segundo no repone el lugar viejo.
    saved.set('c1', { ...COL, ordinal: 2 }); saved.set('a', { ...COL, id: 'a', physicalName: 'A', logicalName: 'a', ordinal: 1 });
    showSaved();
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { isPrimaryKey: true }),
      useModelerStore.getState().updateColumn('c1', { description: 'desc' }),
    ]);
    expect(moved).toBe(1);
    expect(saved.get('c1')).toMatchObject({ isPrimaryKey: true, ordinal: 1, description: 'desc' });
  });

  it('el siguiente sale después de la recarga del anterior: quien pidió el primero ya ve lo grabado', async () => {
    const order: string[] = [];
    useModelerStore.setState({ reload: vi.fn(async () => { await sleep(30); showSaved(); order.push('recargó'); }) });
    vi.mocked(gov.updateColumn).mockImplementation(async (c) => {
      order.push(`graba ${c.logicalName}`); await sleep(10); saved.set(c.id, { ...c }); return {} as never;
    });
    const first = useModelerStore.getState().updateColumn('c1', { description: 'd' }).then(() => {
      order.push(`el primero ve «${useModelerStore.getState().diagram?.columns[0].description}»`);
    });
    await Promise.all([first, useModelerStore.getState().updateColumn('c1', { logicalName: 'n' })]);
    expect(order.indexOf('recargó')).toBeLessThan(order.indexOf('graba n'));
    expect(order).toContain('el primero ve «d»');
    expect(saved.get('c1')).toMatchObject({ description: 'd', logicalName: 'n' });
  });

  it('un cambio de llave en la fila no le hace reponer al siguiente lo que otra escritura cambió mientras tanto', async () => {
    saved.set('c1', { ...COL, isForeignKey: true });
    showSaved();
    let cleared = false;
    // La recarga del primero trae además una escritura ajena (p. ej. borrar una relación apagó el FK).
    useModelerStore.setState({ reload: vi.fn(async () => {
      await sleep(5);
      if (!cleared) { cleared = true; saved.set('c1', { ...saved.get('c1')!, isForeignKey: false }); }
      showSaved();
    }) });
    vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
      await sleep(10);
      for (const ch of changes) if (ch.collection === 'canonical_columns') saved.set(ch.entityId, { ...(ch.payload as unknown as gov.CanonicalColumn) });
      return undefined as never;
    });
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { isPrimaryKey: true }),
      useModelerStore.getState().updateColumn('c1', { description: 'desc' }),
    ]);
    expect(saved.get('c1')).toMatchObject({ isPrimaryKey: true, description: 'desc', isForeignKey: false });
  });

  it('terminada la fila, el siguiente guardado parte otra vez del diagrama (un Undo pudo reponerla)', async () => {
    await Promise.all([
      useModelerStore.getState().updateColumn('c1', { description: 'd1' }),
      useModelerStore.getState().updateColumn('c1', { logicalName: 'n1' }),
    ]);
    saved.set('c1', { ...COL });                      // p. ej. un Undo repuso la columna
    showSaved();
    await useModelerStore.getState().updateColumn('c1', { physicalName: 'NOMBRE_2' });
    expect(saved.get('c1')).toMatchObject({ logicalName: 'nombre', physicalName: 'NOMBRE_2' });
    expect(saved.get('c1')?.description).toBeUndefined();
  });

  it('lo grabado por la fila de una versión no se suma en otra', async () => {
    const posted: gov.CanonicalColumn[] = [];
    vi.mocked(gov.updateColumn).mockImplementation(async (c) => { posted.push({ ...c }); await sleep(30); return {} as never; });
    const first = useModelerStore.getState().updateColumn('c1', { description: 'en cs1' });
    await sleep(2);
    useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs2' });
    showSaved();
    const second = useModelerStore.getState().updateColumn('c1', { logicalName: 'en cs2' });
    await Promise.allSettled([first, second]);
    expect(posted.map((c) => [c.description, c.logicalName])).toEqual([['en cs1', 'nombre'], [undefined, 'en cs2']]);
  });

  it('el que esperaba su turno no graba si mientras tanto se abrió otra versión', async () => {
    const first = useModelerStore.getState().updateColumn('c1', { description: 'a' });
    const second = useModelerStore.getState().updateColumn('c1', { logicalName: 'b' });
    await sleep(2);                                  // el primero ya está grabando
    useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs2' });
    await Promise.allSettled([first, second]);
    expect(gov.updateColumn).toHaveBeenCalledTimes(1);
  });
});
