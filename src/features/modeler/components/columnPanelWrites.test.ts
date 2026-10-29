// El contenedor del panel de columna (doc 133 §13): su guardado y su borrado,
// sin DOM (hooks de mentira: ver features/reporting/components/fakeReact.testutil).
//  · P2: lo que el cuerpo manda ya desmontado llega al store con sus opciones, y
//    las vistas se re-apuntan a un físico nuevo solo si el guardado grabó.
//  · P3: si mientras se lee el impacto de «Delete column…» corre un Undo o un
//    Redo, el aviso se vuelve a leer al terminar el paso (debe mostrar las
//    relaciones vigentes); si el paso se llevó la columna, el borrado se cancela.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, runEffects, walk, type El } from '../../reporting/components/fakeReact.testutil';

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('@/store/useModelerStore', () => ({
  useModelerStore: Object.assign((pick: (s: unknown) => unknown) => pick(h.state), { getState: () => h.state }),
}));
vi.mock('@/store/useSessionStore', async (orig) => {
  const real = await orig<typeof import('@/store/useSessionStore')>();
  const hook = Object.assign((pick: (s: unknown) => unknown) => pick(real.useSessionStore.getState()), real.useSessionStore);
  return { ...real, useSessionStore: hook, sessionProjectId: () => 'p1' };
});
vi.mock('@/store/useUndoStore', async (orig) => {
  const real = await orig<typeof import('@/store/useUndoStore')>();
  const hook = Object.assign((pick: (s: unknown) => unknown) => pick(real.useUndoStore.getState()), real.useUndoStore);
  return { ...real, useUndoStore: hook };
});
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('@/services/governance.service', async (orig) => ({
  ...(await orig<object>()), listDomains: vi.fn(async () => []), physicalize: vi.fn(), columnImpact: vi.fn(),
}));
vi.mock('./deleteFlows', () => ({
  holdTable: vi.fn(() => ({ release: vi.fn(), dialog: false })), readEmptiedViews: vi.fn(async () => []), busyMessage: vi.fn(() => 'busy'),
}));
vi.mock('./deleteConfirm', () => ({ confirmDeleteColumn: vi.fn(async (o: { action: () => Promise<unknown> }) => { await o.action(); return true; }) }));
vi.mock('../lib/viewSync', () => ({ syncRenamedColumnInViews: vi.fn(async () => 0) }));

import { useSessionStore } from '@/store/useSessionStore';
import { useUndoStore } from '@/store/useUndoStore';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn } from '@/services/governance.service';
import { confirmDeleteColumn } from './deleteConfirm';
import { pinSession } from '../lib/sessionGuard';
import { syncRenamedColumnInViews } from '../lib/viewSync';
import ColumnPropertiesPanel, { ColumnPropsBody } from './ColumnPropertiesPanel';

const COL = { id: 'c1', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 0 } as CanonicalColumn;
const pushToast = vi.fn();

/** Monta el panel con la columna seleccionada y devuelve las props de su cuerpo. */
function mountPanel() {
  resetFake();
  const tree = ColumnPropertiesPanel({ pushToast });
  runEffects();
  return [...walk(tree)].find((e: El) => e.type === ColumnPropsBody)!.props as {
    onPatch: (id: string, fields: Partial<CanonicalColumn>, opts?: unknown) => Promise<void>;
    onDelete: () => Promise<void>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useUndoStore.setState({ busy: false, steps: 0 });
  useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1' });
  h.state = {
    diagram: {
      subjectArea: { id: 'saA', projectId: 'p1', name: 'A', tableIds: ['t1'], viewIds: [], layout: {}, routes: {} },
      tables: [{ id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' }], columns: [{ ...COL }], relationships: [], views: [],
    },
    selectedColumnId: 'c1', viewMode: 'physical', naming: null,
    setSelectedColumn: vi.fn(), setSelectedTable: vi.fn(), setPanelFocusCol: vi.fn(),
    updateColumn: vi.fn(async () => ({ views: 0 })), deleteColumn: vi.fn(async () => undefined), reload: vi.fn(async () => undefined),
  };
});

describe('guardado del panel (P2)', () => {
  it('lo que el cuerpo manda ya desmontado llega al store con sus opciones', async () => {
    const { onPatch } = mountPanel();
    const opts = { fromServer: true, pin: pinSession() };
    await onPatch('c1', { description: 'd' }, opts);
    expect(h.state.updateColumn).toHaveBeenCalledWith('c1', { description: 'd' }, opts);
  });

  it('el aviso dice cuántas vistas re-apuntó el guardado (van en su mismo lote); el panel no las toca aparte', async () => {
    h.state.updateColumn = vi.fn(async () => ({ views: 2 }));
    const { onPatch } = mountPanel();
    await onPatch('c1', { physicalName: 'NOMBRE_X' });
    expect(pushToast).toHaveBeenCalledWith('Rename also applied to 2 view(s)');
    expect(syncRenamedColumnInViews).not.toHaveBeenCalled();
  });

  it('sin vistas re-apuntadas, o si no grabó, no avisa', async () => {
    h.state.updateColumn = vi.fn(async () => ({ views: 0 }));
    await mountPanel().onPatch('c1', { physicalName: 'NOMBRE_X' });
    h.state.updateColumn = vi.fn(async () => null);
    await mountPanel().onPatch('c1', { physicalName: 'NOMBRE_Y' });
    expect(pushToast).not.toHaveBeenCalled();
  });
});

/** El impacto de la columna con estas relaciones. */
const impact = (...relIds: string[]) => ({
  total: relIds.length,
  relationships: relIds.map((relId) => ({ relId, parentTable: 'CLIENTE', childTable: 'PEDIDO', identifying: false })),
}) as unknown as gov.RelationshipImpact;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const asked = () => vi.mocked(confirmDeleteColumn).mock.calls.map(([o]) => o.impact.relationships.map((r) => r.relId));

describe('«Delete column…» con un Undo o Redo mientras se lee el impacto (P3)', () => {
  it('sin pasos de por medio, una sola lectura (sin latencia extra)', async () => {
    vi.mocked(gov.columnImpact).mockResolvedValue(impact());
    await mountPanel().onDelete();
    expect(gov.columnImpact).toHaveBeenCalledTimes(1);
    expect(h.state.deleteColumn).toHaveBeenCalledWith('c1', [], { col: expect.objectContaining({ id: 'c1' }) });
  });

  it('si un Undo terminó mientras se leía, vuelve a leer: el aviso y el borrado van con la relación que repuso', async () => {
    vi.mocked(gov.columnImpact)
      .mockImplementationOnce(async () => { useUndoStore.setState({ steps: 1 }); return impact(); })   // el Undo repone r2
      .mockResolvedValueOnce(impact('r2'));
    await mountPanel().onDelete();
    expect(gov.columnImpact).toHaveBeenCalledTimes(2);
    expect(asked()).toEqual([['r2']]);
    expect(h.state.deleteColumn).toHaveBeenCalledWith('c1', ['r2'], expect.anything());
  });

  it('si el paso sigue corriendo al terminar de leer, espera a que termine y vuelve a leer', async () => {
    vi.mocked(gov.columnImpact)
      .mockImplementationOnce(async () => {
        useUndoStore.setState({ busy: true });
        setTimeout(() => useUndoStore.setState({ busy: false, steps: 1 }), 5);
        return impact();
      })
      .mockResolvedValueOnce(impact('r2'));
    const done = mountPanel().onDelete();
    await sleep(1);
    expect(confirmDeleteColumn).not.toHaveBeenCalled();
    await done;
    expect(asked()).toEqual([['r2']]);
  });

  it('si el paso se llevó la columna (deshacer «Add column»), el borrado se cancela sin aviso y suelta la tabla', async () => {
    const { holdTable } = await import('./deleteFlows');
    const release = vi.fn();
    vi.mocked(holdTable).mockReturnValueOnce({ release, dialog: false } as never);
    vi.mocked(gov.columnImpact).mockImplementationOnce(async () => {
      useUndoStore.setState({ steps: 1 });
      h.state = { ...h.state, diagram: { ...(h.state.diagram as object), columns: [] } };
      return impact();
    });
    await mountPanel().onDelete();
    expect(confirmDeleteColumn).not.toHaveBeenCalled();
    expect(h.state.deleteColumn).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('si el paso cambió la selección (la columna sigue), el borrado también se cancela', async () => {
    vi.mocked(gov.columnImpact).mockImplementationOnce(async () => {
      useUndoStore.setState({ steps: 1 });
      h.state = { ...h.state, selectedColumnId: null };
      return impact();
    });
    await mountPanel().onDelete();
    expect(confirmDeleteColumn).not.toHaveBeenCalled();
    expect(h.state.deleteColumn).not.toHaveBeenCalled();
  });

  it('tras el paso, el aviso y el borrado van con la columna vigente (el Undo la renombró)', async () => {
    const { readEmptiedViews } = await import('./deleteFlows');
    vi.mocked(gov.columnImpact)
      .mockImplementationOnce(async () => {
        useUndoStore.setState({ steps: 1 });
        h.state = { ...h.state, diagram: { ...(h.state.diagram as object), columns: [{ ...COL, physicalName: 'NOMBRE_ANTES' }] } };
        return impact();
      })
      .mockResolvedValueOnce(impact());
    await mountPanel().onDelete();
    expect(vi.mocked(confirmDeleteColumn).mock.calls[0][0].name).toBe('NOMBRE_ANTES');
    expect(vi.mocked(readEmptiedViews).mock.calls.at(-1)?.[1]).toEqual([expect.objectContaining({ physicalName: 'NOMBRE_ANTES' })]);
    expect(h.state.deleteColumn).toHaveBeenCalledWith('c1', [], { col: expect.objectContaining({ physicalName: 'NOMBRE_ANTES' }) });
  });

  it('en la tercera lectura también espera el paso en curso: si se llevó la columna, se cancela', async () => {
    let n = 0;
    vi.mocked(gov.columnImpact).mockImplementation(async () => {
      n += 1;
      if (n < 3) { useUndoStore.setState({ steps: n }); return impact(); }
      useUndoStore.setState({ busy: true });
      setTimeout(() => {
        h.state = { ...h.state, diagram: { ...(h.state.diagram as object), columns: [] } };
        useUndoStore.setState({ busy: false, steps: 3 });
      }, 5);
      return impact();
    });
    await mountPanel().onDelete();
    expect(gov.columnImpact).toHaveBeenCalledTimes(3);
    expect(confirmDeleteColumn).not.toHaveBeenCalled();
  });

  it('a la tercera lectura sigue con la última (el store igual rechaza si otra relación usa la columna)', async () => {
    let n = 0;
    vi.mocked(gov.columnImpact).mockImplementation(async () => { n += 1; useUndoStore.setState({ steps: n }); return impact(`r${n}`); });
    await mountPanel().onDelete();
    expect(gov.columnImpact).toHaveBeenCalledTimes(3);
    expect(asked()).toEqual([['r3']]);
  });
});
