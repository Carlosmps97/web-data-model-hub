// Flujos de borrado compartidos por el menú del canvas y los paneles. Borrar
// varias columnas lee su impacto (links de la tabla) y sus vistas a la vez, abre
// un solo diálogo y borra con las relaciones de ese impacto. Si mientras lee se
// cierra el menú o se abre otra versión, no hay diálogo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { textOf } from '../../reporting/components/fakeReact.testutil';

vi.mock('@/components/ui/dialogs', () => ({
  confirmDialog: vi.fn(async (o: { action?: () => Promise<unknown> }) => { if (o.action) await o.action(); return true; }),
}));
vi.mock('@/services/governance.service', () => ({
  tableLinks: vi.fn(), tableUsage: vi.fn(), listRelationships: vi.fn(), listColumns: vi.fn(),
}));
vi.mock('@/services/views.service', () => ({ listViews: vi.fn() }));

import { confirmDialog } from '@/components/ui/dialogs';
import { facetNouns } from '@/lib/facets';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { askDeleteColumns, askDeleteTable, askRemoveFromCanvas, readEmptiedViews } from './deleteFlows';

const col = (id: string, extra: object = {}) =>
  ({ id, tableId: 'tP', physicalName: id.toUpperCase(), logicalName: `log_${id}`, dataType: 'INT', typeOverridden: false, ordinal: 0, ...extra });
const PA = col('pa'), PB = col('pb');
const LINK = { id: 'r1', parentTableId: 'tP', parentTableName: 'P', childTableId: 'tH', childTableName: 'H',
  parentCardinality: 'one', childCardinality: 'many', identifying: false, canvases: [],
  pairs: [{ parentColumnId: 'pa', parentColumnName: 'PA', childColumnId: 'ha', childColumnName: 'HA' }] };
const VIEW = { id: 'v1', name: 'VU_P', tableId: 'tP', sourceTableIds: ['tP'],
  sources: [{ tableId: 'tP', column: 'PA', outputAlias: 'PA' }, { tableId: 'tP', column: 'PB', outputAlias: 'PB' }] };
const dialog = () => vi.mocked(confirmDialog).mock.calls[0][0];
const TABLE = { id: 'tP', physicalName: 'P', logicalName: 'p' };

let pushToast: ReturnType<typeof vi.fn>;
let deleteColumns: ReturnType<typeof vi.fn>;
const ask = (extra: Partial<Parameters<typeof askDeleteColumns>[0]> = {}) => askDeleteColumns({
  tableId: 'tP', tableName: 'P', cols: [PA, PB] as never, viewMode: 'physical',
  pushToast: pushToast as never, deleteColumns: deleteColumns as never, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  pushToast = vi.fn();
  deleteColumns = vi.fn(async () => {});
  vi.mocked(gov.tableLinks).mockResolvedValue({ links: [LINK], total: 1 } as never);
  vi.mocked(viewsSvc.listViews).mockResolvedValue([] as never);
  vi.mocked(gov.listColumns).mockResolvedValue([PA, PB] as never);
});

describe('borrar varias columnas desde el menú', () => {
  it('lee los links y las vistas a la vez y abre un solo diálogo con todas', async () => {
    let links!: (v: unknown) => void;
    let views!: (v: unknown) => void;
    vi.mocked(gov.tableLinks).mockReturnValueOnce(new Promise((r) => { links = r; }) as never);
    vi.mocked(viewsSvc.listViews).mockReturnValueOnce(new Promise((r) => { views = r; }) as never);
    const run = ask();
    await Promise.resolve();
    expect(gov.tableLinks).toHaveBeenCalledWith('tP');
    expect(viewsSvc.listViews).toHaveBeenCalledWith('tP');
    links({ links: [LINK], total: 1 });
    views([]);
    await run;
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(dialog().title).toBe('Delete 2 columns');
    expect(textOf(dialog().message)).toContain('PAPB');
  });

  it('la acción borra con las relaciones del impacto (y las columnas: el canvas puede cerrarse con el diálogo abierto) y avisa', async () => {
    await ask();
    expect(deleteColumns).toHaveBeenCalledWith(['pa', 'pb'], ['r1'], { cols: [PA, PB] });
    expect(pushToast).toHaveBeenCalledWith('2 columns and their relationships deleted');
  });

  it('sin relaciones, el aviso solo dice cuántas', async () => {
    vi.mocked(gov.tableLinks).mockResolvedValueOnce({ links: [], total: 0 } as never);
    await ask();
    expect(deleteColumns).toHaveBeenCalledWith(['pa', 'pb'], [], { cols: [PA, PB] });
    expect(pushToast).toHaveBeenCalledWith('2 columns deleted');
  });

  it('una sola columna: los textos de siempre', async () => {
    await ask({ cols: [PA] as never });
    expect(dialog().title).toBe('Delete column');
    expect(pushToast).toHaveBeenCalledWith('Column and its relationships deleted');
  });

  it('sin el impacto no se abre el diálogo ni se borra', async () => {
    vi.mocked(gov.tableLinks).mockRejectedValueOnce(new Error('sin red'));
    await ask();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(deleteColumns).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith("Couldn't check the relationships of these columns: nothing was deleted. Try again.", 'err');
  });

  it('una vista que queda sin columnas se nombra; sin las vistas, el diálogo lo dice', async () => {
    vi.mocked(viewsSvc.listViews).mockResolvedValueOnce([VIEW] as never);
    await ask();
    expect(textOf(dialog().message)).toContain('This view will be left without columns: VU_P. Edit or delete it afterwards.');
    vi.mocked(confirmDialog).mockClear();
    vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('sin red'));
    await ask();
    expect(textOf(dialog().message)).toContain("Couldn't check which views would be left without columns.");
    expect(deleteColumns).toHaveBeenCalledTimes(2);
  });

  it('en lógico, con los nombres lógicos', async () => {
    await ask({ viewMode: 'logical' });
    expect(dialog().title).toBe('Delete 2 attributes');
    expect(textOf(dialog().message)).toContain('log_palog_pb');
  });

  it('si el menú se cerró mientras leía, un error del impacto no se avisa', async () => {
    vi.mocked(gov.tableLinks).mockRejectedValueOnce(new Error('sin red'));
    await ask({ stillWanted: () => false });
    expect(pushToast).not.toHaveBeenCalled();
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('si mientras leía se cerró el menú, no hay diálogo', async () => {
    const beforeDialog = vi.fn();
    await ask({ stillWanted: () => false, beforeDialog });
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(beforeDialog).not.toHaveBeenCalled();
  });

  it('el menú se cierra justo antes de abrir el diálogo', async () => {
    const order: string[] = [];
    vi.mocked(confirmDialog).mockImplementationOnce(async () => { order.push('dialog'); return false; });
    await ask({ stillWanted: () => true, beforeDialog: () => order.push('close') });
    expect(order).toEqual(['close', 'dialog']);
  });

  it('si mientras leía se abrió otra versión, no hay diálogo', async () => {
    let links!: (v: unknown) => void;
    vi.mocked(gov.tableLinks).mockReturnValueOnce(new Promise((r) => { links = r; }) as never);
    const run = ask();
    await Promise.resolve();
    useSessionStore.setState({ activeChangesetId: 'cs2' });
    links({ links: [LINK], total: 1 });
    await run;
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(deleteColumns).not.toHaveBeenCalled();
  });

  it('si el lote se rechaza, avisa el motivo', async () => {
    deleteColumns.mockRejectedValueOnce(new Error("Relationship must migrate the parent's full primary key (parent has 2 PK column(s), got 1 pair(s))."));
    vi.mocked(confirmDialog).mockImplementationOnce(async (o) => { await o.action?.(); return true; });
    await ask();
    expect(pushToast).toHaveBeenCalledWith("Relationship must migrate the parent's full primary key (parent has 2 PK column(s), got 1 pair(s)).", 'err');
    expect(pushToast).not.toHaveBeenCalledWith('2 columns and their relationships deleted');
  });
});

describe('un borrado a la vez por tabla (el menú y el panel pueden pedir el mismo)', () => {
  it('un segundo pedido mientras el primero sigue no abre otro diálogo; terminado, se puede volver a pedir', async () => {
    let links!: (v: unknown) => void;
    vi.mocked(gov.tableLinks).mockReturnValueOnce(new Promise((r) => { links = r; }) as never);
    const first = ask();
    await ask();
    vi.mocked(gov.tableUsage).mockResolvedValue({ usage: [], total: 0 } as never);
    vi.mocked(gov.listRelationships).mockResolvedValue([] as never);
    await askDeleteTable({ table: TABLE as never, nouns: facetNouns('physical'), pushToast: pushToast as never, deleteTable: vi.fn(async () => {}) });
    links({ links: [LINK], total: 1 });
    await first;
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(deleteColumns).toHaveBeenCalledTimes(1);
    await ask();
    expect(confirmDialog).toHaveBeenCalledTimes(2);
  });
});

describe('el candado por tabla y los pedidos cancelados', () => {
  it('un pedido cancelado (el menú se cerró mientras leía) no retiene la tabla: el siguiente abre su diálogo', async () => {
    let links!: (v: unknown) => void;
    vi.mocked(gov.tableLinks).mockReturnValueOnce(new Promise((r) => { links = r; }) as never);
    let wanted = true;
    const first = ask({ stillWanted: () => wanted });
    try {
      await Promise.resolve();
      wanted = false;
      await ask();
      expect(confirmDialog).toHaveBeenCalledTimes(1);
    } finally {
      links({ links: [LINK], total: 1 });
      await first;
    }
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(deleteColumns).toHaveBeenCalledTimes(1);
  });

  it('con el diálogo del primero abierto (el menú ya cerrado), un segundo pedido no abre otro', async () => {
    let answer!: (ok: boolean) => void;
    vi.mocked(confirmDialog).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    let wanted = true;
    const first = ask({ stillWanted: () => wanted, beforeDialog: () => { wanted = false; } });
    try {
      await new Promise((r) => setTimeout(r, 0));
      expect(confirmDialog).toHaveBeenCalledTimes(1);
      await ask();
      expect(confirmDialog).toHaveBeenCalledTimes(1);
    } finally {
      answer?.(false);
      await first;
    }
  });

  it('el cancelado que termina después no le suelta la tabla al que la tomó', async () => {
    let links!: (v: unknown) => void;
    let answer!: (ok: boolean) => void;
    vi.mocked(gov.tableLinks).mockReturnValueOnce(new Promise((r) => { links = r; }) as never);
    vi.mocked(confirmDialog).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    let wanted = true;
    const canceled = ask({ stillWanted: () => wanted });
    let second: Promise<void> | undefined;
    try {
      await Promise.resolve();
      wanted = false;
      second = ask();                                     // toma la tabla y abre su diálogo
      await new Promise((r) => setTimeout(r, 0));
      links({ links: [LINK], total: 1 });
      await canceled;                                     // el cancelado termina
      await ask();                                        // un tercero: el diálogo del segundo sigue abierto
      expect(confirmDialog).toHaveBeenCalledTimes(1);
    } finally {
      links?.({ links: [LINK], total: 1 });
      answer?.(false);
      await canceled;
      await second;
    }
  });

  it('el pedido ignorado lo dice y cierra su menú (columnas y tabla)', async () => {
    let links!: (v: unknown) => void;
    vi.mocked(gov.tableLinks).mockReturnValueOnce(new Promise((r) => { links = r; }) as never);
    const first = ask();
    try {
      const beforeDialog = vi.fn();
      await ask({ stillWanted: () => true, beforeDialog });
      expect(beforeDialog).toHaveBeenCalled();
      expect(pushToast).toHaveBeenCalledWith('A delete on this table is already in progress');
      pushToast.mockClear();
      await askDeleteTable({ table: TABLE as never, nouns: facetNouns('physical'), pushToast: pushToast as never, deleteTable: vi.fn(async () => {}) });
      expect(pushToast).toHaveBeenCalledWith('A delete on this table is already in progress');
    } finally {
      links({ links: [LINK], total: 1 });
      await first;
    }
    expect(confirmDialog).toHaveBeenCalledTimes(1);
  });

  // Los paneles toman el candado, avisan si otro borrado lo tiene y lo sueltan
  // siempre (también si falla o se cancela). Sin DOM: se revisa el fuente.
  describe('los paneles comparten el candado con el menú', () => {
    const code = (f: string) => readFileSync(join(__dirname, f), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const fn = (file: string, head: RegExp) => new RegExp(`${head.source}([\\s\\S]*?)\\n {2}\\};`).exec(code(file))?.[1] ?? '';
    it.each([
      ['ColumnPropertiesPanel.tsx', /const removeCol = async \(\) => \{/, 'col.tableId', /pushToast\(busyMessage\(facetNouns\(viewMode\)\)\)/],
      ['ObjectInspector.tsx', /const askDeleteColumn = async \(c: CanonicalColumn\) => \{/, 'c.tableId', /toast\.message\(busyMessage\(nouns\)\)/],
      ['ObjectInspector.tsx', /const askDeleteTable = async \(\) => \{/, 'target.id', /toast\.message\(busyMessage\(nouns\)\)/],
    ])('%s %s', (file, head, key, say) => {
      const body = fn(file, head);
      expect(body).toContain(`const hold = holdTable(${key});`);
      expect(body).toMatch(new RegExp(`if \\(!hold\\) \\{ ${say.source}; return; \\}`));
      expect(body).toMatch(/finally \{[^}]*hold\.release\(\);[^}]*\}/);
    });
    it('el Inspector suelta la tabla antes de refrescarse', () => {
      expect(fn('ObjectInspector.tsx', /const askDeleteColumn = async \(c: CanonicalColumn\) => \{/)).toMatch(/hold\.release\(\);\s*await refresh\(\);/);
    });
  });
});

describe('vistas que quedan sin columnas', () => {
  it('sus nombres; null si no se pudieron leer (nunca rechaza)', async () => {
    vi.mocked(viewsSvc.listViews).mockResolvedValueOnce([VIEW, { ...VIEW, id: 'v2', name: 'VU_OTRA', sources: [VIEW.sources[0], { expression: '1' }] }] as never);
    expect(await readEmptiedViews('tP', [PA, PB])).toEqual(['VU_P']);
    vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('sin red'));
    expect(await readEmptiedViews('tP', [PA])).toBeNull();
    vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'));
    expect(await readEmptiedViews('tP', [PA])).toBeNull();
  });

  it('una columna repetida (homónima) que queda en la tabla sostiene la vista', async () => {
    // PA y PA2 se llaman igual: borrar PA deja a PA2, y la fuente «PA» de la
    // vista sigue resolviendo a ella.
    const PA2 = col('pa2', { physicalName: 'PA' });
    vi.mocked(gov.listColumns).mockResolvedValue([PA, PA2, PB] as never);
    vi.mocked(viewsSvc.listViews).mockResolvedValue([{ ...VIEW, sources: [VIEW.sources[0]] }] as never);
    expect(await readEmptiedViews('tP', [PA])).toEqual([]);
    expect(await readEmptiedViews('tP', [PA, PA2])).toEqual(['VU_P']);
  });
});

describe('quitar y borrar la tabla (los del panel Properties)', () => {
  beforeEach(() => {
    vi.mocked(gov.tableUsage).mockResolvedValue({ usage: [{ canvasId: 'sa1' }], total: 1 } as never);
    vi.mocked(gov.listRelationships).mockResolvedValue([] as never);
  });

  it('borrar: cuenta el impacto, abre el diálogo y la acción borra la tabla', async () => {
    const deleteTable = vi.fn(async () => {});
    await askDeleteTable({ table: TABLE as never, nouns: facetNouns('physical'), pushToast: pushToast as never, deleteTable });
    expect(dialog().title).toBe('Delete table');
    expect(deleteTable).toHaveBeenCalledWith('tP');
    expect(pushToast).toHaveBeenCalledWith('Table deleted');
  });

  it('borrar: si mientras contaba se cerró el menú, no hay diálogo', async () => {
    const deleteTable = vi.fn(async () => {});
    await askDeleteTable({ table: TABLE as never, nouns: facetNouns('physical'), pushToast: pushToast as never, deleteTable, stillWanted: () => false });
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(deleteTable).not.toHaveBeenCalled();
  });

  it('quitar del canvas: confirma, quita y avisa', async () => {
    const remove = vi.fn(async () => {});
    await askRemoveFromCanvas({ table: TABLE as never, nouns: facetNouns('physical'), pushToast: pushToast as never, remove });
    expect(dialog().title).toBe('Remove from canvas');
    expect(remove).toHaveBeenCalledWith('tP');
    expect(pushToast).toHaveBeenCalledWith('Table removed from this canvas');
  });
});
