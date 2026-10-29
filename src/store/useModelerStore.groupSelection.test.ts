// Grupo de tablas del canvas (doc 134 §3.2–§3.6): `groupIds` es vacío o de 2+
// tablas; con grupo, Properties se cierra; un cuadro de una sola tabla es la
// selección de siempre (sin encuadrar). El portapapeles de grupo copia por valor,
// con la posición de cada tabla, y es excluyente con el de tabla y el de columnas.
// «Select area» y las herramientas de relación/subcategoría se excluyen.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import { GROUP_MAX } from '@/features/modeler/lib/canvasMenu';
import { useModelerStore } from './useModelerStore';

const st = () => useModelerStore.getState();
const col = (id: string, tableId: string, ordinal: number, extra: object = {}) =>
  ({ id, tableId, physicalName: id.toUpperCase(), logicalName: id, dataType: 'INT', typeOverridden: false, ordinal, ...extra });
const DIAGRAM = {
  subjectArea: { id: 'sa1', name: 's', tableIds: ['t1', 't2'] },
  tables: [{ id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', udpValues: { u: '1' } }, { id: 't2', physicalName: 'M_PEDIDO', logicalName: 'Pedido' }],
  columns: [col('c2', 't1', 1), col('c1', 't1', 0, { udpValues: { x: 'y' } }), col('p1', 't2', 0)],
  relationships: [], views: [],
} as never;
const POS: Record<string, { x: number; y: number }> = { t1: { x: 10.4, y: 20.6 }, t2: { x: 400, y: 0 } };
const flow = { getNode: (id: string) => (POS[id] ? { id, position: POS[id] } : undefined) } as never;

beforeEach(() => {
  useModelerStore.setState({
    diagram: JSON.parse(JSON.stringify(DIAGRAM)), flow, activeSaId: 'sa1',
    colSel: null, colMenu: null, colClipboard: null, tblClipboard: null, groupClipboard: null,
    groupIds: [], groupSeq: 0, boxSelect: false, relPreset: null, subcatArmed: false,
    selectedTableId: null, selectedColumnId: null, selectedViewId: null, selectedEdgeId: null,
  });
});

describe('setGroup / selectBox', () => {
  it('menos de dos tablas no es un grupo; sin repetidos', () => {
    st().setGroup(['t1']);
    expect(st().groupIds).toEqual([]);
    st().setGroup(['t1', 't2', 't1']);
    expect(st().groupIds).toEqual(['t1', 't2']);
  });
  it('con grupo, Properties y la selección de filas se cierran', () => {
    useModelerStore.setState({ selectedTableId: 't1', selectedColumnId: 'c1', colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' } });
    st().setGroup(['t1', 't2']);
    expect([st().selectedTableId, st().selectedColumnId, st().colSel]).toEqual([null, null, null]);
  });
  it('lo que viene de React Flow no vuelve a escribirle (`groupSeq` no sube)', () => {
    st().setGroup(['t1', 't2']);
    expect(st().groupSeq).toBe(1);
    st().setGroup(['t2', 't1'], { fromFlow: true });
    expect(st().groupIds).toEqual(['t2', 't1']);
    st().setGroup([], { fromFlow: true });
    expect(st().groupIds).toEqual([]);
    expect(st().groupSeq).toBe(1);
  });
  it('seleccionar una tabla (clic, Locate, crearla, pegarla) suelta el grupo; deseleccionar no lo toca', () => {
    st().setGroup(['t1', 't2']);
    st().setSelectedTable(null);
    expect(st().groupIds).toEqual(['t1', 't2']);
    st().setSelectedTable('t2');
    expect([st().groupIds, st().selectedTableId, st().groupSeq]).toEqual([[], 't2', 2]);
  });
  it('enfocar una columna de una tabla (buscador) también suelta el grupo', () => {
    st().setGroup(['t1', 't2']);
    st().focusColumnInPanel('t1', 'c1', { frame: false });
    expect([st().groupIds, st().selectedTableId, st().selectedColumnId]).toEqual([[], 't1', 'c1']);
  });
  it('un cuadro con una tabla la selecciona sin encuadrar; vacío limpia', () => {
    const frame = vi.spyOn(st(), 'frameTable');
    st().selectBox(['t2']);
    expect(st().selectedTableId).toBe('t2');
    expect(st().groupIds).toEqual([]);
    expect(frame).not.toHaveBeenCalled();
    st().selectBox([]);
    expect(st().selectedTableId).toBeNull();
  });
  it('seleccionar filas limpia el grupo', () => {
    st().setGroup(['t1', 't2']);
    st().toggleColSelect('t1', 'c1', 'single');
    expect(st().groupIds).toEqual([]);
  });
});

describe('copyTables', () => {
  it('por valor, en el orden del grupo y con la posición redondeada de cada una', () => {
    expect(st().copyTables(['t2', 't1'])).toBe(2);
    const clip = st().groupClipboard!;
    expect(clip.tables.map((t) => t.table.id)).toEqual(['t2', 't1']);
    expect(clip.tables[1].cols.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(clip.tables.map((t) => t.pos)).toEqual([{ x: 400, y: 0 }, { x: 10, y: 21 }]);
    const d = st().diagram!;
    d.tables[0].physicalName = 'MUTADO';
    d.columns[1].udpValues!.x = 'mutado';
    expect(clip.tables[1].table.physicalName).toBe('M_CLIENTE');
    expect(clip.tables[1].cols[0].udpValues).toEqual({ x: 'y' });
  });
  it('excluyente con el portapapeles de tabla y el de columnas, en los dos sentidos', () => {
    st().copyTable('t1');
    st().copyTables(['t1', 't2']);
    expect(st().tblClipboard).toBeNull();
    st().copyTable('t1');
    expect(st().groupClipboard).toBeNull();
    st().copyTables(['t1', 't2']);
    useModelerStore.setState({ colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' } });
    st().copySelectedColumns();
    expect(st().groupClipboard).toBeNull();
  });
  it(`más de ${GROUP_MAX} no copia`, () => {
    expect(st().copyTables(Array.from({ length: GROUP_MAX + 1 }, (_, i) => `t${i}`))).toBe(0);
    expect(st().groupClipboard).toBeNull();
  });
});

describe('«Select area» y las herramientas', () => {
  it('encender el modo desarma relación y subcategoría; armarlas lo apaga', () => {
    useModelerStore.setState({ relPreset: { parent: 'one', child: 'many', identifying: false } });
    st().setBoxSelect(true);
    expect([st().boxSelect, st().relPreset]).toEqual([true, null]);
    st().setRelPreset({ parent: 'one', child: 'many', identifying: false });
    expect(st().boxSelect).toBe(false);
    st().setBoxSelect(true);
    st().setSubcatArmed(true);
    expect(st().boxSelect).toBe(false);
  });
});
